/**
 * 受限观察器与故障注入（design.md「Test and trace reachability」/ 需求 16.1、16.12-16.13；tasks.md 9.2）。
 *
 * 观察器**只读**：它从 `ValidationReport` / `ActivationResult` 这两个生产出口读取事实，
 * 不持有任何内部阶段句柄，因此不存在"绕过流水线直接观察中间态"的可能。
 *
 * 故障注入通过**包装已登记端口**实现，而不是在生产代码里加 if 分支。这保证被测代码路径与
 * 生产路径完全一致（design.md：Fault injection is dependency injection at documented ports）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { ActivationResult, ValidationReport } from '../model/report.js';
import type { ValidationStage } from '../model/stage.js';
import type { QuotaKind } from '../model/quota-types.js';

export interface StageObservation {
  readonly reachedStages: readonly ValidationStage[];
  readonly skippedStages: readonly ValidationStage[];
  readonly codes: readonly string[];
  readonly blockingCodes: readonly string[];
  readonly warningCodes: readonly string[];
  readonly quotaUsed: Readonly<Partial<Record<QuotaKind, number>>>;
  readonly status: ValidationReport['status'];
}

/**
 * 从报告推断"哪些阶段实际跑到了"。
 *
 * 依据是 `skippedChecks` 的阶段集合与诊断的 messageKey 前缀，两者都是生产输出的一部分。
 * 刻意不引入额外的 instrumentation 钩子：多一个观察通道就多一条可能与生产路径不一致的路径。
 */
export function observe(report: ValidationReport): StageObservation {
  const skippedStages = [...new Set(report.skippedChecks.map((entry) => entry.stage))];
  const reachedStages = [
    ...new Set(
      report.diagnostics
        .map((entry) => entry.messageKey)
        .filter((key): key is string => typeof key === 'string' && key.startsWith('ugc/'))
        .map((key) => key.split('/')[1])
        .filter((stage): stage is ValidationStage => stage !== undefined),
    ),
  ];
  const quotaUsed: Partial<Record<QuotaKind, number>> = {};
  for (const [kind, usage] of Object.entries(report.budget)) {
    if (usage.used > 0) quotaUsed[kind as QuotaKind] = usage.used;
  }
  return Object.freeze({
    reachedStages: Object.freeze(reachedStages),
    skippedStages: Object.freeze(skippedStages),
    codes: Object.freeze(report.diagnostics.map((entry) => entry.code)),
    blockingCodes: Object.freeze(
      report.diagnostics.filter((entry) => entry.severity === 'error' || entry.severity === 'fatal').map((entry) => entry.code),
    ),
    warningCodes: Object.freeze(
      report.diagnostics.filter((entry) => entry.severity === 'warn' || entry.severity === 'info').map((entry) => entry.code),
    ),
    quotaUsed: Object.freeze(quotaUsed),
    status: report.status,
  });
}

/** 拒绝路径的通用断言事实：状态未变、无产物、至少一条阻断诊断。 */
export interface RejectionFacts {
  readonly rejected: boolean;
  readonly hasBlocking: boolean;
  readonly noArtifact: boolean;
}

export function rejectionFacts(report: ValidationReport): RejectionFacts {
  return Object.freeze({
    rejected: report.status === 'rejected',
    hasBlocking: report.diagnostics.some((entry) => entry.severity === 'error' || entry.severity === 'fatal'),
    noArtifact: report.validated === null,
  });
}

/** 激活拒绝路径的通用断言事实：快照前后一致且 unchanged 为真。 */
export function activationUnchanged(result: ActivationResult): boolean {
  return (
    result.status === 'rejected' &&
    result.unchanged &&
    result.previousSnapshotFingerprint === result.activeSnapshotFingerprint
  );
}

export function diagnosticsOfCode(report: ValidationReport, code: string): readonly Diagnostic[] {
  return Object.freeze(report.diagnostics.filter((entry) => entry.code === code));
}
