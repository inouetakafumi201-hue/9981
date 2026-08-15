/**
 * 开发板地图编辑内核的模拟操作用例测试。
 *
 * 目标：把「用户一次会做的连续动作」串成端到端用例，每一步断言结构合法性 +
 * 不变量，覆盖审计发现的真实坑位（height 不作为 floor、删除后 id 不撞、对称扇区
 * 重复边、选中残留、导出自洽、诊断点击聚焦）。
 */
import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  blankMap,
  deleteSelection,
  floorOf,
  makeLayerFloors,
  moveNode,
  nextId,
  sampleMap,
  samples,
  setNodeFloor,
} from './editor-state.js';
import { validateMapStructure } from '../ports/map-contracts.js';
import { serializeMapPublish } from '../editor/map-io.js';

const errors = (map: any): number => validateMapStructure(map).filter((d) => d.severity === 'error').length;

describe('开发板模拟操作：节点/连接/删除循环', () => {
  it('放置→拉边→拖动→改楼层→删除 全流程每步结构合法', () => {
    let map = blankMap('流程测试');
    expect(errors(map)).toBe(0);
    // 放置三个场景
    const a = addNode(map, { x: 0.1, y: 0.8 }, 0, 'large');
    const b = addNode(a, { x: 0.5, y: 0.5 }, 0, 'medium');
    const c = addNode(b, { x: 0.9, y: 0.1 }, 0, 'medium');
    expect(errors(c)).toBe(0);
    // 拖线：c→b、b→a
    map = addEdge(c, c.nodes[0]!.id, c.nodes[1]!.id);
    map = addEdge(map, map.nodes[1]!.id, map.nodes[2]!.id);
    expect(map.edges).toHaveLength(2);
    expect(errors(map)).toBe(0);
    // 拖动一个节点，曲线端点跟着走且仍吸附
    map = moveNode(map, map.nodes[0]!.id, { x: 0.2, y: 0.6 });
    const moved = map.nodes.find((n) => n.id === 'scene_1')!;
    expect(moved.at).toEqual({ x: 0.2, y: 0.6 });
    expect(errors(map)).toBe(0);
    // 改楼层到未登记的一层 → 自动登记
    map = setNodeFloor(map, map.nodes[1]!.id, 2);
    expect(map.nodes[1]!.floor).toBe(2);
    expect(map.floors).toContain(2);
    expect(errors(map)).toBe(0);
    // 删中间节点 → 其连接被连带清理
    const target = map.nodes[1]!.id;
    map = deleteSelection(map, `node:${target}`);
    expect(map.nodes.some((n) => n.id === target)).toBe(false);
    expect(map.edges.some((e) => e.a === target || e.b === target)).toBe(false);
    expect(errors(map)).toBe(0);
  });

  it('删除后新建，节点/放置 id 绝不撞名', () => {
    let map = sampleMap();
    const beforeNodes = map.nodes.length;
    map = deleteSelection(map, 'node:carriage');
    const added = addNode(map, { x: 0.5, y: 0.5 }, 0, 'medium');
    expect(added.nodes).toHaveLength(beforeNodes); // 1 删 + 1 增
    expect(new Set(added.nodes.map((n) => n.id)).size).toBe(added.nodes.length);
    expect(added.nodes.some((n) => n.id === 'scene_1')).toBe(true); // nextId 从 1 重新用起来
    // 放置 id 用 nextId，删除后也不会复用已存在的
    const withPlacement = { ...added, placements: [{ id: 'placement_1', at: added.nodes[0]!.id, def: 'x' }] as any[] };
    const after = { ...withPlacement, placements: [...withPlacement.placements, { id: nextId('placement', withPlacement.placements), at: added.nodes[1]!.id ?? added.nodes[0]!.id, def: 'y' }] as any[] };
    expect(new Set(after.placements.map((p: any) => p.id)).size).toBe(after.placements.length);
  });

  it('对称扇区：正向建后再反向建会被拒绝（不产生MAP_PARALLEL_EDGE）', () => {
    let map = sampleMap();
    map = addNode(map, { x: 0.4, y: 0.6 }, 0, 'medium');
    const n = map.nodes[map.nodes.length - 1]!;
    map = addEdge(map, map.nodes[0]!.id, n.id);
    const before = map.edges.length;
    const reversed = addEdge(map, n.id, map.nodes[0]!.id);
    expect(reversed).toBe(map); // 对称重复拒绝
    expect(reversed.edges.length).toBe(before);
  });

  it('addEdge 对不存在端点的调用返回原图（静默安全，不崩溃）', () => {
    const map = sampleMap();
    expect(addEdge(map, 'ghost', map.nodes[0]!.id)).toBe(map);
    expect(addEdge(map, map.nodes[0]!.id, 'ghost')).toBe(map);
  });
});

describe('开发板模拟操作：图层楼层映射', () => {
  it('height 是表现高度，不等同楼层：放置用 layerFloor 分配整数楼层', () => {
    const layerFloor = makeLayerFloors(['layer:ground', 'layer:roof']);
    let map = blankMap();
    // 地面层 → 楼层 0
    const ground = addNode(map, { x: 0.3, y: 0.7 }, floorOf(layerFloor, 'layer:ground', map.floors));
    expect(ground.nodes[0]!.floor).toBe(0);
    // 高架层 → 楼层 1；图层楼层未登记时先登记，再放置落到 1（而不是误灌 0）
    let image = { ...ground, floors: [0, 1] as number[] };
    const roof = addNode(image, { x: 0.7, y: 0.3 }, floorOf(layerFloor, 'layer:roof', image.floors));
    expect(roof.nodes[1]!.floor).toBe(1);
    expect(roof.floors).toEqual([0, 1]);
    expect(errors(roof)).toBe(0);
  });

  it('floorOf 对未知图层退回已声明楼层：优先 0，否则第一个已声明楼层', () => {
    const layerFloor = makeLayerFloors(['ground']);
    // 地图只有楼层 0 → 未知图层退回 0
    const blank = blankMap();
    expect(floorOf(layerFloor, 'nope', blank.floors)).toBe(0);
    // 地图不含楼层 0（floors [1,2]）→ 未知图层退回第一个已声明楼层 1，不产生明文 0 越界
    const map = { ...blankMap(), floors: [1, 2] as number[] };
    expect(floorOf(layerFloor, 'nope', map.floors)).toBe(1);
  });
});

describe('开发板模拟操作：样例地图与导出自洽', () => {
  it('samples() 返回可直接编辑的两张图，均结构合法', () => {
    const list = samples();
    expect(list.length).toBe(2);
    for (const map of list) expect(errors(map)).toBe(0);
    expect(list[0]!.id).not.toBe(list[1]!.id);
  });

  it('序列化导出包含 floors 且 layers 形状与节点楼层自洽，可再编译', () => {
    const map = sampleMap();
    const json = serializeMapPublish({ map, layers: [{ id: 'layer:ground', name: '地面层', height: 0 }, { id: 'layer:roof', name: '高架层', height: 1 }] });
    const parsed = JSON.parse(json) as any;
    // 不再丢 floors：导出的文件能通过结构校验（floors 与节点楼层一致）
    expect(parsed.floors).toEqual([0, 1]);
    const reparsed = { ...parsed, schemaVersion: '1.0' as const };
    expect(errors(reparsed)).toBe(0);
    // layers 保序、无 bounds
    expect(parsed.layers.length).toBe(2);
    expect(json).not.toContain('"bounds"');
  });
});
