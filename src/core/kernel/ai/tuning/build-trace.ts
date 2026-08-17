/**
 * DecisionTrace 组装（Task 4）—— 在 `facade.act` 成功/拒绝路径上附加 trace。
 *
 * facade 在决策关键点已经拿到：rootSlice（信念切片）、候选动作的 ScoreBreakdown（由
 * DesignCurrencyGateway 提供）、选中动作、提交流程结果。这里把这些拼成完整 DecisionTrace，
 * 并给 trace 加决策时世界快照的 stateHash（抗漂移）。
 */
import type { BeliefSlice } from '../types.js';
import type { AIDecisionResult } from '../types.js';
import { extractObservedFacts, type DecisionTrace, type TraceCandidate, type TraceSubmission } from './trace.js';
import { hashWorldState } from './snapshot.js';
import type { WorldState } from '../../state/world-state.js';
import type { ScoreBreakdownInstance } from '../design-currency.js';

/** 由 facade 调用方传入的「当前世界快照」—— 供生成 stateHash。 */
export interface TraceCandidateInput {
  actionId: string;
  score: number;
  breakdown: { items: readonly { feeItem: string; contribution: number; currentValue: number; triggeredPivot?: string; scarcityMultiplier?: number }[]; total: number };
}
export interface TraceBuildInput {
  correlationId: string;
  slice: BeliefSlice | null;
  candidates: readonly TraceCandidateInput[];
  selected: { actionId: string; score: number; reason: string } | null;
  submission: TraceSubmission;
  worldState: WorldState | null;
}

/** 构建完整决策证据链。缺 slice 时 observedFacts 为空；缺 world 时 stateHash 用一个可重放退避值。 */
export function buildDecisionTrace(input: TraceBuildInput): DecisionTrace {
  const stateHash = input.worldState === null ? 'none' : hashWorldState(input.worldState);
  const observedFacts = input.slice === null ? [] : extractObservedFacts(input.slice);
  const candidates: readonly TraceCandidate[] = input.candidates.map((c): TraceCandidate => ({
    actionId: c.actionId,
    score: c.score,
    breakdown: { total: c.breakdown.total, items: c.breakdown.items } as ScoreBreakdownInstance,
  }));
  return {
    correlationId: input.correlationId,
    stateHash,
    timestamp: Date.now(),
    observedFacts: observedFacts as never,
    candidates,
    selected: input.selected,
    submission: input.submission,
  };
}

/** 最小决策证据链（无候选 / 无合法动作时）。 */
export function minimalDecisionTrace(correlationId: string, stateHash: string): DecisionTrace {
  return {
    correlationId,
    stateHash,
    timestamp: Date.now(),
    observedFacts: [],
    candidates: [],
    selected: null,
    submission: { ok: false, rejectionReason: 'no executable decision' },
  };
}

/** 把一次 AIDecisionResult 折叠成 trace 的 submission 字段。 */
export function submissionOfResult(result: AIDecisionResult): TraceSubmission {
  if (result.status === 'submitted' || result.status === 'recommended') return { ok: true };
  const code = result.diagnostics[0]?.code;
  const reason = result.diagnostics[0]?.reason;
  return { ok: false, ...(code === undefined ? {} : { rejectionCode: code }), ...(reason === undefined ? {} : { rejectionReason: reason }) };
}
