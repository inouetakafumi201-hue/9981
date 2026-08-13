import { describe, expect, it } from 'vitest';

import { profileFixture } from '../../__tests__/support/fixtures.js';
import {
  REJECTED_OUTCOME,
  createInMemoryActionPort,
} from '../../__tests__/support/in-memory-ports.js';
import { makeInternalMetric } from '../../presentation/gameplay-value.js';
import type { SubmissionOutcome } from '../../ports/action-port.js';
import { COUNTDOWN_STATES, createEndTurnCountdown } from '../end-turn-countdown.js';
import type { InteractionIntent } from '../../model/intent.js';
import { revision } from '../../__tests__/support/fixtures.js';

const END_TURN_INTENT: InteractionIntent = Object.freeze({
  intentId: 'intent:end-turn',
  agentId: 'agent.a',
  target: Object.freeze({ kind: 'action' as const, actionId: 'act.end-turn' }),
  bindings: Object.freeze({}),
  observedRevision: revision(1, 'fp-1'),
  inputSource: 'keyboard' as const,
});

function countdown(profile = profileFixture()) {
  const actionPort = createInMemoryActionPort({
    kind: 'accepted',
    committedRevision: revision(2, 'fp-2'),
  });
  const submitEndTurn = (): SubmissionOutcome => actionPort.submit(END_TURN_INTENT);
  return { actionPort, timer: createEndTurnCountdown({ profile, submitEndTurn }) };
}

describe('倒计时不改变规则语义（tasks.md 任务 5.5、Requirement 5.12—5.14）', () => {
  it('状态机里没有任何表示"回合已结束"的取值', () => {
    expect(COUNTDOWN_STATES).toEqual(['idle', 'running', 'cancelled', 'submitted']);
    expect(COUNTDOWN_STATES.some((state) => /end|over|finish/u.test(state))).toBe(false);
  });

  it('秒数取自 profile 且是内部度量', () => {
    const profile = profileFixture({
      endTurnCountdown: {
        seconds: makeInternalMetric(5, 's'),
        cancellable: true,
        authoritativeSource: 'D-042',
      },
    });
    const { timer } = countdown(profile);
    timer.start(0);
    expect(timer.tick(4_999).state).toBe('running');
    expect(timer.tick(5_000).state).toBe('submitted');
  });

  it('倒计时结束经与其他意图相同的权威通道提交，且不当作回合已结束', () => {
    const { actionPort, timer } = countdown();
    timer.start(0);
    const elapsed = timer.tick(3_000);
    expect(elapsed.state).toBe('submitted');
    expect(elapsed.submission?.kind).toBe('accepted');
    expect(actionPort.submitted()).toHaveLength(1);
    expect(actionPort.submitted()[0]?.target).toEqual({ kind: 'action', actionId: 'act.end-turn' });
  });
});

describe('任意时刻可取消（反悔窗口）', () => {
  it('取消后不再提交，且规则语义不变', () => {
    for (const cancelAt of [0, 500, 1_500, 2_999]) {
      const { actionPort, timer } = countdown();
      timer.start(0);
      timer.tick(cancelAt);
      const cancelled = timer.cancel();
      expect(cancelled.state, String(cancelAt)).toBe('cancelled');
      expect(timer.tick(10_000).state).toBe('cancelled');
      expect(actionPort.submitted()).toHaveLength(0);
    }
  });

  it('profile 声明不可取消时 cancel 不改变状态', () => {
    const profile = profileFixture({
      endTurnCountdown: {
        seconds: makeInternalMetric(3, 's'),
        cancellable: false,
        authoritativeSource: 'D-042',
      },
    });
    const { timer } = countdown(profile);
    timer.start(0);
    expect(timer.cancel().state).toBe('running');
  });

  it('未启动时 tick 不提交', () => {
    const { actionPort, timer } = countdown();
    expect(timer.tick(10_000).state).toBe('idle');
    expect(actionPort.submitted()).toHaveLength(0);
  });

  it('剩余时间单调不增，且恒为内部度量', () => {
    const { timer } = countdown();
    timer.start(0);
    const samples = [0, 1_000, 2_000, 2_999].map((now) => timer.tick(now).remaining);
    expect(samples.every((metric) => metric.__brand === 'InternalMetric')).toBe(true);
    expect(samples.map((metric) => metric.value)).toEqual([3_000, 2_000, 1_000, 1]);
  });

  it('倒计时提交被拒绝时也只是一次普通拒绝，不改变规则语义', () => {
    const actionPort = createInMemoryActionPort(REJECTED_OUTCOME);
    const timer = createEndTurnCountdown({
      profile: profileFixture(),
      submitEndTurn: () => actionPort.submit(END_TURN_INTENT),
    });
    timer.start(0);
    const elapsed = timer.tick(3_000);
    expect(elapsed.state).toBe('submitted');
    expect(elapsed.submission?.kind).toBe('rejected');
  });
});
