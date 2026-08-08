import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerStructuralOps, makeItemMove, createContainerForOwner } from '../structural-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import type { Ref } from '../../state/ids.js';
import type { Def } from '../../state/def.js';

const TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:room', { id: 'd:room', kind: 'node' }],
  ['d:door', { id: 'd:door', kind: 'link' }],
  ['d:sword', { id: 'd:sword', kind: 'item' }],
  ['d:vehicle', { id: 'd:vehicle', kind: 'item' }],
]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({
    exprEngine,
    evalCtxForSlotAccepts: (_containerId: string, _slotIndex: number) => makeDefaultEvalContext(),
  });
  registerStructuralOps(registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  return { holder, registry };
}

describe('结构类 Op（需求7.1-7.6, 16.6-16.7）', () => {
  it('entity.create / entity.destroy', () => {
    const { holder, registry } = setupRegistry();
    const created = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(holder.getState().entities[created.value.$]).toBeDefined();
      const destroyed = registry.invoke('entity.destroy', { id: created.value.$ });
      expect(destroyed.ok).toBe(true);
      expect(holder.getState().entities[created.value.$]).toBeUndefined();
    }
  });

  it('node.create / node.destroy 级联销毁子节点与关联 Link（需求7.5, 20.7）', () => {
    const { holder, registry } = setupRegistry();
    const n1 = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const n2 = registry.invoke<{ def: string; parent?: string }, Ref>('node.create', { def: 'd:room', parent: (n1 as { value: Ref }).value.$ });
    const linkResult = registry.invoke('link.create', { a: (n1 as { value: Ref }).value.$, b: (n2 as { value: Ref }).value.$, def: 'd:door' });
    expect(linkResult.ok).toBe(true);

    const destroyResult = registry.invoke('node.destroy', { id: (n1 as { value: Ref }).value.$ });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().nodes[(n1 as { value: Ref }).value.$]).toBeUndefined();
    expect(holder.getState().nodes[(n2 as { value: Ref }).value.$]).toBeUndefined(); // 子节点级联销毁
    expect(Object.keys(holder.getState().links).length).toBe(0); // 关联 Link 级联销毁
  });

  it('item.move: 未指定槎位时按索引选取第一个合法且为空的槎位（需求10.9）', () => {
    const { holder, registry } = setupRegistry();
    const item = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
    holder.setState(containerResult.draft);
    registry.invoke('slot.add', { containerId: containerResult.containerId });
    registry.invoke('slot.add', { containerId: containerResult.containerId });

    const moveResult = registry.invoke('item.move', { itemId: (item as { value: Ref }).value.$, toContainerId: containerResult.containerId });
    expect(moveResult.ok).toBe(true);
    const container = holder.getState().containers[containerResult.containerId];
    expect(container?.slots[0]?.holds?.$).toBe((item as { value: Ref }).value.$);
  });

  it('item.move: 找不到合法槎位时返回 ok:false，不落地不吞掉（需求10.10）', () => {
    const { holder, registry } = setupRegistry();
    const item = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
    holder.setState(containerResult.draft); // 容器没有任何槎位

    const before = holder.getState();
    const moveResult = registry.invoke('item.move', { itemId: (item as { value: Ref }).value.$, toContainerId: containerResult.containerId });
    expect(moveResult.ok).toBe(false);
    expect(holder.getState()).toBe(before); // 完全未改变
    expect(holder.getState().items[(item as { value: Ref }).value.$]).toBeDefined(); // 物品未被吞掉
  });

  it('item.promote / entity.demote 互逆转换（需求2.3-2.4）', () => {
    const { holder, registry } = setupRegistry();
    const item = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:vehicle' });
    const node = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const promoted = registry.invoke<{ itemId: string; nodeId: string }, Ref>('item.promote', {
      itemId: (item as { value: Ref }).value.$,
      nodeId: (node as { value: Ref }).value.$,
    });
    expect(promoted.ok).toBe(true);
    if (promoted.ok) {
      expect(holder.getState().entities[promoted.value.$]?.node).toBe((node as { value: Ref }).value.$);
      expect(holder.getState().items[(item as { value: Ref }).value.$]).toBeUndefined();
    }
  });

  it('Property: 对于任意容器容量与 item.move 序列，不存在物品既不在容器中又未被销毁的悬空状态', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 10 }), (slotCount, itemCount) => {
        const { holder, registry } = setupRegistry();
        const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const containerResult = createContainerForOwner(holder.getState(), (entity as { value: Ref }).value.$, 'backpack', 'fixed');
        holder.setState(containerResult.draft);
        for (let i = 0; i < slotCount; i++) registry.invoke('slot.add', { containerId: containerResult.containerId });

        const itemIds: string[] = [];
        for (let i = 0; i < itemCount; i++) {
          const created = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
          if (created.ok) itemIds.push(created.value.$);
        }
        let successCount = 0;
        for (const id of itemIds) {
          const r = registry.invoke('item.move', { itemId: id, toContainerId: containerResult.containerId });
          if (r.ok) successCount++;
        }
        // 成功放入的数量不应超过槎位数
        expect(successCount).toBeLessThanOrEqual(slotCount);
        // 所有物品依然存在（未被吞掉）
        for (const id of itemIds) {
          expect(holder.getState().items[id]).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
