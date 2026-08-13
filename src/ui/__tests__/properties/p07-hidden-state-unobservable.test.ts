// Feature: wakeup-ui-animation, Property 7: 隐藏状态不产生任何可观察呈现
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { planCeremonialPresentation, visibleStableIdFromProjection } from '../../animation/ceremonial.js';
import { resolveSalientStates } from '../../presentation/salience.js';
import { profileFixture } from '../support/fixtures.js';

it('任意非所有者观察隐藏招架状态都等同于不存在且静默失效无演出', () => {
  const lapse = fc.constantFrom('received-ranged-attack' as const, 'received-unparryable-damage' as const);
  fc.assert(fc.property(fc.string({ minLength: 1 }), lapse, (observerId, branch) => {
    fc.pre(observerId !== 'owner');
    const profile = profileFixture();
    const hidden = resolveSalientStates({ declarations: [{ stateSemanticId: 'parry-ready', ownerEntityId: 'owner', accessibleLabel: '招架准备', ruleVisibility: 'hidden' }], profile, observerOwnedEntityIds: [observerId] });
    const absent = resolveSalientStates({ declarations: [], profile, observerOwnedEntityIds: [observerId] });
    expect(hidden.views).toStrictEqual(absent.views);
    expect(planCeremonialPresentation({ actionSemanticId: 'parry-trigger', resolutionBranch: branch, profile, mode: 'standard', visibleStableId: visibleStableIdFromProjection('visible:event'), accessibleLabel: '招架' })).toEqual([]);
  }), { numRuns: 100 });
});
