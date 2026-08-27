/**
 * Task 12 测试：表自述生成器。
 *  - generateFeeItemDocumentation 输出人类可读 Markdown，含当前当量/触发场景/±0.5 影响/调整史；
 *  - generateConfigOverview 输出整表概览；
 *  - 未知费目输出「不在当前费目表」提示。
 */
import { describe, expect, it } from 'vitest';
import { generateFeeItemDocumentation, generateConfigOverview } from '../documentation';
import { defaultDesignCurrencyConfig } from '../config-design-currency';

describe('documentation（Task12）', () => {
  it('已知费目输出 Markdown 含当前当量', () => {
    const config = defaultDesignCurrencyConfig();
    const doc = generateFeeItemDocumentation('e:enemy.vitality', config);
    expect(doc.markdown).toContain('敌人的生命值');
    expect(doc.markdown).toContain('当前内部定价');
    expect(doc.markdown).toContain('触发场景');
    expect(doc.markdown).toContain('±0.5');
  });

  it('玩家可见费目标注禁碰', () => {
    const config = defaultDesignCurrencyConfig();
    const doc = generateFeeItemDocumentation('vitality', config);
    expect(doc.markdown).toContain('禁碰');
  });

  it('未知费目输出「不在当前费目表」', () => {
    const config = defaultDesignCurrencyConfig();
    const doc = generateFeeItemDocumentation('nonexistent', config);
    expect(doc.markdown).toContain('不在当前费目表');
  });

  it('generateConfigOverview 输出整表概览含铁律与费目', () => {
    const config = defaultDesignCurrencyConfig();
    const overview = generateConfigOverview(config);
    expect(overview).toContain('死亡锚');
    expect(overview).toContain('致死窗口');
    expect(overview).toContain('资源耗尽锚');
    expect(overview).toContain('生命值');
    expect(overview).toContain('敌人的生命值');
    expect(overview).toContain('禁碰');
  });

  it('调整历史为空时输出「尚无记录」', () => {
    const config = defaultDesignCurrencyConfig();
    const doc = generateFeeItemDocumentation('heal', config);
    expect(doc.markdown).toContain('尚无');
  });

  it('调整历史非空时展示记录', () => {
    const config = defaultDesignCurrencyConfig();
    const history = [
      {
        id: 'tune-1', timestamp: 1000, iteration: 1,
        attribution: { violatedAssertion: 'a1', rootCauseFeeItem: 'heal', confidence: 0.8, evidenceTrace: null as unknown as never },
        change: { feeItem: 'heal', field: 'unit' as const, before: 3, after: 3.5, direction: 'increase' as const, magnitude: 0.5, reasoning: '测试调参' },
        verification: { targetAssertionPassed: true, regressionCount: 0, regressionDetails: [] },
        decision: 'accepted' as const,
      },
    ];
    const doc = generateFeeItemDocumentation('heal', config, history);
    expect(doc.markdown).toContain('提高了');
    expect(doc.markdown).toContain('已接受');
  });
});