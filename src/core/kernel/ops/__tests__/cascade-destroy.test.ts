/**
 * 销毁级联清理穷举测试（决策与风险记录.md 记录5/11/12）。
 *
 * 覆盖 entity.destroy/item.destroy/node.destroy/link.destroy 四个销毁 Op 在下列四类附着状态下
 * 都必须成功且完全清理，不留悬空引用——这是"机械纪律"部分：内核只保证不产生悬空引用，
 * 不涉及"死于导弹是否掉落"这类语义判断（那部分由玩法包的 before Hook 决定，此处不测）。
 *
 * 四类附着状态（可独立出现也可组合出现，穷举而非抽样）：
 * A. 被销毁对象自身是某个 Attachment 的 target（光环/状态挂在它身上）
 * B. 被销毁对象拥有自己的 Container（背包），容器里有占用者（Item 或 Entity）
 * C. 被销毁对象自身正被别的容器的 Slot 持有（它站在载具座位里）
 * D. 被销毁对象与另一实体之间存在 Relation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpRegistry } from '../registry';
import { WorldStateHolder } from '../transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { registerStructuralOps, makeItemMove, createContainerForOwner } from '../structural-ops';
import { registerRelationOps } from '../relation-ops';
import { registerAttachOps } from '../../attachment/attach-ops';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import { resetIdCounters } from '../../state/ids';
import type { Ref } from '../../state/ids';
import type { Def } from '../../state/def';

const TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:room', { id: 'd:room', kind: 'node' }],
  ['d:door', { id: 'd:door', kind: 'link' }],
  ['d:sword', { id: 'd:sword', kind: 'item' }],
  ['d:buff', { id: 'd:buff', kind: 'attachment', stackStrategy: 'independent' } as unknown as Def],
]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  const defLookup = (id: string) => TEST_DEFS.get(id) ?? null;
  registerStructuralOps(registry, { itemMove, defLookup });
  registerRelationOps(registry);
  registerAttachOps(registry, { defLookup });
  return { holder, registry };
}

describe('销毁级联清理：entity.destroy（记录5/11）', () => {
  beforeEach(() => resetIdCounters());

  it('A. 带 Attachment 的实体可以被销毁，且 Attachment 一并消失', () => {
    const { holder, registry } = setupRegistry();
    const e = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const eId = (e as { value: Ref }).value.$;
    const a = registry.invoke<unknown, Ref>('attach.add', { def: 'd:buff', target: { $: eId } });
    expect(a.ok).toBe(true);

    const destroyResult = registry.invoke('entity.destroy', { id: eId });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().entities[eId]).toBeUndefined();
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
  });

  it('A. grantedBy 链式 Attachment 在实体销毁时一并级联清理', () => {
    const { holder, registry } = setupRegistry();
    const e = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const eId = (e as { value: Ref }).value.$;
    const root = registry.invoke<unknown, Ref>('attach.add', { def: 'd:buff', target: { $: eId } });
    const rootId = (root as { value: Ref }).value.$;
    registry.invoke('attach.add', { def: 'd:buff', target: { $: eId }, grantedBy: rootId });

    expect(Object.keys(holder.getState().world.attachments).length).toBe(2);
    const destroyResult = registry.invoke('entity.destroy', { id: eId });
    expect(destroyResult.ok).toBe(true);
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
  });

  it('B. 拥有背包容器（含物品）的实体可以被销毁；容器内物品脱离槎位但不被销毁（机械纪律：不落地不吞掉）', () => {
    const { holder, registry } = setupRegistry();
    const e = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const eId = (e as { value: Ref }).value.$;
    const containerResult = createContainerForOwner(holder.getState(), eId, 'backpack', 'fixed');
    holder.setState(containerResult.draft);
    registry.invoke('slot.add', { containerId: containerResult.containerId });
    const sword = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const swordId = (sword as { value: Ref }).value.$;
    registry.invoke('item.move', { itemId: swordId, toContainerId: containerResult.containerId });
    expect(holder.getState().items[swordId]?.slot).toBeDefined();

    const destroyResult = registry.invoke('entity.destroy', { id: eId });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().entities[eId]).toBeUndefined();
    expect(holder.getState().containers[containerResult.containerId]).toBeUndefined(); // 容器本身随宿主销毁
    // 物品本身未被销毁（机械纪律：容器内占用者不随容器一并消失），只是脱离了槎位
    expect(holder.getState().items[swordId]).toBeDefined();
    expect(holder.getState().items[swordId]?.slot).toBeUndefined();
  });

  // design.md 3.1节：Entity.slot 与 Slot.holds 均可指向 Entity，但当前 Op 全集没有"把既有
  // Entity 直接放进槎位"的公开入口（只有 entity.demote 先转 Item 再 item.move）——这里用手动
  // 构造 draft 的方式模拟这一状态，验证 clearHoldingSlot 对 Entity 占用者同样生效，不止对 Item 生效。
  it('C. 正被别的容器槎位直接持有的实体，销毁时宿主槎位随之清空', () => {
    const { holder, registry } = setupRegistry();
    const rider = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const riderId = (rider as { value: Ref }).value.$;
    const vehicle = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const vehicleId = (vehicle as { value: Ref }).value.$;
    const containerResult = createContainerForOwner(holder.getState(), vehicleId, 'seats', 'fixed');
    let state = containerResult.draft;
    state = { ...state, containers: { ...state.containers, [containerResult.containerId]: { ...state.containers[containerResult.containerId]!, slots: [{ id: 's:manual', tags: [], holds: { $: riderId }, props: {} }] } } };
    state = { ...state, entities: { ...state.entities, [riderId]: { ...state.entities[riderId]!, slot: 's:manual' } } };
    holder.setState(state);
    expect(holder.getState().containers[containerResult.containerId]?.slots[0]?.holds?.$).toBe(riderId);

    const destroyResult = registry.invoke('entity.destroy', { id: riderId });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().containers[containerResult.containerId]?.slots[0]?.holds).toBeUndefined();
  });

  it('D. 与另一实体存在 Relation 的实体可以被销毁，双向 Relation 一并清理', () => {
    const { holder, registry } = setupRegistry();
    const e1 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e1Id = (e1 as { value: Ref }).value.$;
    const e2 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e2Id = (e2 as { value: Ref }).value.$;
    registry.invoke('relation.set', { from: e1Id, to: e2Id, kind: 'owns' });
    expect(holder.getState().entities[e2Id]?.relations['owns']?.in).toEqual([{ $: e1Id }]);

    const destroyResult = registry.invoke('entity.destroy', { id: e1Id });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().entities[e2Id]?.relations['owns']?.in ?? []).toEqual([]);
  });

  it('A+B+D 组合：同时带 Attachment、背包容器、Relation 的实体一次性全部正确清理', () => {
    const { holder, registry } = setupRegistry();
    const e1 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e1Id = (e1 as { value: Ref }).value.$;
    const e2 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e2Id = (e2 as { value: Ref }).value.$;

    registry.invoke('attach.add', { def: 'd:buff', target: { $: e1Id } });
    const containerResult = createContainerForOwner(holder.getState(), e1Id, 'backpack', 'fixed');
    holder.setState(containerResult.draft);
    registry.invoke('relation.set', { from: e1Id, to: e2Id, kind: 'knows' });

    const destroyResult = registry.invoke('entity.destroy', { id: e1Id });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().entities[e1Id]).toBeUndefined();
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
    expect(holder.getState().containers[containerResult.containerId]).toBeUndefined();
    expect(holder.getState().entities[e2Id]?.relations['knows']?.in ?? []).toEqual([]);
  });
});

describe('销毁级联清理：item.destroy（记录5/11）', () => {
  beforeEach(() => resetIdCounters());

  it('A. 带 Attachment 的物品可以被销毁', () => {
    const { holder, registry } = setupRegistry();
    const i = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const iId = (i as { value: Ref }).value.$;
    registry.invoke('attach.add', { def: 'd:buff', target: { $: iId } });

    const destroyResult = registry.invoke('item.destroy', { id: iId });
    expect(destroyResult.ok).toBe(true);
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
  });

  it('B. 拥有容器的物品（如一个背包本身也是 Item）可以被销毁，容器与其内容物正确处理', () => {
    const { holder, registry } = setupRegistry();
    const bag = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const bagId = (bag as { value: Ref }).value.$;
    const containerResult = createContainerForOwner(holder.getState(), bagId, 'inside', 'fixed');
    holder.setState(containerResult.draft);
    registry.invoke('slot.add', { containerId: containerResult.containerId });
    const inner = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const innerId = (inner as { value: Ref }).value.$;
    registry.invoke('item.move', { itemId: innerId, toContainerId: containerResult.containerId });

    const destroyResult = registry.invoke('item.destroy', { id: bagId });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().containers[containerResult.containerId]).toBeUndefined();
    expect(holder.getState().items[innerId]).toBeDefined(); // 内容物不随容器销毁
    expect(holder.getState().items[innerId]?.slot).toBeUndefined();
  });

  it('C. 正被容器槎位持有的物品被销毁时，宿主槎位随之清空', () => {
    const { holder, registry } = setupRegistry();
    const owner = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (owner as { value: Ref }).value.$;
    const containerResult = createContainerForOwner(holder.getState(), ownerId, 'backpack', 'fixed');
    holder.setState(containerResult.draft);
    registry.invoke('slot.add', { containerId: containerResult.containerId });
    const sword = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
    const swordId = (sword as { value: Ref }).value.$;
    registry.invoke('item.move', { itemId: swordId, toContainerId: containerResult.containerId });
    expect(holder.getState().containers[containerResult.containerId]?.slots[0]?.holds?.$).toBe(swordId);

    const destroyResult = registry.invoke('item.destroy', { id: swordId });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().containers[containerResult.containerId]?.slots[0]?.holds).toBeUndefined();
  });
});

describe('销毁级联清理：node.destroy（记录11）', () => {
  beforeEach(() => resetIdCounters());

  it('A. 带 Attachment（环境状态）的节点可以被销毁', () => {
    const { holder, registry } = setupRegistry();
    const n = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const nId = (n as { value: Ref }).value.$;
    registry.invoke('attach.add', { def: 'd:buff', target: { $: nId } });

    const destroyResult = registry.invoke('node.destroy', { id: nId });
    expect(destroyResult.ok).toBe(true);
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
  });

  it('A. 级联销毁的子节点上的 Attachment 也一并清理（不止根节点）', () => {
    const { holder, registry } = setupRegistry();
    const parent = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const parentId = (parent as { value: Ref }).value.$;
    const child = registry.invoke<{ def: string; parent?: string }, Ref>('node.create', { def: 'd:room', parent: parentId });
    const childId = (child as { value: Ref }).value.$;
    registry.invoke('attach.add', { def: 'd:buff', target: { $: childId } });

    const destroyResult = registry.invoke('node.destroy', { id: parentId });
    expect(destroyResult.ok).toBe(true);
    expect(holder.getState().nodes[childId]).toBeUndefined();
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
  });
});

describe('销毁级联清理：link.destroy（记录11）', () => {
  beforeEach(() => resetIdCounters());

  it('A. 带 Attachment（如"上锁"状态）的边可以被销毁', () => {
    const { holder, registry } = setupRegistry();
    const n1 = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const n2 = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const link = registry.invoke<{ a: string; b: string; def: string }, Ref>('link.create', {
      a: (n1 as { value: Ref }).value.$,
      b: (n2 as { value: Ref }).value.$,
      def: 'd:door',
    });
    const linkId = (link as { value: Ref }).value.$;
    registry.invoke('attach.add', { def: 'd:buff', target: { $: linkId } });

    const destroyResult = registry.invoke('link.destroy', { id: linkId });
    expect(destroyResult.ok).toBe(true);
    expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
  });
});
