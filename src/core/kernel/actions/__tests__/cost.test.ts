import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { freezeCost, settleCost, refundCost } from '../cost';
import type { CostSettleDeps } from '../cost';
import { Transaction } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { getPath, setPath } from '../../ops/path';
import { ok } from '../../ops/result';
import type { OpContext } from '../../ops/registry';
import type { CostSpec } from '../types';

/** Pool 结算从不触及 invokeInline/runEffects，用一个"若被调用即失败"的守卫确认这一点。 */
const poolSettleDeps: CostSettleDeps = {
  invokeInline: () => { throw new Error('pool settle must not invoke ops'); },
};

function makeCtx(initialAvailable: number, initialReal: number): { ctx: OpContext; poolAvailablePath: string; poolRealPath: string } {
  let state = createEmptyWorldState('sched:1');
  state = setPath(state, 'world.props.pools.ap.a:1.available', initialAvailable);
  state = setPath(state, 'world.props.pools.ap.a:1.real', initialReal);
  const tx = new Transaction(state);
  const events: { type: string; payload: unknown }[] = [];
  const ctx: OpContext = { tx, depth: 0, emit: (type, payload) => events.push({ type, payload }) };
  (ctx as unknown as { __events: typeof events }).__events = events;
  return { ctx, poolAvailablePath: 'world.props.pools.ap.a:1.available', poolRealPath: 'world.props.pools.ap.a:1.real' };
}

describe('代价泛化三态生命周期（需求26.1-26.6, 20.12）', () => {
  it('freezeCost 立即扣减可用额度（需求26.2）', () => {
    const { ctx, poolAvailablePath } = makeCtx(10, 10);
    const costs: CostSpec[] = [{ pool: 'ap', amount: 3 }];
    const result = freezeCost('a:1', costs, ctx);
    expect(result.ok).toBe(true);
    expect(getPath(ctx.tx.getDraft(), poolAvailablePath)).toBe(7);
  });

  it('freezeCost 可用额度不足时拒绝（需求26.2 的边界）', () => {
    const { ctx } = makeCtx(2, 10);
    const costs: CostSpec[] = [{ pool: 'ap', amount: 5 }];
    const result = freezeCost('a:1', costs, ctx);
    expect(result.ok).toBe(false);
  });

  it('settleCost 真正扣减真实额度（需求26.3）', () => {
    const { ctx, poolRealPath } = makeCtx(10, 10);
    const costs: CostSpec[] = [{ pool: 'ap', amount: 3 }];
    const frozen = freezeCost('a:1', costs, ctx);
    expect(frozen.ok).toBe(true);
    if (frozen.ok) {
      settleCost(frozen.value, ctx, poolSettleDeps);
      expect(getPath(ctx.tx.getDraft(), poolRealPath)).toBe(7);
    }
  });

  it('refundCost 把可用额度差值全额加回并发出 cost.refunded 诊断（需求26.4-26.5）', () => {
    const { ctx, poolAvailablePath } = makeCtx(10, 10);
    const costs: CostSpec[] = [{ pool: 'ap', amount: 3 }];
    const frozen = freezeCost('a:1', costs, ctx);
    expect(frozen.ok).toBe(true);
    if (frozen.ok) {
      refundCost(frozen.value, 'require 前提失效', ctx, 'intent:1');
      expect(getPath(ctx.tx.getDraft(), poolAvailablePath)).toBe(10);
      const events = (ctx as unknown as { __events: { type: string }[] }).__events;
      expect(events.some((e) => e.type === 'cost.refunded')).toBe(true);
    }
  });

  it('不存在静默退回路径（需求26.6）：refundCost 总是调用 ctx.emit', () => {
    const { ctx } = makeCtx(10, 10);
    const costs: CostSpec[] = [{ pool: 'ap', amount: 1 }];
    const frozen = freezeCost('a:1', costs, ctx);
    if (frozen.ok) {
      refundCost(frozen.value, 'test', ctx);
      const events = (ctx as unknown as { __events: unknown[] }).__events;
      expect(events.length).toBeGreaterThan(0);
    }
  });
});

describe('Property 7: 代价冻结与结算守恒（需求26.2-26.6, 20.12）', () => {
  it('解算成功路径：结算后 real 减少量等于冻结量，available 不再变化', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 1000 }), fc.integer({ min: 0, max: 9 }), (initial, amount) => {
        const { ctx, poolAvailablePath, poolRealPath } = makeCtx(initial, initial);
        const costs: CostSpec[] = [{ pool: 'ap', amount }];
        const frozen = freezeCost('a:1', costs, ctx);
        expect(frozen.ok).toBe(true);
        if (frozen.ok) {
          const availableAfterFreeze = getPath(ctx.tx.getDraft(), poolAvailablePath);
          settleCost(frozen.value, ctx, poolSettleDeps);
          expect(getPath(ctx.tx.getDraft(), poolRealPath)).toBe(initial - amount);
          expect(getPath(ctx.tx.getDraft(), poolAvailablePath)).toBe(availableAfterFreeze);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('void 退回路径：available 结束时等于提交前的可用额度', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 1000 }), fc.integer({ min: 0, max: 9 }), (initial, amount) => {
        const { ctx, poolAvailablePath } = makeCtx(initial, initial);
        const costs: CostSpec[] = [{ pool: 'ap', amount }];
        const frozen = freezeCost('a:1', costs, ctx);
        expect(frozen.ok).toBe(true);
        if (frozen.ok) {
          refundCost(frozen.value, 'void', ctx);
          expect(getPath(ctx.tx.getDraft(), poolAvailablePath)).toBe(initial);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/** 记录 settle 阶段对 Op / Effect 的分派，用于断言 items/attach/custom 走对了通道。 */
function recordingSettleDeps() {
  const opCalls: { op: string; args: unknown }[] = [];
  const effectRuns: unknown[][] = [];
  const deps: CostSettleDeps = {
    invokeInline: (op, args) => { opCalls.push({ op, args }); return ok(undefined); },
    runEffects: (effects) => { effectRuns.push([...effects]); return ok(undefined); },
  };
  return { deps, opCalls, effectRuns };
}

function ctxWithItemAndAttachment(): OpContext {
  let state = createEmptyWorldState('sched:1');
  state = { ...state, items: { 'i:1': { id: 'i:1', def: 'd:coin', tags: [], props: {}, containers: {}, attachments: [] } } };
  state = {
    ...state,
    world: {
      ...state.world,
      attachments: { 'a:9': { id: 'a:9', def: 'd:charge', target: { $: 'a:1' }, props: {}, stack: 1 } },
    },
  };
  const tx = new Transaction(state);
  const events: { type: string; payload: unknown }[] = [];
  const ctx: OpContext = { tx, depth: 0, emit: (type, payload) => events.push({ type, payload }) };
  (ctx as unknown as { __events: typeof events }).__events = events;
  return ctx;
}

describe('CostSpec 四形态：items / attach / custom（需求26.1）', () => {
  it('items 代价：freeze 校验物品存在（不移除），settle 通过 item.destroy 消耗', () => {
    const ctx = ctxWithItemAndAttachment();
    const frozen = freezeCost('a:1', [{ items: { $: 'i:1' } }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(true);
    expect(ctx.tx.getDraft().items['i:1']).toBeDefined();
    if (!frozen.ok) return;
    const { deps, opCalls } = recordingSettleDeps();
    expect(settleCost(frozen.value, ctx, deps).ok).toBe(true);
    expect(opCalls).toEqual([{ op: 'item.destroy', args: { id: 'i:1' } }]);
  });

  it('items 代价：freeze 对不存在的物品拒绝（不静默）', () => {
    const ctx = ctxWithItemAndAttachment();
    const frozen = freezeCost('a:1', [{ items: { $: 'i:absent' } }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(false);
  });

  it('items 代价：支持引用列表，settle 逐个 item.destroy', () => {
    const ctx = ctxWithItemAndAttachment();
    ctx.tx.setDraft({
      ...ctx.tx.getDraft(),
      items: {
        ...ctx.tx.getDraft().items,
        'i:2': { id: 'i:2', def: 'd:coin', tags: [], props: {}, containers: {}, attachments: [] },
      },
    });
    const frozen = freezeCost('a:1', [{ items: [{ $: 'i:1' }, { $: 'i:2' }] }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const { deps, opCalls } = recordingSettleDeps();
    settleCost(frozen.value, ctx, deps);
    expect(opCalls.map((c) => c.args)).toEqual([{ id: 'i:1' }, { id: 'i:2' }]);
  });

  it('attach 代价：freeze 校验目标上存在该 def 的 Attachment，settle 通过 attach.del 移除', () => {
    const ctx = ctxWithItemAndAttachment();
    const frozen = freezeCost('a:1', [{ attach: 'd:charge' }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const { deps, opCalls } = recordingSettleDeps();
    settleCost(frozen.value, ctx, deps);
    expect(opCalls).toEqual([{ op: 'attach.del', args: { id: 'a:9' } }]);
  });

  it('attach 代价：目标上没有该 Attachment 时 freeze 拒绝', () => {
    const ctx = ctxWithItemAndAttachment();
    const frozen = freezeCost('a:1', [{ attach: 'd:missing' }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(false);
  });

  it('custom 代价：freeze 不改状态，settle 运行其 Effect', () => {
    const ctx = ctxWithItemAndAttachment();
    const customEffects = [{ op: 'prop.set', args: { path: 'x', value: 1 } }];
    const frozen = freezeCost('a:1', [{ custom: customEffects }] as unknown as CostSpec[], ctx);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const { deps, effectRuns } = recordingSettleDeps();
    settleCost(frozen.value, ctx, deps);
    expect(effectRuns).toEqual([customEffects]);
  });

  it('items/attach/custom 的 refund 不改状态但仍发出 cost.refunded（需求26.6 无静默）', () => {
    const ctx = ctxWithItemAndAttachment();
    const frozen = freezeCost('a:1', [{ items: { $: 'i:1' } }, { attach: 'd:charge' }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    refundCost(frozen.value, 'void', ctx, 'g:1');
    expect(ctx.tx.getDraft().items['i:1']).toBeDefined();
    expect(ctx.tx.getDraft().world.attachments['a:9']).toBeDefined();
    const events = (ctx as unknown as { __events: { type: string }[] }).__events;
    expect(events.some((e) => e.type === 'cost.refunded')).toBe(true);
  });

  it('多形态混合冻结：任一形态失败则整体 ok:false，不产生部分冻结', () => {
    const ctx = ctxWithItemAndAttachment();
    const frozen = freezeCost('a:1', [{ items: { $: 'i:1' } }, { attach: 'd:missing' }] as CostSpec[], ctx);
    expect(frozen.ok).toBe(false);
  });
});
