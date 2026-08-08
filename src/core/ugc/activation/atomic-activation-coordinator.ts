/**
 * 提交前复检与原子激活（design.md「Atomic activation」/ 需求 13.3-13.13；tasks.md 8.2、8.3）。
 *
 * 提交路径上的顺序是刻意的，每一步都必须在**调用注册表之前**完成：
 *   1. 产物必须是本进程内部铸造的（WeakSet 守卫）——挡住类型断言伪造；
 *   2. 从封存绑定重算请求指纹并逐字段核对——挡住"内容相同就复用"（需求 13.13）；
 *   3. 重新采集并逐字段比较基线——挡住 TOCTOU（需求 13.5、13.6）；
 *   4. 目标注册表必须与绑定的目标层一致——挡住把玩法层产物提交进基类层注册表（需求 6.7、6.8）。
 * 任一步失败：`activateAtomically` 调用次数为 **0**，活动快照指纹不变。
 *
 * 提交只调用 `activateAtomically` **一次**。UGC 不执行 Op、不写 WorldState、不注册 Hook、
 * 不推进迁移、不写宿主持久化（需求 13.9）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import { computeChangeRequestFingerprint } from '../model/binding.js';
import type { StableFingerprintGateway } from '../model/fingerprint.js';
import type { ActivationResult } from '../model/report.js';
import type { ValidationBaseline } from '../model/baseline.js';
import type { ValidatedChangeSet } from '../model/validated-change-set.js';
import type { BaselineSources } from '../baseline/baseline-factory.js';
import { recheckBaseline } from '../baseline/baseline-factory.js';
import type { DefinitionRegistryGateway } from '../ports/definition-ports.js';
import { isMintedValidatedChangeSet } from './validated-change-set.js';

const STAGE = 'activation-precheck' as const;

export interface AtomicActivationCoordinator {
  activate(validated: ValidatedChangeSet, expected: ValidationBaseline): ActivationResult;
}

export interface AtomicActivationDeps {
  readonly registry: DefinitionRegistryGateway;
  readonly baselineSources: BaselineSources;
  readonly fingerprint: StableFingerprintGateway;
  readonly factory: UGCDiagnosticFactory;
}

function rejected(
  baseline: ValidationBaseline,
  candidateFingerprint: string,
  changeRequestFingerprint: string,
  snapshotFingerprint: string,
  diagnostics: readonly Diagnostic[],
): ActivationResult {
  return Object.freeze({
    status: 'rejected',
    baseline,
    candidateFingerprint,
    changeRequestFingerprint,
    diagnostics: Object.freeze([...diagnostics]),
    previousSnapshotFingerprint: snapshotFingerprint,
    activeSnapshotFingerprint: snapshotFingerprint,
    unchanged: true,
  });
}

export function createAtomicActivationCoordinator(deps: AtomicActivationDeps): AtomicActivationCoordinator {
  const { registry, baselineSources, fingerprint, factory } = deps;

  return Object.freeze({
    activate(validated: ValidatedChangeSet, expected: ValidationBaseline): ActivationResult {
      // 先读一次快照，作为"拒绝时状态不变"的证据基准。纯读，不改变任何东西。
      const snapshotBefore = registry.readSnapshot().snapshotFingerprint;
      const sourcePackage = validated.changeRequestBinding.sourcePackageId;

      const reject = (
        condition: 'artifact-not-minted' | 'request-binding-mismatch' | 'gateway-invalid-result' | 'activation-failed',
        reason: string,
        correction: string,
      ): ActivationResult =>
        rejected(expected, validated.candidateFingerprint, validated.changeRequestFingerprint, snapshotBefore, [
          factory.registry({
            selector: { category: 'ATOMIC_ACTIVATION', condition },
            stage: STAGE,
            sourcePackage,
            message: `Activation refused before commit (${condition}).`,
            reason,
            correctionSuggestion: correction,
            expectedBaseline: expected.fingerprint,
            actualBaseline: expected.fingerprint,
          }),
        ]);

      // 1. 产物必须由内部工厂铸造。
      if (!isMintedValidatedChangeSet(validated)) {
        return reject(
          'artifact-not-minted',
          '提交的验证产物不是由本模块内部工厂铸造的，无法确认它真的通过了全部强制阶段。',
          '请通过公共 Facade 的 validate 入口重新验证候选，然后用其返回的产物提交。',
        );
      }

      // 2. 从封存绑定重算请求指纹并逐字段核对。
      const recomputed = computeChangeRequestFingerprint(fingerprint, validated.changeRequestBinding);
      if (recomputed !== validated.changeRequestFingerprint) {
        return reject(
          'request-binding-mismatch',
          `从请求绑定重算的指纹 ${recomputed} 与产物携带的 ${validated.changeRequestFingerprint} 不一致，产物已被篡改或损坏。`,
          '请从原始候选重新完整验证后再提交。',
        );
      }
      if (validated.changeRequestBinding.candidateFingerprint !== validated.candidateFingerprint) {
        return reject(
          'request-binding-mismatch',
          '产物的候选指纹与请求绑定中的候选指纹不一致。',
          '请从原始候选重新完整验证后再提交。',
        );
      }

      // 3. 目标注册表必须与绑定的目标层一致：一个层的产物不能授权另一个层的变更。
      if (registry.targetOwnership !== validated.changeRequestBinding.targetOwnership) {
        return reject(
          'request-binding-mismatch',
          `该验证产物针对 ${validated.changeRequestBinding.targetOwnership}，` +
            `但提交的目标注册表属于 ${registry.targetOwnership}。基类层与玩法层必须分别原子提交。`,
          '请把候选提交到与其目标层一致的注册表；不要在同一个变更集里混合两层。',
        );
      }

      // 4. 基线复检：重新采集全部上游版本并逐字段比较。
      const staleDiagnostics = recheckBaseline(baselineSources, expected, factory, sourcePackage);
      if (staleDiagnostics.length > 0) {
        return rejected(
          expected,
          validated.candidateFingerprint,
          validated.changeRequestFingerprint,
          snapshotBefore,
          staleDiagnostics,
        );
      }

      return commit(registry, validated, expected, snapshotBefore, factory, sourcePackage);
    },
  });
}

/**
 * 唯一一次注册表提交。
 *
 * 网关抛出异常、返回非法结果、或声称成功却把快照指纹留在原地，都转为激活错误并保留旧状态——
 * 「网关说成功」不等于「真的发生了完整变更」，UGC 必须自己核对可观察证据（tasks.md 8.3）。
 */
function commit(
  registry: DefinitionRegistryGateway,
  validated: ValidatedChangeSet,
  expected: ValidationBaseline,
  snapshotBefore: string,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
): ActivationResult {
  const activationError = (reason: string, correction: string): ActivationResult =>
    rejected(expected, validated.candidateFingerprint, validated.changeRequestFingerprint, snapshotBefore, [
      factory.registry({
        selector: { category: 'ATOMIC_ACTIVATION', condition: 'activation-failed' },
        stage: STAGE,
        sourcePackage,
        message: 'Atomic activation failed; the previous valid state remains active.',
        reason,
        correctionSuggestion: correction,
        expectedBaseline: expected.fingerprint,
        actualBaseline: expected.fingerprint,
      }),
    ]);

  let result: ActivationResult;
  try {
    result = registry.activateAtomically(validated, expected);
  } catch (thrown) {
    // 异常绝不逃逸公共边界，也绝不被当成"可能成功了"。
    return activationError(
      `定义注册表在提交时抛出异常：${thrown instanceof Error ? thrown.message : String(thrown)}。` +
        '上一份有效的注册表、依赖图与规范化快照保持不变。',
      '这是上游注册表实现的问题而非候选内容问题：请向维护者报告。',
    );
  }

  if (result === null || typeof result !== 'object' || (result.status !== 'activated' && result.status !== 'rejected')) {
    return activationError(
      '定义注册表返回了不符合契约的激活结果，无法确认变更是否发生，因此按失败处理。',
      '这是上游注册表实现的问题：请向维护者报告。',
    );
  }

  if (result.status === 'rejected') {
    // 保留上游拒绝原样，但强制补齐"状态未变"的断言，避免上游漏填导致调用方误判。
    if (result.previousSnapshotFingerprint !== result.activeSnapshotFingerprint) {
      return activationError(
        '定义注册表报告提交失败，但前后快照指纹不同，说明可能发生了部分激活。',
        '这是上游注册表实现的问题：请向维护者报告并从最后一个完整快照恢复。',
      );
    }
    return Object.freeze({ ...result, unchanged: true });
  }

  if (result.activeSnapshotFingerprint === result.previousSnapshotFingerprint) {
    return activationError(
      '定义注册表报告激活成功，但活动快照指纹与提交前完全相同，无法证明变更已发布。',
      '这是上游注册表实现的问题：请向维护者报告。',
    );
  }

  return Object.freeze({ ...result, unchanged: false });
}
