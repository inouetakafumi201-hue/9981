/**
 * 阶段与跳过检查（design.md「Validation baseline and pipeline」/ 需求 14.7）。
 *
 * 流水线是阶段 DAG，不是"遇到第一个错误就无条件终止"。只要输入仍有安全、确定的结构，彼此独立的
 * 检查继续执行；依赖已失败数据的检查不猜测输入，而是记录 `SkippedCheck` 并关联阻断它的根诊断。
 */

/** 阶段顺序即 DAG 的拓扑序，用于诊断稳定排序和报告可解释性。 */
export const VALIDATION_STAGES = [
  'ingress',
  'decode',
  'schema-migration',
  'canonicalize',
  'request-binding',
  'baseline',
  'definition-validation',
  'reference-resolution',
  'presentation-resolution',
  'activation-precheck',
] as const;

export type ValidationStage = (typeof VALIDATION_STAGES)[number];

export function stageIndex(stage: ValidationStage): number {
  return VALIDATION_STAGES.indexOf(stage);
}

export interface SkippedCheck {
  readonly stage: ValidationStage;
  /** 稳定的检查标识，供测试与追踪引用；不是自由文本消息。 */
  readonly checkId: string;
  /** 阻断该检查的根诊断的 `rootCauseId`。 */
  readonly blockedByDiagnosticId: string;
}

export function createSkippedCheck(input: SkippedCheck): SkippedCheck {
  return Object.freeze({
    stage: input.stage,
    checkId: input.checkId,
    blockedByDiagnosticId: input.blockedByDiagnosticId,
  });
}

/** 跳过检查的确定性排序：先按阶段拓扑序，再按 checkId，再按根诊断 ID。 */
export function compareSkippedChecks(left: SkippedCheck, right: SkippedCheck): number {
  const stageOrder = stageIndex(left.stage) - stageIndex(right.stage);
  if (stageOrder !== 0) return stageOrder;
  if (left.checkId !== right.checkId) return left.checkId < right.checkId ? -1 : 1;
  if (left.blockedByDiagnosticId === right.blockedByDiagnosticId) return 0;
  return left.blockedByDiagnosticId < right.blockedByDiagnosticId ? -1 : 1;
}
