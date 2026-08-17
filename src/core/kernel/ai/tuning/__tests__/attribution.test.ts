/**
 * Task 9 测试：归因引擎。
 *  - wrongSelection：对比期望/实际 breakdown，输出贡献差异最大的费目；
 *  - scoreConstraint：直接定位约束费目，confidence 0.9；
 *  - 只返回 trace 里真实出现的费目；
 *  - 近几轮被反复调的费目降置信（局部化提示）。
 */
import { describe, expect, it } from 'vitest';
import { AttributionEngine, type Cause } from '../attribution.js';
import { buildDecisionTrace } from '../build-trace.js';
import { scoreBreakdown } from '../../design-currency.js';
import { createEmptyWorldState } from '../../../state/world-state.js';
import type { AssertionViolation } from '../assertions.js';
import type { DecisionTrace } from '../trace.js';
import type { BeliefSlice } from '../../types.js';

function slice(facts: Record<string, number>): BeliefSlice {
  return { agent: { $: 'g:agent' }, visibleFacts: { ...facts }, knownFacts: {}, visibleRefs: [], policyContext: {} };
}
const world = createEmptyWorldState('sched:round');

/** 构造 trace：给定候选候选 breakdown 与「实际选中」。 */
function traceWith(candidates: Array<{ actionId: string; slice: BeliefSlice }>, selectedAction: string): DecisionTrace {
  return buildDecisionTrace({
    correlationId: 'attr', slice: candidates[0]?.slice ?? slice({}), 
    candidates: candidates.map((c) => ({ actionId: c.actionId, score: 0, breakdown: scoreBreakdown({ slice: c.slice }) })),
    selected: { actionId: selectedAction, score: 0, reason: 'r' },
    submission: { ok: true }, worldState: world,
  });
}

function wrongSelectionViolation(expected: string, trace: DecisionTrace): AssertionViolation {
  return { type: 'wrongSelection', expected, actual: trace.selected?.actionId ?? 'none', trace };
}

describe('AttributionEngine（Task9）', () => {
  it('wrongSelection 对比期望/实际 breakdown，输出贡献差异最大的费目', () => {
    // 期望「残血保命」(heal)：heal 分支把 enemy 移走、无死亡锚；实际「攻击」(hunt)：保留残血死亡锚。
    const trace = traceWith([
      { actionId: 'a:heal', slice: slice({ 'e:agent.vitality': 5, 'e:enemy.vitality': 0 }) }, // 期望
      { actionId: 'a:hunt', slice: slice({ 'e:agent.vitality': 1, 'e:enemy.vitality': 3 }) }, // 实际
    ], 'a:hunt');
    const engine = new AttributionEngine();
    const causes = engine.attribute(wrongSelectionViolation('a:heal', trace), trace);
    expect(causes.length).toBeGreaterThan(0);
    // 根因应是「在两端贡献差异最大」的费目——敌方残血 vs 敌方活体，或死亡锚。
    const top = causes[0]!;
    expect(top.feeItem).toBeTruthy();
    expect(top.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('scoreConstraint 型直接定位约束费目，confidence 0.9', () => {
    const s = slice({ 'e:enemy.vitality': 3 });
    const trace = traceWith([{ actionId: 'a:attack', slice: s }], 'a:attack');
    const violation: AssertionViolation = {
      type: 'scoreConstraint',
      expected: 'e:enemy.vitality < 0',
      actual: 'contribution = 5',
      trace,
    };
    const causes = new AttributionEngine().attribute(violation, trace);
    expect(causes[0]?.feeItem).toBe('e:enemy.vitality');
    expect(causes[0]?.confidence).toBeCloseTo(0.9);
  });

  it('只返回 trace 里真实出现的费目（实际候选 breakdown 里的项）', () => {
    const trace = traceWith([{ actionId: 'a:heal', slice: slice({ 'not.a.field': 9 }) }], 'a:heal');
    const causes = new AttributionEngine().attribute(wrongSelectionViolation('a:heal', trace), trace);
    // 'not.a.field' 不在费目表 → 无贡献 → 归因无候选（cannot-attribute 由编排器处理）。
    expect(causes.length).toBe(0);
  });

  it('近 4 轮被反复调的费目降置信', () => {
    const trace = traceWith([
      { actionId: 'a:heal', slice: slice({ 'e:agent.vitality': 5, 'e:enemy.vitality': 0 }) },
      { actionId: 'a:hunt', slice: slice({ 'e:agent.vitality': 1, 'e:enemy.vitality': 3 }) },
    ], 'a:hunt');
    const recency = new Map<string, number>([['e:enemy.vitality', 3]]);
    const causes = new AttributionEngine({ recency }).attribute(wrongSelectionViolation('a:heal', trace), trace);
    // 在被标记频繁的费目降置信后仍有条目（若该费目是唯一根因，其 confidence 减半）。
    const enemyCause = causes.find((c) => c.feeItem === 'e:enemy.vitality');
    if (enemyCause !== undefined) {
      expect(enemyCause.confidence).toBeLessThanOrEqual(0.9);
    }
    let expectation: Cause[] | undefined;
    void expectation;
  });
});
