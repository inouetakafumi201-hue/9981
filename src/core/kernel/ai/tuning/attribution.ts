/**
 * 归因引擎（Task 9）—— 定位「哪条费目导致违规」。
 *
 * 输入：一条违规 + 决策 trace。输出：按置信度降序的根因费目候选。
 * 规则（design.md §3）：
 *  - wrongSelection：对比期望动作与实际动作的 ScoreBreakdown，输出贡献差异最大的费目为根因；
 *    confidence = |差异| / |总分差|（总分差为 0 时给保守值）。
 *  - scoreConstraint：直接定位到该约束索引的费目，confidence = 0.9。
 *  - pivotConstraint：定位到该 pivot 对应费目，confidence = 0.9。
 *  - 只返回 trace 里真实出现的费目（未观测不归因）。
 *  - 若某费目近 N 轮都被调过，降低其置信度（提示可能陷入局部）——由编排器注入最近记录。
 */
import type { DecisionTrace, TraceCandidate } from './trace.js';
import type { AssertionViolation, ScoreConstraint } from './assertions.js';

/** 根因候选。 */
export interface Cause {
  readonly feeItem: string;
  readonly confidence: number;
  readonly reasoning: string;
}

/** 归因依赖：提供「哪些费目近期被反复调过」（用于降置信）。 */
export interface AttributionContext {
  /** 近几轮里被调过的费目（键）与次数。 */
  readonly recency: ReadonlyMap<string, number>;
}

const DEFAULT_CONTEXT: AttributionContext = { recency: new Map() };

/** 从 trace 收集「期望动作」的 breakdown（按动作 id 查找）。 */
function breakdownOf(trace: DecisionTrace, actionId: string | undefined): TraceCandidate | undefined {
  if (actionId === undefined) return undefined;
  return trace.candidates.find((c) => c.actionId === actionId);
}

/**
 * 归因主入口：给定违规 + trace + 可选近期改动统计，返回根因候选（降序）。
 * 至少返回一条；无候选且无法归因时返回空数组（由编排器据此 stop cannot-attribute）。
 */
export class AttributionEngine {
  constructor(private readonly context: AttributionContext = DEFAULT_CONTEXT) {}

  attribute(violation: AssertionViolation, trace: DecisionTrace): Cause[] {
    if (violation.type === 'wrongSelection') {
      const causes = this.attributeWrongSelection(violation, trace, violation.expected);
      return rankAndPrioritize(causes, this.context.recency);
    }
    if (violation.type === 'scoreConstraint') {
      const causes = this.attributeConstraint(violation, trace);
      return rankAndPrioritize(causes, this.context.recency);
    }
    // pivotConstraint 型：定位到该 pivot 对应费目。
    const causes: Cause[] = [];
    for (const candidate of trace.candidates) {
      for (const item of candidate.breakdown.items) {
        if (item.triggeredPivot !== undefined && violation.expected.includes(item.triggeredPivot)) {
          causes.push({ feeItem: item.feeItem, confidence: 0.9, reasoning: `分水岭约束不满足：${violation.expected}。` });
        }
      }
    }
    return rankAndPrioritize(causes, this.context.recency);
  }

  private attributeWrongSelection(violation: AssertionViolation, trace: DecisionTrace, expectedAction: string): Cause[] {
    const expected = breakdownOf(trace, expectedAction);
    const actual = breakdownOf(trace, trace.selected?.actionId);
    if (expected === undefined && actual === undefined) return [];
    if (expected === undefined || actual === undefined) {
      // 候选缺失时，从实际候选里找贡献差异最大的，或回退到「选中候选贡献最大项」。
      const fallback = actual ?? expected;
      if (fallback === undefined) return [];
      return diffFromSingle(fallback);
    }
    // 对比期望 vs 实际的逐费目贡献差异。
    const expectedItems = new Map(expected.breakdown.items.map((i) => [i.feeItem, i.contribution]));
    const actualItems = new Map(actual.breakdown.items.map((i) => [i.feeItem, i.contribution]));
    const feeItems = new Set([...expectedItems.keys(), ...actualItems.keys()]);
    const diffs: Array<{ feeItem: string; diff: number }> = [];
    for (const feeItem of feeItems) {
      const exp = expectedItems.get(feeItem) ?? 0;
      const act = actualItems.get(feeItem) ?? 0;
      // 只归因为「实际候选里确实出现」的费目。
      if (actualItems.has(feeItem)) diffs.push({ feeItem, diff: act - exp });
    }
    if (diffs.length === 0) return [];
    const totalDiff = Math.abs(actual.breakdown.total - expected.breakdown.total);
    const denom = totalDiff > 0 ? totalDiff : 1; // 分数平局时用保守尺度
    return diffs
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .map((d) => ({
        feeItem: d.feeItem,
        // confidence 落在 0.3~0.95：差异化越大越可信，最低抬到 0.3 避免「过低即停」误伤。
        confidence: clamp(0.3, 0.95, Math.abs(d.diff) / denom),
        reasoning: `该选 ${expectedAction} 却选了 ${trace.selected?.actionId ?? '无'}：费目「${d.feeItem}」在两者间的贡献差异最大（差 ${d.diff} 分）。`,
      }));
  }

  private attributeConstraint(violation: AssertionViolation, trace: DecisionTrace): Cause[] {
    const constraint = extractConstraintFromViolation(violation);
    if (constraint === undefined) return [];
    const causes: Cause[] = [];
    for (const candidate of trace.candidates) {
      for (const item of candidate.breakdown.items) {
        if (item.feeItem === constraint.feeItem) {
          causes.push({
            feeItem: item.feeItem,
            confidence: 0.9,
            reasoning: `分数约束 ${constraint.feeItem} ${constraint.operator} ${constraint.value} 不满足（当前贡献 ${item.contribution}）。`,
          });
        }
      }
    }
    return causes;
  }
}

function diffFromSingle(fallthrough: TraceCandidate): Cause[] {
  const maxItem = fallthrough.breakdown.items.reduce<{ feeItem: string; contribution: number } | null>(
    (acc, item) => (acc === null || Math.abs(item.contribution) > Math.abs(acc.contribution) ? item : acc),
    null,
  );
  if (maxItem === null) return [];
  return [{
    feeItem: maxItem.feeItem,
    confidence: 0.6,
    reasoning: `无法对比期望与实际动作的完整 breakdown，回退到实际候选 ${fallthrough.actionId} 贡献最大的费目「${maxItem.feeItem}」。`,
  }];
}

/** 从违规描述里解析分数约束（期望字符串带 operator+value。这里用正则），或由断言上下文直接提供。 */
function extractConstraintFromViolation(violation: AssertionViolation): ScoreConstraint | undefined {
  const m = /^(\S+)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*/.exec(violation.expected);
  if (m === null) return undefined;
  const op = m[2] as ScoreConstraint['operator'];
  if (!(op === '>' || op === '<' || op === '>=' || op === '<=')) return undefined;
  const feeItem = m[1];
  if (feeItem === undefined) return undefined;
  return { feeItem, operator: op, value: Number(m[3]), reason: violation.expected };
}

function rankAndPrioritize(causes: Cause[], recency: ReadonlyMap<string, number>): Cause[] {
  if (causes.length === 0) return [];
  const processed = causes.map((cause) => {
    const recent = recency.get(cause.feeItem) ?? 0;
    // 近几轮被调 ≥2 次 → 置信度减半（提示可能已局部化），但保底 0.1。
    if (recent >= 2) return { ...cause, confidence: cause.confidence * 0.5 };
    return cause;
  });
  return processed.sort((a, b) => b.confidence - a.confidence);
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}
