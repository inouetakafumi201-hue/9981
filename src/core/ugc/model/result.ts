/**
 * UGC 结果通道（design.md「Components and Interfaces」/ 需求 14.5）。
 *
 * 为什么不直接复用 `src/core/kernel/ops/result.ts` 的 `Result<T>`：
 * 内核 `Result<T>` 的失败分支是 `{ ok:false; code; detail }`，一次只能表达一个错误码和一段自由文本。
 * UGC 的核心契约是"一次返回全部可独立发现的错误"（需求 14.6）且"每个 Structured_Rejection 至少含一条
 * error 级 Diagnostic"（需求 14.5），这两条都无法用单码结构表达。因此 UGC 使用携带完整 Diagnostic 列表的
 * 结果类型；它不替代内核 Result，只在 UGC 边界内部使用，且 Diagnostic/ErrCode 仍复用共享形状。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic';

export interface UgcOk<T> {
  readonly ok: true;
  readonly value: T;
  /** 成功路径仍可携带 warn/info 级诊断（例如表现资源回退警告）。 */
  readonly diagnostics: readonly Diagnostic[];
}

export interface UgcRejected {
  readonly ok: false;
  /** 不变量：至少含一条 severity 为 'error' 或 'fatal' 的 Diagnostic。由 `ugcReject` 结构性保证。 */
  readonly diagnostics: readonly Diagnostic[];
}

export type UgcResult<T> = UgcOk<T> | UgcRejected;

/** 判断一条诊断是否具有阻断力（error 或 fatal）。warn/info 永不阻断。 */
export function isBlockingDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error' || diagnostic.severity === 'fatal';
}

export function hasBlockingDiagnostic(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(isBlockingDiagnostic);
}

export function ugcOk<T>(value: T, diagnostics: readonly Diagnostic[] = []): UgcResult<T> {
  return { ok: true, value, diagnostics: Object.freeze([...diagnostics]) };
}

/**
 * 构造拒绝结果。需求 14.5 规定"没有 error 级诊断的拒绝本身是无效验证结果"，因此这里不静默接受：
 * 若调用方给出的诊断集合不含任何阻断级诊断，追加一条 `E_LOAD_DIAGNOSTIC_FAILURE`（已登记为
 * 基础设施 fatal），把"诊断生成本身出错"如实暴露出来，而不是产出一个既非通过也无错误的悬空结果。
 */
export function ugcReject(diagnostics: readonly Diagnostic[], phase = 0): UgcRejected {
  const collected = [...diagnostics];
  if (!hasBlockingDiagnostic(collected)) {
    collected.push(diagnosticIntegrityFailure(phase));
  }
  return { ok: false, diagnostics: Object.freeze(collected) };
}

/**
 * 诊断完整性兜底。它不是"通用未知错误"：只在拒绝结果缺少阻断级诊断这一种情况下产生，
 * 表示 UGC 自身的诊断构造出了问题，必须停止而不是发布。
 */
export function diagnosticIntegrityFailure(phase = 0): Diagnostic {
  return {
    code: 'E_LOAD_DIAGNOSTIC_FAILURE',
    severity: 'fatal',
    haltClass: 'infrastructure',
    scope: 'host',
    message: 'A rejection was produced without any error-severity diagnostic.',
    reason: 'UGC 内部构造了一个没有任何 error 级诊断的拒绝结果，该结果无法被信任。',
    correctionSuggestion: '这是实现缺陷而非创作者输入问题；请向维护者报告完整的验证报告。',
    hint: '诊断生成本身失败。编译已安全停止，且不会发布不完整产物。',
    actionableHint: '这是实现缺陷而非创作者输入问题；请向维护者报告完整的验证报告。',
    at: null,
    path: null,
    sourcePackage: null,
    sourceSpan: null,
    phase,
  };
}

/** 类型收窄辅助：在已知 ok 为真的分支上取值。 */
export function unwrap<T>(result: UgcResult<T>): T {
  if (!result.ok) {
    throw new Error('unwrap called on a rejected UgcResult');
  }
  return result.value;
}

/** 把一个失败结果沿用到另一个值类型，避免在阶段间重建诊断列表。 */
export function propagate<T>(rejected: UgcRejected): UgcResult<T> {
  return rejected;
}
