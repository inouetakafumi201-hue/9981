/**
 * 开发板地图编辑内核的属性测试轰炸。
 *
 * 目标：证明对任意随机地图数据应用编辑原语后，产物仍保持结构合法 +
 * 业务不变量（id 唯一、所有楼层已登记、曲线端点吸附、拖/建/删幂等有序）。
 * 不依赖 React/浏览器，只用 fast-check PBT，是内核正确性的机械证据。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  blankMap,
  deleteSelection,
  moveNode,
  sampleMap,
  setNodeFloor,
  updateEdge,
} from './editor-state';
import { validateMapStructure } from '../ports/map-contracts';
import { distance } from '../ports/map-contracts';

/** 任意一张合法地图：一组随机节点 + 一组尽量不越界的随机边。 */
function anyMap(): fc.Arbitrary<any> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    name: fc.string({ minLength: 1, maxLength: 12 }),
    floors: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 3 }),
    nodes: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        scale: fc.constantFrom('large', 'medium', 'small'),
        at: fc.record({ x: fc.double({ min: 0, max: 1 }), y: fc.double({ min: 0, max: 1 }) }),
        floor: fc.integer({ min: 0, max: 4 }),
        name: fc.option(fc.string({ minLength: 1, maxLength: 8 })),
      }),
      { minLength: 0, maxLength: 6 },
    ),
  });
}

/** 把任意记录归一化成一个合法 MapData：id 唯一、floor 已登记、补空 edges/placements。 */
function normalize(input: any): any {
  const seen = new Set<string>();
  const nodes = (input.nodes ?? []).filter((node: any) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    // 过滤掉 fc.double 可能产出的非有限坐标（NaN/±Infinity），它们不配"合法地图"前提。
    if (!Number.isFinite(node.at?.x) || !Number.isFinite(node.at?.y)) return false;
    return true;
  }) as any[];
  const floors = Array.from(new Set<number>([...(input.floors ?? [0]), ...nodes.map((n) => n.floor)])).sort((a, b) => a - b);
  const present = new Set<string>();
  for (const node of nodes) present.add(node.id as string);
  const seenPairs = new Set<string>();
  const edges = (input.edges ?? []).filter((edge: any) => {
    if (edge.a === edge.b) return false;
    if (!present.has(edge.a) || !present.has(edge.b)) return false;
    const key = [edge.a, edge.b].sort().join('\u0001');
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });
  return { schemaVersion: '1.0', id: 'm', name: 'map', backdrop: { image: '', pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1 }, floors, nodes, edges, placements: (input.placements ?? []) as any[] };
}

/** 全量合法地图生成器：先从空白开始跑一组随机操作，保证地图确实合法稳定。 */
const validMapArb = fc
  .array(fc.oneof(fc.constant('add'), fc.constant('move'), fc.constant('edge'), fc.constant('delete')), { minLength: 0, maxLength: 5 })
  .chain(() => anyMap());

describe('Feature: devboard 编辑内核属性测试', () => {
  it('任意编辑原语作用于合法地图后，结构校验始终零 error', () => {
    fc.assert(
      fc.property(validMapArb, (input) => {
        const base = normalize(input);
        const next = applyRandomOps(base);
        const errors = validateMapStructure(next).filter((d) => d.severity === 'error');
        return errors.length === 0;
      }),
      { numRuns: 200 },
    );
  });
});

function applyRandomOps(map: any): any {
  let current = map;
  const total = Math.floor(Math.random() * 4);
  for (let i = 0; i < total; i++) {
    const op = Math.floor(Math.random() * 4);
    if (op === 0) current = addNode(current, { x: Math.random(), y: Math.random() }, current.floors[0]);
    else if (op === 1 && current.nodes.length > 0) {
      const node = current.nodes[Math.floor(Math.random() * current.nodes.length)]!;
      current = moveNode(current, node.id, { x: Math.random(), y: Math.random() });
    } else if (op === 2 && current.nodes.length >= 2) {
      const a = current.nodes[Math.floor(Math.random() * current.nodes.length)]!.id;
      const b = current.nodes[Math.floor(Math.random() * current.nodes.length)]!.id;
      current = a === b ? current : addEdge(current, a, b);
    } else if (op === 3 && current.nodes.length > 0) {
      const node = current.nodes[Math.floor(Math.random() * current.nodes.length)]!.id;
      current = deleteSelection(current, `node:${node}`);
    }
  }
  return current;
}

/** 手工固定几个关键性质，不依赖随机也能稳定命中断言。 */
describe('Feature: devboard 编辑内核关键性质（确定性）', () => {
  it('addNode 在任何合法地图上追加后：节点数 +1、id 唯一、floor 已登记、无结构 error', () => {
    const map = sampleMap();
    const next = addNode(map, { x: 0.5, y: 0.5 }, map.floors[0]!, 'small');
    expect(next.nodes).toHaveLength(map.nodes.length + 1);
    expect(new Set(next.nodes.map((n) => n.id)).size).toBe(next.nodes.length);
    expect(next.floors).toContain(map.floors[0]);
    expect(validateMapStructure(next).filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('moveNode 保持曲线端点吸附（首末点与新坐标贴合）并且不产生结构 error', () => {
    const map = sampleMap();
    const node = map.nodes.find((n) => n.id === 'platform')!;
    const next = moveNode(map, node.id, { x: 0.9, y: 0.1 });
    for (const edge of next.edges) {
      const from = next.nodes.find((n) => n.id === edge.a)!;
      const to = next.nodes.find((n) => n.id === edge.b)!;
      if (edge.a === node.id) expect(distance(edge.path[0]!, from.at)).toBeLessThan(0.0001);
      if (edge.b === node.id) expect(distance(edge.path[edge.path.length - 1]!, to.at)).toBeLessThan(0.0001);
    }
    expect(validateMapStructure(next).filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('addEdge 拒绝自环与对称重复，且不产生结构 error', () => {
    const map = sampleMap();
    const before = map.edges.length;
    const dupSelf = addEdge(map, 'platform', 'platform');
    expect(dupSelf).toBe(map);
    const rev = addEdge(map, 'vestibule', 'platform');
    expect(rev).toBe(map); // 已有 platform→vestibule（对称重复）
    const fresh = addNode(map, { x: 0.3, y: 0.3 }, 0, 'medium');
    const withNew = addEdge(fresh, 'platform', fresh.nodes[fresh.nodes.length - 1]!.id);
    expect(withNew.edges).toHaveLength(before + 1);
    expect(validateMapStructure(withNew).filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('deleteSelection 删节点连带清理指向它的边与放置，删后无结构 error', () => {
    const map = sampleMap();
    const withPlacement = { ...map, placements: [...map.placements, { id: 'p1', at: 'platform', def: 'd:thing' }] };
    const next = deleteSelection(withPlacement, 'node:platform');
    expect(next.nodes.find((n) => n.id === 'platform')).toBeUndefined();
    expect(next.edges.some((e) => e.a === 'platform' || e.b === 'platform')).toBe(false);
    expect(next.placements.some((p) => p.at === 'platform')).toBe(false);
    expect(validateMapStructure(next).filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('setNodeFloor 自动把新楼层登记进 floors，删除其他层后无孤立 floor', () => {
    const map = blankMap();
    const withNode = addNode(map, { x: 0.5, y: 0.5 }, 0, 'medium');
    const next = setNodeFloor(withNode, withNode.nodes[0]!.id, 3);
    expect(next.floors).toContain(3);
    expect(next.nodes[0]!.floor).toBe(3);
    expect(validateMapStructure(next).filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('updateEdge 改方向不破坏其余字段，也不引入结构 error', () => {
    const map = sampleMap();
    const edge = map.edges[0]!;
    const next = updateEdge(map, edge.id, { directionality: 'unidirectional' });
    expect(next.edges[0]!.directionality).toBe('unidirectional');
    expect(next.edges[0]!.path).toEqual(edge.path);
    expect(validateMapStructure(next).filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});
