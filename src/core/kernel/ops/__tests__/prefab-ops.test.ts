import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerStructuralOps, makeItemMove } from '../structural-ops.js';
import { registerPrefabOps } from '../prefab-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import { resetIdCounters } from '../../state/ids.js';
import type { Ref } from '../../state/ids.js';
import type { PrefabDef, PrefabHandle } from '../../topology/prefab.js';
import type { Def } from '../../state/def.js';

const BASE_TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:hallway', { id: 'd:hallway', kind: 'node' }],
  ['d:room', { id: 'd:room', kind: 'node' }],
  ['d:door', { id: 'd:door', kind: 'link' }],
]);

function setupRegistry(prefabs: PrefabDef[]) {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const map = new Map<string, Def>(BASE_TEST_DEFS);
  for (const p of prefabs) map.set(p.id, p);
  const defLookup = (id: string) => map.get(id) ?? null;
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(registry, { itemMove, defLookup });
  registerPrefabOps(registry, { defLookup });
  return { holder, registry };
}

function makeRoomPrefab(): PrefabDef {
  return {
    id: 'p:room',
    kind: 'prefab',
    nodes: [
      { key: 'root', def: 'd:room' },
      { key: 'annex', def: 'd:room' },
    ],
    links: [{ a: 'root', b: 'annex', def: 'd:door' }],
    attachTo: 'root',
  };
}

describe('prefab.spawn / prefab.despawn（需求8.1-8.7, 16.6）', () => {
  beforeEach(() => resetIdCounters());

  it('spawn 按预制结构批量创建节点与边，key 被重映射为实际 Id（需求8.1-8.2）', () => {
    const prefab = makeRoomPrefab();
    const { holder, registry } = setupRegistry([prefab]);
    const result = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', { def: 'p:room' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.length).toBe(2);
      expect(result.value.links.length).toBe(1);
      for (const nodeId of result.value.nodes) {
        expect(holder.getState().nodes[nodeId]).toBeDefined();
      }
      const link = holder.getState().links[result.value.links[0] as string];
      expect(result.value.nodes).toContain(link?.a);
      expect(result.value.nodes).toContain(link?.b);
    }
  });

  it('spawn 声明 attachTo 时预制结构 root 与外部节点相连（需求8.3）', () => {
    const prefab = makeRoomPrefab();
    const { holder, registry } = setupRegistry([prefab]);
    const outside = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:hallway' });
    const outsideId = (outside as { value: Ref }).value.$;

    const result = registry.invoke<{ def: string; attachTo: string }, PrefabHandle>('prefab.spawn', {
      def: 'p:room',
      attachTo: outsideId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const seamLinks = Object.values(holder.getState().links).filter(
        (l) => (l.a === outsideId || l.b === outsideId) && (result.value.nodes.includes(l.a) || result.value.nodes.includes(l.b)),
      );
      expect(seamLinks.length).toBeGreaterThan(0);
    }
  });

  it('despawn 回收 spawn 创建的全部对象（需求8.4）', () => {
    const prefab = makeRoomPrefab();
    const { holder, registry } = setupRegistry([prefab]);
    const spawnResult = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', { def: 'p:room' });
    expect(spawnResult.ok).toBe(true);
    if (!spawnResult.ok) return;

    const despawnResult = registry.invoke('prefab.despawn', { handle: spawnResult.value });
    expect(despawnResult.ok).toBe(true);
    for (const nodeId of spawnResult.value.nodes) {
      expect(holder.getState().nodes[nodeId]).toBeUndefined();
    }
    for (const linkId of spawnResult.value.links) {
      expect(holder.getState().links[linkId]).toBeUndefined();
    }
  });

  it('despawn 存在占位者但未提供 evacuateTo 时拒绝，不产生任何状态改动（需求8.5：疏散至有效位置，内核不得自行发明去处）', () => {
    const prefab = makeRoomPrefab();
    const { holder, registry } = setupRegistry([prefab]);
    const spawnResult = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', { def: 'p:room' });
    expect(spawnResult.ok).toBe(true);
    if (!spawnResult.ok) return;

    const occupant = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const occupantId = (occupant as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: occupantId, nodeId: spawnResult.value.nodes[0] });
    const beforeDespawn = holder.getState();

    const despawnResult = registry.invoke('prefab.despawn', { handle: spawnResult.value });
    expect(despawnResult.ok).toBe(false);
    if (!despawnResult.ok) expect(despawnResult.code).toBe('E_OP_NO_LEGAL_SLOT');
    // 拒绝时状态必须逐字段不变（否决/拒绝零改动纪律，与 Property 24 同构）
    expect(holder.getState()).toEqual(beforeDespawn);
    expect(holder.getState().entities[occupantId]?.node).toBe(spawnResult.value.nodes[0]);
  });

  it('despawn 提供 evacuateTo 时把占位者疏散至该有效节点，且该节点必须真实存在（需求8.5）', () => {
    const prefab = makeRoomPrefab();
    const { holder, registry } = setupRegistry([prefab]);
    const spawnResult = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', { def: 'p:room' });
    expect(spawnResult.ok).toBe(true);
    if (!spawnResult.ok) return;

    const occupant = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const occupantId = (occupant as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: occupantId, nodeId: spawnResult.value.nodes[0] });

    const safeHaven = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:hallway' });
    const safeHavenId = (safeHaven as { value: Ref }).value.$;

    const despawnResult = registry.invoke('prefab.despawn', { handle: spawnResult.value, evacuateTo: safeHavenId });
    expect(despawnResult.ok).toBe(true);
    expect(holder.getState().entities[occupantId]?.node).toBe(safeHavenId); // 疏散到玩法包指定的真实有效位置，不是内核发明的"无位置"
  });

  it('despawn 提供的 evacuateTo 若不存在，拒绝且不产生任何状态改动', () => {
    const prefab = makeRoomPrefab();
    const { holder, registry } = setupRegistry([prefab]);
    const spawnResult = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', { def: 'p:room' });
    expect(spawnResult.ok).toBe(true);
    if (!spawnResult.ok) return;

    const occupant = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const occupantId = (occupant as { value: Ref }).value.$;
    registry.invoke('entity.place', { entityId: occupantId, nodeId: spawnResult.value.nodes[0] });
    const beforeDespawn = holder.getState();

    const despawnResult = registry.invoke('prefab.despawn', { handle: spawnResult.value, evacuateTo: 'n:does-not-exist' });
    expect(despawnResult.ok).toBe(false);
    expect(holder.getState()).toEqual(beforeDespawn);
  });

  it('spawn 引用不存在的 PrefabDef 返回 ok:false', () => {
    const { registry } = setupRegistry([]);
    const result = registry.invoke('prefab.spawn', { def: 'p:nonexistent' });
    expect(result.ok).toBe(false);
  });

  it('Property: 对于任意 prefab.spawn 后立即 prefab.despawn，节点/边/实体集合应恢复到 spawn 前的等价状态（不计 id 分配计数器）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (extraNodeCount) => {
        resetIdCounters();
        const nodes = [{ key: 'root', def: 'd:room' }];
        for (let i = 0; i < extraNodeCount; i++) nodes.push({ key: `n${i}`, def: 'd:room' });
        const links = nodes.slice(1).map((n) => ({ a: 'root', b: n.key, def: 'd:door' }));
        const prefab: PrefabDef = { id: 'p:dynamic', kind: 'prefab', nodes, links, attachTo: 'root' };

        const { holder, registry } = setupRegistry([prefab]);
        const before = holder.getState();
        const spawnResult = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', { def: 'p:dynamic' });
        expect(spawnResult.ok).toBe(true);
        if (!spawnResult.ok) return;
        registry.invoke('prefab.despawn', { handle: spawnResult.value });
        const after = holder.getState();

        expect(Object.keys(after.nodes).length).toBe(Object.keys(before.nodes).length);
        expect(Object.keys(after.links).length).toBe(Object.keys(before.links).length);
        expect(Object.keys(after.entities).length).toBe(Object.keys(before.entities).length);
      }),
      { numRuns: 50 },
    );
  });
});
