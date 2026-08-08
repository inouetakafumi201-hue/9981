/**
 * L2 Model: `Result<T>`。
 *
 * design.md：`Result<T>` 要么返回值，要么返回带至少一个 `Error_Diagnostic` 的
 * `Structured_Rejection`。成功结果可携带 Warning_Diagnostic（Requirements 13.5）。
 *
 * 判别字段统一为 `rejected`，因此 `Result<T>` 与 `StructuredRejection` 可直接互操作，
 * 不需要额外包装层。
 */

import type { Diagnostic, StructuredRejection, WarningDiagnostic } from './diagnostic.js';
import { isErrorDiagnostic, isWarningDiagnostic } from './diagnostic.js';

export interface Ok<T> {
  readonly rejected: false;
  readonly value: T;
  readonly warnings: readonly WarningDiagnostic[];
}

export type Result<T> = Ok<T> | StructuredRejection;

export function ok<T>(value: T, warnings: readonly Diagnostic[] = []): Ok<T> {
  return {
    rejected: false,
    value,
    warnings: warnings.filter(isWarningDiagnostic),
  };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.rejected === false;
}

export function isRejection<T>(result: Result<T>): result is StructuredRejection {
  return result.rejected === true;
}

/**
 * 取值；仅在已经用 `isOk` 判定过的分支使用。
 * 传入拒绝结果时抛出 —— 这是编程错误，不是可恢复的验证失败。
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.rejected) {
    throw new Error(
      `unwrap() 收到 Structured_Rejection：${result.diagnostics.map((d) => d.code).join(', ')}`,
    );
  }
  return result.value;
}

/** 把成功结果映射为另一个成功结果，保留 warnings；拒绝原样透传。 */
export function mapOk<T, U>(result: Result<T>, project: (value: T) => U): Result<U> {
  if (result.rejected) {
    return result;
  }
  return { rejected: false, value: project(result.value), warnings: result.warnings };
}

/** 合并两组诊断中的错误判断：任一含 Error 即视为拒绝依据。 */
export function containsError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(isErrorDiagnostic);
}
