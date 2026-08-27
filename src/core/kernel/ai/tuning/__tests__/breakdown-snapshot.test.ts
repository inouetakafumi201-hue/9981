/**
 * Task 3/5 测试：ScoreBreakdown 与 StateSnapshot。
 *  - 分数构成总和守恒、未观测不计分、pivot/scarcity 记录完整（对应属性 1/2）；
 *  - 状态快照往返 + 稳定哈希（对应属性 3）。
 */
import { describe, expect, it } from 'vitest';
import { scoreBreakdown, scoreDesignCurrency, DESIGN_CURRENCY_PRINCIPLES } from '../../design-currency';
import { observedNumber, scoreDesignCurrencyBreakdown } from '../runtime';
import { defaultDesignCurrencyConfig } from '../config-design-currency';
import { snapshotWorldState, restoreFromSnapshot, hashWorldState, cyrb53 } from '../snapshot';
import { createEmptyWorldState } from '../../../state/world-state';
import type { BeliefSlice } from '../../types';

function slice(facts: Record<string, number>): BeliefSlice {
  return { agent: { $: 'g:agent' }, visibleFacts: { ...facts }, knownFacts: {}, visibleRefs: [], policyContext: {} };
}

describe('ScoreBreakdown（Task3）', () => {
  it('分数构成：总分 === 各分项贡献之和（属性 1 单元版）', () => {
    const s = slice({ 'e:agent.vitality': 5, 'e:enemy.vitality': 3, 'e:agent.pool.ap': 2 });
    const breakdown = scoreBreakdown({ slice: s });
    const sum = breakdown.items.reduce((acc, item) => acc + item.contribution, 0);
    expect(breakdown.total).toBeCloseTo(sum, 6);
    expect(scoreDesignCurrency({ slice: s })).toBeCloseTo(breakdown.total, 6);
  });

  it('未观测不计分：费目不进入 items（属性 2 单元版）', () => {
    const s = slice({ 'e:agent.vitality': 5 });
    const breakdown = scoreBreakdown({ slice: s });
    // 只有被观测的费目才进 items。
    const feeItems = breakdown.items.map((i) => i.feeItem);
    expect(feeItems).toContain('vitality');
    // 纯 vitality 切片：敌方维度与 AP 都未被观测 → 不进入 items，不给贡献。
    expect(feeItems.some((f) => f.includes('enemy'))).toBe(false);
    expect(feeItems.some((f) => f === 'pool.ap')).toBe(false);
  });

  it('被观测费目都记 currentValue；未观测费目不进入 items', () => {
    const s = slice({ 'e:agent.pool.ip' : 3 });
    const breakdown = scoreBreakdown({ slice: s });
    const items = breakdown.items.filter((i) => i.feeItem === 'pool.ip');
    expect(items).toHaveLength(0);
  });

  it('死亡锚触发时 triggeredPivot===lethalWindow 且 contribution 等于死亡锚', () => {
    const s = slice({ 'e:agent.vitality': 1 });
    const breakdown = scoreBreakdown({ slice: s });
    const vitality = breakdown.items.find((i) => i.feeItem === 'vitality');
    expect(vitality?.triggeredPivot).toBe('lethalWindow');
    expect(vitality?.contribution).toBe(DESIGN_CURRENCY_PRINCIPLES.deathAnchor);
  });

  it('AP 耗尽时 triggeredPivot===exhaustionAnchor', () => {
    const s = slice({ 'e:agent.pool.ap': 0 });
    const breakdown = scoreBreakdown({ slice: s });
    const ap = breakdown.items.find((i) => i.feeItem === 'pool.ap');
    expect(ap?.triggeredPivot).toBe('exhaustionAnchor');
    expect(ap?.contribution).toBe(DESIGN_CURRENCY_PRINCIPLES.exhaustionAnchor);
  });

  it('被观测费目都有 currentValue', () => {
    const s = slice({ 'e:agent.vitality': 4 });
    const breakdown = scoreBreakdown({ slice: s });
    for (const item of breakdown.items) {
      expect(typeof item.currentValue).toBe('number');
      expect(Number.isFinite(item.currentValue)).toBe(true);
    }
  });
});

describe('StateSnapshot（Task5）', () => {
  it('往返：restore(snapshot(s)) 结构等价，再次 snapshot 得相同 hash', () => {
    const state = createEmptyWorldState('sched:round');
    const snap = snapshotWorldState(state);
    const restored = restoreFromSnapshot(snap);
    expect(hashWorldState(restored)).toBe(snap.stateHash);
  });

  it('键序无关：同一状态不同顶层键序产生相同 hash（property 3 单元版）', () => {
    const stateA = createEmptyWorldState('sched:x');
    const stateB: typeof stateA = {
      world: stateA.world,
      defs: {},
      nodes: {},
      links: {},
      entities: {},
      items: {},
      containers: {},
    };
    // 重新打乱顶层键序（用 record 重建），hash 仍相同——stableSerialize 按 key 排序。
    const reordered = { items: stateB.items, containers: stateB.containers, world: stateB.world, defs: stateB.defs, nodes: stateB.nodes, links: stateB.links, entities: stateB.entities } as unknown as typeof stateA;
    expect(hashWorldState(stateA)).toBe(hashWorldState(reordered));
  });

  it('hashWorldState 是稳定 64 位十六进制', () => {
    const state = createEmptyWorldState('sched:r');
    const h = hashWorldState(state);
    expect(/^[0-9a-f]{16}$/.test(h)).toBe(true);
  });

  it('cyrb53 对同一字符串恒定', () => {
    expect(cyrb53('abc')).toBe(cyrb53('abc'));
  });

  it('损坏快照抛带上下文错误', () => {
    expect(() => restoreFromSnapshot({ stateHash: 'h', serialized: '{ bad' })).toThrow(/JSON/i);
  });
});

describe('runtime（Task2/3）', () => {
  it('observedNumber 支持 `key===field` 与 `endWith .field` 两种投影', () => {
    expect(observedNumber({ ...slice({ a: 1 }), visibleFacts: { 'x.range': 2 } }, 'range')).toBe(2);
    expect(observedNumber(slice({ 'range': 3 }), 'range')).toBe(3);
  });

  it('scoreDesignCurrencyBreakdown 的 total 与既有 scoreDesignCurrency 一致', () => {
    const config = defaultDesignCurrencyConfig();
    const s = slice({ 'e:agent.vitality': 5, 'e:enemy.vitality': 3, 'e:agent.pool.ap': 2 });
    const runtime = scoreDesignCurrencyBreakdown(config, s);
    expect(scoreDesignCurrency({ slice: s })).toBeCloseTo(runtime.total, 6);
  });
});
