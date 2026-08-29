import { describe, expect, it } from 'vitest';
import { deriveLayerId, normalizeMapDocument, type CanonicalMapData, type LegacyMapData } from '../types';
import { deserializeMap, importLegacyMap, serializeMap } from '../serialize';
import { validateMapStructure } from '../validate';

const backdrop = { image: 'map.png', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 };
const legacy = (): LegacyMapData => ({ schemaVersion: '1.0', id: 'legacy', name: 'Legacy', backdrop, floors: [0, 2], nodes: [{ id: 'a', def: 'd:scene/room', scale: 'medium', at: { x: 0.2, y: 0.3 }, floor: 2 }], edges: [], placements: [] });
const canonical = (): CanonicalMapData => ({ schemaVersion: '3.0', id: 'v3', name: 'V3', backdrop, layers: [{ id: 'zone:a', visibilityScope: 'all' }], nodes: [{ id: 'a', def: 'd:scene/room', scale: 'medium', at: { x: 0.2, y: 0.3 }, layerId: 'zone:a', floor: null }], edges: [], placements: [] });

function codes(map: CanonicalMapData): string[] { return validateMapStructure(map).map((item) => item.code); }

describe('MapData v3 zone contract', () => {
  it('migrates v1 floors deterministically while preserving sort height', () => {
    const map = normalizeMapDocument(legacy());
    expect(map.schemaVersion).toBe('3.0');
    expect(map.layers.map((layer) => layer.id)).toEqual([deriveLayerId(0), deriveLayerId(2)]);
    expect(map.nodes[0]).toMatchObject({ layerId: deriveLayerId(2), floor: 2 });
  });

  it('strips removed parent, layer height, obstruction height and building groups', () => {
    const dirty = { ...canonical(), layers: [{ id: 'zone:a', height: 7 }], nodes: [{ ...canonical().nodes[0], parent: 'old' }], buildingGroups: [{ id: 'old' }] } as unknown as CanonicalMapData;
    const json = serializeMap(normalizeMapDocument(dirty));
    expect(json).not.toContain('buildingGroups');
    expect(json).not.toContain('"parent"');
    expect(JSON.parse(json).layers[0]).not.toHaveProperty('height');
  });

  it('roundtrips canonical v3 byte-stably', () => {
    const json = serializeMap(canonical());
    expect(serializeMap(deserializeMap(json))).toBe(json);
  });

  it('rejects legacy data at canonical deserialize boundary', () => {
    expect(() => deserializeMap(JSON.stringify(legacy()))).toThrow('MAP_SCHEMA_VERSION_UNSUPPORTED');
    expect(importLegacyMap(JSON.stringify(legacy())).schemaVersion).toBe('3.0');
  });

  it('validates unique zone ids and references', () => {
    expect(codes({ ...canonical(), layers: [{ id: 'x' }, { id: 'x' }] })).toContain('MAP_DUPLICATE_LAYER_ID');
    expect(codes({ ...canonical(), nodes: [{ id: 'a', def: 'd:scene/room', scale: 'medium', at: { x: 0.2, y: 0.3 }, layerId: 'missing', floor: null }] })).toContain('MAP_LAYER_REF_NOT_FOUND');
  });

  it('rejects cross-zone edges and missing concrete defs', () => {
    const map: CanonicalMapData = {
      ...canonical(),
      layers: [{ id: 'zone:a' }, { id: 'zone:b' }],
      nodes: [canonical().nodes[0]!, { ...canonical().nodes[0]!, id: 'b', layerId: 'zone:b' }],
      edges: [{ id: 'e', def: '', a: 'a', b: 'b', directionality: 'bidirectional', path: [{ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.3 }] }],
    };
    expect(codes(map)).toEqual(expect.arrayContaining(['MAP_CROSS_ZONE_INTERACTION_FORBIDDEN', 'MAP_EDGE_DEF_UNREGISTERED']));
  });
});
