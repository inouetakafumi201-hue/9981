/**
 * L2 Model: 诊断、结构化拒绝与验证结果类型。
 *
 * 对应 Requirements 13.1–13.12、design.md 的 `Diagnostic` / `Structured_Rejection` 数据模型
 * 与 Error Handling 章节。
 *
 * 铁律：`Structured_Rejection` 必须至少包含一个 `Error_Diagnostic`；否则调用方必须把它当作
 * 无效验证结果并保留适用的前状态（Requirements 13.12）。该不变量由
 * `diagnostic-factory.ts` 的构造函数与 `isValidStructuredRejection` 强制。
 */

import type {
  DefinitionId,
  HumanReadableText,
  JsonPath,
  PackageId,
  StableDiagnosticCode,
} from './ids';
import type { SourceLocation, SourceRecord } from './source';

/** 诊断严重级别（Requirements 13.1）。 */
export type DiagnosticSeverity = 'Error' | 'Warning';

/**
 * Diagnostic：design.md 数据模型的直接实现。
 *
 * `definitionId`、`jsonPath`、`sourcePackage`、`sourceLocation` 是"可适用时必填"：
 * 例如包级元数据错误没有 `definitionId`，来源裁决诊断没有 `jsonPath`。
 * `code`、`severity`、`reason`、`correctionSuggestion` 无条件必填（Requirements 13.2、13.9）。
 */
export interface Diagnostic {
  readonly code: StableDiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly definitionId?: DefinitionId;
  readonly jsonPath?: JsonPath;
  readonly sourcePackage?: PackageId;
  readonly sourceLocation?: SourceLocation;
  readonly reason: HumanReadableText;
  readonly correctionSuggestion: HumanReadableText;
  readonly relatedSources: readonly SourceRecord[];
}

/** 仅含 Error 严重级别的诊断。 */
export type ErrorDiagnostic = Diagnostic & { readonly severity: 'Error' };

/** 仅含 Warning 严重级别的诊断。 */
export type WarningDiagnostic = Diagnostic & { readonly severity: 'Warning' };

export function isErrorDiagnostic(diagnostic: Diagnostic): diagnostic is ErrorDiagnostic {
  return diagnostic.severity === 'Error';
}

export function isWarningDiagnostic(diagnostic: Diagnostic): diagnostic is WarningDiagnostic {
  return diagnostic.severity === 'Warning';
}

/**
 * Structured_Rejection：明确表示"候选变更未生效"的拒绝结果。
 *
 * `priorStateFingerprint` 记录拒绝时刻的前状态指纹，供调用方与测试断言状态不变。
 * 该字段可缺省（例如纯解析期拒绝时还不存在活动状态）。
 */
export interface StructuredRejection {
  readonly rejected: true;
  readonly diagnostics: readonly Diagnostic[];
  readonly priorStateFingerprint?: string;
}

/** 判断一个拒绝结果是否合法（至少含一个 Error_Diagnostic）。 */
export function isValidStructuredRejection(rejection: StructuredRejection): boolean {
  return rejection.diagnostics.some(isErrorDiagnostic);
}

/**
 * Validation_Result：收集全部可确定发现的诊断。
 *
 * `valid` 由"是否存在 Error_Diagnostic"派生，而不是独立布尔状态，避免出现
 * "valid=true 但含 Error"的自相矛盾结果。
 */
export interface ValidationResult {
  readonly diagnostics: readonly Diagnostic[];
}

export function hasError(result: ValidationResult): boolean {
  return result.diagnostics.some(isErrorDiagnostic);
}

export function errorsOf(result: ValidationResult): readonly ErrorDiagnostic[] {
  return result.diagnostics.filter(isErrorDiagnostic);
}

export function warningsOf(result: ValidationResult): readonly WarningDiagnostic[] {
  return result.diagnostics.filter(isWarningDiagnostic);
}
