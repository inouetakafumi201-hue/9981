/**
 * Schema Migration Graph Tests
 *
 * 验证版本迁移路径查询的正确性
 * - DFS 寻路
 * - 环检测
 * - 模糊路径检测
 * - 版本号比较
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  type CandidateMigration,
  SchemaMigrationGraph,
  compareVersions,
} from '../../codec/schema-migration.js';

describe('compareVersions', () => {
  it('compares major versions correctly', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('compares minor versions correctly', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
  });

  it('compares patch versions correctly', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });

  it('treats missing version parts as 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  it('handles version strings with fewer parts than others', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1', '1.1')).toBeLessThan(0);
  });
});

describe('SchemaMigrationGraph', () => {
  let graph: SchemaMigrationGraph;

  beforeEach(() => {
    graph = new SchemaMigrationGraph();
  });

  describe('register', () => {
    it('registers a single migration', () => {
      const migration: CandidateMigration = {
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.1to2',
      };
      expect(() => graph.register(migration)).not.toThrow();
    });

    it('rejects self-loop migrations', () => {
      expect(() =>
        graph.register({
          fromVersion: '1.0.0',
          toVersion: '1.0.0',
          id: 'mig.self',
        })
      ).toThrow('Migration edge must change version');
    });

    it('rejects duplicate migration IDs', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.dup',
      });
      expect(() =>
        graph.register({
          fromVersion: '1.0.0',
          toVersion: '3.0.0',
          id: 'mig.dup',
        })
      ).toThrow('is already registered');
    });

    it('rejects duplicate (from, to) pairs', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.first',
      });
      expect(() =>
        graph.register({
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          id: 'mig.second',
        })
      ).toThrow('is duplicated');
    });
  });

  describe('resolve', () => {
    it('returns identity for same version', () => {
      const result = graph.resolve('1.0.0', '1.0.0', 10);
      expect(result.status).toBe('identity');
      expect(result.path).toEqual([]);
    });

    it('finds direct single-edge path', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.direct',
      });
      const result = graph.resolve('1.0.0', '2.0.0', 10);
      expect(result.status).toBe('ok');
      expect(result.path).toHaveLength(1);
      expect(result.path[0]?.id).toBe('mig.direct');
    });

    it('finds multi-step path (v1.0 → v1.1 → v2.0)', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        id: 'mig.1-1',
      });
      graph.register({
        fromVersion: '1.1.0',
        toVersion: '2.0.0',
        id: 'mig.1.1-2',
      });
      const result = graph.resolve('1.0.0', '2.0.0', 10);
      expect(result.status).toBe('ok');
      expect(result.path).toHaveLength(2);
      expect(result.path[0]?.id).toBe('mig.1-1');
      expect(result.path[1]?.id).toBe('mig.1.1-2');
    });

    it('returns missing for unreachable target', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.1-2',
      });
      const result = graph.resolve('1.0.0', '3.0.0', 10);
      expect(result.status).toBe('missing');
      expect(result.path).toEqual([]);
    });

    it('detects cycles', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.1-2',
      });
      graph.register({
        fromVersion: '2.0.0',
        toVersion: '1.0.0',
        id: 'mig.2-1',
      });
      const result = graph.resolve('1.0.0', '3.0.0', 10);
      expect(result.status).toBe('cycle');
      expect(result.path).toEqual([]);
    });

    it('detects ambiguous paths', () => {
      // Two different paths from 1.0.0 to 2.0.0
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.5.0',
        id: 'mig.1-1.5',
      });
      graph.register({
        fromVersion: '1.5.0',
        toVersion: '2.0.0',
        id: 'mig.1.5-2',
      });
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.9.0',
        id: 'mig.1-1.9',
      });
      graph.register({
        fromVersion: '1.9.0',
        toVersion: '2.0.0',
        id: 'mig.1.9-2',
      });

      const result = graph.resolve('1.0.0', '2.0.0', 10);
      expect(result.status).toBe('ambiguous');
      expect(result.path).toEqual([]);
      expect(result.competingPaths).toBeDefined();
      expect(result.competingPaths).toHaveLength(2);
    });

    it('respects maxSteps limit', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        id: 'mig.1-1.1',
      });
      graph.register({
        fromVersion: '1.1.0',
        toVersion: '1.2.0',
        id: 'mig.1.1-1.2',
      });
      graph.register({
        fromVersion: '1.2.0',
        toVersion: '2.0.0',
        id: 'mig.1.2-2',
      });

      // maxSteps=2 should find path to 1.2.0 (2 edges)
      let result = graph.resolve('1.0.0', '1.2.0', 2);
      expect(result.status).toBe('ok');
      expect(result.path).toHaveLength(2);

      // maxSteps=1 should not find path to 1.2.0 (2 edges needed)
      result = graph.resolve('1.0.0', '1.2.0', 1);
      expect(result.status).toBe('missing');

      // maxSteps=3 should find path to 2.0.0 (3 edges)
      result = graph.resolve('1.0.0', '2.0.0', 3);
      expect(result.status).toBe('ok');
      expect(result.path).toHaveLength(3);

      // maxSteps=2 should not find path to 2.0.0 (3 edges needed)
      result = graph.resolve('1.0.0', '2.0.0', 2);
      expect(result.status).toBe('missing');
    });

    it('returns missing when path requires > maxSteps steps', () => {
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        id: 'mig.1-1.1',
      });
      graph.register({
        fromVersion: '1.1.0',
        toVersion: '1.2.0',
        id: 'mig.1.1-1.2',
      });
      graph.register({
        fromVersion: '1.2.0',
        toVersion: '2.0.0',
        id: 'mig.1.2-2',
      });

      const result = graph.resolve('1.0.0', '2.0.0', 1);
      expect(result.status).toBe('missing');
    });
  });

  describe('complex topology', () => {
    it('handles diamond-shaped migration graph', () => {
      // 1.0.0 -> 1.5.0 -> 2.0.0 (path A)
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.5.0',
        id: 'mig.1-1.5',
      });
      graph.register({
        fromVersion: '1.5.0',
        toVersion: '2.0.0',
        id: 'mig.1.5-2-a',
      });
      // 1.0.0 -> 1.9.0 -> 2.0.0 (path B, independent)
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '1.9.0',
        id: 'mig.1-1.9',
      });
      graph.register({
        fromVersion: '1.9.0',
        toVersion: '2.0.0',
        id: 'mig.1.9-2-b',
      });

      const result = graph.resolve('1.0.0', '2.0.0', 10);
      expect(result.status).toBe('ambiguous');
      expect(result.competingPaths).toHaveLength(2);
    });

    it('handles multiple independent migration chains', () => {
      // Chain 1: 1.0.0 -> 2.0.0
      graph.register({
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        id: 'mig.c1',
      });
      // Chain 2: 3.0.0 -> 4.0.0 (independent)
      graph.register({
        fromVersion: '3.0.0',
        toVersion: '4.0.0',
        id: 'mig.c2',
      });

      const result1 = graph.resolve('1.0.0', '2.0.0', 10);
      expect(result1.status).toBe('ok');

      const result2 = graph.resolve('3.0.0', '4.0.0', 10);
      expect(result2.status).toBe('ok');

      const result3 = graph.resolve('1.0.0', '4.0.0', 10);
      expect(result3.status).toBe('missing');
    });
  });
});
