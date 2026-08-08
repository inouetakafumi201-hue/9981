/**
 * 验证报告与激活结果（design.md「Validation baseline and pipeline」/ 需求 11.10、13.12、14.2-14.9）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { ValidationBaseline } from './baseline.js';
import type { ChangeRequestBinding } from './binding.js';
import type { QuotaUsageSnapshot } from './quota-types.js';
import type { SkippedCheck } from './stage.js';
import type { ValidatedChangeSet } from './validated-change-set.js';

export type ValidationStatus = 'rejected' | 'validated';

export interface ValidationReport {
  readonly baseline: ValidationBaseline;
  /** 仅内容派生的候选指纹；解码/迁移阶段即失败时为 `null`。 */
  readonly candidateFingerprint: string | null;
  /** 完整请求绑定派生的指纹；绑定阶段之前失败时为 `null`。 */
  readonly changeRequestFingerprint: string | null;
  readonly changeRequestBinding: ChangeRequestBinding | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly skippedChecks: readonly SkippedCheck[];
  readonly budget: QuotaUsageSnapshot;
  readonly status: ValidationStatus;
  /** 只有 `status === 'validated'` 时非 null。 */
  readonly validated: ValidatedChangeSet | null;
}

export type ActivationStatus = 'activated' | 'rejected';

export interface ActivationResult {
  readonly status: ActivationStatus;
  readonly baseline: ValidationBaseline;
  readonly candidateFingerprint: string;
  readonly changeRequestFingerprint: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly previousSnapshotFingerprint: string;
  readonly activeSnapshotFingerprint: string;
  /** 拒绝路径恒为 true，并且 `previousSnapshotFingerprint === activeSnapshotFingerprint`。 */
  readonly unchanged: boolean;
}

export function isValidatedReport(
  report: ValidationReport,
): report is ValidationReport & { readonly status: 'validated'; readonly validated: ValidatedChangeSet } {
  return report.status === 'validated' && report.validated !== null;
}
