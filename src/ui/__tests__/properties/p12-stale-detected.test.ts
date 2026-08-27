// Feature: wakeup-ui-animation, Property 12: 过期状态必被检出
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { classifyStaleness } from '../../projection/staleness';
import { arbRevisionPair } from '../support/arbitraries';

it('任意非同一修订都不会被判为 fresh，且不可比较必全量重同步', () => {
  fc.assert(fc.property(arbRevisionPair(), (pair) => {
    const verdict = classifyStaleness(pair.left, pair.right);
    if (pair.expected === 'same') expect(verdict).toBe('fresh');
    else if (pair.expected === 'older') expect(verdict).toBe('stale');
    else expect(verdict).toBe('requires-full-resync');
    expect(verdict === 'fresh').toBe(pair.expected === 'same');
  }), { numRuns: 100 });
});
