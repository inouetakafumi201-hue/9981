/**
 * Task 4/6 测试：DecisionTrace 组装与断言基座（Registry + Runner）。
 *  - trace 携带分类构成 / 观测事实 / 选中 / 提交；
 *  - 断言注册表 JSON 往返 + golden 过滤；
 *  - AssertionRunner 对 trace 检错（wrongSelection / scoreConstraint / pivotConstraint）。
 */
import { describe, expect, it } from 'vitest';
import { scoreBreakdown } from '../../design-currency.js';
import { buildDecisionTrace, minimalDecisionTrace, submissionOfResult, type TraceCandidateInput } from '../build-trace.js';
import { extractObservedFacts, readableFieldName } from '../trace.js';
import { BehaviorAssertionRegistry, AssertionRunner, type BehaviorAssertion } from '../assertions.js';
import { createEmptyWorldState } from '../../../state/world-state.js';
import type { BeliefSlice } from '../../types.js';

function slice(facts: Record<string, number>): BeliefSlice {
  return { agent: { $: 'g:agent' }, visibleFacts: { ...facts }, knownFacts: {}, visibleRefs: [], policyContext: {} };
}

const world = createEmptyWorldState('sched:round');

function candidate(actionId: string, slice: BeliefSlice, score: number): TraceCandidateInput {
  const br = scoreBreakdown({ slice });
  return { actionId, score, breakdown: br };
}

describe('DecisionTrace（Task4）', () => {
  it('携带 correlationId、stateHash、timestamp、observedFacts、candidates、selected、submission', () => {
    const s = slice({ 'e:agent.vitality': 1 });
    const candidates = [
      candidate('a:heal', slice({ 'e:agent.vitality': 5 }), 30),
      candidate('a:hunt', slice({ 'e:agent.vitality': 1 }), -10),
    ];
    const trace = buildDecisionTrace({
      correlationId: 'corr-1',
      slice: s,
      candidates,
      selected: { actionId: 'a:heal', score: 30, reason: 'sustain lives' },
      submission: { ok: true },
      worldState: world,
    });
    expect(trace.correlationId).toBe('corr-1');
    expect(typeof trace.stateHash).toBe('string');
    expect(trace.timestamp).toBeGreaterThan(0);
    expect(trace.observedFacts.length).toBeGreaterThan(0);
    expect(trace.candidates.length).toBe(2);
    expect(trace.selected?.actionId).toBe('a:heal');
    expect(trace.submission.ok).toBe(true);
  });

  it('extractObservedFacts 只提取数字值且排序稳定', () => {
    const facts = extractObservedFacts(slice({ 'e:agent.vitality': 5, 'range': 3, 'nonum': 1 }));
    const keys = facts.map((f) => f.key);
    expect(keys).toContain('e:agent.vitality');
    expect(keys).toContain('range');
    // 数字值全部 >0
    expect(facts.every((f) => f.value > 0)).toBe(true);
  });

  it('minimalDecisionTrace 无候选时 selected 为 null', () => {
    const trace = minimalDecisionTrace('corr-x', 'h');
    expect(trace.selected).toBeNull();
    expect(trace.candidates).toHaveLength(0);
  });

  it('submissionOfResult 把 rejected 结果折叠成 rejectionCode/reason', () => {
    const submission = submissionOfResult({
      status: 'rejected',
      candidate: undefined,
      diagnostics: [{ code: 'AI_NO_LEGAL_ACTION', severity: 'error', category: 'npc-behavior', agent: { $: 'g' }, controlledEntity: { $: 'e' }, policy: { $: 'p' }, correlationId: 'c', phase: 'plan', reason: 'no legal action', upstreamContract: 'planner.plan', hint: 'retry' }],
    } as never);
    expect(submission.ok).toBe(false);
    expect(submission.rejectionCode).toBe('AI_NO_LEGAL_ACTION');
  });
});

describe('BehaviorAssertionRegistry（Task6）', () => {
  const assertion: BehaviorAssertion = {
    id: 'g1', category: 'sustain', description: '残血应保命', isGolden: true, source: 'initial',
    setup: { stateHash: 'h', serialized: '{}' },
    expect: { shouldSelect: 'a:heal', scoreConstraints: [{ feeItem: 'vitality', operator: '<', value: 0, reason: '残血生命为负分' }] },
  };

  it('add/get/all/getByCategory/getGolden', () => {
    const reg = new BehaviorAssertionRegistry([assertion]);
    expect(reg.get('g1')).toEqual(assertion);
    expect(reg.getByCategory('sustain')).toHaveLength(1);
    expect(reg.getGolden()).toHaveLength(1);
    expect(reg.all()).toHaveLength(1);
    expect(reg.size()).toBe(1);
  });

  it('JSON 往返（属性 5 单元版）：导出→导入语义等价、紧凑形态稳定', () => {
    const reg = new BehaviorAssertionRegistry([assertion]);
    const json = reg.exportToJson();
    const reg2 = new BehaviorAssertionRegistry();
    reg2.loadFromJson(json);
    // 语义等价（含 isGolden/source）
    expect(reg2.get('g1')).toEqual(assertion);
    // 再导出应拥有相同断言集（无丢失/无键序漂移导致内容漂移）
    expect(reg2.getGolden()).toHaveLength(1);
    expect(reg2.getGolden()[0]?.id).toBe('g1');
    expect(reg2.all()[0]?.isGolden).toBe(true);
    expect(reg2.all()[0]?.source).toBe('initial');
  });

  it('损坏 JSON 抛带上下文错误', () => {
    const reg = new BehaviorAssertionRegistry();
    expect(() => reg.loadFromJson('{ bad')).toThrow(/JSON/i);
  });

  it('违反 schema（缺 setup）抛错', () => {
    const reg = new BehaviorAssertionRegistry();
    expect(() => reg.loadFromJson(JSON.stringify([{ id: 'x', category: 'c', isGolden: true, expect: {} }]))).toThrow();
  });
});

describe('AssertionRunner（Task6）', () => {
  it('选中匹配期望 → 全绿', () => {
    const s = slice({ 'e:agent.vitality': 5 });
    const trace = buildDecisionTrace({
      correlationId: 'c', slice: s,
      candidates: [candidate('a:heal', s, 30)],
      selected: { actionId: 'a:heal', score: 30, reason: 'sustain' },
      submission: { ok: true }, worldState: world,
    });
    const runner = new AssertionRunner({ runRequest: () => ({ trace, error: undefined }) });
    const result = runner.run({
      id: 'a1', category: 'c', description: '', isGolden: true, source: 'initial',
      setup: { stateHash: 'h', serialized: '{}' },
      expect: { shouldSelect: 'a:heal' },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('选中不匹配 → wrongSelection', () => {
    const s = slice({ 'e:agent.vitality': 5 });
    const trace = buildDecisionTrace({
      correlationId: 'c', slice: s,
      candidates: [candidate('a:hunt', s, 5)],
      selected: { actionId: 'a:hunt', score: 5, reason: 'aggressive' },
      submission: { ok: true }, worldState: world,
    });
    const runner = new AssertionRunner({ runRequest: () => ({ trace, error: undefined }) });
    const result = runner.run({
      id: 'a2', category: 'c', description: '', isGolden: true, source: 'initial',
      setup: { stateHash: 'h', serialized: '{}' },
      expect: { shouldSelect: 'a:heal' },
    });
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.type).toBe('wrongSelection');
  });

  it('scoreConstraint 不满足 → scoreConstraint 违规', () => {
    const s = slice({ 'e:agent.vitality': 5 });
    const trace = buildDecisionTrace({
      correlationId: 'c', slice: s,
      candidates: [candidate('a:heal', s, 30)],
      selected: { actionId: 'a:heal', score: 30, reason: 'sustain' },
      submission: { ok: true }, worldState: world,
    });
    const runner = new AssertionRunner({ runRequest: () => ({ trace, error: undefined }) });
    const result = runner.run({
      id: 'a3', category: 'c', description: '', isGolden: true, source: 'initial',
      setup: { stateHash: 'h', serialized: '{}' },
      // 期望残血生命是负分，但这里 health=5 是正分 → 违规
      expect: { scoreConstraints: [{ feeItem: 'vitality', operator: '<', value: 0, reason: '残血为负' }] },
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.type === 'scoreConstraint')).toBe(true);
  });

  it('pivotConstraint 期望触发但未触发 → pivotConstraint 违规', () => {
    const s = slice({ 'e:agent.vitality': 5 }); // 安全窗口，lethalWindow 不触发
    const trace = buildDecisionTrace({
      correlationId: 'c', slice: s,
      candidates: [candidate('a:heal', s, 30)],
      selected: { actionId: 'a:heal', score: 30, reason: 'sustain' },
      submission: { ok: true }, worldState: world,
    });
    const runner = new AssertionRunner({ runRequest: () => ({ trace, error: undefined }) });
    const result = runner.run({
      id: 'a4', category: 'c', description: '', isGolden: true, source: 'initial',
      setup: { stateHash: 'h', serialized: '{}' },
      expect: { pivotConstraints: [{ pivot: 'lethalWindow', shouldTrigger: true, reason: '期望触发' }] },
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.type === 'pivotConstraint')).toBe(true);
  });

  it('无可用于断言的 trace → 违规', () => {
    const runner = new AssertionRunner({ runRequest: () => ({ trace: null, error: 'no decision trace' }) });
    const result = runner.run({
      id: 'a5', category: 'c', description: '', isGolden: true, source: 'initial',
      setup: { stateHash: 'h', serialized: '{}' },
      expect: { shouldSelect: 'a:heal' },
    });
    expect(result.passed).toBe(false);
  });
});

describe('可读字段名（面向玩家）', () => {
  it('把费目术语翻译成贴近玩家的描述', () => {
    expect(readableFieldName('e:enemy.vitality')).toBe('敌人的生命值');
    expect(readableFieldName('pool.ap')).toBe('行动点');
    expect(readableFieldName('pool.stamina')).toBe('体力');
    expect(readableFieldName('E')).toBe('武器/装备等级');
  });
});
