/**
 * 阶段 3 PBT：属性 9/10（编排器终止 + 回归守恒）。
 *
 * 属性 9：任意 runTuningCycle 在 ≤maxIterations 内要么 ok、要么带 reason 停止，绝不无限循环。
 * 属性 10：accepted 的改动 regressionCount === 0。
 *
 * 生成器：随机断言 + 可控 budget + 故障注入候选。
 * numRuns ≥ 100，标签 `Feature: wakeup-ai-tuning, Property 9/10`。
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { BehaviorAssertionRegistry, AssertionRunner, type BehaviorAssertion } from '../assertions.js';
import { AttributionEngine } from '../attribution.js';
import { ParameterTuner } from '../tuner.js';
import { TuningOrchestrator } from '../orchestrator.js';
import { defaultDesignCurrencyConfig } from '../config-design-currency.js';
import { buildDecisionTrace } from '../build-trace.js';
import { scoreBreakdown } from '../../design-currency.js';
import { createEmptyWorldState } from '../../../state/world-state.js';
import type { BeliefSlice } from '../../types.js';

const world = createEmptyWorldState('sched:pbt9');

function slice(facts: Record<string, number>): BeliefSlice {
  return { agent: { $: 'g:agent' }, visibleFacts: { ...facts }, knownFacts: {}, visibleRefs: [], policyContext: {} };
}

/** 可调费目的错误 trace（期望 heal 却选 hunt，根因落在可调费目 pool.ap）。 */
function wrongTrace(): ReturnType<typeof buildDecisionTrace> {
  return buildDecisionTrace({
    correlationId: 'pbt9', slice: slice({ 'pool.ap': 0 }),
    candidates: [
      { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 3 }) }) },
      { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 0 }) }) },
    ],
    selected: { actionId: 'a:hunt', score: 0, reason: 'aggressive' },
    submission: { ok: true }, worldState: world,
  });
}

describe('PBT 属性 9/10（Task21）', () => {
  it('属性 9：任意 budget 下编排器有限终止（绝不无限循环）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }),
        (budget) => {
          const config = defaultDesignCurrencyConfig();
          const registry = new BehaviorAssertionRegistry([mkAssertion()]);
          const tuner = new ParameterTuner({ config });
          // runner 永不收敛（始终 hunt）→ 看是否在 budget 内终止。
          const runner = new AssertionRunner({
            runRequest: () => ({ trace: wrongTrace(), error: undefined }),
          });
          const orchestrator = new TuningOrchestrator({
            assertions: registry, runner,
            regression: { runAll: () => ({ anyFailed: false, failures: [] }) },
            tuner, attributor: new AttributionEngine(), maxIterations: Math.max(1, budget),
          });
          const outcome = orchestrator.runTuningCycle('target-fix');
          // 要么 ok，要么带 reason 的 {ok:false}——绝不无限循环。
          if (outcome.ok) return true;
          return typeof outcome.reason === 'string' && outcome.reason.length > 0;
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 9 反例：回归恒失败时编排器在 budget 内停止并交回 history', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (budget) => {
          const config = defaultDesignCurrencyConfig();
          const registry = new BehaviorAssertionRegistry([mkAssertion()]);
          const tuner = new ParameterTuner({ config });
          const runner = new AssertionRunner({
            runRequest: () => ({ trace: wrongTrace(), error: undefined }),
          });
          const orchestrator = new TuningOrchestrator({
            assertions: registry, runner,
            regression: { runAll: () => ({ anyFailed: true, failures: [{ assertionId: 'golden-x', result: { passed: false, violations: [] } }] }) },
            tuner, attributor: new AttributionEngine(), maxIterations: budget,
          });
          const outcome = orchestrator.runTuningCycle('target-fix');
          if (outcome.iterations > budget) return false;
          if (outcome.ok) return false; // 回归恒失败不可能 ok
          return typeof outcome.reason === 'string';
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 10：accepted 记录 regressionCount === 0（本测试用空回归跑通收敛闭环）', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (shouldConverge) => {
          const config = defaultDesignCurrencyConfig();
          const registry = new BehaviorAssertionRegistry([mkAssertion()]);
          const tuner = new ParameterTuner({ config });
          let hits = 0;
          const runner = new AssertionRunner({
            runRequest: () => {
              hits += 1;
              const healed = shouldConverge && hits >= 3;
              const trace = buildDecisionTrace({
                correlationId: 'pbt10', slice: slice({ 'pool.ap': healed ? 3 : 0 }),
                candidates: [
                  { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 3 }) }) },
                  { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 0 }) }) },
                ],
                selected: healed ? { actionId: 'a:heal', score: 0, reason: 'sustain' } : { actionId: 'a:hunt', score: 0, reason: 'aggressive' },
                submission: { ok: true }, worldState: world,
              });
              return { trace, error: undefined };
            },
          });
          const orchestrator = new TuningOrchestrator({
            assertions: registry, runner,
            regression: { runAll: () => ({ anyFailed: false, failures: [] }) },
            tuner, attributor: new AttributionEngine(), maxIterations: 12,
          });
          const outcome = orchestrator.runTuningCycle('target-fix');
          // 任何 accepted 记录必须 regressionCount === 0。
          for (const rec of outcome.history) {
            if (rec.decision === 'accepted' && rec.verification.regressionCount !== 0) return false;
          }
          return true;
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});

function mkAssertion(): BehaviorAssertion {
  return {
    id: 'target-fix', category: 'sustain', description: 'x', isGolden: false, source: 'initial',
    setup: { stateHash: 'h', serialized: '{}' }, expect: { shouldSelect: 'a:heal' },
  };
}
