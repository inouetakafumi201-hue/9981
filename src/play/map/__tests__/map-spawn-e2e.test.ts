/**
 * 端到端：MapData → PrefabDef → 真实 WorldState。
 *
 * 上一个测试文件断言的是编译产物的**形状**，那只能证明"我编出了我以为的东西"。本文件把产物交给
 * 真实的 `OpRegistry` / `prefab.spawn` 执行，再用真实的 `dist`/`shortestPath` 在生成出来的世界上
 * 走一遍——这才能证明管线的终点确实是一条已经被测过的引擎路径，而不是一个自洽的幻觉。
 *
 * 这里不注册任何替身：Op 实现、事务、Id 分配、图度量全是引擎本体。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { OpRegistry } from '../../../core/kernel/ops/registry.js';
import { WorldStateHolder } from '../../../core/kernel/ops/transaction.js';
import { registerPrefabOps } from '../../../core/kernel/ops/prefab-ops.js';
import { makeItemMove, registerStructuralOps } from '../../../core/kernel/ops/structural-ops.js';
import { createEmptyWorldState } from '../../../core/kernel/state/world-state.js';
import { resetIdCounters } from '../../../core/kernel/state/ids.js';
import { ExprEngine, makeDefaultEvalContext } from '../../../core/kernel/expr/engine.js';
import { dist, shortestPath } from '../../../core/kernel/topology/metrics.js';
import type { Def } from '../../../core/kernel/state/def.js';
import type { PrefabDef, PrefabHandle } from '../../../core/kernel/topology/prefab.js';
import { compileMap } from '../compile.js';
import type { MapData } from '../types.js';

/** 基类层在本测试中的替代：只提供 def 登记，不含任何玩法数值。 */
const CLASS_DEFS = new Map<string, Def>([
  ['d:scene/yard', { id: 'd:scene/yard', kind: 'node' }],
  ['d:scene/room', { id: 'd:scene/room', kind: 'node' }],
  ['d:transition/door', { id: 'd:transition/door', kind: 'link' }],
  ['d:transition/stairs', { id: 'd:transition/stairs', kind: 'link' }],
  ['inst_locker_7f3a', { id: 'inst_locker_7f3a', kind: 'entity' }],
]);

function setup(prefab: PrefabDef) {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const defs = new Map<string, Def>(CLASS_DEFS);
  defs.set(prefab.id, prefab);
  const defLookup = (id: string): Def | null => defs.get(id) ?? null;
  const itemMove = makeItemMove({
    exprEngine,
    evalCtxForSlotAccepts: () => makeDefaultEvalContext(),
  });
  registerStructuralOps(registry, { itemMove, defLookup });
  registerPrefabOps(registry, { defLookup });
  return { holder, registry };
}

/**
 * 一张手写的地图，代表"没有编辑器也能跑"的那条路径：三个场景连成一条链，
 * 楼梯段代价更高，储物柜放在尽头。
 */
function campusMap(): MapData {
  return {
    schemaVersion: '1.0',
    id: 'wushi_campus_7f3a',
    name: '测试校园',
    backdrop: {
      image: 'campus.png',
      pixelWidth: 1920,
      pixelHeight: 1080,
      tileRows: 1,
      tileCols: 1,
    },
    floors: [0, 1],
    nodes: [
      { id: 'yard', def: 'd:scene/yard', scale: 'large', at: { x: 0.2, y: 0.8 }, floor: 0, name: '前院' },
      { id: 'hall', def: 'd:scene/room', scale: 'medium', at: { x: 0.5, y: 0.5 }, floor: 0, name: '门厅' },
      { id: 'attic', def: 'd:scene/room', scale: 'medium', at: { x: 0.8, y: 0.2 }, floor: 1, name: '阁楼' },
    ],
    edges: [
      {
        id: 'gate',
        def: 'd:transition/door',
        a: 'yard',
        b: 'hall',
        directionality: 'bidirectional',
        path: [{ x: 0.2, y: 0.8 }, { x: 0.35, y: 0.62 }, { x: 0.5, y: 0.5 }],
      },
      {
        id: 'climb',
        def: 'd:transition/stairs',
        a: 'hall',
        b: 'attic',
        directionality: 'bidirectional',
        path: [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.2 }],
      },
    ],
    placements: [{ id: 'locker', at: 'attic', def: 'inst_locker_7f3a' }],
  };
}

describe('地图管线端到端：手写 MapData 直达运行期世界', () => {
  beforeEach(() => resetIdCounters());

  it('编译产物被真实 prefab.spawn 接受，节点/边/实体全部落地', () => {
    const compiled = compileMap(campusMap());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const { holder, registry } = setup(compiled.prefab);
    const spawned = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', {
      def: compiled.prefab.id,
    });

    expect(spawned.ok, spawned.ok ? '' : `${spawned.code}: ${spawned.detail}`).toBe(true);
    if (!spawned.ok || spawned.value === undefined) return;

    const handle = spawned.value;
    expect(handle.nodes).toHaveLength(3);
    expect(handle.links).toHaveLength(2);
    expect(handle.entities).toHaveLength(1);

    const state = holder.getState();
    for (const nodeId of handle.nodes) expect(state.nodes[nodeId]).toBeDefined();
    for (const linkId of handle.links) expect(state.links[linkId]).toBeDefined();
    for (const entityId of handle.entities) expect(state.entities[entityId]).toBeDefined();
  });

  it('生成出来的世界是连通的，且真实 dist 反映作者写的代价而非曲线长度', () => {
    const source = campusMap();
    const compiled = compileMap(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const { holder, registry } = setup(compiled.prefab);
    const spawned = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', {
      def: compiled.prefab.id,
    });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok || spawned.value === undefined) return;

    const state = holder.getState();
    const byDef = (defId: string): string[] =>
      spawned.value!.nodes.filter((id) => state.nodes[id]?.def === defId);

    const yardId = byDef('d:scene/yard')[0];
    expect(yardId).toBeDefined();
    if (yardId === undefined) return;

    // 三点连成链，任意两点可达。
    const rooms = byDef('d:scene/room');
    expect(rooms).toHaveLength(2);
    for (const roomId of rooms) {
      const path = shortestPath(state.nodes, state.links, yardId, roomId);
      expect(path, `${yardId} → ${roomId} 应可达`).not.toBeNull();
    }

    // 院子到阁楼必须经门厅，跳数为 2；院子到门厅跳数为 1。
    const hops = rooms
      .map((roomId) => dist(state.nodes, state.links, yardId, roomId, { metric: 'hops' }))
      .sort((l, r) => (l ?? 0) - (r ?? 0));
    expect(hops).toEqual([1, 2]);
  });

  it('曲线画得长不改变代价：把 gate 的折线拉长十倍，spawn 出的世界完全相同', () => {
    const plain = campusMap();
    // 同一对端点之间塞进大量绕行控制点——只有视觉变了。
    const detour = [
      { x: 0.2, y: 0.8 },
      ...Array.from({ length: 40 }, (_, i) => ({
        x: 0.2 + (i % 2) * 0.25,
        y: 0.8 - i * 0.007,
      })),
      { x: 0.5, y: 0.5 },
    ];
    const scenic: MapData = {
      ...plain,
      edges: plain.edges.map((edge) =>
        edge.id === 'gate' ? { ...edge, path: detour } : edge),
    };

    const a = compileMap(plain);
    const b = compileMap(scenic);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // 编译产物逐字节相同：几何完全不参与拓扑。
    expect(JSON.stringify(b.prefab)).toBe(JSON.stringify(a.prefab));

    // 上面既然逐字节相同，两边 spawn 出的世界必然相同——所以下面单纯比 distances[0] === distances[1]
    // 是重言式，说明不了任何事。真正要钉住的是那个数本身：yard →(gate) hall →(climb) attic 两跳，
    // 每跳 link.weight × nodes[b].weight = 1 × 1，默认 'sum' 度量下总代价 = 2。
    // 绕行 40 个控制点不会把它变成 3。谁哪天让几何参与度量，这个 2 会先动。
    const distances = [a.prefab, b.prefab].map((prefab) => {
      resetIdCounters();
      const { holder, registry } = setup(prefab);
      const spawned = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', {
        def: prefab.id,
      });
      if (!spawned.ok || spawned.value === undefined) throw new Error('spawn 失败');
      const state = holder.getState();
      const yardId = spawned.value.nodes.find((id) => state.nodes[id]?.def === 'd:scene/yard');
      const atticId = spawned.value.nodes
        .filter((id) => state.nodes[id]?.def === 'd:scene/room')
        .at(-1);
      if (yardId === undefined || atticId === undefined) throw new Error('节点缺失');
      return dist(state.nodes, state.links, yardId, atticId);
    });
    expect(distances[0]).toBe(2);
    expect(distances[1]).toBe(2);
  });

  it('despawn 能把整张地图收回去，世界回到空——管线是可逆的', () => {
    const compiled = compileMap(campusMap());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const { holder, registry } = setup(compiled.prefab);
    const before = holder.getState();
    const spawned = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', {
      def: compiled.prefab.id,
    });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok || spawned.value === undefined) return;

    const despawned = registry.invoke<{ handle: PrefabHandle }, void>('prefab.despawn', {
      handle: spawned.value,
    });
    expect(despawned.ok, despawned.ok ? '' : `${despawned.code}: ${despawned.detail}`).toBe(true);

    const after = holder.getState();
    expect(Object.keys(after.nodes)).toEqual(Object.keys(before.nodes));
    expect(Object.keys(after.links)).toEqual(Object.keys(before.links));
  });

  it('未登记的场景类型会被引擎自己拒绝——校验器漏掉时仍有第二道闸', () => {
    const base = campusMap();
    const source: MapData = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === 'hall' ? { ...node, def: 'd:scene/nonexistent' } : node),
    };
    const compiled = compileMap(source);
    // 结构校验不查跨目录引用，所以这里仍然编译成功——这正是两层校验的分工。
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const { registry } = setup(compiled.prefab);
    const spawned = registry.invoke<{ def: string }, PrefabHandle>('prefab.spawn', {
      def: compiled.prefab.id,
    });
    expect(spawned.ok).toBe(false);
  });
});
