import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { HookDispatcher } from '../dispatcher';
import type { EffectRunner, HookCandidate, HookDiagnostic } from '../dispatcher';
import { ok, err } from '../../ops/result';
import { Transaction } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import type { OpContext } from '../../ops/registry';
import type { RuleDef } from '../types';

function makeCtx(): OpContext {
  const tx = new Transaction(createEmptyWorldState('sched:1'));
  return { tx, depth: 0, emit: () => {} };
}

function rule(id: string, phase: RuleDef['phase'], opts?: Partial<RuleDef>): RuleDef {
  return { id, kind: 'rule', on: 'test', phase, priority: 0, effects: [], ...opts };
}

/** 记录执行顺序的 EffectRunner：把 ruleId 追加进共享数组，按需模拟失败/抛异常。 */
function makeTrackingRunner(log: string[], opts?: { failIds?: Set<string>; throwIds?: Set<string> }): EffectRunner {
  return (_effects, _ctx, vars, ruleId) => {
    log.push(ruleId);
    if (opts?.throwIds?.has(ruleId)) throw new Error('boom');
    if (opts?.failIds?.has(ruleId)) return { result: err('E_OP_INVALID_ARGS', 'forced failure'), vars };
    return { result: ok(undefined), vars };
  };
}

describe('HookDispatcher: 五阶段调度顺序（需求23.1-23.10）', () => {
  it('before 阶段 veto 时整体取消', () => {
    const log: string[] = [];
    const runner = makeTrackingRunner(log, { failIds: new Set(['r:before1']) });
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [{ rule: rule('r:before1', 'before') }];
    const result = dispatcher.dispatch('test.event', { x: 1 }, candidates, makeCtx());
    expect(result.cancelled).toBe(true);
    expect(log).toEqual(['r:before1']);
  });

  it('before 阶段未被 veto 时正常放行，进入后续阶段', () => {
    const log: string[] = [];
    const runner = makeTrackingRunner(log);
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [{ rule: rule('r:before1', 'before') }, { rule: rule('r:default1', 'default') }];
    const result = dispatcher.dispatch('test.event', {}, candidates, makeCtx());
    expect(result.cancelled).toBe(false);
    expect(log).toEqual(['r:before1', 'r:default1']);
  });

  it('modify 阶段按 (priority, defId) 顺序执行并链式改写 payload（需求23.5, 24.5）', () => {
    const order: number[] = [];
    const runner: EffectRunner = (_effects, _ctx, vars) => {
      const current = (vars['payload'] as { x: number }).x;
      order.push(current);
      return { result: ok(undefined), vars: { payload: { x: current + 1 } } };
    };
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [
      { rule: rule('r:m2', 'modify', { priority: 2 }) },
      { rule: rule('r:m1', 'modify', { priority: 1 }) },
    ];
    const result = dispatcher.dispatch('test.event', { x: 0 }, candidates, makeCtx());
    expect(order).toEqual([0, 1]);
    expect((result.finalPayload as { x: number }).x).toBe(2);
  });

  it('Property 25: instead 阶段排他执行——恰好排序键最小的候选执行，其余不参与', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { minLength: 2, maxLength: 6 }), (priorities) => {
        const log: string[] = [];
        const runner = makeTrackingRunner(log);
        const dispatcher = new HookDispatcher({ runEffects: runner });
        const candidates: HookCandidate[] = priorities.map((p, i) => ({ rule: rule(`r:${i}`, 'instead', { priority: p }) }));
        const result = dispatcher.dispatch('test.event', {}, candidates, makeCtx());
        expect(result.cancelled).toBe(false);
        expect(log.length).toBe(1); // 恰好一个候选执行
        const minPriority = Math.min(...priorities);
        const executedRule = candidates.find((c) => c.rule.id === log[0])!;
        expect(executedRule.rule.priority).toBe(minPriority);
      }),
      { numRuns: 100 },
    );
  });

  it('instead 阶段 when 不通过的候选不参与排序竞争', () => {
    const log: string[] = [];
    const runner = makeTrackingRunner(log);
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [
      { rule: rule('r:i1', 'instead', { priority: 0, when: false }) },
      { rule: rule('r:i2', 'instead', { priority: 1 }) },
    ];
    dispatcher.dispatch('test.event', {}, candidates, makeCtx());
    expect(log).toEqual(['r:i2']);
  });

  it('没有 instead 候选通过时，default 阶段正常执行', () => {
    const log: string[] = [];
    const runner = makeTrackingRunner(log);
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [{ rule: rule('r:default1', 'default') }];
    const result = dispatcher.dispatch('test.event', {}, candidates, makeCtx());
    expect(result.cancelled).toBe(false);
    expect(log).toEqual(['r:default1']);
  });

  it('有 instead 候选通过时，default 阶段不执行', () => {
    const log: string[] = [];
    const runner = makeTrackingRunner(log);
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [{ rule: rule('r:instead1', 'instead') }, { rule: rule('r:default1', 'default') }];
    dispatcher.dispatch('test.event', {}, candidates, makeCtx());
    expect(log).toEqual(['r:instead1']);
  });

  it('单条 Hook 内部报错只跳过该 Hook，其余候选继续执行并产出 warn 诊断（需求23.10）', () => {
    const log: string[] = [];
    const diagnostics: HookDiagnostic[] = [];
    const runner = makeTrackingRunner(log, { throwIds: new Set(['r:d1']) });
    const dispatcher = new HookDispatcher({ runEffects: runner, onDiagnostic: (d) => diagnostics.push(d) });
    const candidates: HookCandidate[] = [
      { rule: rule('r:d1', 'default') },
      { rule: rule('r:d2', 'default') },
    ];
    const result = dispatcher.dispatch('test.event', {}, candidates, makeCtx());
    expect(result.cancelled).toBe(false);
    expect(log).toEqual(['r:d1', 'r:d2']); // 两者都被尝试执行
    expect(diagnostics.some((d) => d.code === 'W_HOOK_INTERNAL_ERROR')).toBe(true);
  });

  it('Property: 对于任意一条内部报错的 Hook 与同一事件的其余合法 Hook，dispatch 应继续执行其余 Hook 并返回正常结果', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 0, max: 7 }), (n, failIdx) => {
        fc.pre(failIdx < n);
        const log: string[] = [];
        const failId = `r:${failIdx}`;
        const runner = makeTrackingRunner(log, { throwIds: new Set([failId]) });
        const dispatcher = new HookDispatcher({ runEffects: runner });
        const candidates: HookCandidate[] = Array.from({ length: n }, (_, i) => ({ rule: rule(`r:${i}`, 'default') }));
        const result = dispatcher.dispatch('test.event', {}, candidates, makeCtx());
        expect(result.cancelled).toBe(false);
        expect(log.length).toBe(n); // 全部候选都被尝试
      }),
      { numRuns: 50 },
    );
  });

  it('after 阶段的写入被机械丢弃（嵌套保存点无条件 rollback，需求23.7）', () => {
    const ctx = makeCtx();
    const runner: EffectRunner = (_effects, c, vars) => {
      const draft = c.tx.getDraft();
      c.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, sideEffect: 999 } } });
      return { result: ok(undefined), vars };
    };
    const dispatcher = new HookDispatcher({ runEffects: runner });
    const candidates: HookCandidate[] = [{ rule: rule('r:after1', 'after') }];
    dispatcher.dispatch('test.event', {}, candidates, ctx);
    expect(ctx.tx.getDraft().world.props['sideEffect']).toBeUndefined();
  });
});

describe('Property 14: 连锁深度上限的可终止性（需求24.1-24.2）', () => {
  it('事件连锁（Hook 的 effects 递归触发同类型新事件）在有限步数内终止，不会栈溢出或死循环', () => {
    const ctx = makeCtx();
    let dispatchCount = 0;
    const dispatcher = new HookDispatcher(
      {
        // 故意构造 A 触发 A 的无限连锁：runEffects 内部再调用同一个 dispatcher.dispatch
        runEffects: (_effects, c, vars) => {
          dispatchCount++;
          dispatcher.dispatch('chain.event', {}, [{ rule: rule('r:chain', 'default') }], c);
          return { result: ok(undefined), vars };
        },
      },
      5, // maxDepth = 5，故意设小以在测试时间内触发
    );
    const result = dispatcher.dispatch('chain.event', {}, [{ rule: rule('r:chain', 'default') }], ctx);
    expect(result.cancelled).toBe(false); // 顶层调用本身未被拒绝（拒绝发生在递归深处）
    expect(dispatchCount).toBeLessThanOrEqual(6); // 深度上限保证了有限次数，不会无限递归
  });

  it('Property: 对于任意 maxDepth 设置，构造的自触发连锁都应在有限次 dispatch 调用内终止', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (maxDepth) => {
        const ctx = makeCtx();
        let dispatchCount = 0;
        let dispatcherRef: HookDispatcher;
        dispatcherRef = new HookDispatcher(
          {
            runEffects: (_effects, c, vars) => {
              dispatchCount++;
              if (dispatchCount > 1000) throw new Error('未终止：疑似无限递归');
              dispatcherRef.dispatch('chain.event', {}, [{ rule: rule('r:chain', 'default') }], c);
              return { result: ok(undefined), vars };
            },
          },
          maxDepth,
        );
        expect(() => dispatcherRef.dispatch('chain.event', {}, [{ rule: rule('r:chain', 'default') }], ctx)).not.toThrow();
        expect(dispatchCount).toBeLessThanOrEqual(maxDepth + 2);
      }),
      { numRuns: 30 },
    );
  });

  it('resetDepth 把连锁深度计数器归零（需求24.3）', () => {
    const dispatcher = new HookDispatcher({ runEffects: () => ({ result: ok(undefined), vars: {} }) }, 2);
    const ctx = makeCtx();
    dispatcher.dispatch('e', {}, [], ctx);
    dispatcher.resetDepth();
    expect(dispatcher.getDepth()).toBe(0);
  });
});

describe('Property 26: Hook 重入拒绝（需求24.6）', () => {
  it('同一 (type, hookId) 组合在同一次分发中重入被拒绝，effects 不执行两次', () => {
    const log: string[] = [];
    let selfDispatcher: HookDispatcher;
    const runner: EffectRunner = (_effects, c, vars, ruleId) => {
      log.push(ruleId);
      // 模拟该 Hook 的 effects 直接重新 emit 了同一事件类型且命中同一实例：递归调用同一个 dispatch
      selfDispatcher.dispatch('test.event', {}, [{ rule: rule(ruleId, 'default') }], c);
      return { result: ok(undefined), vars };
    };
    selfDispatcher = new HookDispatcher({ runEffects: runner }, 10);
    const ctx = makeCtx();
    selfDispatcher.dispatch('test.event', {}, [{ rule: rule('r:reentrant', 'default') }], ctx);
    // 第一次进入记录一次；递归调用命中重入锁，被拒绝，不会记录第二次
    expect(log).toEqual(['r:reentrant']);
  });
});
