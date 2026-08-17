/**
 * Task 14 测试：调参报告生成器 + 断言固化。
 *  - 五段式报告面向玩家（不用原始术语堆砌）；
 *  - 固化仅在 passed && golden 全绿时发生，且标记 source=tuning-derived；
 *  - 否则拒绝固化。
 */
import { describe, expect, it } from 'vitest';
import { generateTuningReport, solidifyAssertion } from '../report.js';
import { BehaviorAssertionRegistry } from '../assertions.js';
import type { BehaviorAssertion } from '../assertions.js';
import type { ParameterTuningRecord } from '../tuner.js';

function mkAssertion(id: string, opts: Partial<BehaviorAssertion> = {}): BehaviorAssertion {
  return {
    id, category: 'sustain', description: '残血应保命', isGolden: false, source: 'initial',
    setup: { stateHash: 'h', serialized: '{}' },
    expect: { shouldSelect: 'a:heal' },
    ...opts,
  };
}

function acceptedRecord(feeItem: string): ParameterTuningRecord {
  return {
    id: 'tune-1', timestamp: 1, iteration: 1,
    attribution: { violatedAssertion: 'a1', rootCauseFeeItem: feeItem, confidence: 0.9, evidenceTrace: null as never },
    change: { feeItem, field: 'unit', before: 3, after: 3.5, direction: 'increase', magnitude: 0.5, reasoning: '' },
    verification: { targetAssertionPassed: true, regressionCount: 0, regressionDetails: [] },
    decision: 'accepted',
  };
}

describe('report（Task14）', () => {
  it('生成五段式报告且术语面向玩家', () => {
    const report = generateTuningReport(mkAssertion('a1'), [acceptedRecord('pool.ap')]);
    expect(report.problem).toContain('残血应保命');
    expect(report.suggestion).toContain('行动点');
    // 五段齐全
    for (const key of ['problem', 'cause', 'suggestion', 'impact', 'needsConfirmation'] as const) {
      expect(Array.isArray(report[key]) || typeof report[key] === 'string').toBe(true);
    }
  });

  it('无接受改动时报告如实说明', () => {
    const report = generateTuningReport(mkAssertion('a1'), []);
    expect(report.suggestion).toContain('未产生');
  });

  it('固化：passed && golden 全绿 → 标 tuning-derived 并入断言集', () => {
    const registry = new BehaviorAssertionRegistry();
    const assertion = mkAssertion('a-tuning-1');
    const result = solidifyAssertion(assertion, true, true, registry);
    expect(result.ok).toBe(true);
    const inReg = registry.get('a-tuning-1');
    expect(inReg?.source).toBe('tuning-derived');
  });

  it('固化：目标断言未通过 → 拒绝', () => {
    const registry = new BehaviorAssertionRegistry();
    const result = solidifyAssertion(mkAssertion('a-tuning-2'), false, true, registry);
    expect(result.ok).toBe(false);
    expect(registry.get('a-tuning-2')).toBeUndefined();
  });

  it('固化：golden 未全绿 → 拒绝', () => {
    const registry = new BehaviorAssertionRegistry();
    const result = solidifyAssertion(mkAssertion('a-tuning-3'), true, false, registry);
    expect(result.ok).toBe(false);
    expect(registry.get('a-tuning-3')).toBeUndefined();
  });

  it('固化：已存在断言升级 source 而非复制', () => {
    const registry = new BehaviorAssertionRegistry([mkAssertion('a-tuning-4', { source: 'curated' })]);
    const result = solidifyAssertion(registry.get('a-tuning-4')!, true, true, registry);
    expect(result.ok).toBe(true);
    expect(registry.all().length).toBe(1);
    expect(registry.get('a-tuning-4')?.source).toBe('tuning-derived');
  });
});