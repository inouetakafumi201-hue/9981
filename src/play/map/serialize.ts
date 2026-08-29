import { normalizeMapDocument, type CanonicalMapData, type MapDataDocument } from './types';

function ordered(map: CanonicalMapData): Record<string, unknown> {
  return {
    schemaVersion: '3.0',
    id: map.id,
    name: map.name,
    backdrop: { image: map.backdrop.image, pixelWidth: map.backdrop.pixelWidth, pixelHeight: map.backdrop.pixelHeight, tileRows: map.backdrop.tileRows, tileCols: map.backdrop.tileCols },
    layers: map.layers.map((layer) => ({
      id: layer.id,
      ...(layer.name !== undefined ? { name: layer.name } : {}),
      ...(layer.backdrop !== undefined ? { backdrop: { ...layer.backdrop } } : {}),
      ...(layer.transform !== undefined ? { transform: { ...layer.transform } } : {}),
      ...(layer.visibilityScope !== undefined ? { visibilityScope: layer.visibilityScope } : {}),
    })),
    nodes: map.nodes.map((node) => ({ id: node.id, def: node.def, scale: node.scale, at: { ...node.at }, layerId: node.layerId, floor: node.floor, ...(node.name !== undefined ? { name: node.name } : {}) })),
    edges: map.edges.map((edge) => ({ id: edge.id, def: edge.def, a: edge.a, b: edge.b, directionality: edge.directionality, path: edge.path.map((point) => ({ ...point })), ...(edge.visualObstruction !== undefined ? { visualObstruction: edge.visualObstruction } : {}), ...(edge.physicalObstruction !== undefined ? { physicalObstruction: edge.physicalObstruction } : {}), ...(edge.transitionWindow !== undefined ? { transitionWindow: edge.transitionWindow } : {}), ...(edge.semanticAnchor !== undefined ? { semanticAnchor: edge.semanticAnchor } : {}) })),
    placements: map.placements.map((placement) => ({ id: placement.id, at: placement.at, def: placement.def, ...(placement.overrides !== undefined ? { overrides: placement.overrides } : {}), ...(placement.temporaryFree !== undefined ? { temporaryFree: placement.temporaryFree } : {}) })),
  };
}

export function serializeMap(map: CanonicalMapData): string { return JSON.stringify(ordered(map), null, 2); }
export const serializeMapData = serializeMap;

export function deserializeMap(json: string): CanonicalMapData {
  const raw = JSON.parse(json) as MapDataDocument;
  if (raw.schemaVersion !== '3.0') throw new Error('MAP_SCHEMA_VERSION_UNSUPPORTED: expected canonical v3');
  return normalizeMapDocument(raw);
}
export const parseMapData = deserializeMap;

/** Legacy v1 is accepted only through this explicit import boundary. */
export function importLegacyMap(json: string): CanonicalMapData {
  const raw = JSON.parse(json) as MapDataDocument;
  if (raw.schemaVersion !== '1.0') throw new Error('MAP_LEGACY_SCHEMA_EXPECTED');
  return normalizeMapDocument(raw);
}
