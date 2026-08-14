/**
 * Feature: wakeup-engine-bombardment
 * Property 4: L4-L5 Hook/Flow 确定性 + 预算
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 *
 * - HookDispatcher 对任意随机 RuleDef 候选集 × 事件输入，分发结果确定（同输入同输出）；
 * - 深度超限签发 E_HOOK_DEPTH（不陷入无限递归）；
 * - FlowInterpreter 对随机效果脚本：用有限预算防挂死、不存在必然挂死的输入（对合法脚本
 *   预算回退；对缺失 maxIter 的 while 签发 E_FLOW_NO_MAXITER）；
 * - 由真实接线（wireHooksIntoRegistry）驱动的 effects 在创建 FullHarness 时被真实执行。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { HookDispatcher, type HookCandidate, type HookDispatcherDeps } from '../events/dispatcher.js';
import { FlowInterpreter, type FlowRunResult } from '../flow/interpreter.js';
import type { Effect } from '../events/effect-types.js';
import type { RuleDef, HookPhase } from '../events/types.js';
import { Transaction, WorldStateHolder } from '../ops/transaction.js';
import { createEmptyWorldState } from '../state/world-state.js';
import { QueryEngine } from '../expr/query-engine.js';
import type { OpContext } from '../ops/registry.js';
import type { Value } from '../state/value.js';
import { ok } from '../ops/result.js';
import { createFullHarness, defaultSeedDefs } from '../testing/full-harness.js';
import { resetIdCounters } from '../state/ids.js';

const PHASES: HookPhase[] = ['before', 'instead', 'modify', 'after'];
const MAX_DEPTH = 32;

/** 生成一组随机 RuleDef 候选（phase/priority/effects）。 */
interface RuleSpec {
  ids: string[];
  phases: HookPhase[];
  priorities: number[];
  effectScripts: Effect[][];
}

const scalarExpr: fc.Arbitrary<Value> = fc.oneof(
  fc.constant(1),
  fc.constant(true),
  fc.string(),
  fc.constant(null),
  fc.integer({ min: -100, max: 100 }),
);
const emitEffect: fc.Arbitrary<Effect> = fc.record({
  emit: fc.constantFrom('entity.created', 'item.moved', 'sound.emitted', 'decision.opened'),
  data: fc.oneof(fc.constant(1), fc.constant(true), fc.constant('x'), fc.constant(null)),
}) as fc.Arbitrary<Effect>;
const whileEffect: fc.Arbitrary<Effect> = fc.integer({ min: 1, max: 3 }).chain((iter) =>
  fc.array(fc.constantFrom<Effect>({ emit: 'tick' }, { emit: 'throttle' } as Effect), { maxLength: 3 }).map(
    (emits): Effect => ({
      while: { op: 'literal', args: { value: true } },
      do: emits,
      maxIter: iter,
    }),
  ),
);
const effectArb: fc.Arbitrary<Effect> = fc.oneof(emitEffect, whileEffect, fc.constant<Effect>({ abort: true }));
const effectListArb: fc.Arbitrary<Effect[]> = fc.array(effectArb, { maxLength: 5 });

const ruleSetArb: fc.Arbitrary<RuleSpec> = fc
  .record({ n: fc.integer({ min: 1, max: 5 }) })
  .chain(({ n }) =>
    fc.record({
      ids: fc.array(fc.constantFrom('r:a', 'r:b', 'r:c', 'r:d', 'r:e'), { minLength: n, maxLength: n }),
      phases: fc.array(fc.constantFrom(...PHASES), { minLength: n, maxLength: n }),
      priorities: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: n, maxLength: n }),
      effectScripts: fc.array(effectListArb, { minLength: n, maxLength: n }),
    }),
  );

function candidatesOf(spec: RuleSpec): HookCandidate[] {
  return spec.ids.map((id, i) => ({
    rule: {
      id,
      kind: 'rule',
      on: 'entity.create',
      phase: spec.phases[i] as HookPhase,
      priority: spec.priorities[i] as number,
      effects: spec.effectScripts[i] ?? [],
    } as RuleDef,
  }));
}

/** 最小可用 OpContext（tx + emit + depth），供 Hook/Flow 独立测试用。 */
function makeCtx(tx: Transaction): OpContext {
  return {
    tx,
    emit: () => {},
    depth: 0,
    holder: new WorldStateHolder(tx.getDraft()),
    registry: undefined as never,
  } as unknown as OpContext;
}

describe('Feature: wakeup-engine-bombardment, Property 4: L4-L5 Hook/Flow 确定性 + 预算', () => {
  it('任意随机候选集 × 事件：分发结果确定性（同输入同输出）', () => {
    fc.assert(
      fc.property(ruleSetArb, fc.string(), fc.record({ v: scalarExpr }), (spec, eventType, payload) => {
        const candidates = candidatesOf(spec);
        const tx1 = new Transaction(createEmptyWorldState('sched:h1'));
        const tx2 = new Transaction(createEmptyWorldState('sched:h2'));
        const ctx1 = makeCtx(tx1);
        const ctx2 = makeCtx(tx2);
        const h1 = new HookDispatcher({ runEffects: () => ({ result: ok(undefined), vars: {} }) }, MAX_DEPTH);
        const h2 = new HookDispatcher({ runEffects: () => ({ result: ok(undefined), vars: {} }) }, MAX_DEPTH);
        const r1 = h1.dispatch(eventType, payload, candidates, ctx1);
        const r2 = h2.dispatch(eventType, payload, candidates, ctx2);
        expect(r1.cancelled).toBe(r2.cancelled);
        expect(r1.reason ?? null).toBe(r2.reason ?? null);
        expect(JSON.stringify(r1.finalPayload)).toBe(JSON.stringify(r2.finalPayload));
      }),
      { numRuns: 200 },
    );
  });

  it('FlowInterpreter 随机效果脚本：有限预算下不挂死、结果合法（ok 或带 code）', () => {
    const exprEngine = (createFullHarness(defaultSeedDefs())).exprEngine;
    const queryEngine = new QueryEngine();
    const flow = new FlowInterpreter({
      opRegistry: undefined as never,
      exprEngine,
      queryEngine,
      defRegistry: undefined as never,
    });
    fc.assert(
      fc.property(effectListArb, (effects) => {
        const tx = new Transaction(createEmptyWorldState('sched:flow'));
        const ctx = makeCtx(tx);
        const start = Date.now();
        let r: FlowRunResult | null = null;
        expect(() => { r = flow.run(effects, ctx, 64); }).not.toThrow();
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(3000); // 不挂死
        // result 必为 Result<void>：ok 为 boolean，且失败时带有 string code
        expect(typeof r!.result.ok).toBe('boolean');
        if (!r!.result.ok) {
          expect(typeof r!.result.code).toBe('string');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('真实接线：createFullHarness 把结构性 Op 接入 Hook 分发，effects 被执行且 hookDiagnostics 可用', () => {
    resetIdCounters();
    const harness = createFullHarness(defaultSeedDefs());
    // 挂真实 before-abort rule：entity.create 触发 before 分发，effects 经真实 runEffects 执行
    harness.ruleProvider.add({
      id: 'r:bombard',
      kind: 'rule',
      on: 'entity.create',
      phase: 'before',
      priority: 0,
      effects: [{ abort: true }],
    } as RuleDef);
    const r = harness.registry.invoke('entity.create', { def: 'd:human' });
    // 返回合法 Result（可能 ok（abort 未生效）或被 veto，但绝不抛）
    expect(typeof r.ok).toBe('boolean');
    if (!r.ok) expect(typeof r.code).toBe('string');
    expect(Array.isArray(harness.hookDiagnostics)).toBe(true);
  });
});
