import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { ok } from '../result.js';
import type { OpImpl } from '../registry.js';

/**
 * L3 Ops: 结构性 Op 否决机制（design.md 3.4节 / 需求19.1-19.4）。
 * withVeto 的完整 Hook 分发逻辑在 L4，这里先用 OpRegistry 已提供的 dispatchBefore/dispatchAfter
 * 钩子接口验证 veto 契约本身：before 阶段返回 cancelled:true 时，Op 应返回
 * {ok:false, code:'E_OP_VETOED'} 且不产生任何状态改动。
 */
describe('Property 24: before Hook 否决后状态零改动（需求19.2, 19.4）', () => {
  it('dispatchBefore 返回 cancelled:true 时，Op 返回 E_OP_VETOED 且状态不变', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder, {
      dispatchBefore: () => ({ cancelled: true, reason: '容量已满' }),
    });
    const structuralOp: OpImpl<{ value: number }, void> = (args, ctx) => {
      const draft = ctx.tx.getDraft();
      ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, x: args.value } } });
      return ok(undefined);
    };
    registry.register('test.structural', structuralOp, { structural: true });

    const before = holder.getState();
    const result = registry.invoke('test.structural', { value: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_OP_VETOED');
    expect(holder.getState()).toBe(before); // 完全未改变
  });

  it('dispatchBefore 返回 cancelled:false 时，Op 正常执行', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder, {
      dispatchBefore: () => ({ cancelled: false }),
    });
    const structuralOp: OpImpl<{ value: number }, void> = (args, ctx) => {
      const draft = ctx.tx.getDraft();
      ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, x: args.value } } });
      return ok(undefined);
    };
    registry.register('test.structural', structuralOp, { structural: true });

    const result = registry.invoke('test.structural', { value: 42 });
    expect(result.ok).toBe(true);
    expect(holder.getState().world.props['x']).toBe(42);
  });

  it('非 structural 的 Op 不受 dispatchBefore 影响（veto 只作用于结构性 Op）', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder, {
      dispatchBefore: () => ({ cancelled: true }),
    });
    const nonStructuralOp: OpImpl<{ value: number }, void> = (args, ctx) => {
      const draft = ctx.tx.getDraft();
      ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, x: args.value } } });
      return ok(undefined);
    };
    registry.register('test.nonstructural', nonStructuralOp, { structural: false });
    const result = registry.invoke('test.nonstructural', { value: 42 });
    expect(result.ok).toBe(true);
  });

  it('内核代码本身不包含负重/容量等具体约束（需求19.3）：kernel/ops 源码不出现具体玩法约束词汇', () => {
    const opsDir = join(process.cwd(), 'src/core/kernel/ops');
    const files = readdirSync(opsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    // 微型场景的 capacity 是内核原语（需求9.6），此处排除该合法用法；只扫描具体玩法词汇
    const forbiddenWords = ['maxweight', 'encumbrance', 'staminacost', 'manacost', 'weightlimit'];
    for (const file of files) {
      const content = readFileSync(join(opsDir, file), 'utf-8').toLowerCase().replace(/\s+/g, '');
      for (const word of forbiddenWords) {
        expect(content.includes(word)).toBe(false);
      }
    }
  });

  it('Property: 对于任意结构性 Op 与任意 veto 决策，veto 时状态不变；未 veto 时状态按预期改变', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: -1000, max: 1000 }), (shouldVeto, value) => {
        const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
        const registry = new OpRegistry(holder, {
          dispatchBefore: () => ({ cancelled: shouldVeto }),
        });
        const structuralOp: OpImpl<{ v: number }, void> = (args, ctx) => {
          const draft = ctx.tx.getDraft();
          ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: { ...draft.world.props, v: args.v } } });
          return ok(undefined);
        };
        registry.register('test.op', structuralOp, { structural: true });
        const before = holder.getState();
        const result = registry.invoke('test.op', { v: value });
        if (shouldVeto) {
          expect(result.ok).toBe(false);
          expect(holder.getState()).toBe(before);
        } else {
          expect(result.ok).toBe(true);
          expect(holder.getState().world.props['v']).toBe(value);
        }
      }),
      { numRuns: 100 },
    );
  });
});
