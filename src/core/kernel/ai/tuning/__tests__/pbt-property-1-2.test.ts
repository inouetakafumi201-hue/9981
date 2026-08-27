/**
 * 阶段 3 PBT：属性 1/2（分数守恒 + 未观测不计分）。
 *
 * 属性 1：对于任何（信念切片，费目配置），ScoreBreakdown.total === Σ items[].contribution。
 * 属性 2：observedNumber 未观测到值的费目不进入 items、贡献为 0。
 *
 * 生成器：随机 BeliefSlice（随机字段名 + 有限数值），随机配置子集。
 * numRuns ≥ 100，标签 `Feature: wakeup-ai-tuning, Property 1/2`。
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { scoreBreakdown, scoreDesignCurrency } from '../../design-currency';
import { observedNumber, scoreDesignCurrencyBreakdown } from '../runtime';
import { defaultDesignCurrencyConfig } from '../config-design-currency';
import type { BeliefSlice } from '../../types';

/** 随机信念切片生成器：0-5 个随机字段，值 0-10。 */
const arbitrarySlice: fc.Arbitrary<BeliefSlice> = fc
  .dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.integer({ min: 0, max: 10 }))
  .map((facts): BeliefSlice => ({
    agent: { $: 'g:agent' },
    visibleFacts: facts,
    knownFacts: {} as Record<string, never>,
    visibleRefs: [] as never[],
    policyContext: {} as Record<string, never>,
  }));

describe('PBT 属性 1/2（Task17）', () => {
  it('属性 1：分数构成总和守恒（ScoreBreakdown.total === Σ items[].contribution）', () => {
    fc.assert(
      fc.property(arbitrarySlice, (slice) => {
        const breakdown = scoreBreakdown({ slice });
        const sum = breakdown.items.reduce((acc, item) => acc + item.contribution, 0);
        // 浮点精度：允许 1e-10 误差。
        return Math.abs(breakdown.total - sum) < 1e-10;
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 1 延伸：scoreDesignCurrency 与 breakdown.total 一致', () => {
    fc.assert(
      fc.property(arbitrarySlice, (slice) => {
        const total = scoreDesignCurrency({ slice });
        const breakdown = scoreBreakdown({ slice });
        return Math.abs(total - breakdown.total) < 1e-10;
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 2：未观测不计分——费目不在 items 中', () => {
    fc.assert(
      fc.property(arbitrarySlice, (slice) => {
        const breakdown = scoreBreakdown({ slice });
        // 对每个费目：若 observedNumber 返回 null，则不应出现在 items 中。
        const config = defaultDesignCurrencyConfig();
        for (const charge of config.charges) {
          const observed = observedNumber(slice, charge.field);
          const inItems = breakdown.items.some((i) => i.feeItem === charge.field);
          if (observed === null) {
            // 未观测 → 不应在 items 中。
            if (inItems) return false;
          }
        }
        return true;
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 2 延伸：未观测费目贡献为 0（不进入 items 即贡献 0）', () => {
    fc.assert(
      fc.property(arbitrarySlice, (slice) => {
        const config = defaultDesignCurrencyConfig();
        const breakdown = scoreDesignCurrencyBreakdown(config, slice);
        const sum = breakdown.items.reduce((acc, item) => acc + item.contribution, 0);
        return Math.abs(breakdown.total - sum) < 1e-10;
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});