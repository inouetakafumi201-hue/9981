// Feature: wakeup-ui-animation, Property 4: 内部度量不被当作玩法数值渲染
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { isGameplayValue, isInternalMetric, makeInternalMetric } from '../../presentation/gameplay-value.js';
import { ruleSignificantItems } from '../../presentation/accessibility.js';
import { uiViewFixture } from '../support/fixtures.js';

it('任意内部度量保持独立 brand 且不进入规则显著项', () => {
  fc.assert(fc.property(fc.integer(), fc.string({ minLength: 1 }), (value, unit) => {
    const metric = makeInternalMetric(value, unit);
    const view = uiViewFixture({ turn: value });
    expect(isInternalMetric(metric)).toBe(true);
    expect(isGameplayValue(metric)).toBe(false);
    expect(view.turn.__brand).toBe('InternalMetric');
    expect(JSON.stringify(ruleSignificantItems(view))).not.toContain('InternalMetric');
  }), { numRuns: 100 });
});
