// Feature: wakeup-ui-animation, Property 9: 动画不影响语义状态
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createAnimationScheduler } from '../../animation/scheduler';
import { planCeremonialPresentation, visibleStableIdFromProjection } from '../../animation/ceremonial';
import { arbReachableProjection } from '../support/arbitraries';
import { profileFixture, revision } from '../support/fixtures';

const MODES = ['standard', 'user-skipped', 'reduced-motion', 'resource-fallback'] as const;

it('任意演出启用、跳过、减少或资源失败都不改变规则投影', () => {
  fc.assert(fc.property(arbReachableProjection(), fc.constantFrom(...MODES), (reachable, mode) => {
    const before = reachable.projection.semanticStateFingerprint;
    const scheduler = createAnimationScheduler();
    scheduler.enqueue({ event: { sequence: 1, semanticType: 'after:vault', observedAtRevision: revision(1, before), safePayload: Object.freeze({}) } });
    scheduler.takeNext();
    if (mode === 'user-skipped') scheduler.skipAll();
    else scheduler.completeActive();
    const cues = planCeremonialPresentation({ actionSemanticId: 'vault-window', resolutionBranch: 'resolved', profile: profileFixture(), mode, visibleStableId: visibleStableIdFromProjection('visible:vault'), accessibleLabel: '翻窗' });
    expect(cues.every((cue) => !cue.changedSemanticState && !cue.changedLegality && !cue.changedCost)).toBe(true);
    expect(reachable.projection.semanticStateFingerprint).toBe(before);
  }), { numRuns: 100 });
});
