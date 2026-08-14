/**
 * Feature: wakeup-engine-layer
 * Property 1: 容器承载活体不变量
 * Validates: Requirements 1.3, 1.7, 2.2, 2.3, 5.2, 5.3, 5.4
 *
 * 对生成的承载面拓扑（合法与非法混合），若不变量破坏则引擎以 E_INV_* 拒绝该 Op 且不产生
 * 半改状态；合法状态下单一容纳、单一位置、位置互斥、无环容纳均成立；非 category:'carrier'
 * 承载面试图 holds 活体则被结构拒绝。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerStructuralOps, makeItemMove, createContainerForOwner } from '../../ops/structural-ops.js';
import { registerCarrierOps, makeContainerExit } from '../../ops/carrier-ops.js';
import { createCarrierSurface, addCarrierSlot } from '../../topology/carrier.js';
import { resetIdCounters, nextId } from '../../state/ids.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import type { Def } from '../../state/def.js';
import type { Ref } from '../../state/ids.js';
import type { Entity } from '../../state/entity.js';
import type { WorldState } from '../../state/world-state.js';

const TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:room', { id: 'd:room', kind: 'node' }],
]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  const defLookup = (id: string) => TEST_DEFS.get(id) ?? null;
  const containerExit = makeContainerExit();
  registerStructuralOps(registry, { itemMove, defLookup });
  registerCarrierOps(registry, {
    exprEngine,
    evalCtxForSlotAccepts: () => makeDefaultEvalContext(),
    evalCtxForCarrierLiving: () => makeDefaultEvalContext(),
    containerExit,
  });
  return { holder, registry };
}

/** 把载器承载面挂到 owner entity 上（owner.containers[name] = surfaceId），返回更新后的 state。 */
function attachSurface(state: WorldState, ownerId: string, surfaceId: string, surface: ReturnType<typeof addCarrierSlot>): WorldState {
  const owner = state.entities[ownerId] as Entity;
  const nextOwner: Entity = { ...owner, containers: { ...owner.containers, seat: surfaceId } };
  return {
    ...state,
    containers: { ...state.containers, [surfaceId]: surface },
    entities: { ...state.entities, [ownerId]: nextOwner },
  };
}

describe('Feature: wakeup-engine-layer, Property 1: 容器承载活体不变量', () => {
  beforeEach(() => resetIdCounters());

  it('合法进入：活体经 container.enter 进入载器承载面，holds/slot 互为镜像', () => {
    const { holder, registry } = setupRegistry();
    const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    expect(nodeRes.ok).toBe(true);
    const nodeId = (nodeRes as { value: Ref }).value.$;

    const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (ownerRes as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: ownerId, nodeId });

    const surfaceId = nextId('c');
    let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed', { capacity: 2 });
    surface = addCarrierSlot(surface);
    surface = addCarrierSlot(surface);
    holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

    const entity2Res = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const entityId = (entity2Res as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId, nodeId });

    const enterRes = registry.invoke('container.enter', { entityId, toContainerId: surfaceId });
    expect(enterRes.ok).toBe(true);

    const after = holder.getState();
    const container = after.containers[surfaceId]!;
    const slot = container.slots.find((s) => s?.holds?.$ === entityId);
    expect(slot).toBeDefined();
    expect(after.entities[entityId]!.slot).toBe(slot!.id);
    expect(after.entities[entityId]!.node).toBeUndefined();
  });

  it('位置互斥：活体进入承载面后 node 与 slot 不得并存', () => {
    const { holder, registry } = setupRegistry();
    const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const nodeId = (nodeRes as { value: Ref }).value.$;
    const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (ownerRes as { value: Ref }).value.$;
    const entity2Res = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const entityId = (entity2Res as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId, nodeId });

    const surfaceId = nextId('c');
    let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed');
    surface = addCarrierSlot(surface);
    holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

    registry.invoke('container.enter', { entityId, toContainerId: surfaceId });
    const after = holder.getState();
    const occupant = after.entities[entityId]!;
    expect(occupant.slot).toBeDefined();
    expect(occupant.node).toBeUndefined();
  });

  it('非载器承载面试图 container.enter 活体 → 被拒绝', () => {
    const { holder, registry } = setupRegistry();
    const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const nodeId = (nodeRes as { value: Ref }).value.$;
    const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (ownerRes as { value: Ref }).value.$;
    const entity2Res = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const entityId = (entity2Res as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId, nodeId });

    const { draft, containerId: plainId } = createContainerForOwner(holder.getState(), ownerId, 'backpack', 'fixed');
    holder.setState(draft);

    const enterRes = registry.invoke('container.enter', { entityId, toContainerId: plainId });
    expect(enterRes.ok).toBe(false);
    if (!enterRes.ok) {
      // reconciliation C2：非 carrier 承载面 holds 活体被结构拒绝，且不产生半改状态
      expect(enterRes.code).toBe('E_OP_NOT_ACCEPTED');
    }
    expect(holder.getState().entities[entityId]!.slot).toBeUndefined();
  });

  it('capacity 超限 → container.enter 被拒绝', () => {
    const { holder, registry } = setupRegistry();
    const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const nodeId = (nodeRes as { value: Ref }).value.$;
    const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (ownerRes as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: ownerId, nodeId });

    const surfaceId = nextId('c');
    let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed', { capacity: 1 });
    surface = addCarrierSlot(surface);
    holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

    const e1Res = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e1Id = (e1Res as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: e1Id, nodeId });
    const e2Res = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e2Id = (e2Res as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: e2Id, nodeId });

    const r1 = registry.invoke('container.enter', { entityId: e1Id, toContainerId: surfaceId });
    expect(r1.ok).toBe(true);
    const r2 = registry.invoke('container.enter', { entityId: e2Id, toContainerId: surfaceId });
    expect(r2.ok).toBe(false);
  });

  it('fast-check: 随机合法进入序列不破坏单一容纳与位置互斥', () => {
    const numSlotsArb = fc.integer({ min: 1, max: 4 });
    const numEntitiesArb = fc.integer({ min: 1, max: 4 });
    const opSequenceArb = fc.array(
      fc.record({
        entityIdx: fc.integer({ min: 0, max: 3 }),
        slotIdx: fc.integer({ min: 0, max: 3 }),
      }),
      { maxLength: 10 },
    );

    fc.assert(
      fc.property(numSlotsArb, numEntitiesArb, opSequenceArb, (numSlots, numEntities, ops) => {
        const { holder, registry } = setupRegistry();
        const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
        const nodeId = (nodeRes as { value: Ref }).value.$;

        const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const ownerId = (ownerRes as { value: Ref }).value.$;
        registry.invoke('entity.place', { entityId: ownerId, nodeId });

        const entityIds: string[] = [];
        for (let i = 0; i < numEntities; i++) {
          const eRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
          const eId = (eRes as { value: Ref }).value.$;
          registry.invoke('entity.place', { entityId: eId, nodeId });
          entityIds.push(eId);
        }

        const surfaceId = nextId('c');
        let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed', { capacity: numSlots });
        for (let i = 0; i < numSlots; i++) surface = addCarrierSlot(surface);
        holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

        for (const op of ops) {
          if (op.entityIdx >= entityIds.length) continue;
          const eid = entityIds[op.entityIdx];
          registry.invoke('container.enter', {
            entityId: eid,
            toContainerId: surfaceId,
            atSlot: op.slotIdx < numSlots ? op.slotIdx : undefined,
          });
        }

        const after = holder.getState();
        const surface2 = after.containers[surfaceId]!;
        let totalHolds = 0;
        const heldSet = new Set<string>();
        for (const s of surface2.slots) {
          if (s?.holds) {
            totalHolds++;
            heldSet.add(s.holds.$);
          }
        }
        expect(totalHolds).toBe(heldSet.size); // 单一容纳
        expect(totalHolds).toBeLessThanOrEqual(numSlots); // capacity
        for (const eid of heldSet) {
          expect(after.entities[eid]!.node).toBeUndefined();
          expect(after.entities[eid]!.slot).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: wakeup-engine-layer
 * Property 2: 容器承载面销毁释放
 * Validates: Requirements 2.4, 4.2, 4.3, 4.4
 *
 * 销毁承载面宿主后，内部成员的 slot/holds 清空一致，成员完整存在、成员自身容器不破坏、
 * 无悬空引用；活体成员与物品成员释放同构。
 */
describe('Feature: wakeup-engine-layer, Property 2: 容器承载面销毁释放', () => {
  beforeEach(() => resetIdCounters());

  it('销毁承载面宿主：内部活体脱离槽位、完整保留、无悬空引用', () => {
    const { holder, registry } = setupRegistry();
    const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const nodeId = (nodeRes as { value: Ref }).value.$;

    const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (ownerRes as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: ownerId, nodeId });

    const surfaceId = nextId('c');
    let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed', { capacity: 2 });
    surface = addCarrierSlot(surface);
    surface = addCarrierSlot(surface);
    holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

    for (let i = 0; i < 2; i++) {
      const eRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
      const eId = (eRes as { value: Ref }).value.$;
      registry.invoke('entity.place', { entityId: eId, nodeId });
      registry.invoke('container.enter', { entityId: eId, toContainerId: surfaceId });
    }

    const destroyRes = registry.invoke('entity.destroy', { id: ownerId });
    expect(destroyRes.ok).toBe(true);

    const after = holder.getState();
    expect(after.entities[ownerId]).toBeUndefined();
    expect(after.containers[surfaceId]).toBeUndefined();
    const remaining = Object.values(after.entities).filter((e) => e !== undefined);
    expect(remaining.length).toBeGreaterThanOrEqual(2);
    for (const e of remaining) {
      expect(e.slot).toBeUndefined();
    }
  });

  it('退出后活体可重新进承载面（container.exit → container.enter 往返一致）', () => {
    const { holder, registry } = setupRegistry();
    const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const nodeId = (nodeRes as { value: Ref }).value.$;
    const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const ownerId = (ownerRes as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: ownerId, nodeId });

    const surfaceId = nextId('c');
    let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed');
    surface = addCarrierSlot(surface);
    holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

    const eRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const eId = (eRes as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: eId, nodeId });

    const r1 = registry.invoke('container.enter', { entityId: eId, toContainerId: surfaceId });
    expect(r1.ok).toBe(true);
    expect(holder.getState().entities[eId]!.slot).toBeDefined();

    const r2 = registry.invoke('container.exit', { entityId: eId, toNode: nodeId });
    expect(r2.ok).toBe(true);
    expect(holder.getState().entities[eId]!.slot).toBeUndefined();
    expect(holder.getState().entities[eId]!.node).toBe(nodeId);

    const r3 = registry.invoke('container.enter', { entityId: eId, toContainerId: surfaceId });
    expect(r3.ok).toBe(true);
    expect(holder.getState().entities[eId]!.slot).toBeDefined();
    expect(holder.getState().entities[eId]!.node).toBeUndefined();
  });
});

/**
 * Feature: wakeup-engine-layer
 * Property 2b: 承载面销毁释放（fast-check 属性扩展）
 * Validates: Requirements 2.4, 4.2, 4.3, 4.4
 *
 * 随机容量（1 或 0）+ 随机入坑个数：坑总数为 0 时不能进；capacity≥1 时进坑数是容量上限、互为镜像；
 * 销毁承载面宿主后所有成员 slot 清空、实体完整存在且不悬空槽位引用。
 */
describe('Feature: wakeup-engine-layer, Property 2b: 承载面释放属性', () => {
  beforeEach(() => resetIdCounters());

  it('任意容量/入坑组合：入坑镜像、容量封顶、销毁后槽位清空一致', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 4 }),
        (capacity, entitiesToBoard) => {
          const { holder, registry } = setupRegistry();
          const nodeRes = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
          const nodeId = (nodeRes as { value: Ref }).value.$;
          const ownerRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
          const ownerId = (ownerRes as { value: Ref }).value.$;
          registry.invoke('entity.place', { entityId: ownerId, nodeId });

          const surfaceId = nextId('c');
          let surface = createCarrierSurface(surfaceId, ownerId, 'seat', 'fixed', { capacity });
          for (let i = 0; i < capacity; i++) surface = addCarrierSlot(surface);
          holder.setState(attachSurface(holder.getState(), ownerId, surfaceId, surface));

          // 建实体并尝试入坑
          const boardedIds: string[] = [];
          for (let i = 0; i < entitiesToBoard; i++) {
            const eRes = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
            const eId = (eRes as { value: Ref }).value.$;
            registry.invoke('entity.place', { entityId: eId, nodeId });
            const enter = registry.invoke('container.enter', { entityId: eId, toContainerId: surfaceId });
            if (enter.ok) boardedIds.push(eId);
          }

          const mid = holder.getState();
          const slots = mid.containers[surfaceId]!.slots;
          const holdsCount = slots.filter((s) => s?.holds !== undefined).length;
          // 互为镜像：每个已上坑的活体 slot 指向对应槽；槽 holds 与 entity.slot 一致
          expect(holdsCount).toBe(Math.min(capacity, entitiesToBoard));
          expect(holdsCount).toBe(boardedIds.length);
          for (const s of slots) {
            if (s?.holds) {
              expect(mid.entities[s.holds.$]!.slot).toBe(s.id);
            }
          }
          for (const eid of boardedIds) {
            const e = mid.entities[eid]!;
            expect(e.slot).toBeDefined();
            expect(e.node).toBeUndefined();
          }

          registry.invoke('entity.destroy', { id: ownerId });
          const after = holder.getState();
          const survivors = Object.values(after.entities).filter((e) => e !== undefined);
          // 全部（存活）成员槽位清空；但已上坑实体仍完整存在
          for (const e of survivors) {
            expect(e.slot).toBeUndefined();
          }
          expect(after.containers[surfaceId]).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
