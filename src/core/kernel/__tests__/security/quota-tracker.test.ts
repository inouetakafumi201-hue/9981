/**
 * QuotaTracker Tests
 *
 * 验证配额消耗追踪、增量检查和超限诊断
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_TECHNICAL_QUOTAS,
  QuotaTracker,
  type TechnicalQuotas,
} from '../../security/quotas';

describe('QuotaTracker', () => {
  let tracker: QuotaTracker;
  let smallQuota: TechnicalQuotas;

  beforeEach(() => {
    tracker = new QuotaTracker(DEFAULT_TECHNICAL_QUOTAS);
    // 创建小配额用于测试超限场景
    smallQuota = {
      inputBytes: 100,
      nestingDepth: 5,
      objectMembers: 10,
      arrayElements: 10,
      astNodes: 20,
      definitions: 5,
      referenceEdges: 10,
      traversalWork: 50,
      diagnostics: 5,
      outputBytes: 500,
      migrationSteps: 3,
      identifierLength: 20,
      packageDependencyEdges: 5,
    };
  });

  describe('increment', () => {
    it('increments consumption for a field', () => {
      tracker.increment('inputBytes', 50);
      const consumption = tracker.getConsumption();
      expect(consumption.inputBytes).toBe(50);
    });

    it('increments multiple times accumulates', () => {
      tracker.increment('inputBytes', 30);
      tracker.increment('inputBytes', 20);
      const consumption = tracker.getConsumption();
      expect(consumption.inputBytes).toBe(50);
    });

    it('increments different fields independently', () => {
      tracker.increment('inputBytes', 100);
      tracker.increment('definitions', 5);
      const consumption = tracker.getConsumption();
      expect(consumption.inputBytes).toBe(100);
      expect(consumption.definitions).toBe(5);
      expect(consumption.objectMembers).toBe(0);
    });
  });

  describe('canIncrement', () => {
    it('returns true when increment will not exceed quota', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      expect(smallTracker.canIncrement('inputBytes', 50)).toBe(true);
      expect(smallTracker.canIncrement('inputBytes', 100)).toBe(true);
    });

    it('returns false when increment will exceed quota', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      expect(smallTracker.canIncrement('inputBytes', 101)).toBe(false);
      expect(smallTracker.canIncrement('definitions', 6)).toBe(false);
    });

    it('checks against current consumption + delta', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('inputBytes', 80);
      expect(smallTracker.canIncrement('inputBytes', 19)).toBe(true);  // 80 + 19 = 99 < 100
      expect(smallTracker.canIncrement('inputBytes', 20)).toBe(true);  // 80 + 20 = 100, equals limit
      expect(smallTracker.canIncrement('inputBytes', 21)).toBe(false); // 80 + 21 = 101 > 100
    });

    it('handles boundary at exactly quota limit', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      expect(smallTracker.canIncrement('inputBytes', 100)).toBe(true);
      expect(smallTracker.canIncrement('inputBytes', 101)).toBe(false);
    });
  });

  describe('getConsumption', () => {
    it('returns frozen snapshot of consumption', () => {
      tracker.increment('inputBytes', 50);
      const consumption = tracker.getConsumption();
      expect(Object.isFrozen(consumption)).toBe(true);
    });

    it('returns current state of all fields', () => {
      tracker.increment('inputBytes', 100);
      tracker.increment('definitions', 10);
      tracker.increment('diagnostics', 5);
      const consumption = tracker.getConsumption();
      expect(consumption.inputBytes).toBe(100);
      expect(consumption.definitions).toBe(10);
      expect(consumption.diagnostics).toBe(5);
      expect(consumption.objectMembers).toBe(0);
    });

    it('does not allow modification of returned snapshot', () => {
      const consumption = tracker.getConsumption();
      expect(() => {
        (consumption as any).inputBytes = 999;
      }).toThrow();
    });
  });

  describe('getExhaustedFields', () => {
    it('returns empty array when no fields are exhausted', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('inputBytes', 50);
      smallTracker.increment('definitions', 2);
      const exhausted = smallTracker.getExhaustedFields();
      expect(exhausted).toHaveLength(0);
    });

    it('returns exhausted fields with their values', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('inputBytes', 100);
      smallTracker.increment('definitions', 5);
      smallTracker.increment('objectMembers', 10);
      const exhausted = smallTracker.getExhaustedFields();
      expect(exhausted).toHaveLength(3);
      const fields = exhausted.map((e) => e.field);
      expect(fields).toContain('inputBytes');
      expect(fields).toContain('definitions');
      expect(fields).toContain('objectMembers');
    });

    it('includes current and limit values in exhausted fields', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('inputBytes', 100);
      const exhausted = smallTracker.getExhaustedFields();
      expect(exhausted[0]).toEqual({
        field: 'inputBytes',
        current: 100,
        limit: 100,
      });
    });

    it('returns fields at exactly quota limit as exhausted', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('definitions', 5);
      const exhausted = smallTracker.getExhaustedFields();
      expect(exhausted.some((e) => e.field === 'definitions')).toBe(true);
    });

    it('returns all exhausted fields (multiple)', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('inputBytes', 150);
      smallTracker.increment('definitions', 10);
      smallTracker.increment('diagnostics', 5);
      const exhausted = smallTracker.getExhaustedFields();
      expect(exhausted.length).toBeGreaterThanOrEqual(3);
      const fields = exhausted.map((e) => e.field);
      expect(fields).toContain('inputBytes');
      expect(fields).toContain('definitions');
      expect(fields).toContain('diagnostics');
    });
  });

  describe('reset', () => {
    it('resets consumption to zero', () => {
      tracker.increment('inputBytes', 500);
      tracker.increment('definitions', 10);
      tracker.reset();
      const consumption = tracker.getConsumption();
      expect(consumption.inputBytes).toBe(0);
      expect(consumption.definitions).toBe(0);
    });

    it('allows new consumption after reset', () => {
      tracker.increment('inputBytes', 500);
      tracker.reset();
      tracker.increment('inputBytes', 100);
      expect(tracker.getConsumption().inputBytes).toBe(100);
    });

    it('resets all fields to zero', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('inputBytes', 50);
      smallTracker.increment('definitions', 2);
      smallTracker.increment('diagnostics', 1);
      smallTracker.increment('traversalWork', 10);
      smallTracker.reset();
      const consumption = smallTracker.getConsumption();
      for (const field of Object.keys(consumption) as (keyof typeof consumption)[]) {
        expect(consumption[field]).toBe(0);
      }
    });
  });

  describe('integration scenarios', () => {
    it('tracks realistic JSON parsing consumption', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      // Simulate parsing: {"a": [1, 2, 3], "b": {"c": 4}}
      expect(smallTracker.canIncrement('inputBytes', 30)).toBe(true);
      smallTracker.increment('inputBytes', 30);

      expect(smallTracker.canIncrement('nestingDepth', 2)).toBe(true);
      smallTracker.increment('nestingDepth', 2);

      expect(smallTracker.canIncrement('objectMembers', 2)).toBe(true);
      smallTracker.increment('objectMembers', 2);

      expect(smallTracker.canIncrement('arrayElements', 3)).toBe(true);
      smallTracker.increment('arrayElements', 3);

      expect(smallTracker.canIncrement('astNodes', 7)).toBe(true);
      smallTracker.increment('astNodes', 7);

      const consumption = smallTracker.getConsumption();
      expect(consumption.inputBytes).toBe(30);
      expect(consumption.nestingDepth).toBe(2);
      expect(consumption.objectMembers).toBe(2);
      expect(consumption.arrayElements).toBe(3);
      expect(consumption.astNodes).toBe(7);
    });

    it('prevents increments after quota exhaustion', () => {
      const smallTracker = new QuotaTracker(smallQuota);
      smallTracker.increment('definitions', 5);
      expect(smallTracker.canIncrement('definitions', 1)).toBe(false);
      // Tracker still allows increment() call, but calling code should check first
      smallTracker.increment('definitions', 1);
      expect(smallTracker.getConsumption().definitions).toBe(6);
    });
  });
});
