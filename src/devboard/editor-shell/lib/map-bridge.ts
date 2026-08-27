'use client'
/* =========================================================================
   editor-shell MapDoc ⇄ 游戏 canonical MapData 转化桥。

   editor-shell 自建 MapDoc（map-types.ts）与 `src/play/map` 的 CanonicalMapData
   是两套独立形状：字段名错位（from/to vs a/b、materialId+sceneId+x+y vs at/def）
   且编辑器缺游戏契约必需的 backdrop / def。本文件是他们间的唯一映射点——
   editor-shell 侧经 `ports/map-contracts.ts`（src/devboard/ports）消费游戏契约，
   不做游戏契约的内部改写。

   导出（editorDocToCanonical）：把编辑器编辑态桥成 canonical v2，喂给
   `createLoadedMatch` / `compileMap` / `validateMapStructure`。
   导入（canonicalToEditorDoc）：把 `parseMapData` 的产物桥回 MapDoc，让游戏中
   已验证的地图能进编辑器继续编辑。
   ========================================================================= */

import { WORLD, type MapDoc, type Layer, type SceneNode, type Edge, type BuildingGroup, type BuildingFloor } from './map-types'
import { uid } from './editor-store'
import type {
  CanonicalMapData,
  CanonicalMapNode,
  MapLayer,
  MapEdge,
  MapPlacement,
  BuildingGroup as CanonicalBuildingGroup,
  SceneScale,
  Directionality,
} from '../../ports/map-contracts'

/** 世界坐标(0..WORLD) → 归一化坐标(0..1)。 */
function nx(v: number): number {
  return +(v / WORLD.w).toFixed(4)
}
function ny(v: number): number {
  return +(v / WORLD.h).toFixed(4)
}
/** 归一化坐标 → 世界坐标。 */
function wx(v: number): number {
  return Math.round(v * WORLD.w)
}
function wy(v: number): number {
  return Math.round(v * WORLD.h)
}

/** canonical 节点/放置的 def 缺省：按尺度给占位 scene def。 */
function nodeDefOf(scale: SceneScale): string {
  return `d:scene/${scale}`
}
const DEFAULT_EDGE_DEF = 'd:link/path'

/** 顶层缺省底图：transparent dataURL（1×1）。任何地图都必须有 backdrop。 */
export const TRANSPARENT_BACKDROP = {
  image:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  pixelWidth: 1,
  pixelHeight: 1,
  tileRows: 1,
  tileCols: 1,
}

function layerToCanonical(layer: Layer): MapLayer {
  return {
    id: layer.id,
    ...(layer.name !== undefined ? { name: layer.name } : {}),
    ...(layer.height !== undefined ? { height: layer.height } : {}),
    ...(layer.backdrop !== undefined
      ? {
          backdrop: {
            image: layer.backdrop.image,
            pixelWidth: layer.backdrop.pixelWidth,
            pixelHeight: layer.backdrop.pixelHeight,
          },
        }
      : {}),
    ...(layer.transform !== undefined
      ? {
          transform: {
            scaleX: layer.transform.scaleX,
            scaleY: layer.transform.scaleY,
            tx: layer.transform.tx,
            ty: layer.transform.ty,
          },
        }
      : {}),
  }
}

/** 收集所有图层的 backdrop —— 优先取第一个有图层的，否则用透明占位。 */
function backdropOf(doc: MapDoc): typeof TRANSPARENT_BACKDROP {
  const first = doc.layers.find((l) => l.backdrop)
  if (first?.backdrop) {
    return {
      image: first.backdrop.image,
      pixelWidth: first.backdrop.pixelWidth,
      pixelHeight: first.backdrop.pixelHeight,
      tileRows: 1,
      tileCols: 1,
    }
  }
  return TRANSPARENT_BACKDROP
}

/** 把一次地图级导出聚合成 CanonicalMapData。 */
export function editorDocToCanonical(doc: MapDoc): CanonicalMapData {
  const nodes: CanonicalMapNode[] = doc.sceneNodes.map((n) => {
    const node: CanonicalMapNode = {
      id: n.id,
      def: n.def ?? nodeDefOf(n.scale),
      scale: n.scale,
      at: { x: nx(n.at.x), y: ny(n.at.y) },
      layerId: n.layerId,
      ...(n.parent !== undefined ? { parent: n.parent } : {}),
      ...(n.name !== undefined ? { name: n.name } : {}),
    }
    return node
  })

  const edges: MapEdge[] = doc.edges.map((e) => {
    const edge: MapEdge = {
      id: e.id,
      def: e.def ?? DEFAULT_EDGE_DEF,
      a: e.from,
      b: e.to,
      directionality: toDirectionality(e),
      path: e.points.map((p) => ({ x: nx(p.x), y: ny(p.y) })),
      ...(e.semanticAnchor !== undefined
        ? { semanticAnchor: (e.semanticAnchor === 'highland' ? 'high' : e.semanticAnchor === 'lowland' ? 'low' : 'neutral') as 'high' | 'low' | 'neutral' }
        : {}),
    }
    return edge
  })

  const placements: MapPlacement[] = doc.placements.map((p) => ({
    id: p.id,
    at: p.sceneId,
    def: p.materialId,
  }))

  const buildingGroups: CanonicalBuildingGroup[] = (doc.buildingGroups ?? []).map((group) => ({
    id: group.id,
    frame: { x: nx(group.frame.x), y: ny(group.frame.y), width: nx(group.frame.width), height: ny(group.frame.height) },
    shell: group.shell,
    floors: group.floors.map((floor) => ({
      id: floor.id, ordinal: floor.ordinal, height: floor.height,
      nodes: [...floor.nodes],
      ...(floor.image !== undefined ? { image: floor.image } : {}),
      ...(floor.frame !== undefined ? { frame: { x: nx(floor.frame.x), y: ny(floor.frame.y), width: nx(floor.frame.width), height: ny(floor.frame.height) } } : {}),
    })),
    portals: group.portals.map((portal) => ({ ...portal })),
  }))

  return {
    schemaVersion: '2.0',
    id: doc.id,
    name: doc.name,
    backdrop: backdropOf(doc),
    layers: doc.layers.map(layerToCanonical),
    nodes,
    edges,
    placements,
    ...(buildingGroups.length ? { buildingGroups } : {}),
  }
}

/** 编辑器方向性 → canonical Directionality。 */
function toDirectionality(e: Pick<Edge, 'directionality'>): Directionality {
  return e.directionality as Directionality
}

/** canonical Directionality → 编辑器方向性。 */
function fromDirectionality(d: Directionality): Edge['directionality'] {
  return d as Edge['directionality']
}

function canonicalLayerToEditor(layer: MapLayer, fallbackHeight?: number): Layer {
  const out: Layer = {
    id: layer.id,
    name: layer.name ?? '图层',
    ...(layer.height !== undefined
      ? { height: layer.height }
      : fallbackHeight !== undefined
        ? { height: fallbackHeight }
        : {}),
    ...(layer.backdrop !== undefined ? { backdrop: layer.backdrop } : {}),
    ...(layer.transform !== undefined ? { transform: layer.transform } : {}),
  }
  return out
}

/** 把 canonical MapData 桥回编辑器 MapDoc（导入 / 继续编辑用）。 */
export function canonicalToEditorDoc(canonical: CanonicalMapData): MapDoc {
  const layers: Layer[] = canonical.layers.map((l, i) => canonicalLayerToEditor(l, i))

  const layerOf = (layerId: string) =>
    layers.find((l) => l.id === layerId)?.id ?? layers[0]?.id ?? 'ly_0'

  const sceneNodes: SceneNode[] = canonical.nodes.map((n, i) => {
    const node: SceneNode = {
      id: n.id,
      name: n.name ?? `场景 ${i + 1}`,
      scale: n.scale,
      layerId: layerOf(n.layerId),
      at: { x: wx(n.at.x), y: wy(n.at.y) },
      ...(n.parent !== undefined ? { parent: n.parent } : {}),
      ...(n.def !== undefined ? { def: n.def } : {}),
    }
    return node
  })

  const nodeIds = new Set(sceneNodes.map((n) => n.id))
  const edges: Edge[] = canonical.edges.flatMap((e) => {
    if (!nodeIds.has(e.a) || !nodeIds.has(e.b)) return []
    const edge: Edge = {
      id: e.id,
      from: e.a,
      to: e.b,
      directionality: fromDirectionality(e.directionality),
      points: e.path.map((p) => ({ x: wx(p.x), y: wy(p.y) })),
      ...(e.semanticAnchor !== undefined
        ? { semanticAnchor: (e.semanticAnchor === 'high' ? 'highland' : e.semanticAnchor === 'low' ? 'lowland' : 'neutral') as 'highland' | 'lowland' | 'neutral' }
        : {}),
      ...(e.def !== undefined ? { def: e.def } : {}),
    }
    return [edge]
  })

  // 场景框：按节点锚点生成一个默认矩形，让节点在画布上有可视实体。
  const sceneBoxes = sceneNodes.map((n, i) => {
    const w = n.scale === 'large' ? 200 : n.scale === 'medium' ? 140 : 90
    const h = n.scale === 'large' ? 120 : n.scale === 'medium' ? 84 : 56
    return {
      id: `bx_${i}_${uid('edge').slice(-4)}`,
      sceneId: n.id,
      x: Math.round(n.at.x - w / 2),
      y: Math.round(n.at.y - h / 2),
      width: w,
      height: h,
    }
  })

  // 放置：canonical placement.at 指向宿主节点；编辑器 placement 需要 sceneId 与坐标。
  const buildingGroups: BuildingGroup[] = (canonical.buildingGroups ?? []).map((group) => ({
    id: group.id,
    frame: { x: wx(group.frame.x), y: wy(group.frame.y), width: wx(group.frame.width), height: wy(group.frame.height) },
    shell: group.shell,
    floors: group.floors.map((floor): BuildingFloor => ({
      id: floor.id, ordinal: floor.ordinal, height: floor.height, nodes: [...floor.nodes],
      ...(floor.image !== undefined ? { image: floor.image } : {}),
      ...(floor.frame !== undefined ? { frame: { x: wx(floor.frame.x), y: wy(floor.frame.y), width: wx(floor.frame.width), height: wy(floor.frame.height) } } : {}),
    })),
    portals: group.portals.map((portal) => ({ ...portal })),
  }))

  const placements = canonical.placements.flatMap((p) => {
    const host = sceneNodes.find((n) => n.id === p.at)
    if (!host) return []
    return [
      {
        id: p.id,
        materialId: p.def,
        sceneId: host.id,
        x: host.at.x,
        y: host.at.y,
      },
    ]
  })

  return {
    id: canonical.id,
    name: canonical.name,
    layers,
    sceneNodes,
    sceneBoxes,
    edges,
    obstructions: [],
    terrains: [],
    placements,
    buildingGroups,
  }
}
