/**
 * L5×L9: Flow 的 after/at 延迟效果落地（需求22.1）。
 *
 * 本次修补前，after/at 只调用一个可选的 onScheduleDeferred 回调，而该回调在所有组合根里都未接线——
 * 意味着"延迟执行/定时执行"这两种 Effect 形态实际被静默丢弃。现在 after/at 把效果块写入
 * world.deferredEffects（纳入 WorldState，被 snapshot/replay 捕获），由 schedule.advance 在相位
 * 到达时兑现。这里锁定：排期写入正确、兑现时机与顺序正确、快照捕获挂起队列。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FlowInterpreter } from '../interpreter.js';
import { registerScheduleOps } from '../../schedule/schedule-ops.js';
import { registerPropOps } from '../../ops/prop-ops.js';
import { OpRegistry } from '../../ops/registry.js';
import { Transaction, WorldStateHolder } from '../../ops/transaction.js';
import { ExprEngine } from '../../expr/engine.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { DefRegistry } from '../../state/def.js';
import { resetIdCounters } from '../../state/ids.js';
import { takeSnapshot } from '../../persistence/persistence.js';
import type { ScheduleDef } from '../../schedule/types.js';
import type { Effect } from '../../events/effect-types.js';
import type { OpContext } from '../../ops/registry.js';

const sched: ScheduleDef = {
  id: 's:sched',
  kind: 'schedule',
  phases: [{ id: 'phase:0' }, { id: 'phase:1' }],
  loop: true,
};

function makeCtx(phaseEnteredAt = 0): OpContext {
  const base = createEmptyWorldState(sched.id);
  const state = { ...base, world: { ...base.world, turn: { ...base.world.turn, phaseEnteredAt } } };
  return { tx: new Transaction(state), depth: 0, emit: () => {} };
}

describe('Flow after/at 写入 world.deferredEffects（需求22.1）', () => {
  beforeEach(() => resetIdCounters());

  it('after N 排期到 当前相位 + N，捕获效果块与作用域 vars', () => {
    const flow = new FlowInterpreter({ opRegistry: new OpRegistry(new WorldStateHolder(createEmptyWorldState(sched.id))), exprEngine: new ExprEngine() });
    const ctx = makeCtx(3);
    const effects: Effect[] = [
      { let: 'mark', be: 42 },
      { after: 2, do: [{ op: 'prop.set', args: { path: 'world.props.fired', value: { var: 'mark' } } }] },
    ];
    const { result } = flow.run(effects, ctx);
    expect(result.ok).toBe(true);
    const queue = ctx.tx.getDraft().world.deferredEffects;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.kind).toBe('after');
    expect(queue[0]?.dueAt).toBe(5); // 3 + 2
    expect(queue[0]?.vars).toMatchObject({ mark: 42 }); // 排期时的作用域被捕获
  });

  it('at M 排期到 绝对相位 M', () => {
    const flow = new FlowInterpreter({ opRegistry: new OpRegistry(new WorldStateHolder(createEmptyWorldState(sched.id))), exprEngine: new ExprEngine() });
    const ctx = makeCtx(3);
    flow.run([{ at: 7, do: [{ emit: 'tick' }] }], ctx);
    const queue = ctx.tx.getDraft().world.deferredEffects;
    expect(queue[0]?.kind).toBe('at');
    expect(queue[0]?.dueAt).toBe(7);
  });

  it('deferredSeq 单调递增，多次排期不复用序号', () => {
    const flow = new FlowInterpreter({ opRegistry: new OpRegistry(new WorldStateHolder(createEmptyWorldState(sched.id))), exprEngine: new ExprEngine() });
    const ctx = makeCtx(0);
    flow.run([{ after: 1, do: [{ emit: 'a' }] }, { after: 1, do: [{ emit: 'b' }] }], ctx);
    const queue = ctx.tx.getDraft().world.deferredEffects;
    expect(queue.map((e) => e.seq)).toEqual([1, 2]);
    expect(ctx.tx.getDraft().world.deferredSeq).toBe(2);
  });
});

describe('schedule.advance 兑现到期延迟效果（需求22.1 落地）', () => {
  beforeEach(() => resetIdCounters());

  /** 构造一个接齐 prop 写入 + flow + schedule 的最小 registry。 */
  function makeHarness(phaseEnteredAt = 0) {
    const base = createEmptyWorldState(sched.id);
    const state = { ...base, world: { ...base.world, turn: { ...base.world.turn, phaseEnteredAt } } };
    const holder = new WorldStateHolder(state);
    const registry = new OpRegistry(holder);
    const defRegistry = new DefRegistry();
    const exprEngine = new ExprEngine();
    const flow = new FlowInterpreter({ opRegistry: registry, exprEngine, defRegistry });
    registerPropOps(registry, defRegistry);
    registerScheduleOps(registry, {
      defLookup: (id) => (id === sched.id ? sched : null),
      runEffects: (effects, ctx, vars) => flow.run(effects, ctx, undefined, vars ?? {}).result,
    });
    return { holder, registry, flow };
  }

  it('到期后兑现效果，效果内可读回排期时捕获的 vars', () => {
    const { holder, registry, flow } = makeHarness(0);
    // 手动在一个事务里排一个 after 1 的效果，并提交到 holder（模拟某个 Op 内触发的 flow）。
    const ctx: OpContext = { tx: new Transaction(holder.getState()), depth: 0, emit: () => {} };
    flow.run([{ let: 'v', be: 9 }, { after: 1, do: [{ op: 'prop.set', args: { path: 'world.props.echo', value: { var: 'v' } } }] }], ctx);
    holder.setState(ctx.tx.getFinalDraft());
    expect(holder.getState().world.deferredEffects).toHaveLength(1);

    // 相位 0 -> 1：dueAt=1 到期，兑现，world.props.echo 被写为 9
    const advanced = registry.invoke('schedule.advance', {});
    expect(advanced.ok).toBe(true);
    expect(holder.getState().world.props['echo']).toBe(9);
    // 兑现后从队列移除
    expect(holder.getState().world.deferredEffects).toHaveLength(0);
  });

  it('未到期的效果不兑现，留在队列里等后续相位', () => {
    const { holder, registry, flow } = makeHarness(0);
    const ctx: OpContext = { tx: new Transaction(holder.getState()), depth: 0, emit: () => {} };
    flow.run([{ after: 3, do: [{ op: 'prop.set', args: { path: 'world.props.late', value: 1 } } as Effect] }], ctx);
    holder.setState(ctx.tx.getFinalDraft());

    registry.invoke('schedule.advance', {}); // ->1, dueAt=3 未到
    expect(holder.getState().world.props['late']).toBeUndefined();
    expect(holder.getState().world.deferredEffects).toHaveLength(1);
    registry.invoke('schedule.advance', {}); // ->2
    registry.invoke('schedule.advance', {}); // ->3, 到期兑现
    expect(holder.getState().world.props['late']).toBe(1);
    expect(holder.getState().world.deferredEffects).toHaveLength(0);
  });

  it('同一相位多个到期效果按 (dueAt, seq) 顺序兑现', () => {
    const { holder, registry, flow } = makeHarness(0);
    const ctx: OpContext = { tx: new Transaction(holder.getState()), depth: 0, emit: () => {} };
    // 两个 after 1，seq 决定顺序；用 list.insert 追加到同一列表以观察顺序
    flow.run([
      { after: 1, do: [{ op: 'list.insert', args: { path: 'world.props.order', value: 'first' } } as Effect] },
      { after: 1, do: [{ op: 'list.insert', args: { path: 'world.props.order', value: 'second' } } as Effect] },
    ], ctx);
    holder.setState(ctx.tx.getFinalDraft());
    registry.invoke('schedule.advance', {});
    expect(holder.getState().world.props['order']).toEqual(['first', 'second']);
  });

  it('延迟队列纳入 WorldState，被快照捕获（回放安全）', () => {
    const { holder, flow } = makeHarness(0);
    const ctx: OpContext = { tx: new Transaction(holder.getState()), depth: 0, emit: () => {} };
    flow.run([{ after: 5, do: [{ emit: 'boom' }] }], ctx);
    holder.setState(ctx.tx.getFinalDraft());
    const snap = takeSnapshot(holder.getState());
    expect(snap.state.world.deferredEffects).toHaveLength(1);
    expect(snap.state.world.deferredEffects[0]?.dueAt).toBe(5);
  });

  it('兑现中的效果失败时，schedule.advance 整体回滚（相位不推进、队列不变）', () => {
    const { holder, registry, flow } = makeHarness(0);
    const ctx: OpContext = { tx: new Transaction(holder.getState()), depth: 0, emit: () => {} };
    // abort 效果让兑现失败
    flow.run([{ after: 1, do: [{ abort: 'boom' } as Effect] }], ctx);
    holder.setState(ctx.tx.getFinalDraft());
    const before = holder.getState();
    const result = registry.invoke('schedule.advance', {});
    expect(result.ok).toBe(false);
    // 整体回滚：相位与队列都不变
    expect(holder.getState().world.turn.phaseIndex).toBe(before.world.turn.phaseIndex);
    expect(holder.getState().world.deferredEffects).toHaveLength(1);
  });
});
