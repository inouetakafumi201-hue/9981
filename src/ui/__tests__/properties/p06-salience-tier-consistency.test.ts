// Feature: wakeup-ui-animation, Property 6: 显著性分层由描述符决定且与规则可见性一致
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { UI_DIAGNOSTIC_CODES } from '../../model/diagnostic.js';
import { resolveSalienceTier } from '../../presentation/salience.js';
import { profileFixture } from '../support/fixtures.js';

it('任意显著性档位只接受与规则可见性一致的显式 profile 声明', () => {
  fc.assert(fc.property(fc.constantFrom('weakness', 'aiming', 'parry-ready'), fc.boolean(), (state, useMatching) => {
    const declaredHidden = state === 'parry-ready';
    const ruleVisibility = (useMatching ? declaredHidden : !declaredHidden) ? 'hidden' : 'public';
    const result = resolveSalienceTier({ stateSemanticId: state, profile: profileFixture(), ruleVisibility, presentationLocation: `test/${state}` });
    expect(result.ok).toBe(useMatching);
    if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toContain(UI_DIAGNOSTIC_CODES.SALIENCE_TIER_CONFLICT);
  }), { numRuns: 100 });
});
