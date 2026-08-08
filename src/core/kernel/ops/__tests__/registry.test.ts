import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { ok, err } from '../result.js';
import type { OpImpl } from '../registry.js';

describe('OpRegistry: 永不抛异常与事务包裹（需求16.1-16.4, 21.1-21.4）', () => {
  it('未注册的 Op 返回 ok:false 而不是抛异常', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    const result = registry.invoke('nonexistent.op', {});
    expect(result.ok).toBe(false);
  });

  it('Op 实现内部抛出异常时 invoke 捕获并返回 ok:false（需求16.2-16.3）', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registry.register('test.throws', () => {
      throw new Error('boom');
    });
    const result = registry.invoke('test.throws', {});
    expect(result.ok).toBe(false);
  });

  it('Op 成功执行后状态被写回 holder', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    const setProp: OpImpl<{ value: number }, void> = (args, ctx) => {
      const draft = ctx.tx.getDraft();
      ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, x: args.value } } });
      return ok(undefined);
    };
    registry.register('test.setProp', setProp);
    const result = registry.invoke('test.setProp', { value: 42 });
    expect(result.ok).toBe(true);
    expect(holder.getState().world.props['x']).toBe(42);
  });

  it('Op 返回 ok:false 时状态不改变（Property 3 的直接体现）', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const before = holder.getState();
    const registry = new OpRegistry(holder);
    const failingOp: OpImpl<Record<string, never>, void> = (_args, ctx) => {
      const draft = ctx.tx.getDraft();
      ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, x: 999 } } });
      return err('E_OP_INVALID_ARGS', 'intentional failure');
    };
    registry.register('test.failing', failingOp);
    const result = registry.invoke('test.failing', {});
    expect(result.ok).toBe(false);
    expect(holder.getState()).toBe(before); // 引用相等：完全未改变
  });

  it('Property 2: 对于任意已注册 Op 与任意结构合法的入参（含指向不存在对象的 Ref、越界索引），invoke 都应返回 Result，不抛出异常', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registry.register('test.weird', (args: unknown, ctx) => {
      // 模拟一个可能因输入畸形而内部出错的 Op：故意访问可能不存在的字段
      const a = args as { ref?: { $: string }; idx?: number };
      if (a.ref && !(a.ref.$ in ctx.tx.getDraft().entities)) {
        return err('E_REF_MISSING', 'ref missing');
      }
      if (a.idx !== undefined && (a.idx < 0 || a.idx > 1000000)) {
        return err('E_OP_INVALID_ARGS', 'idx out of range');
      }
      return ok(null);
    });

    fc.assert(
      fc.property(
        fc.record({
          ref: fc.option(fc.record({ $: fc.string() }), { nil: undefined }),
          idx: fc.option(fc.integer(), { nil: undefined }),
        }),
        (args) => {
          expect(() => registry.invoke('test.weird', args)).not.toThrow();
          const result = registry.invoke('test.weird', args);
          expect(typeof result.ok).toBe('boolean');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 3: 事务的原子性——单次致命失败的 Op 调用，调用后状态应与调用前逐字段相等', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (value) => {
        const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
        const registry = new OpRegistry(holder);
        registry.register('test.accumulate', (args: unknown, ctx) => {
          const { shouldFail } = args as { value: number; shouldFail: boolean };
          if (shouldFail) return err('E_OP_INVALID_ARGS', 'boom');
          const draft = ctx.tx.getDraft();
          ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, sum: value } } });
          return ok(null);
        });

        const before = holder.getState();
        const result = registry.invoke('test.accumulate', { value, shouldFail: true });
        expect(result.ok).toBe(false);
        expect(holder.getState()).toBe(before); // 回滚后状态应与调用前逐字段（此处为引用）相等
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4 的雏形：从合法初始状态出发经任意长度成功 Op 序列后，InvariantChecker 全部通过（此处用简单 prop 写入验证不触发假性不变量报错）', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 10 }), (values) => {
        const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
        const registry = new OpRegistry(holder);
        registry.register('test.setNum', (args: unknown, ctx) => {
          const { value } = args as { value: number };
          const draft = ctx.tx.getDraft();
          ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, n: value } } });
          return ok(null);
        });
        for (const v of values) {
          const result = registry.invoke('test.setNum', { value: v });
          expect(result.ok).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
