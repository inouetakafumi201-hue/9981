/**
 * L2 → wakeup-ugc 端口：三个端口共用的身份、载荷令牌与诊断/配额辅助。
 *
 * ## 载荷令牌为什么必要
 * UGC 的 `UpstreamValidatedCandidate.payload` / `UpstreamResolvedReferenceGraph.payload` /
 * `DefinitionRegistryReadSnapshot.payload` 对 UGC 是不透明的 `unknown`。如果注册表端口直接
 * `as` 强转就消费它，那么「A 提供方验证出的产物」可以被喂给「B 提供方的注册表」，
 * 而类型系统完全看不出来。因此每个载荷都带一个 `kind` 令牌与 `providerId`，
 * 消费前先核对；不匹配即失败关闭。
 */

import type { Diagnostic as KernelDiagnostic } from '../../../core/kernel/state/diagnostic';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import type { ValidationStage } from '../../../core/ugc/model/stage';
import type { QuotaViolation } from '../../../core/ugc/model/quota-types';
import { SUPPORTED_SCHEMA_VERSIONS } from '../../codec/json-codec';
import { compareStrings } from '../../model/ordering';
import type { DefinitionPackage } from '../../model/definition';
import type { ReferenceGraph } from '../../resolution/reference-graph';
import type { ActiveRegistry } from '../../registry/definition-registry';

/** 基类层作为上游提供方的稳定标识。进入诊断与产物，是可观察输出的一部分。 */
export const L2_PORT_PROVIDER_ID = 'l2-base-layer';

/**
 * 端口版本。
 *
 * 由端口契约版本 + 受支持的声明式 Schema 版本集合派生，而不是手写一个易忘同步的常量：
 * l2 增删受支持 Schema 版本时版本串自动变化，UGC 侧的审计能看出上游能力边界变了。
 */
export const L2_PORT_VERSION = `l2-ports/1+${[...SUPPORTED_SCHEMA_VERSIONS].sort(compareStrings).join(',')}`;

export const L2_VALIDATED_PAYLOAD_KIND = 'l2/validated-candidate/1';
export const L2_GRAPH_PAYLOAD_KIND = 'l2/resolved-reference-graph/1';
export const L2_SNAPSHOT_PAYLOAD_KIND = 'l2/registry-snapshot/1';

/** 验证端口产出的载荷。注册表端口据此重跑激活，不信任任何已缓存的解析结论。 */
export interface L2ValidatedPayload {
  readonly kind: typeof L2_VALIDATED_PAYLOAD_KIND;
  readonly providerId: string;
  readonly package: DefinitionPackage;
  /** definitionId → 文档内锚点路径，供后续阶段的诊断定位复用。 */
  readonly definitionAnchors: ReadonlyMap<string, string>;
}

/** 解析端口产出的载荷。 */
export interface L2GraphPayload {
  readonly kind: typeof L2_GRAPH_PAYLOAD_KIND;
  readonly providerId: string;
  readonly graph: ReferenceGraph;
}

/** 注册表只读快照载荷。 */
export interface L2SnapshotPayload {
  readonly kind: typeof L2_SNAPSHOT_PAYLOAD_KIND;
  readonly providerId: string;
  readonly registry: ActiveRegistry;
}

function hasKind(value: unknown, kind: string, providerId: string): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as { readonly kind?: unknown; readonly providerId?: unknown };
  return record.kind === kind && record.providerId === providerId;
}

export function readValidatedPayload(value: unknown, providerId: string): L2ValidatedPayload | undefined {
  return hasKind(value, L2_VALIDATED_PAYLOAD_KIND, providerId) ? (value as L2ValidatedPayload) : undefined;
}

export function readGraphPayload(value: unknown, providerId: string): L2GraphPayload | undefined {
  return hasKind(value, L2_GRAPH_PAYLOAD_KIND, providerId) ? (value as L2GraphPayload) : undefined;
}

export function readSnapshotPayload(value: unknown, providerId: string): L2SnapshotPayload | undefined {
  return hasKind(value, L2_SNAPSHOT_PAYLOAD_KIND, providerId) ? (value as L2SnapshotPayload) : undefined;
}

/**
 * 注册表版本令牌。
 *
 * 由目标层 + 快照指纹派生：活动状态内容一变，令牌就变，因此旧的 Validation Baseline 必然过期。
 * 不使用自增计数器——计数器在「回滚到等价状态」时会与内容脱钩，而基线比较的语义是内容比较。
 */
export function registryVersionToken(targetOwnership: string, snapshotFingerprint: string): string {
  return `l2-defreg/${targetOwnership}/${snapshotFingerprint}`;
}

export interface PortDiagnosticEnvelope {
  readonly factory: UGCDiagnosticFactory;
  readonly stage: ValidationStage;
  readonly sourcePackage: string;
}

/**
 * 载荷令牌不匹配时的失败关闭诊断。
 *
 * 用 `host` scope 而不是候选相关的 scope：这不是创作者写错了内容，而是宿主把不属于本提供方的
 * 产物接到了本端口上，属于装配错误（需求 14.4 的 host scope 语义）。
 */
export function foreignPayloadDiagnostic(
  envelope: PortDiagnosticEnvelope,
  slot: string,
  expectedKind: string,
): KernelDiagnostic {
  return envelope.factory.host({
    selector: { category: 'ATOMIC_ACTIVATION', condition: 'gateway-invalid-result' },
    stage: envelope.stage,
    sourcePackage: envelope.sourcePackage,
    message: `${slot} payload is not owned by ${L2_PORT_PROVIDER_ID}; expected kind ${expectedKind}`,
    reason:
      `端口在 ${slot} 上收到的载荷不是由基类层（${L2_PORT_PROVIDER_ID}）铸造的（期望令牌 ${expectedKind}）。` +
      '端口不会消费来源不明的上游产物。',
    correctionSuggestion:
      '检查装配：验证、解析与注册表三个端口必须来自同一个基类层端口集合（同一 providerId）。',
    sourceSpan: null,
    rootCauseId: `l2-port/foreign-payload/${slot}`,
    messageArgs: Object.freeze({ slot, expectedKind, providerId: L2_PORT_PROVIDER_ID }),
  });
}

/**
 * 配额越界 → 内核诊断。
 *
 * 只记录类别、限额与观测下界，**不回显**超大载荷（需求 9.7）。
 */
export function quotaDiagnostic(
  envelope: PortDiagnosticEnvelope,
  violation: QuotaViolation,
): KernelDiagnostic {
  const context = violation.context;
  return envelope.factory.changeSet({
    selector: { category: 'RESOURCE_LIMIT', condition: violation.kind },
    stage: envelope.stage,
    sourcePackage: envelope.sourcePackage,
    message:
      `quota ${violation.kind} exceeded: limit ${violation.limit}, observed ${violation.observed}, ` +
      `requested ${violation.requested}`,
    reason:
      `技术配额 ${violation.kind} 超限：限额 ${violation.limit}，已观测用量 ${violation.observed}，` +
      `本次请求 ${violation.requested}。相关遍历已终止。`,
    correctionSuggestion:
      '拆分候选变更使其落在宿主配额档案内；配额由可信宿主提供，候选内容不能修改或禁用它。',
    sourceSpan: context?.sourceSpan ?? null,
    jsonPath: context?.jsonPath ?? null,
    rootCauseId: `l2-port/quota/${violation.kind}`,
    messageArgs: Object.freeze({
      kind: violation.kind,
      limit: violation.limit,
      observed: violation.observed,
      requested: violation.requested,
      definitionId: context?.definitionId ?? null,
    }),
  });
}
