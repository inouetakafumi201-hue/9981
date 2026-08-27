// Feature: wakeup-ui-animation, Property 17: 可选项集合不超过 5
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { buildOptionSet, MAX_SIMULTANEOUS_OPTIONS } from '../../model/option-set';
import { arbLegalActionSet } from '../support/arbitraries';

it('任意规模与导航位置同时呈现的动作和导航控件总数都不超过 5', () => {
  const cursor = fc.record({ path: fc.constantFrom<readonly string[]>([], ['paid'], ['attached'], ['paid', 'traversal'], ['attached', 'hostile-interaction']), page: fc.nat({ max: 30 }) });
  fc.assert(fc.property(fc.integer({ min: 0, max: 120 }).chain(arbLegalActionSet), cursor, (actions, selected) => {
    const set = buildOptionSet(actions, selected);
    expect(set.visible.length).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPTIONS);
    expect(set.totalLegalOptions.value).toBe(actions.length);
    expect(new Set(set.visible.map((item) => item.optionId)).size).toBe(set.visible.length);
  }), { numRuns: 150 });
});
