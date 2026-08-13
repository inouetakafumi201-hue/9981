// Feature: wakeup-ui-animation, Property 3: 玩家可见数值恒在 1—5 的整数域
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { discreteSegments, makeGameplayValue } from '../../presentation/gameplay-value.js';

it('任意输入只有 1—5 整数能进入离散玩法数值呈现', () => {
  const raw = fc.oneof(fc.double({ noNaN: false, noDefaultInfinity: false }), fc.integer(), fc.string(), fc.constant(null));
  fc.assert(fc.property(raw, (candidate) => {
    const result = makeGameplayValue(candidate, { category: 'resource', playerVisible: true, role: 'hp' });
    if (result.ok) {
      expect(Number.isInteger(result.value.value)).toBe(true);
      expect(result.value.value).toBeGreaterThanOrEqual(1);
      expect(result.value.value).toBeLessThanOrEqual(5);
      expect(discreteSegments(result.value)).toHaveLength(5);
    } else {
      expect(typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 1 || candidate > 5 || !Number.isFinite(candidate)).toBe(true);
    }
  }), { numRuns: 200 });
});
