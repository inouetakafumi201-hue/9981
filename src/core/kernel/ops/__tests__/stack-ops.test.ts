import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry';
import { WorldStateHolder } from '../transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { registerStructuralOps, makeItemMove, createContainerForOwner } from '../structural-ops';
import { registerStackOps } from '../stack-ops';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import type { Ref } from '../../state/ids';
import type { Def } from '../../state/def';

const TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:arrow', { id: 'd:arrow', kind: 'item' }],
]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  registerStackOps(registry, itemMove);
  return { holder, registry };
}

function countTotalStack(items: Record<string, { def: string; stack?: number }>, defId: string): number {
  return Object.values(items)
    .filter((i) => i.def === defId)
    .reduce((sum, i) => sum + (i.stack ?? 1), 0);
}

describe('stack.split / stack.merge 原子性（需求17.1-17.5）', () => {
  it('stack.split 成功拆分：扣减-创建-放置三步都生效', () => {
    const { holder, registry } = setupRegistry();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
    holder.setState(containerResult.draft);
    registry.invoke('slot.add', { containerId: containerResult.containerId });

    const item = registry.invoke<{ def: string; stack: number }, Ref>('item.create', { def: 'd:arrow', stack: 10 });
    const itemId = (item as { value: Ref }).value.$;

    const splitResult = registry.invoke<{ id: string; n: number; toContainerId: string }, Ref>('stack.split', {
      id: itemId,
      n: 3,
      toContainerId: containerResult.containerId,
    });
    expect(splitResult.ok).toBe(true);
    expect(holder.getState().items[itemId]?.stack).toBe(7);
    if (splitResult.ok) {
      expect(holder.getState().items[splitResult.value.$]?.stack).toBe(3);
    }
  });

  it('stack.split 无合法槎位时整体回滚：原栈数量不变，不产生新物品（需求17.1-17.3）', () => {
    const { holder, registry } = setupRegistry();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
    holder.setState(containerResult.draft); // 无槎位

    const item = registry.invoke<{ def: string; stack: number }, Ref>('item.create', { def: 'd:arrow', stack: 10 });
    const itemId = (item as { value: Ref }).value.$;
    const itemCountBefore = Object.keys(holder.getState().items).length;

    const splitResult = registry.invoke('stack.split', { id: itemId, n: 3, toContainerId: containerResult.containerId });
    expect(splitResult.ok).toBe(false);
    expect(holder.getState().items[itemId]?.stack).toBe(10); // 原栈数量不变
    expect(Object.keys(holder.getState().items).length).toBe(itemCountBefore); // 不产生新物品
  });

  it('stack.merge 合并同 DefId 物品并销毁来源', () => {
    const { holder, registry } = setupRegistry();
    const a = registry.invoke<{ def: string; stack: number; stackMax: number }, Ref>('item.create', { def: 'd:arrow', stack: 3, stackMax: 20 });
    const b = registry.invoke<{ def: string; stack: number; stackMax: number }, Ref>('item.create', { def: 'd:arrow', stack: 5, stackMax: 20 });
    const aId = (a as { value: Ref }).value.$;
    const bId = (b as { value: Ref }).value.$;

    const mergeResult = registry.invoke('stack.merge', { fromId: aId, intoId: bId });
    expect(mergeResult.ok).toBe(true);
    expect(holder.getState().items[bId]?.stack).toBe(8);
    expect(holder.getState().items[aId]).toBeUndefined();
  });

  it('stack.merge 超出 stackMax 时拒绝', () => {
    const { holder, registry } = setupRegistry();
    const a = registry.invoke<{ def: string; stack: number; stackMax: number }, Ref>('item.create', { def: 'd:arrow', stack: 15, stackMax: 20 });
    const b = registry.invoke<{ def: string; stack: number; stackMax: number }, Ref>('item.create', { def: 'd:arrow', stack: 10, stackMax: 20 });
    const aId = (a as { value: Ref }).value.$;
    const bId = (b as { value: Ref }).value.$;

    const mergeResult = registry.invoke('stack.merge', { fromId: aId, intoId: bId });
    expect(mergeResult.ok).toBe(false);
    expect(holder.getState().items[aId]?.stack).toBe(15);
    expect(holder.getState().items[bId]?.stack).toBe(10);
  });

  it('Property 5: 堆叠总量守恒——split/merge 序列不改变同 DefId 物品总量（仅 create/destroy 改变）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), fc.integer({ min: 1, max: 49 }), (initialStack, splitN) => {
        fc.pre(splitN < initialStack);
        const { holder, registry } = setupRegistry();
        const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
        holder.setState(containerResult.draft);
        registry.invoke('slot.add', { containerId: containerResult.containerId });

        const item = registry.invoke<{ def: string; stack: number }, Ref>('item.create', { def: 'd:arrow', stack: initialStack });
        const itemId = (item as { value: Ref }).value.$;
        const totalBefore = countTotalStack(holder.getState().items as Record<string, { def: string; stack?: number }>, 'd:arrow');

        registry.invoke('stack.split', { id: itemId, n: splitN, toContainerId: containerResult.containerId });

        const totalAfter = countTotalStack(holder.getState().items as Record<string, { def: string; stack?: number }>, 'd:arrow');
        expect(totalAfter).toBe(totalBefore);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 6: 拆分失败即整体回滚——目标容器已满时原栈数量不变，无新物品', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), fc.integer({ min: 1, max: 49 }), (initialStack, splitN) => {
        fc.pre(splitN < initialStack);
        const { holder, registry } = setupRegistry();
        const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
        holder.setState(containerResult.draft); // 无槎位 → 必然拆分失败

        const item = registry.invoke<{ def: string; stack: number }, Ref>('item.create', { def: 'd:arrow', stack: initialStack });
        const itemId = (item as { value: Ref }).value.$;
        const itemCountBefore = Object.keys(holder.getState().items).length;

        const result = registry.invoke('stack.split', { id: itemId, n: splitN, toContainerId: containerResult.containerId });
        expect(result.ok).toBe(false);
        expect(holder.getState().items[itemId]?.stack).toBe(initialStack);
        expect(Object.keys(holder.getState().items).length).toBe(itemCountBefore);
      }),
      { numRuns: 100 },
    );
  });
});
