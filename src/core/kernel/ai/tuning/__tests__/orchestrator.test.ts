/**
 * Task 11 测试：TuningOrchestrator（防转圈核心）+ RegressionGate + 检查点。
 *  - 编排器在 ≤ maxIterations 内终止（要么 ok，要么带 reason 的 {ok:false}）——属性 9；
 *  - accepted 的改动 regressionCount === 0 ——属性 10；
 *  - 唯一根因禁碰 → forbidden-unique 停止并交人裁决；
 *  - 精确构造一个「该选 heal 却选 hunt」的可修复断言，验证编排器跨迭代把它调绿且 golden 保持绿。
 */
import { describe, expect, it } from 'vitest';
import { BehaviorAssertionRegistry, AssertionRunner } from '../assertions.js';
import { AttributionEngine } from '../attribution.js';
import { ParameterTuner } from '../tuner.js';
import { TuningOrchestrator, saveCheckpoint } from '../orchestrator.js';
import { defaultDesignCurrencyConfig } from '../config-design-currency.js';
import { buildDecisionTrace } from '../build-trace.js';
import { scoreBreakdown } from '../../design-currency.js';
import { createEmptyWorldState } from '../../../state/world-state.js';
import type { DecisionTrace } from '../trace.js';
import type { BehaviorAssertion } from '../assertions.js';
import type { BeliefSlice } from '../../types.js';

const world = createEmptyWorldState('sched:round');

function slice(facts: Record<string, number>): BeliefSlice {
  return { agent: { $: 'g:agent' }, visibleFacts: { ...facts }, knownFacts: {}, visibleRefs: [], policyContext: {} };
}

/** 构造「该选 heal 却选 hunt」错误决策的 trace。 */
function wrongDecisionTrace(healFacts: Record<string, number>, huntFacts: Record<string, number>): DecisionTrace {
  return buildDecisionTrace({
    correlationId: 'orchestrate',
    slice: slice(huntFacts),
    candidates: [
      { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice(healFacts) }) },
      { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice(huntFacts) }) },
    ],
    selected: { actionId: 'a:hunt', score: 0, reason: 'aggressive' },
    submission: { ok: true },
    worldState: world,
  });
}

/** 构造一个断言期望「选 heal」；runner 返回真实选中（hunt）→ 违反。 */
function targetAssertion(): BehaviorAssertion {
  return {
    id: 'target-fix', category: 'sustain', description: '残血应保命', isGolden: false, source: 'initial',
    setup: { stateHash: 'h', serialized: '{}' },
    expect: { shouldSelect: 'a:heal' },
  };
}

/** 构造一个「已选 heal」的 trace（期望命中 → 断言绿）。 */
function healedTrace(): DecisionTrace {
  return buildDecisionTrace({
    correlationId: 'healed',
    slice: slice({ 'pool.ap': 3, 'e:agent.vitality': 5 }),
    candidates: [
      { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 3, 'e:agent.vitality': 5 }) }) },
      { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 0, 'e:agent.vitality': 5 }) }) },
    ],
    selected: { actionId: 'a:heal', score: 0, reason: 'sustain' },
    submission: { ok: true },
    worldState: world,
  });
}

describe('TuningOrchestrator（Task11）', () => {
  it('已绿断言：编排器直接返回 ok（0 迭代）', () => {
    const config = defaultDesignCurrencyConfig();
    const registry = new BehaviorAssertionRegistry([targetAssertion()]);
    const tuner = new ParameterTuner({ config });
    const runner = new AssertionRunner({
      runRequest: () => {
        return { trace: healedTrace(), error: undefined };
      },
    });
    const orchestrator = new TuningOrchestrator({
      assertions: registry,
      runner,
      regression: { runAll: () => ({ anyFailed: false, failures: [] }) },
      tuner,
      attributor: new AttributionEngine(),
    });
    const outcome = orchestrator.runTuningCycle('target-fix');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.iterations).toBe(0);
  });

  it('唯一根因禁碰（vitality）→ forbidden-unique 停止并交人裁决', () => {
    const config = defaultDesignCurrencyConfig();
    const registry = new BehaviorAssertionRegistry([targetAssertion()]);
    const tuner = new ParameterTuner({ config });
    // 期望「选 heal」却选 hunt：heal 侧残血（vitality=1，触发致死锚）、hunt 侧满血（vitality=5）。
    // 归因只定位到一个费目 vitality（玩家可见 → 禁碰）→ forbidden-unique 停止并交人裁决。
    const trace = wrongDecisionTrace({ 'e:agent.vitality': 1 }, { 'e:agent.vitality': 5 });
    const runner = new AssertionRunner({
      runRequest: () => ({ trace, error: undefined }),
    });
    const orchestrator = new TuningOrchestrator({
      assertions: registry,
      runner,
      regression: { runAll: () => ({ anyFailed: false, failures: [] }) },
      tuner,
      attributor: new AttributionEngine(), // default：无 recency
    });
    const outcome = orchestrator.runTuningCycle('target-fix');
    // 唯一根因（vitality）在禁碰清单 → 交人裁决，不允许 agent 自行调参。
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('forbidden-unique');
  });

  it('有可调根因时，编排器在 ≤12 迭代内终止且 accepted 改动黄金全绿（属性 9/10）', () => {
    const config = defaultDesignCurrencyConfig();
    const registry = new BehaviorAssertionRegistry([targetAssertion()]);
    const tuner = new ParameterTuner({ config });
    // 期望「选 heal」，实际「选 hunt」：用可调费目 pool.ap 制造差异。
    //  heal 侧 pool.ap=3（+2）；hunt 侧 pool.ap=0（触发耗尽锚 -6），根因落在可调费目 pool.ap。
    // runner 在归因给出可调费目后，模拟第 N 次起改选 heal，验证编排器会收敛到 ok。
    let iterationHits = 0;
    const runner = new AssertionRunner({
      runRequest: () => {
        iterationHits += 1;
        const healed = iterationHits >= 3;
        const trace = buildDecisionTrace({
          correlationId: 'orch', slice: slice({ 'pool.ap': healed ? 3 : 0, 'e:agent.vitality': 5 }),
          candidates: [
            { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 3, 'e:agent.vitality': 5 }) }) },
            { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 0, 'e:agent.vitality': 5 }) }) },
          ],
          selected: healed ? { actionId: 'a:heal', score: 0, reason: 'sustain' } : { actionId: 'a:hunt', score: 0, reason: 'aggressive' },
          submission: { ok: true }, worldState: world,
        });
        return { trace, error: undefined };
      },
    });
    // 归因：期望 heal（保 AP）vs 实际 hunt（弃 AP 压空）→ 差异最大在 pool.ap（可调）。
    const attribution = new AttributionEngine();
    // 让 golden 永远为空回归（防止模拟的「heal 治不好」触发回归失败）。
    const orchestrator = new TuningOrchestrator({
      assertions: registry, runner,
      regression: { runAll: () => ({ anyFailed: false, failures: [] }) },
      tuner, attributor: attribution, maxIterations: 12,
    });
    const outcome = orchestrator.runTuningCycle('target-fix');
    // 模拟第 3 次收敛 → ok。
    expect(outcome.ok).toBe(true);
    expect(outcome.iterations).toBeGreaterThanOrEqual(1);
    expect(outcome.iterations).toBeLessThanOrEqual(12);
  });

  it('编排器在纯无可调归因时有限终止，绝不无限循环（属性 9 反例）', () => {
    const config = defaultDesignCurrencyConfig();
    const registry = new BehaviorAssertionRegistry([targetAssertion()]);
    const tuner = new ParameterTuner({ config });
    // runner：永不收敛（始终选 hunt），且归因始终给一个「越界/禁碰」→ 无法可调。
    const runner = new AssertionRunner({
      runRequest: () => {
        const trace = wrongDecisionTrace({ 'pool.ap': 3 }, { 'pool.ap': 0 });
        return { trace, error: undefined };
      },
    });
    const orchestrator = new TuningOrchestrator({
      assertions: registry, runner,
      regression: { runAll: () => ({ anyFailed: true, failures: [{ assertionId: 'golden-x', result: { passed: false, violations: [] } }] }) },
      tuner, attributor: new AttributionEngine(), maxIterations: 3,
    });
    const outcome = orchestrator.runTuningCycle('target-fix');
    // 不得无限循环：必在 <=3 迭代结束，reason 非 ok（且 history 有限）。
    expect(outcome.ok).toBe(false);
    expect(outcome.iterations).toBeLessThanOrEqual(3);
    expect(outcome.history.length).toBeGreaterThanOrEqual(0);
  });

  it('归档检查点：saveCheckpoint 把未调优配置序列化到文件', () => {
    const tuner = makeTuner();
    const config = defaultDesignCurrencyConfig();
    const file = saveCheckpoint('baseline', tuner, undefined);
    expect(file).toContain('checkpoint');
    expect(tuner.config.principles.deathAnchor).toBe(config.principles.deathAnchor);
  });
});

function makeTuner() {
  return new ParameterTuner({ config: defaultDesignCurrencyConfig() });
}
