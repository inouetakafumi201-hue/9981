import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FlowInterpreter } from '../interpreter';
import { OpRegistry } from '../../ops/registry';
import { WorldStateHolder, Transaction } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { registerPropOps } from '../../ops/prop-ops';
import { DefRegistry } from '../../state/def';
import type { OpContext } from '../../ops/registry';
import type { Effect } from '../../events/effect-types';

function setup() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  registerPropOps(registry, new DefRegistry());
  const interpreter = new FlowInterpreter({ opRegistry: registry });
  return { holder, registry, interpreter };
}

function makeCtx(holder: WorldStateHolder): OpContext {
  return { tx: new Transaction(holder.getState()), depth: 0, emit: () => {} };
}

describe('FlowInterpreter: 十种 Effect 形态（需求22.1, 22.3）', () => {
  it('op: 调用已注册 Op', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ op: 'prop.set', args: { path: 'world.props.x', value: 42 } }];
    const { result } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(true);
    ctx.tx.commit();
    expect(ctx.tx.getFinalDraft().world.props['x']).toBe(42);
  });

  it('let: 局部变量赋值', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ let: 'x', be: 10 }, { let: 'y', be: { op: 'add', args: [{ var: 'x' }, 5] } }];
    const { result, vars } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(true);
    expect(vars['y']).toBe(15);
  });

  it('if: 条件分支', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [
      { let: 'x', be: 10 },
      { if: { op: 'gt', args: [{ var: 'x' }, 5] }, then: [{ let: 'result', be: 'big' }], else: [{ let: 'result', be: 'small' }] },
    ];
    const { vars } = interpreter.run(effects, ctx);
    expect(vars['result']).toBe('big');
  });

  it('forEach: 受限遍历', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [
      { let: 'sum', be: 0 },
      { forEach: [1, 2, 3, 4], as: 'item', do: [{ let: 'sum', be: { op: 'add', args: [{ var: 'sum' }, { var: 'item' }] } }] },
    ];
    const { vars } = interpreter.run(effects, ctx);
    expect(vars['sum']).toBe(10);
  });

  it('while: 受限循环，必须声明 maxIter', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [
      { let: 'i', be: 0 },
      { while: { op: 'lt', args: [{ var: 'i' }, 5] }, maxIter: 100, do: [{ let: 'i', be: { op: 'add', args: [{ var: 'i' }, 1] } }] },
    ];
    const { result, vars } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(true);
    expect(vars['i']).toBe(5);
  });

  it('while 缺失 maxIter 时运行期防御性拒绝（需求22.6）', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ while: true, maxIter: undefined as unknown as number, do: [] }];
    const { result } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(false);
  });

  it('while 迭代次数超出 maxIter 时中止', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ while: true, maxIter: 3, do: [] }];
    const { result } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(false);
  });

  it('emit: 发出事件', () => {
    const { holder, registry } = setup();
    const ctx = makeCtx(holder);
    const emitted: { type: string }[] = [];
    const interpreter2 = new FlowInterpreter({
      opRegistry: registry,
      onEmit: (type) => { emitted.push({ type }); },
    });
    const effects: Effect[] = [{ emit: 'custom.event', data: { x: 1 } }];
    interpreter2.run(effects, ctx);
    expect(emitted[0]?.type).toBe('custom.event');
  });

  it('try/catch: 捕获失败并转入 catch 分支', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [
      { try: [{ op: 'nonexistent.op', args: {} }], catch: [{ let: 'caught', be: true }] },
    ];
    const { result, vars } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(true);
    expect(vars['caught']).toBe(true);
  });

  it('abort: 主动失败中止执行', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ let: 'before', be: true }, { abort: 'manual stop' }, { let: 'after', be: true }];
    const { result, vars } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(false);
    expect(vars['before']).toBe(true);
    expect(vars['after']).toBeUndefined();
  });

  it('不提供函数定义/递归/闭包能力（需求22.3）：未知 Effect 必须显式拒绝', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const weirdEffect = { defineFunction: 'notAllowed' } as unknown as Effect;
    const { result } = interpreter.run([weirdEffect], ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_FLOW_UNKNOWN_EFFECT');
  });

  it('try 没有 catch 时传播原始失败，禁止静默成功', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects = [{ try: [{ op: 'nonexistent.op', args: {} }] }] as Effect[];
    const { result } = interpreter.run(effects, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_OP_NOT_FOUND');
  });

  it('宿主回调异常映射为 E_FLOW_INTERNAL，且不会伪装成脚本错误', () => {
    const { holder, registry } = setup();
    const ctx = makeCtx(holder);
    const interpreter = new FlowInterpreter({
      opRegistry: registry,
      onEmit: () => { throw new Error('host callback failed'); },
    });
    const { result } = interpreter.run([{ emit: 'custom.event' }], ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('E_FLOW_INTERNAL');
      expect(result.detail).toContain('host callback failed');
    }
  });
});

describe('Property 15: Flow 的 step 预算终止性（需求22.4-22.5）', () => {
  it('超过 step 预算时中止并返回诊断，不挂起', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ while: true, maxIter: 1000000, do: [{ let: 'noop', be: 1 }] }];
    const { result } = interpreter.run(effects, ctx, 50);
    expect(result.ok).toBe(false);
  });

  it('Property: 对于任意包含 while 循环（maxIter 已声明）的 Effect 序列，run 都应在 budget 步以内返回，不挂起', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 10, max: 200 }), (maxIter, budget) => {
        const { holder, interpreter } = setup();
        const ctx = makeCtx(holder);
        const effects: Effect[] = [{ while: true, maxIter, do: [{ let: 'noop', be: 1 }] }];
        const start = Date.now();
        const { result } = interpreter.run(effects, ctx, budget);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000); // 不挂起
        // 若 maxIter 超出 budget，应因预算耗尽而失败；否则应因 maxIter 耗尽而失败（while:true 永不满足退出条件）
        expect(result.ok).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('forEach 每次迭代计入 step 预算', () => {
    const { holder, interpreter } = setup();
    const ctx = makeCtx(holder);
    const effects: Effect[] = [{ forEach: Array.from({ length: 1000 }, (_, i) => i), as: 'x', do: [] }];
    const { result } = interpreter.run(effects, ctx, 50);
    expect(result.ok).toBe(false); // 1000 次迭代远超 50 步预算
  });
});
