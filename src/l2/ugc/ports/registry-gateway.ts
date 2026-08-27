/**
 * L2 → wakeup-ugc 端口：`DefinitionRegistryGateway` 实现（按目标层各一份）。
 *
 * 契约（`definition-ports.ts` 已确认内核旧 `DefRegistry` 不满足）：
 * 1. 内部工作副本完成新增/覆盖/删除/入边重验/快照生成；
 * 2. compare-and-swap 一次发布，`expected` 不匹配即拒绝；
 * 3. 失败时返回与旧快照**完全相同**的指纹，且 `unchanged` 为 true；
 * 4. 单次 `activateAtomically` 完成整个变更集。
 *
 * l2 的 `registry/definition-registry.ts#activate` 恰好是「不可变值 + 纯函数、一次性原子替换」的语义，
 * 完美对上第 1、2、4 条。本端口做的是把它包成「有状态的注册表句柄」并加上 CAS 语义：
 * - 端口持有当前 `ActiveRegistry`（模块外不可见）；
 * - `activateAtomically` 先比对 `expected.definitionRegistryVersion` 与当前快照版本，不符即拒绝，
 *   且返回的 `previousSnapshotFingerprint === activeSnapshotFingerprint`（第 3 条）；
 * - 版本相符则调用 l2 `activate`，成功才替换持有的 registry。
 *
 * 这不是把 l2 的激活逻辑复制一份，而是给它套上 UGC 需要的「基线令牌 + CAS 发布」外壳——
 * 那层外壳是端口边界的语义，l2 的纯函数 `activate` 本身没有、也不该有「当前状态」这个概念。
 */

import type { Diagnostic as KernelDiagnostic } from '../../../core/kernel/state/diagnostic';
import type { DiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import { createDiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import { sha256FingerprintGateway } from '../../../core/ugc/ports/sha256-fingerprint-gateway';
import type { StableFingerprintGateway } from '../../../core/ugc/model/fingerprint';
import type { DefinitionRegistryGateway } from '../../../core/ugc/ports/definition-ports';
import type { TargetOwnership } from '../../../core/ugc/model/candidate';
import type { ValidationBaseline } from '../../../core/ugc/model/baseline';
import type { ActivationResult } from '../../../core/ugc/model/report';
import type { ValidatedChangeSet } from '../../../core/ugc/model/validated-change-set';
import type { DefinitionRegistryReadSnapshot } from '../../../core/ugc/model/upstream';
import { activate } from '../../registry/definition-registry';
import type { ActiveRegistry } from '../../registry/definition-registry';
import { emptyRegistry } from '../../registry/definition-registry';
import { createSourceIndex } from './source-index';
import { projectL2Diagnostics, type DiagnosticProjectionContext } from './diagnostic-projection';
import {
  L2_PORT_PROVIDER_ID,
  L2_PORT_VERSION,
  L2_SNAPSHOT_PAYLOAD_KIND,
  registryVersionToken,
  readValidatedPayload,
  type L2SnapshotPayload,
} from './port-common';

const REGISTRY_STAGE = 'activation-precheck' as const;

export interface L2RegistryGatewayOptions {
  readonly targetOwnership: TargetOwnership;
  /** 初始活动注册表；缺省为空。 */
  readonly initial?: ActiveRegistry;
  readonly fingerprintGateway?: StableFingerprintGateway;
  readonly catalog?: DiagnosticCodeCatalog;
  readonly factory?: UGCDiagnosticFactory;
}

/**
 * l2 注册表句柄不仅是 `DefinitionRegistryGateway`，还额外暴露 `currentRegistry()`：
 * 验证/解析端口需要拿到「本提供方铸造的」活动快照载荷去核对，装配层用它把三个端口接到同一状态上。
 */
export interface L2DefinitionRegistryGateway extends DefinitionRegistryGateway {
  /** 当前活动注册表（供装配层构造快照载荷；不供 UGC 直接读取内部结构）。 */
  currentRegistry(): ActiveRegistry;
}

function snapshotOf(
  registry: ActiveRegistry,
  targetOwnership: TargetOwnership,
): DefinitionRegistryReadSnapshot {
  const fingerprint = registry.snapshot.fingerprint;
  return Object.freeze({
    registryVersion: registryVersionToken(targetOwnership, fingerprint),
    snapshotFingerprint: fingerprint,
    targetOwnership,
    activeDefinitionIds: Object.freeze([...registry.definitions.keys()].sort()),
    payload: Object.freeze({
      kind: L2_SNAPSHOT_PAYLOAD_KIND,
      providerId: L2_PORT_PROVIDER_ID,
      registry,
    } satisfies L2SnapshotPayload),
  });
}

/** 构造一条拒绝结果，`unchanged` 为 true 且前后指纹相同（契约第 3 条）。 */
function rejection(
  baseline: ValidationBaseline,
  change: ValidatedChangeSet,
  currentFingerprint: string,
  diagnostics: readonly KernelDiagnostic[],
): ActivationResult {
  return Object.freeze({
    status: 'rejected',
    baseline,
    candidateFingerprint: change.candidateFingerprint,
    changeRequestFingerprint: change.changeRequestFingerprint,
    diagnostics: Object.freeze([...diagnostics]),
    previousSnapshotFingerprint: currentFingerprint,
    activeSnapshotFingerprint: currentFingerprint,
    unchanged: true,
  });
}

/** 创建按目标层的 l2 注册表端口。 */
export function createL2DefinitionRegistryGateway(
  options: L2RegistryGatewayOptions,
): L2DefinitionRegistryGateway {
  const targetOwnership = options.targetOwnership;
  const catalog =
    options.catalog ?? createDiagnosticCodeCatalog(options.fingerprintGateway ?? sha256FingerprintGateway);
  const factory = options.factory ?? createDiagnosticFactory(catalog);
  let current: ActiveRegistry = options.initial ?? emptyRegistry();

  const registryDiag = (
    change: ValidatedChangeSet,
    expected: ValidationBaseline,
    condition: 'baseline-stale' | 'activation-failed' | 'gateway-invalid-result',
    message: string,
    reason: string,
    correctionSuggestion: string,
  ): KernelDiagnostic =>
    factory.registry({
      selector: { category: 'ATOMIC_ACTIVATION', condition },
      stage: REGISTRY_STAGE,
      sourcePackage: change.changeRequestBinding.sourcePackageId,
      message,
      reason,
      correctionSuggestion,
      expectedBaseline: expected.fingerprint,
      actualBaseline: registryVersionToken(targetOwnership, current.snapshot.fingerprint),
    });

  return Object.freeze({
    providerId: L2_PORT_PROVIDER_ID,
    version: L2_PORT_VERSION,
    targetOwnership,
    currentRegistry(): ActiveRegistry {
      return current;
    },
    readSnapshot(): DefinitionRegistryReadSnapshot {
      return snapshotOf(current, targetOwnership);
    },
    activateAtomically(change: ValidatedChangeSet, expected: ValidationBaseline): ActivationResult {
      const currentFingerprint = current.snapshot.fingerprint;
      const currentVersion = registryVersionToken(targetOwnership, currentFingerprint);

      // 目标层核对：这份变更必须提交给它声明的目标层。
      if (change.targetOwnership !== targetOwnership) {
        return rejection(expected, change, currentFingerprint, [
          registryDiag(
            change,
            expected,
            'gateway-invalid-result',
            `change targets ${change.targetOwnership} but this registry owns ${targetOwnership}`,
            `变更声明目标层 ${change.targetOwnership}，但本注册表属于 ${targetOwnership}。`,
            '把变更提交到与其目标层一致的注册表。',
          ),
        ]);
      }

      // CAS：期望基线的注册表版本必须与当前一致。
      if (expected.definitionRegistryVersion !== currentVersion) {
        return rejection(expected, change, currentFingerprint, [
          registryDiag(
            change,
            expected,
            'baseline-stale',
            `expected registry version ${expected.definitionRegistryVersion} but current is ${currentVersion}`,
            `期望的注册表版本 ${expected.definitionRegistryVersion} 与当前版本 ${currentVersion} 不一致，` +
              '说明在验证之后注册表已被其他变更改动。',
            '基于最新的注册表快照重新验证候选后再提交（从原始候选完整重验，不做局部更新）。',
          ),
        ]);
      }

      // 取出被验证产物携带的候选包。它必须由本提供方铸造。
      const payload = readValidatedPayload(change.upstreamValidated.payload, L2_PORT_PROVIDER_ID);
      if (payload === undefined) {
        return rejection(expected, change, currentFingerprint, [
          registryDiag(
            change,
            expected,
            'gateway-invalid-result',
            'validated payload is not owned by the l2 provider',
            '待激活的验证产物不是由基类层铸造的，注册表不会激活来源不明的产物。',
            '确认验证、解析与注册表端口来自同一个基类层端口集合。',
          ),
        ]);
      }

      // 原子激活。l2 activate 内部会再跑一次全量验证（提交前复检），失败即结构化拒绝。
      const result = activate(current, payload.package);
      if (result.rejected) {
        const index = createSourceIndex(`${L2_PORT_PROVIDER_ID}:commit-recheck`, '');
        const projection: DiagnosticProjectionContext = {
          factory,
          catalog,
          stage: REGISTRY_STAGE,
          sourcePackage: change.changeRequestBinding.sourcePackageId,
          index,
          definitionAnchors: payload.definitionAnchors,
        };
        const recheck = registryDiag(
          change,
          expected,
          'activation-failed',
          'atomic activation commit-recheck failed; no change is visible',
          '提交前复检未通过：候选在写入注册表前被再次全量验证并拒绝，注册表保持原样（零变更可见）。',
          '按下列复检诊断修正候选后重新提交。',
        );
        const projected = projectL2Diagnostics(projection, result.diagnostics);
        return rejection(expected, change, currentFingerprint, [recheck, ...projected]);
      }

      current = result.value.registry;
      return Object.freeze({
        status: 'activated',
        baseline: expected,
        candidateFingerprint: change.candidateFingerprint,
        changeRequestFingerprint: change.changeRequestFingerprint,
        diagnostics: Object.freeze([]),
        previousSnapshotFingerprint: currentFingerprint,
        activeSnapshotFingerprint: current.snapshot.fingerprint,
        unchanged: false,
      });
    },
  });
}
