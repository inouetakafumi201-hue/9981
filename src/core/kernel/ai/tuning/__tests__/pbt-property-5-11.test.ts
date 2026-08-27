/**
 * 阶段 3 PBT：属性 5/11（断言 + 配置序列化往返）。
 *
 * 属性 5：对于任何 BehaviorAssertion，序列化→再解析应语义等价；再序列化紧凑形态稳定。
 * 属性 11：对于任何 DesignCurrencyConfig，序列化→解析→再序列化保持语义等价且 version 不变。
 *
 * 生成器：随机断言 / 配置对象。
 * numRuns ≥ 100，标签 `Feature: wakeup-ai-tuning, Property 5/11`。
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { BehaviorAssertionRegistry, loadAssertionsJson } from '../assertions';
import { defaultDesignCurrencyConfig, parseDesignCurrencyConfig, toCompactCharge } from '../config-design-currency';
import type { BehaviorAssertion } from '../assertions';
import type { DesignCurrencyConfig } from '../config-design-currency';

/** 随机断言生成器。 */
const arbitraryAssertion: fc.Arbitrary<BehaviorAssertion> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 40 }),
  category: fc.constantFrom('sustain', 'aggro', 'defeat', 'resource'),
  description: fc.string({ minLength: 1, maxLength: 80 }),
  setup: fc.record({
    stateHash: fc.string({ minLength: 1, maxLength: 20 }),
    serialized: fc.constant('{}'),
  }),
  expect: fc.record({
    shouldSelect: fc.constantFrom('a:heal', 'a:attack', 'a:eternal-sleep', ''),
    shouldNotSelect: fc.constantFrom([], ['a:overcharge'], ['a:attack']),
  }),
  isGolden: fc.boolean(),
  source: fc.constantFrom('initial', 'initial'),
});

/** 随机配置生成器：基于默认配置随机改一个 unit + 一个 field 名。 */
const arbitraryConfig: fc.Arbitrary<DesignCurrencyConfig> = fc
  .record({
    unitShift: fc.integer({ min: -2, max: 2 }),
    field: fc.constantFrom('heal', 'E', 'range', 'pool.ap', 'pool.stamina'),
  })
  .map((c) => {
    const base = defaultDesignCurrencyConfig();
    const charges = base.charges.map((charge) =>
      charge.field === c.field ? { ...charge, unit: Math.max(1, charge.unit + c.unitShift) } : { ...charge },
    );
    return { ...base, charges } as DesignCurrencyConfig;
  });

describe('PBT 属性 5/11（Task19）', () => {
  it('属性 5：断言 JSON round-trip 语义等价（导出→导入保留 id/stateHash）', () => {
    fc.assert(
      fc.property(arbitraryAssertion, (assertion) => {
        const reg = new BehaviorAssertionRegistry([assertion]);
        const json = reg.exportToJson();
        const reloaded = loadAssertionsJson(json);
        const found = reloaded.find((a) => a.id === assertion.id);
        if (found === undefined) return false;
        return found.setup.stateHash === assertion.setup.stateHash && found.isGolden === assertion.isGolden;
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 5 延伸：紧凑形态稳定（再序列化与首次一致）', () => {
    fc.assert(
      fc.property(arbitraryAssertion, (assertion) => {
        const reg = new BehaviorAssertionRegistry([assertion]);
        const first = reg.exportToJson();
        const reloaded = loadAssertionsJson(first);
        const reg2 = new BehaviorAssertionRegistry(reloaded);
        const second = reg2.exportToJson();
        return first === second;
      }),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 11：DesignCurrencyConfig round-trip 且 version 不变', () => {
    fc.assert(
      fc.property(arbitraryConfig, (config) => {
        const json = JSON.stringify({ version: config.version, principles: { ...config.principles }, charges: config.charges.map((c) => toCompactCharge(c)) });
        const reparsed = parseDesignCurrencyConfig(JSON.parse(json));
        if (reparsed.version !== config.version) return false;
        if (reparsed.charges.length !== config.charges.length) return false;
        // 逐费目 unit 与 range 保持一致。
        for (let i = 0; i < config.charges.length; i++) {
          const a = reparsed.charges[i];
          const b = config.charges[i];
          if (a === undefined || b === undefined) return false;
          if (a.field !== b.field || a.unit !== b.unit) return false;
          if (a.tunableRange[0] !== b.tunableRange[0] || a.tunableRange[1] !== b.tunableRange[1]) return false;
        }
        return true;
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});