/**
 * 阶段 3 PBT：属性 12/13/14（skill 加载 + 固化门槛 + 边界上交）。
 *
 * 属性 12：skill 启动缺文件/空 → 拒绝并提示缺失，不静默。
 * 属性 13：仅 passed && golden 全绿才可固化。
 * 属性 14：进入无解/震荡/低置信/禁碰/需新机制状态 → 停止上交，不硬调。
 *
 * 生成器：随机加载缺项组合 / 固化输入 / 编排器故障注入。
 * numRuns ≥ 100，标签 `Feature: wakeup-ai-tuning, Property 12/13/14`。
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
import { solidifyAssertion } from '../report.js';
import type { BeliefSlice } from '../../types.js';

const world = createEmptyWorldState('sched:pbt14');

function slice(facts: Record<string, number>): BeliefSlice {
  return { agent: { $: 'g:agent' }, visibleFacts: { ...facts }, knownFacts: {}, visibleRefs: [], policyContext: {} };
}

function wrongTrace(): ReturnType<typeof buildDecisionTrace> {
  return buildDecisionTrace({
    correlationId: 'pbt14', slice: slice({ 'pool.ap': 0 }),
    candidates: [
      { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 3 }) }) },
      { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'pool.ap': 0 }) }) },
    ],
    selected: { actionId: 'a:hunt', score: 0, reason: 'aggressive' },
    submission: { ok: true }, worldState: world,
  });
}

describe('PBT 属性 12/13/14（Task22）', () => {
  it('属性 12：固化仅在 passed && golden 全绿时成功，其余组合拒绝', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (passed, green) => {
          const registry = new BehaviorAssertionRegistry();
          const assertion: BehaviorAssertion = {
            id: 'a-pbt', category: 'sustain', description: 'x', isGolden: false, source: 'initial',
            setup: { stateHash: 'h', serialized: '{}' }, expect: { shouldSelect: 'a:heal' },
          };
          const result = solidifyAssertion(assertion, passed, green, registry);
          if (passed && green) {
            // 应成功固化且 source=tuning-derived。
            if (!result.ok) return false;
            return registry.get('a-pbt')?.source === 'tuning-derived';
          }
          // 否则拒绝。
          return !result.ok && registry.get('a-pbt') === undefined;
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 14：唯一根因禁碰 → 编排器停止上交（ok:false 且 reason=forbidden-unique）', () => {
    fc.assert(
      fc.property(
        fc.constant(1),
        () => {
          const config = defaultDesignCurrencyConfig();
          const registry = new BehaviorAssertionRegistry([mkAssertion()]);
          const tuner = new ParameterTuner({ config });
          // 用 vitality（禁碰）制造差异：heal 侧残血、hunt 侧满血。
          const trace = buildDecisionTrace({
            correlationId: 'pbt14forbidden', slice: slice({ 'e:agent.vitality': 5 }),
            candidates: [
              { actionId: 'a:heal', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'e:agent.vitality': 1 }) }) },
              { actionId: 'a:hunt', score: 0, breakdown: scoreBreakdown({ slice: slice({ 'e:agent.vitality': 5 }) }) },
            ],
            selected: { actionId: 'a:hunt', score: 0, reason: 'aggressive' },
            submission: { ok: true }, worldState: world,
          });
          const runner = new AssertionRunner({ runRequest: () => ({ trace, error: undefined }) });
          const orchestrator = new TuningOrchestrator({
            assertions: registry, runner,
            regression: { runAll: () => ({ anyFailed: false, failures: [] }) },
            tuner, attributor: new AttributionEngine(), maxIterations: 4,
          });
          const outcome = orchestrator.runTuningCycle('target-fix');
          return !outcome.ok && outcome.reason === 'forbidden-unique';
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 14 延伸：无解/禁碰状态停止上交、不硬调（history 有限）', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (regressFail) => {
          const config = defaultDesignCurrencyConfig();
          const registry = new BehaviorAssertionRegistry([mkAssertion()]);
          const tuner = new ParameterTuner({ config });
          const runner = new AssertionRunner({ runRequest: () => ({ trace: wrongTrace(), error: undefined }) });
          const orchestrator = new TuningOrchestrator({
            assertions: registry, runner,
            regression: { runAll: () => (regressFail ? { anyFailed: true, failures: [{ assertionId: 'g', result: { passed: false, violations: [] } }] } : { anyFailed: false, failures: [] }) },
            tuner, attributor: new AttributionEngine(), maxIterations: 4,
          });
          const outcome = orchestrator.runTuningCycle('target-fix');
          // 有限终止，且任何进入边界状态都带 reason（不硬调成 ok 后无历史）。
          if (outcome.ok) return true; // 收敛是合法的
          return typeof outcome.reason === 'string' && outcome.iterations <= 4;
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
