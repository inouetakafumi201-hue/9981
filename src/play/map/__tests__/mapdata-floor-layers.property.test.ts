import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeMapDocument, type CanonicalMapData, type LegacyMapData } from '../types';
import { deserializeMap, serializeMap } from '../serialize';

const backdrop = { image: 'map.png', pixelWidth: 640, pixelHeight: 360, tileRows: 1, tileCols: 1 };
const legacyArb: fc.Arbitrary<LegacyMapData> = fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 1, maxLength: 8 }).map((floors) => ({ schemaVersion: '1.0', id: 'legacy', name: 'Legacy', backdrop, floors, nodes: floors.map((floor, index) => ({ id: `n:${index}`, def: 'd:scene/room', scale: 'medium', at: { x: 0.5, y: 0.5 }, floor })), edges: [], placements: [] }));
const canonicalArb: fc.Arbitrary<CanonicalMapData> = fc.array(fc.integer({ min: -20, max: 20 }), { minLength: 1, maxLength: 8 }).map((heights) => ({ schemaVersion: '3.0', id: 'v3', name: 'V3', backdrop, layers: [{ id: 'zone:a' }], nodes: heights.map((floor, index) => ({ id: `n:${index}`, def: 'd:scene/room', scale: 'medium', at: { x: 0.5, y: 0.5 }, layerId: 'zone:a', floor })), edges: [], placements: [] }));

describe('MapData v3 properties', () => {
  it('v1 migration is deterministic and idempotent', () => fc.assert(fc.property(legacyArb, (legacy) => {
    const once = normalizeMapDocument(legacy);
    expect(normalizeMapDocument(once)).toEqual(once);
    expect(once.layers.map((layer) => layer.id)).toEqual([...once.layers.map((layer) => layer.id)].sort((a, b) => Number(a.split(':').at(-1)) - Number(b.split(':').at(-1))));
  }), { numRuns: 100 }));

  it('v3 serialization roundtrips without removed fields', () => fc.assert(fc.property(canonicalArb, (map) => {
    const json = serializeMap(map);
    expect(deserializeMap(json)).toEqual(map);
    expect(json).not.toContain('buildingGroups');
    expect(json).not.toContain('"parent"');
    expect(json).not.toContain('"height"');
  }), { numRuns: 100 }));
});
