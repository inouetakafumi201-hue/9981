import { describe, expect, it } from 'vitest';

import {
  edgeFromMapEdge,
  layerFromFloor,
  nodeFromMapNode,
  createSpatialProjection,
} from '../render-projection-port';
import type { MapData } from '../../../../play/map/types';
import type { ReadOnlySemanticProjection } from '../../../../l2/model/projection';

describe('spatial-view', () => {
  const sampleMapNode = {
    id: 'node:a',
    def: 'd:scene/large',
    scale: 'large' as const,
    at: { x: 0.5, y: 0.3 },
    floor: 2,
    name: '检测站A',
  };

  const sampleMapEdge = {
    id: 'edge:a-b',
    def: 'd:link/path',
    a: 'node:a',
    b: 'node:b',
    directionality: 'bidirectional' as const,
    path: [
      { x: 0.5, y: 0.3 },
      { x: 0.7, y: 0.5 },
      { x: 0.9, y: 0.7 },
    ],
    semanticAnchor: 'high' as const,
  };

  const sampleMapData: MapData = {
    schemaVersion: '1.0',
    id: 'map:test',
    name: '测试地图',
    backdrop: {
      image: 'data:image/png;base64,abc',
      pixelWidth: 100,
      pixelHeight: 100,
      tileRows: 1,
      tileCols: 1,
    },
    floors: [0, 1, 2],
    nodes: [sampleMapNode],
    edges: [sampleMapEdge],
    placements: [],
  };

  const sampleProjection: ReadOnlySemanticProjection = {
    scopeId: 'scope:a',
    consumer: 'ui',
    turn: 1,
    definitions: [],
    entities: [],
    beliefSlices: [],
    visibility: [],
    semanticStateFingerprint: 'fp-1',
  };

  describe('nodeFromMapNode', () => {
    it('should convert MapNode to NodeView', () => {
      const result = nodeFromMapNode(sampleMapNode, sampleMapData);

      expect(result.id).toBe('node:a');
      expect(result.def).toBe('d:scene/large');
      expect(result.scale).toBe('large');
      expect(result.name).toBe('检测站A');
      expect(result.at).toEqual({ x: 0.5, y: 0.3 });
      expect(result.floor).toBe(2);
    });

    it('should handle node with minimal fields', () => {
      const minimalNode = {
        id: 'node:c',
        def: 'd:scene/small',
        scale: 'small' as const,
        at: { x: 0, y: 0 },
        floor: 0,
      };

      const result = nodeFromMapNode(minimalNode, sampleMapData);

      expect(result.id).toBe('node:c');
      expect(result.def).toBe('d:scene/small');
      expect(result.scale).toBe('small');
    });
  });

  describe('edgeFromMapEdge', () => {
    it('should convert MapEdge to EdgeView', () => {
      const result = edgeFromMapEdge(sampleMapEdge, sampleMapData);

      expect(result.id).toBe('edge:a-b');
      expect(result.a).toBe('node:a');
      expect(result.b).toBe('node:b');
      expect(result.directionality).toBe('bidirectional');
      expect(result.path).toEqual([
        { x: 0.5, y: 0.3 },
        { x: 0.7, y: 0.5 },
        { x: 0.9, y: 0.7 },
      ]);
      expect(result.semanticAnchor).toBe('high');
    });

    it('should handle edge with minimal path', () => {
      const simpleEdge = {
        id: 'edge:test',
        def: 'd:link/path',
        a: 'node:a',
        b: 'node:b',
        directionality: 'bidirectional' as const,
        path: [{ x: 0.5, y: 0.3 }],
      };

      const result = edgeFromMapEdge(simpleEdge, sampleMapData);

      expect(result.id).toBe('edge:test');
      expect(result.path).toEqual([{ x: 0.5, y: 0.3 }]);
      expect(result.semanticAnchor).toBe('neutral');
    });
  });

  describe('layerFromFloor', () => {
    it('should convert floor number to LayerView', () => {
      const result = layerFromFloor(0, 2);

      expect(result.id).toBe('floor:2');
      expect(result.name).toBe('楼层 2');
      expect(result.height).toBe(2);
      expect(result.opacity).toBe(1);
    });
  });

  describe('createSpatialProjection', () => {
    it('should create complete SpatialProjection', () => {
      const result = createSpatialProjection(sampleMapData, sampleProjection);

      expect(result.layers).toHaveLength(3);
      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
      expect(result.entities).toHaveLength(0);
      expect(result.clusters).toHaveLength(0);
      expect(result.tiles).toHaveLength(0);
      expect(result.revision).toBe(4); // 'fp-1'.length
    });

    it('should return frozen objects', () => {
      const result = createSpatialProjection(sampleMapData, sampleProjection);

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.layers)).toBe(true);
      expect(Object.isFrozen(result.nodes)).toBe(true);
      expect(Object.isFrozen(result.edges)).toBe(true);
      expect(Object.isFrozen(result.entities)).toBe(true);
    });
  });
});