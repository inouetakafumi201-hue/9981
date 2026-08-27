/**
 * L2 Model: 诊断构造、完整性校验、排序与结构化拒绝。
 *
 * 对应 Requirements 13.1–13.12、15.7 与 design.md Error Handling。
 *
 * 三条硬约束在此集中实现：
 * 1. 每个诊断必须带稳定代码、严重级别、原因与修正建议（Requirements 13.2、13.9）。
 * 2. 诊断输出顺序必须确定（design.md：定义标识 → JSON 路径 → 稳定代码 → 来源定位）。
 * 3. `Structured_Rejection` 必须含至少一个 `Error_Diagnostic`；否则是无效验证结果
 *    （Requirements 13.12）。
 */

import type {
  DefinitionId,
  HumanReadableText,
  JsonPath,
  PackageId,
  StableDiagnosticCode,
} from './ids';
import type { Diagnostic, DiagnosticSeverity, StructuredRejection } from './diagnostic';
import { isErrorDiagnostic } from './diagnostic';
import type { SourceLocation, SourceRecord } from './source';
import { canonicalSort, compareDiagnostics, compareSourceRecords, fingerprint } from './ordering';
import type { CanonicalSnapshot } from './snapshot';
import { DIAGNOSTIC_CODES } from './diagnostic-codes';

/** 诊断构造输入。 */
export interface DiagnosticInput {
  readonly code: StableDiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly reason: HumanReadableText;
  readonly correctionSuggestion: HumanReadableText;
  readonly definitionId?: DefinitionId;
  readonly jsonPath?: JsonPath;
  readonly sourcePackage?: PackageId;
  readonly sourceLocation?: SourceLocation;
  readonly relatedSources?: readonly SourceRecord[];
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Diagnostic.${field} 必填且不能为空字符串`);
  }
  return value;
}

/**
 * 构造诊断。
 *
 * 关键取舍：缺失必填字段时**抛出**而不是产生一个"降级诊断"。
 * 一个自身不完整的诊断无法被定位和修复，静默降级会把实现缺陷伪装成用户错误。
 * 抛出让缺陷在开发期暴露；`isCompleteDiagnostic` 供外部输入路径先行检查。
 */
export function createDiagnostic(input: DiagnosticInput): Diagnostic {
  requireNonEmpty(input.code, 'code');
  requireNonEmpty(input.reason, 'reason');
  requireNonEmpty(input.correctionSuggestion, 'correctionSuggestion');
  if (input.severity !== 'Error' && input.severity !== 'Warning') {
    throw new TypeError(`Diagnostic.severity 必须为 Error 或 Warning，收到 ${String(input.severity)}`);
  }

  const diagnostic: Record<string, unknown> = {
    code: input.code,
    severity: input.severity,
    reason: input.reason,
    correctionSuggestion: input.correctionSuggestion,
    relatedSources: Object.freeze(
      canonicalSort(input.relatedSources ?? [], compareSourceRecords).slice(),
    ),
  };
  if (input.definitionId !== undefined) {
    diagnostic['definitionId'] = input.definitionId;
  }
  if (input.jsonPath !== undefined) {
    diagnostic['jsonPath'] = input.jsonPath;
  }
  if (input.sourcePackage !== undefined) {
    diagnostic['sourcePackage'] = input.sourcePackage;
  }
  if (input.sourceLocation !== undefined) {
    diagnostic['sourceLocation'] = Object.freeze({ ...input.sourceLocation });
  }
  return Object.freeze(diagnostic) as unknown as Diagnostic;
}

export function errorDiagnostic(input: Omit<DiagnosticInput, 'severity'>): Diagnostic {
  return createDiagnostic({ ...input, severity: 'Error' });
}

export function warningDiagnostic(input: Omit<DiagnosticInput, 'severity'>): Diagnostic {
  return createDiagnostic({ ...input, severity: 'Warning' });
}

/**
 * 诊断完整性检查（Requirements 13.2）。
 * "可适用字段"不强制：包级错误没有 `definitionId`，来源裁决诊断没有 `jsonPath`。
 */
export function isCompleteDiagnostic(value: unknown): value is Diagnostic {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const stringFieldsPresent =
    typeof record['code'] === 'string' &&
    (record['code'] as string).trim().length > 0 &&
    typeof record['reason'] === 'string' &&
    (record['reason'] as string).trim().length > 0 &&
    typeof record['correctionSuggestion'] === 'string' &&
    (record['correctionSuggestion'] as string).trim().length > 0;
  const severityValid = record['severity'] === 'Error' || record['severity'] === 'Warning';
  const sourcesValid = Array.isArray(record['relatedSources']);
  return stringFieldsPresent && severityValid && sourcesValid;
}

/** 规范化诊断排序。 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice());
}

/**
 * 构造结构化拒绝。至少需要一个 Error_Diagnostic，否则抛出 —— 这是调用方的实现缺陷。
 */
export function structuredRejection(
  diagnostics: readonly Diagnostic[],
  priorStateFingerprint?: string,
): StructuredRejection {
  if (!diagnostics.some(isErrorDiagnostic)) {
    throw new TypeError(
      'Structured_Rejection 必须包含至少一个 Error_Diagnostic（Requirements 13.12）；' +
        '若只有 Warning，应返回成功结果并携带 warnings。',
    );
  }
  const rejection: Record<string, unknown> = {
    rejected: true,
    diagnostics: sortDiagnostics(diagnostics),
  };
  if (priorStateFingerprint !== undefined) {
    rejection['priorStateFingerprint'] = priorStateFingerprint;
  }
  return Object.freeze(rejection) as unknown as StructuredRejection;
}

/**
 * 构造未经 Error 检查的拒绝结果。
 *
 * 唯一用途：故障注入与性质测试需要构造"不含 Error 的拒绝"这一非法输入，
 * 以验证调用方按 Requirements 13.12 把它判为无效验证结果并保留前状态。
 * 生产路径不得使用。
 */
export function structuredRejectionUnchecked(
  diagnostics: readonly Diagnostic[],
  priorStateFingerprint?: string,
): StructuredRejection {
  const rejection: Record<string, unknown> = {
    rejected: true,
    diagnostics: sortDiagnostics(diagnostics),
  };
  if (priorStateFingerprint !== undefined) {
    rejection['priorStateFingerprint'] = priorStateFingerprint;
  }
  return Object.freeze(rejection) as unknown as StructuredRejection;
}

/** 拒绝结果的有效性判定与配套诊断（Requirements 13.12）。 */
export interface RejectionValidity {
  readonly valid: boolean;
  readonly diagnostic?: Diagnostic;
}

export function assessRejection(rejection: StructuredRejection): RejectionValidity {
  if (rejection.diagnostics.some(isErrorDiagnostic)) {
    return { valid: true };
  }
  return {
    valid: false,
    diagnostic: errorDiagnostic({
      code: DIAGNOSTIC_CODES.PKG_REJECTION_WITHOUT_ERROR,
      reason: '收到的拒绝结果不含任何 Error_Diagnostic，按 Requirements 13.12 视为无效验证结果。',
      correctionSuggestion:
        '拒绝方必须至少提供一个 Error_Diagnostic；若只想提示，请返回成功结果并携带 Warning_Diagnostic。',
    }),
  };
}

/** 诊断集合等价：忽略顺序，比较规范化后的完整内容。 */
export function diagnosticSetsEquivalent(
  left: readonly Diagnostic[],
  right: readonly Diagnostic[],
): boolean {
  return fingerprint(sortDiagnostics(left)) === fingerprint(sortDiagnostics(right));
}

/** 快照等价（Requirements 12.8–12.12、15.7）。 */
export function snapshotsEquivalent(left: CanonicalSnapshot, right: CanonicalSnapshot): boolean {
  return left.fingerprint === right.fingerprint && fingerprint(left) === fingerprint(right);
}
