import type { Directionality, MapData, MapEdge, MapNode, SceneScale, Vec2 } from '../ports/map-contracts.js';

export type EditorMode = 'select' | 'node' | 'edge' | 'sample' | 'playtest';

export const nodeScales: readonly SceneScale[] = ['large', 'medium', 'small'];
export const directions: readonly Directionality[] = ['bidirectional', 'unidirectional', 'one-way-up', 'one-way-down'];

export function clampPoint(point: Vec2): Vec2 {
  return { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
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
