import type { Directionality, MapData, MapEdge, MapNode, ObstructionSpec, SceneScale, TransitionWindowPoints, Vec2 } from '../ports/map-contracts';
import { findSnapTarget, insertControlPoint, simplifyPath } from '../ports/map-contracts';

export type EditorMode = 'select' | 'node' | 'edge' | 'sample' | 'playtest';

export const nodeScales: readonly SceneScale[] = ['large', 'medium', 'small'];
export const directions: readonly Directionality[] = ['bidirectional', 'unidirectional', 'one-way-up', 'one-way-down'];

export function clampPoint(point: Vec2): Vec2 {
  // Math.max(0, Math.min(1, NaN)) 会得到 NaN，而 NaN 坐标会让校验报 MAP_COORD_OUT_OF_RANGE
  // 且随拖拽持续蔓延（PBT 反例：editor-state.property.test.ts "任意编辑原语…零 error"）。
  // 属性轰炸在任意合法地图上跑随机操作，坐标必须是有限数才配得上"合法地图"前提。
  const x = Number.isFinite(point.x) ? point.x : 0;
  const y = Number.isFinite(point.y) ? point.y : 0;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** 内置的可切换、可编辑地图样例。 */
export function samples(): readonly MapData[] {
  return [sampleMap(), { ...sampleMap(), id: 'night_platform', name: '夜班月台' }];
}

/** 地图各层对应的楼层：`layer.<name>` → 整数楼层。图层 height 是表现高度，不等同于楼层。 */
export interface LayerFloorMap {
  [layerId: string]: { floor: number };
}
export function makeLayerFloors(layerIds: readonly string[]): LayerFloorMap {
  const result: LayerFloorMap = {};
  layerIds.forEach((id, index) => { result[id] = { floor: index }; });
  return result;
}

export function floorOf(layerFloor: LayerFloorMap, layerId: string | null | undefined, floors: readonly number[]): number {
  const mapped = layerId ? layerFloor[layerId]?.floor : undefined;
  return mapped !== undefined && floors.includes(mapped) ? mapped : (floors.includes(0) ? 0 : floors[0] ?? 0);
}

export function blankMap(name = '未命名地图'): MapData {
  return {
    schemaVersion: '1.0',
    id: 'untitled_map',
    name,
    backdrop: { image: 'local-preview', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 },
    floors: [0],
    nodes: [],
    edges: [],
    placements: [],
  };
}

export function sampleMap(): MapData {
  return {
    schemaVersion: '1.0',
    id: 'sleeper_carriage',
    name: '卧铺车厢',
    backdrop: { image: 'sleeper-preview', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 },
    floors: [0, 1],
    nodes: [
      { id: 'platform', def: 'd:scene/yard', scale: 'large', at: { x: 0.16, y: 0.68 }, floor: 0, name: '月台' },
      { id: 'vestibule', def: 'd:scene/room', scale: 'medium', at: { x: 0.41, y: 0.54 }, floor: 0, name: '连接廊' },
      { id: 'carriage', def: 'd:scene/room', scale: 'medium', at: { x: 0.66, y: 0.46 }, floor: 0, name: '卧铺车厢' },
      { id: 'roof', def: 'd:scene/room', scale: 'small', at: { x: 0.82, y: 0.22 }, floor: 1, name: '车顶通道' },
    ],
    edges: [
      { id: 'link_platform', def: 'd:transition/door', a: 'platform', b: 'vestibule', directionality: 'bidirectional', path: [{ x: 0.16, y: 0.68 }, { x: 0.41, y: 0.54 }] },
      { id: 'link_carriage', def: 'd:transition/door', a: 'vestibule', b: 'carriage', directionality: 'bidirectional', path: [{ x: 0.41, y: 0.54 }, { x: 0.66, y: 0.46 }] },
      { id: 'link_roof', def: 'd:transition/door', a: 'carriage', b: 'roof', directionality: 'one-way-up', path: [{ x: 0.66, y: 0.46 }, { x: 0.82, y: 0.22 }] },
    ],
    placements: [],
  };
}

export function nextId(prefix: string, taken: readonly { readonly id: string }[]): string {
  let i = 1;
  while (taken.some((item) => item.id === `${prefix}_${i}`)) i += 1;
  return `${prefix}_${i}`;
}

export function addNode(map: MapData, at: Vec2, floor: number, scale: SceneScale = 'medium'): MapData {
  const id = nextId('scene', map.nodes);
  const node: MapNode = { id, def: 'd:scene/room', scale, at: clampPoint(at), floor, name: `场景 ${map.nodes.length + 1}` };
  return { ...map, floors: map.floors.includes(floor) ? map.floors : [...map.floors, floor].sort((a, b) => a - b), nodes: [...map.nodes, node] };
}

/** 设置某节点的楼层，并确保该楼层已登记进 map.floors（否则会产生 MAP_UNDECLARED_FLOOR）。 */
export function setNodeFloor(map: MapData, nodeId: string, floor: number): MapData {
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.floor === floor) return map;
  const floors = map.floors.includes(floor) ? map.floors : [...map.floors, floor].sort((a, b) => a - b);
  return { ...map, floors, nodes: map.nodes.map((candidate) => candidate.id === nodeId ? { ...candidate, floor } : candidate) };
}

export function moveNode(map: MapData, nodeId: string, at: Vec2): MapData {
  const point = clampPoint(at);
  const nodes = map.nodes.map((node) => node.id === nodeId ? { ...node, at: point } : node);
  const edges = map.edges.map((edge) => {
    const path = edge.path.map((pathPoint, index) => {
      if (index === 0 && edge.a === nodeId) return point;
      if (index === edge.path.length - 1 && edge.b === nodeId) return point;
      return pathPoint;
    });
    return { ...edge, path };
  });
  return { ...map, nodes, edges };
}

export function addEdge(map: MapData, a: string, b: string): MapData {
  if (a === b) return map;
  const source = map.nodes.find((node) => node.id === a);
  const target = map.nodes.find((node) => node.id === b);
  if (!source || !target) return map;
  const dup = map.edges.some((edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
  if (dup) return map;
  const edge: MapEdge = { id: nextId('link', map.edges), def: 'd:transition/door', a, b, directionality: 'bidirectional', path: [source.at, target.at] };
  return { ...map, edges: [...map.edges, edge] };
}

export function deleteSelection(map: MapData, selection: string | null): MapData {
  if (!selection) return map;
  if (selection.startsWith('node:')) {
    const id = selection.slice(5);
    return { ...map, nodes: map.nodes.filter((node) => node.id !== id), edges: map.edges.filter((edge) => edge.a !== id && edge.b !== id), placements: map.placements.filter((placement) => placement.at !== id) };
  }
  if (selection.startsWith('edge:')) return { ...map, edges: map.edges.filter((edge) => edge.id !== selection.slice(5)) };
  return map;
}

export function updateNode(map: MapData, id: string, patch: Partial<MapNode>): MapData {
  return { ...map, nodes: map.nodes.map((node) => node.id === id ? { ...node, ...patch, at: patch.at ? clampPoint(patch.at) : node.at } : node) };
}

export function updateEdge(map: MapData, id: string, patch: Partial<MapEdge>): MapData {
  return { ...map, edges: map.edges.map((edge) => edge.id === id ? { ...edge, ...patch } : edge) };
}

/* ── 拉边描线（§九 拉边流程）────────────────────────────────────────── */
/**
 * 描线中的一次拖拽吸附判定。只有松手点吸附，中间采样点永不吸附
 * （§九：否则曲线绕过节点旁时会被抢走）。返回命中的节点，否则 null。
 */
export function snapEdgeEndpoint(
  candidates: readonly MapNode[],
  point: Vec2,
  snapRadius: number,
): MapNode | null {
  return findSnapTarget(candidates, point, snapRadius);
}

/** RDP 简化拉边阶段采到的原始点，压成少量折点（首尾恒保留）。 */
export function simplifyEdgePath(points: readonly Vec2[], epsilon: number): readonly Vec2[] {
  return simplifyPath(points, epsilon);
}

/* ── 样条塑形（§九 拉线后的塑形：Catmull-Rom 非贝塞尔）───────────────── */
/** 拉弯即追加：在 path 上鼠标落点追加一个隐藏样条点（松手定型，无上限）。 */
export function bendEdgePath(map: MapData, edgeId: string, point: Vec2): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  const path = insertControlPoint(edge.path, point);
  return { ...map, edges: map.edges.map((e) => e.id === edgeId ? { ...e, path } : e) };
}

/** 双击线段拉直：清空该线段内全部隐藏样条点，瞬间绷直为直线（唯一重塑入口）。 */
export function straightenEdgePath(map: MapData, edgeId: string): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  const from = edge.path[0];
  const to = edge.path[edge.path.length - 1];
  if (!from || !to) return map;
  return { ...map, edges: map.edges.map((e) => e.id === edgeId ? { ...e, path: [from, to] } : e) };
}

/* ── 遮挡 / 锚点 / 过渡窗口（§八 图元穷举，落在既有 MapEdge 字段）───── */
/**
 * 在边中点上方放置一个 box 遮挡框（视觉黄 / 物理红）。框中心取边中点，边长取归一化固定值，
 * 自带 shape + 半透明渲染。bounds 用归一化坐标。
 */
function edgeObstruction(map: MapData, edgeId: string, boxSize: number): ObstructionSpec | undefined {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return undefined;
  const from = edge.path[0];
  const to = edge.path[edge.path.length - 1];
  if (!from || !to) return undefined;
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const half = boxSize / 2;
  const bounds: Vec2[] = [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
  return { shape: 'box', bounds };
}

/** 在选中边上追加/更新一个视觉遮挡框（黄）。 */
export function setVisualObstruction(map: MapData, edgeId: string, boxSize = 0.16): MapData {
  const spec = edgeObstruction(map, edgeId, boxSize);
  if (!spec) return map;
  return updateEdge(map, edgeId, { visualObstruction: spec });
}

/** 在选中边上追加/更新一个物理遮挡框（红，不可通行）。 */
export function setPhysicalObstruction(map: MapData, edgeId: string, boxSize = 0.16): MapData {
  const spec = edgeObstruction(map, edgeId, boxSize);
  if (!spec) return map;
  return updateEdge(map, edgeId, { physicalObstruction: spec });
}

/** 移除选中边上的视觉遮挡框。 */
export function clearVisualObstruction(map: MapData, edgeId: string): MapData {
  return updateEdge(map, edgeId, { visualObstruction: undefined });
}

/** 移除选中边上的物理遮挡框。 */
export function clearPhysicalObstruction(map: MapData, edgeId: string): MapData {
  return updateEdge(map, edgeId, { physicalObstruction: undefined });
}

/** 给选中边打语义锚点（高地 / 洼地 / 中性），框可视化在画布由 edges 渲染。 */
export function setSemanticAnchor(map: MapData, edgeId: string, anchor: 'high' | 'low' | 'neutral'): MapData {
  return updateEdge(map, edgeId, { semanticAnchor: anchor });
}

/** 给选中边追加/清空一个过渡窗口（非节点悬浮组件，落在 TransitionWindowPoints）。 */
export function setTransitionWindow(map: MapData, edgeId: string, enabled: boolean): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  const from = edge.path[0];
  const to = edge.path[edge.path.length - 1];
  if (!from || !to) return map;
  const control: TransitionWindowPoints = from
    ? { control: [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }] }
    : { control: [] };
  return updateEdge(map, edgeId, enabled ? { transitionWindow: control } : { transitionWindow: undefined });
}

/* ── 样条塑形 [B] 折点调整 / [D] 折点删除（§九 三态合一最小动作集）────────── */
/**
 * [B] 折点调整：移动 `path[pathIndex]` 坐标，左右连线跟随（Catmull-Rom 重采样）。
 * 首末折点恒吸附节点中心（`clampPoint`），中段折点可自由移动。
 */
export function moveKnot(map: MapData, edgeId: string, pathIndex: number, to: Vec2): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  if (pathIndex <= 0 || pathIndex >= edge.path.length - 1) return map; // 首末由节点吸附，不直接改
  const point = clampPoint(to);
  const path = edge.path.map((p, i) => (i === pathIndex ? point : p));
  return { ...map, edges: map.edges.map((e) => e.id === edgeId ? { ...e, path } : e) };
}

/**
 * [D] 折点删除：移除 `path[pathIndex]`，前/后折点直接连成**绝对直线**（拍直）。
 * 因为重连是新建线段、隐藏样条点天然为空，这是"安全降级"——避免幽灵曲线。
 */
export function deleteKnot(map: MapData, edgeId: string, pathIndex: number): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  if (pathIndex <= 0 || pathIndex >= edge.path.length - 1) return map; // 首末不可删
  const path = edge.path.filter((_, i) => i !== pathIndex);
  return { ...map, edges: map.edges.map((e) => e.id === edgeId ? { ...e, path } : e) };
}

/**
 * [D] 吸附删除：折点拖至邻折点时触发"融合删除"，删点即拍直两侧。
 * 与 `deleteKnot` 同语义（删点后前/后直接连成直线），供 UI 在吸附提示后调用。
 */
export function mergeDeleteKnot(map: MapData, edgeId: string, pathIndex: number): MapData {
  return deleteKnot(map, edgeId, pathIndex);
}

/**
 * [C] 拉弯即追加（Fire-and-Forget）：在鼠标落点追加一个隐藏样条点进该线段。
 * 拖多少次塞多少、无上限；**不调用 simplifyPath**（拉弯后点不再被简化）。
 */
export function pushKnot(map: MapData, edgeId: string, point: Vec2): MapData {
  return bendEdgePath(map, edgeId, point);
}

/**
 * [C] 双击拉直：清空该线段内全部隐藏样条点，瞬间绷直回直线（唯一重塑入口）。
 */
export function straightenKnots(map: MapData, edgeId: string): MapData {
  return straightenEdgePath(map, edgeId);
}

/* ── 遮挡框旋转（§八 涂鸦式交互：滚轮 10°/格）────────────────────────────── */
/** 绕框中心旋转 bounds 顶点任意角度；`shape` 保持 'box'。 */
export function rotateObstruction(map: MapData, edgeId: string, which: 'visual' | 'physical', degrees: number): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  const spec = which === 'visual' ? edge.visualObstruction : edge.physicalObstruction;
  if (!spec || !spec.bounds || spec.bounds.length < 4) return map;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // 框中心 = bounds 顶点均值
  let cx = 0;
  let cy = 0;
  for (const p of spec.bounds) { cx += p.x; cy += p.y; }
  cx /= spec.bounds.length;
  cy /= spec.bounds.length;
  const bounds = spec.bounds.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: clampPoint({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }).x, y: clampPoint({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }).y };
  });
  const next: ObstructionSpec = { ...spec, bounds };
  return updateEdge(map, edgeId, which === 'visual' ? { visualObstruction: next } : { physicalObstruction: next });
}

/** 遮挡框整体平移：拖拽 delta 归一化位移，全部顶点同移（涂鸦交互：框整体拖动，不逐控制点变形）。 */
export function translateObstruction(map: MapData, edgeId: string, which: 'visual' | 'physical', dx: number, dy: number): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  const spec = which === 'visual' ? edge.visualObstruction : edge.physicalObstruction;
  if (!spec || !spec.bounds) return map;
  const bounds = spec.bounds.map((p) => clampPoint({ x: p.x + dx, y: p.y + dy }));
  const next: ObstructionSpec = { ...spec, bounds };
  return updateEdge(map, edgeId, which === 'visual' ? { visualObstruction: next } : { physicalObstruction: next });
}

/* ── 过渡窗口独立拖拽（§八：不吸附节点，独立拖到任意位置）────────────────── */
/** 把过渡窗口移动到任意位置（不吸附节点）。 */
export function moveTransitionWindow(map: MapData, edgeId: string, to: Vec2): MapData {
  const edge = map.edges.find((e) => e.id === edgeId);
  if (!edge) return map;
  const point = clampPoint(to);
  const control: TransitionWindowPoints = { control: [point] };
  return updateEdge(map, edgeId, { transitionWindow: control });
}
