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
  bendEdgePath,
  clearPhysicalObstruction,
  clearVisualObstruction,
  deleteSelection,
  floorOf,
  makeLayerFloors,
  moveNode,
  nextId,
  sampleMap,
  samples,
  setNodeFloor,
  setPhysicalObstruction,
  setSemanticAnchor,
  setTransitionWindow,
  setVisualObstruction,
  simplifyEdgePath,
  snapEdgeEndpoint,
  straightenEdgePath,
  translateObstruction,
} from './editor-state.js';
import { mergeDeleteKnot, moveKnot, moveTransitionWindow, rotateObstruction } from './editor-state.js';
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

describe('开发板模拟操作：拉边描线 + 样条塑形（§九）', () => {
  it('描线采样经 RDP 简化：首尾端点恒保留、点被削减、仍结构合法', () => {
    const map = sampleMap();
    const from = map.nodes[0]!.at;
    const to = map.nodes[1]!.at;
    // 模拟一段带噪声的连续采样（起点→终点之间来回抖动）
    const samples = [from, { x: 0.2, y: 0.6 }, { x: 0.25, y: 0.62 }, { x: 0.3, y: 0.6 }, { x: 0.35, y: 0.58 }, { x: 0.38, y: 0.56 }, to];
    const simplified = simplifyEdgePath(samples, 0.01);
    expect(simplified[0]).toEqual(from);
    expect(simplified[simplified.length - 1]).toEqual(to);
    expect(simplified.length).toBeLessThanOrEqual(samples.length);
  });

  it('松手吸附：落在另一节点吸附半径内命中该节点，否则 null', () => {
    const map = sampleMap();
    const vestibule = map.nodes.find((n) => n.id === 'vestibule')!;
    const inside = snapEdgeEndpoint(map.nodes, { x: vestibule.at.x + 0.01, y: vestibule.at.y + 0.01 }, 0.06);
    expect(inside?.id).toBe('vestibule');
    const far = snapEdgeEndpoint(map.nodes, { x: 0.05, y: 0.9 }, 0.06);
    expect(far).toBeNull();
  });

  it('拉弯即追加：bendEdgePath 在落点插入隐藏样条点、首尾仍吸附节点', () => {
    let map = sampleMap();
    const edge = map.edges[0]!;
    const before = edge.path.length;
    map = bendEdgePath(map, edge.id, { x: 0.3, y: 0.45 });
    const after = map.edges[0]!;
    expect(after.path.length).toBe(before + 1);
    // 首尾仍吸附原节点
    const a = map.nodes.find((n) => n.id === after.a)!;
    const b = map.nodes.find((n) => n.id === after.b)!;
    expect(after.path[0]).toEqual(a.at);
    expect(after.path[after.path.length - 1]).toEqual(b.at);
    expect(errors(map)).toBe(0);
  });

  it('双击拉直：straightenEdgePath 清空全部隐藏样条点、瞬间绷直为直线', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = bendEdgePath(map, edgeId, { x: 0.3, y: 0.45 });
    map = bendEdgePath(map, edgeId, { x: 0.33, y: 0.4 });
    expect(map.edges[0]!.path.length).toBeGreaterThan(2);
    map = straightenEdgePath(map, edgeId);
    expect(map.edges[0]!.path.length).toBe(2);
    expect(errors(map)).toBe(0);
  });

  it('折点调整 [B]：moveKnot 移动中段折点、首末恒吸附；折点删除 [D] 拍直', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = bendEdgePath(map, edgeId, { x: 0.3, y: 0.45 });
    expect(map.edges[0]!.path.length).toBeGreaterThan(2);
    // [B] moveKnot：选中边中段折点拖走
    const mid = Math.floor(map.edges[0]!.path.length / 2);
    map = moveKnot(map, edgeId, mid, { x: 0.42, y: 0.3 });
    const moved = map.edges[0]!.path[mid]!;
    expect(moved.x).toBeCloseTo(0.42, 6);
    expect(moved.y).toBeCloseTo(0.3, 6);
    // 首尾仍精确吸附节点
    const a = map.nodes.find((n) => n.id === map.edges[0]!.a)!;
    const b = map.nodes.find((n) => n.id === map.edges[0]!.b)!;
    expect(map.edges[0]!.path[0]).toEqual(a.at);
    expect(map.edges[0]!.path[map.edges[0]!.path.length - 1]).toEqual(b.at);
    expect(errors(map)).toBe(0);
    // [D] mergeDeleteKnot：删一个折点路径 -1
    const before = map.edges[0]!.path.length;
    map = mergeDeleteKnot(map, edgeId, 1);
    expect(map.edges[0]!.path.length).toBe(before - 1);
    expect(errors(map)).toBe(0);
  });

  it('遮挡框旋转：rotateObstruction 绕框中心旋转、shape 保持 box、结构合法', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setVisualObstruction(map, edgeId);
    const before = map.edges[0]!.visualObstruction!.bounds!;
    const a = map.nodes.find((n) => n.id === map.edges[0]!.a)!;
    const b = map.nodes.find((n) => n.id === map.edges[0]!.b)!;
    const mid = { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 };
    map = rotateObstruction(map, edgeId, 'visual', 90);
    const after = map.edges[0]!.visualObstruction!;
    expect(after.shape).toBe('box');
    expect(after.bounds).toHaveLength(4);
    // 中心不动：旋转前后外接中点不漂移（框中心=边中点）
    const midAfter = {
      x: (after.bounds![0]!.x + after.bounds![2]!.x) / 2,
      y: (after.bounds![0]!.y + after.bounds![2]!.y) / 2,
    };
    expect(midAfter.x).toBeCloseTo(mid.x, 5);
    expect(midAfter.y).toBeCloseTo(mid.y, 5);
    // 面积守恒
    const area = (rb: readonly { x: number; y: number }[]) =>
      Math.hypot(rb[1]!.x - rb[0]!.x, rb[1]!.y - rb[0]!.y) * Math.hypot(rb[3]!.x - rb[0]!.x, rb[3]!.y - rb[0]!.y);
    expect(area(after.bounds!)).toBeCloseTo(area(before), 6);
    expect(errors(map)).toBe(0);
  });

  it('过渡窗口独立拖拽：moveTransitionWindow 移动窗口位置、不吸附节点', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setTransitionWindow(map, edgeId, true);
    map = moveTransitionWindow(map, edgeId, { x: 0.63, y: 0.21 });
    const w = map.edges[0]!.transitionWindow!;
    expect(w.control[0]!.x).toBeCloseTo(0.63, 6);
    expect(w.control[0]!.y).toBeCloseTo(0.21, 6);
    // 独立：不吸附到任何节点（落点离所有节点足够远）
    const nearest = map.nodes.reduce((best, n) =>
      (Math.hypot(n.at.x - 0.63, n.at.y - 0.21) < Math.hypot(best.at.x - 0.63, best.at.y - 0.21) ? n : best),
    map.nodes[0]!);
    expect(Math.hypot(nearest.at.x - 0.63, nearest.at.y - 0.21)).toBeGreaterThan(0.05);
    expect(errors(map)).toBe(0);
  });

  it('遮挡框整体平移：translateObstruction 整体拖移、顶点同移、clamp、结构合法', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setVisualObstruction(map, edgeId);
    const before = map.edges[0]!.visualObstruction!.bounds!;
    map = translateObstruction(map, edgeId, 'visual', 0.05, -0.03);
    const after = map.edges[0]!.visualObstruction!.bounds!;
    expect(after).toHaveLength(4);
    expect(after[0]!.x - before[0]!.x).toBeCloseTo(0.05, 6);
    expect(after[0]!.y - before[0]!.y).toBeCloseTo(-0.03, 6);
    // 同移：顶点间距不变（整体平移，不逐控制点变形）
    expect(after[1]!.x - after[0]!.x).toBeCloseTo(before[1]!.x - before[0]!.x, 6);
    expect(after[3]!.y - after[0]!.y).toBeCloseTo(before[3]!.y - before[0]!.y, 6);
    expect(errors(map)).toBe(0);
  });
});

describe('开发板模拟操作：遮挡/锚点/过渡窗口（§八图元）', () => {
  it('视觉遮挡框：在边上落 box bounds、可清理、结构合法', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setVisualObstruction(map, edgeId);
    expect(map.edges[0]!.visualObstruction?.shape).toBe('box');
    expect(map.edges[0]!.visualObstruction?.bounds).toHaveLength(4);
    expect(errors(map)).toBe(0);
    map = clearVisualObstruction(map, edgeId);
    expect(map.edges[0]!.visualObstruction).toBeUndefined();
    expect(errors(map)).toBe(0);
  });

  it('物理遮挡框：同样可设可清，颜色语义不混', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setPhysicalObstruction(map, edgeId);
    expect(map.edges[0]!.physicalObstruction?.shape).toBe('box');
    expect(map.edges[0]!.visualObstruction).toBeUndefined();
    expect(errors(map)).toBe(0);
    map = clearPhysicalObstruction(map, edgeId);
    expect(map.edges[0]!.physicalObstruction).toBeUndefined();
  });

  it('语义锚点：高/低/中性三选一写在 semanticAnchor', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setSemanticAnchor(map, edgeId, 'high');
    expect(map.edges[0]!.semanticAnchor).toBe('high');
    expect(errors(map)).toBe(0);
    map = setSemanticAnchor(map, edgeId, 'low');
    expect(map.edges[0]!.semanticAnchor).toBe('low');
    expect(errors(map)).toBe(0);
  });

  it('过渡窗口：开→有控制点且结构合法；关→清空；单向边开则 warning 但不阻断', () => {
    let map = sampleMap();
    const edgeId = map.edges[0]!.id;
    map = setTransitionWindow(map, edgeId, true);
    expect(map.edges[0]!.transitionWindow?.control).toHaveLength(1);
    expect(errors(map)).toBe(0);
    map = setTransitionWindow(map, edgeId, false);
    expect(map.edges[0]!.transitionWindow).toBeUndefined();
    // 单向边带窗口 → 校验器给 warning（不是 error），保持可导出
    const oneWay = map.edges.find((e) => e.directionality === 'one-way-up')!;
    map = setTransitionWindow(map, oneWay.id, true);
    const diag = validateMapStructure(map);
    expect(diag.some((d) => d.code === 'MAP_TRANSITION_WINDOW_ON_UNIDIRECTIONAL' && d.severity === 'warning')).toBe(true);
    expect(diag.filter((d) => d.severity === 'error')).toHaveLength(0);
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
