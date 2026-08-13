// Feature: wakeup-ui-animation, Property 18: 无障碍等价物在呈现失败时仍存在
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { buildAccessibleOutputs, PRESENTATION_CHANNELS, ruleSignificantItems } from '../../presentation/accessibility.js';
import { arbLegalActionSet } from '../support/arbitraries.js';
import { uiViewFixture } from '../support/fixtures.js';

it('任意表现通道失败组合都不减少读屏、字幕和 ARIA 信息', () => {
  const failed = fc.uniqueArray(fc.constantFrom(...PRESENTATION_CHANNELS), { maxLength: PRESENTATION_CHANNELS.length });
  fc.assert(fc.property(arbLegalActionSet(6), failed, fc.boolean(), (actions, failedChannels, reducedMotion) => {
    const view = uiViewFixture({ actions });
    const expected = ruleSignificantItems(view);
    const output = buildAccessibleOutputs(view, { failedChannels, reducedMotion });
    expect(output.screenReader).toEqual(expected.map((item) => item.accessibleLabel));
    expect(output.captions).toEqual(expected.map((item) => item.accessibleLabel));
    expect(output.ariaMetadata.map((item) => item.itemId)).toEqual(expected.map((item) => item.itemId));
  }), { numRuns: 100 });
});
