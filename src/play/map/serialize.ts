/**
 * Canonical MapData 序列化 / 解析 + 层间渲染不透明度纯函数（MapData floor→layers 契约扩展）。
 *
 * canonical 序列化只认 `layers` / `layerId`：不写 legacy `floor` / `floors`。legacy floor 文档
 * 只在导入边界出现（`parseMapData` 内部先规范化，再 canonical 输出）。
 *
 * 这一段是纯函数、无 IO、确定性：同一份 canonical MapData 永远写出字节相同的 pretty JSON，
 * 再读回等价结构。这使"地图存了又读回"可以在 CI 里对全部地图批量断言。
 */
import {
  normalizeMapDocument,
  type CanonicalMapData,
  type MapDataDocument,
  type MapLayer,
  type BuildingGroup,
} from './types';

/** 层的显示元数据序列化：只写出有值的字段（height 空 = 独立层，不输出）。
 *  字段顺序固定，保证 pretty JSON 稳定。 */
function serializeLayer(layer: MapLayer): Record<string, unknown> {
  const record: Record<string, unknown> = { id: layer.id };
  if (layer.name !== undefined) record['name'] = layer.name;
  if (layer.height !== undefined) record['height'] = layer.height;
  if (layer.backdrop !== undefined) {
    record['backdrop'] = {
      image: layer.backdrop.image,
      pixelWidth: layer.backdrop.pixelWidth,
      pixelHeight: layer.backdrop.pixelHeight,
    };
  }
  if (layer.transform !== undefined) {
    record['transform'] = {
      scaleX: layer.transform.scaleX,
      scaleY: layer.transform.scaleY,
      tx: layer.transform.tx,
      ty: layer.transform.ty,
    };
  }
  return record;
}

function serializeBuildingGroup(group: BuildingGroup): Record<string, unknown> {
  return {
    id: group.id,
    frame: { ...group.frame },
    shell: group.shell,
    floors: group.floors.map((floor) => ({
      id: floor.id,
      ordinal: floor.ordinal,
      height: floor.height,
      nodes: [...floor.nodes],
      ...(floor.image !== undefined ? { image: floor.image } : {}),
      ...(floor.frame !== undefined ? { frame: { ...floor.frame } } : {}),
    })),
    portals: group.portals.map((portal) => ({ ...portal })),
  };
}

function serializeNode(node: CanonicalMapData['nodes'][number]): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: node.id,
    def: node.def,
    scale: node.scale,
    at: { x: node.at.x, y: node.at.y },
    layerId: node.layerId,
  };
  if (node.parent !== undefined) record['parent'] = node.parent;
  if (node.name !== undefined) record['name'] = node.name;
  return record;
}

function serializeEdge(edge: CanonicalMapData['edges'][number]): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: edge.id,
    def: edge.def,
    a: edge.a,
    b: edge.b,
    directionality: edge.directionality,
    path: edge.path.map((point) => ({ x: point.x, y: point.y })),
  };
  if (edge.visualObstruction !== undefined) record['visualObstruction'] = edge.visualObstruction;
  if (edge.physicalObstruction !== undefined) record['physicalObstruction'] = edge.physicalObstruction;
  if (edge.transitionWindow !== undefined) {
    record['transitionWindow'] = { control: edge.transitionWindow.control.map((p) => ({ x: p.x, y: p.y })) };
  }
  if (edge.semanticAnchor !== undefined) record['semanticAnchor'] = edge.semanticAnchor;
  return record;
}

function serializePlacement(placement: CanonicalMapData['placements'][number]): Record<string, unknown> {
  const record: Record<string, unknown> = { id: placement.id, at: placement.at, def: placement.def };
  if (placement.overrides !== undefined) record['overrides'] = placement.overrides;
  if (placement.temporaryFree !== undefined) record['temporaryFree'] = placement.temporaryFree;
  return record;
}

/** 把 canonical MapData 写成确定性 pretty JSON（只含 canonical 字段，无 floor/floors）。 */
export function serializeMapData(map: CanonicalMapData): string {
  const document = {
    schemaVersion: map.schemaVersion,
    id: map.id,
    name: map.name,
    backdrop: {
      image: map.backdrop.image,
      pixelWidth: map.backdrop.pixelWidth,
      pixelHeight: map.backdrop.pixelHeight,
      tileRows: map.backdrop.tileRows,
      tileCols: map.backdrop.tileCols,
    },
    layers: map.layers.map(serializeLayer),
    nodes: map.nodes.map(serializeNode),
    edges: map.edges.map(serializeEdge),
    placements: map.placements.map(serializePlacement),
    ...(map.buildingGroups !== undefined
      ? { buildingGroups: map.buildingGroups.map(serializeBuildingGroup) }
      : {}),
  };
  return JSON.stringify(document, null, 2);
}

/**
 * 解析地图 JSON：legacy v1（floor/floors）会先规范化为 canonical v2 再返回；
 * canonical v2 直接解析。返回 canonical MapData。
 */
export function parseMapData(json: string): CanonicalMapData {
  const raw = JSON.parse(json) as {
    schemaVersion?: string;
    floors?: readonly number[];
    layers?: readonly unknown[];
    nodes?: readonly Record<string, unknown>[];
    edges?: readonly unknown[];
    placements?: readonly unknown[];
    backdrop: unknown;
    id: string;
    name: string;
  };
  if (raw.schemaVersion === '2.0') {
    const doc = raw as unknown as MapDataDocument;
    return normalizeMapDocument(doc);
  }
  // legacy v1（或未标版本）：按 floor 形状解释，内部规范化。
  const legacy = {
    schemaVersion: '1.0' as const,
    id: raw.id,
    name: raw.name,
    backdrop: raw.backdrop,
    floors: raw.floors ?? [],
    nodes: (raw.nodes ?? []).map((node) => ({ ...(node as object), floor: (node as Record<string, unknown>).floor ?? 0 })),
    edges: raw.edges ?? [],
    placements: raw.placements ?? [],
  } as unknown as MapDataDocument;
  return normalizeMapDocument(legacy);
}

/**
 * 层间渲染不透明度纯函数（L.3）。任一侧无数值 `height` 时返回 `null`（独立层，调用方渲染为
 * opacity 1）；两侧都有时返回 `clamp(1 - |Δheight| × 0.1, 0, 1)`。
 */
export function layerOpacity(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined || b === undefined) return null;
  return Math.max(0, Math.min(1, 1 - Math.abs(a - b) * 0.1));
}
