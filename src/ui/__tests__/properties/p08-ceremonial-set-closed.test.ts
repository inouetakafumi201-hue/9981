// Feature: wakeup-ui-animation, Property 8: 仪式动画集合闭合且每项有来源
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { planCeremonialPresentation, visibleStableIdFromProjection } from '../../animation/ceremonial';
import { CONFIRMED_DECISION_IDS } from '../../model/profile';
import { profileFixture } from '../support/fixtures';

it('任意集合外动作无全屏演出且集合内每项来源均已确认', () => {
  fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), (semantic) => {
    const profile = profileFixture();
    const registered = new Set(profile.ceremonialActionSemantics.map((item) => item.actionSemanticId));
    expect(profile.ceremonialActionSemantics.every((item) => (CONFIRMED_DECISION_IDS as readonly string[]).includes(item.authoritativeSource))).toBe(true);
    const result = planCeremonialPresentation({ actionSemanticId: semantic, resolutionBranch: semantic === 'parry-trigger' ? 'received-melee-attack' : 'resolved', profile, mode: 'standard', visibleStableId: visibleStableIdFromProjection('visible:event'), accessibleLabel: semantic });
    expect(result.some((cue) => cue.fullscreen)).toBe(registered.has(semantic));
  }), { numRuns: 100 });
});
