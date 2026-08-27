/**
 * 待汇合契约的显式失败结果（design.md §14.2、Requirement 14.5）。
 *
 * 尚未汇合的领域字段**必须**表现为显式失败：不返回猜测值、不返回空映射、不用默认值兜底，
 * 也不由 UI 侧先给它起个名字用着（§14.3）。一旦 UI 先定名，后续跨 Spec 审查会被迫接受
 * 表现层的命名，等于让表现层反向决定基类层契约。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnostic,
} from '../model/diagnostic';

export const PENDING_CONVERGENCE_CODE = 'PENDING_CONVERGENCE_CONTRACT' as const;

export type ConvergenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: typeof PENDING_CONVERGENCE_CODE;
      /** 缺失能力的描述性名称。它描述"缺什么能力"，不为待汇合字段定名。 */
      readonly missing: readonly string[];
    };

export function converged<T>(value: T): ConvergenceResult<T> {
  return Object.freeze({ ok: true as const, value });
}

export function pendingConvergence<T>(missing: readonly string[]): ConvergenceResult<T> {
  return Object.freeze({
    ok: false as const,
    code: PENDING_CONVERGENCE_CODE,
    missing: Object.freeze([...missing].sort()),
  });
}

/** 把汇合失败翻译成结构化诊断，供上层"省略该交互并发诊断"使用。 */
export function convergenceDiagnostic(
  missing: readonly string[],
  presentationLocation: string,
): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.PENDING_CONVERGENCE_CONTRACT,
    presentationLocation,
    reason: `依赖的领域能力尚未汇合：${[...missing].sort().join('、')}`,
    correctionSuggestion: '该交互应被省略，直到跨 Spec 一致性审查把对应能力提升为稳定契约',
  });
}
