// Feature: wakeup-ui-animation, Property 15: 倒计时不改变规则语义
import fc from 'fast-check';
import { expect, it, vi } from 'vitest';

import { createEndTurnCountdown } from '../../interaction/end-turn-countdown';
import { profileFixture, revision } from '../support/fixtures';

it('任意取消时刻都不提交、不改变规则指纹，结束也只产生普通提交', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 2999 }), (cancelAt) => {
    const fingerprint = 'semantic:unchanged';
    const submitEndTurn = vi.fn(() => ({ kind: 'accepted' as const, committedRevision: revision(2, 'fp:2') }));
    const timer = createEndTurnCountdown({ profile: profileFixture(), submitEndTurn });
    timer.start(0);
    timer.tick(cancelAt);
    expect(timer.cancel().state).toBe('cancelled');
    expect(timer.tick(10_000).state).toBe('cancelled');
    expect(submitEndTurn).not.toHaveBeenCalled();
    expect(fingerprint).toBe('semantic:unchanged');
  }), { numRuns: 100 });
});
