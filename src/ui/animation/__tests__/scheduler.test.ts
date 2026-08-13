import { describe, expect, it, vi } from 'vitest';

import { revision } from '../../__tests__/support/fixtures.js';
import type { RuleEventProjection } from '../../model/event-projection.js';
import type { AnimationCompletionHandler, AnimationQueueRequest } from '../scheduler.js';
import { createAnimationScheduler } from '../scheduler.js';

function event(sequence: number, revisionSequence = 1, fingerprint = 'fp-1'): RuleEventProjection {
  return Object.freeze({
    sequence,
    semanticType: `event.${sequence}`,
    observedAtRevision: revision(revisionSequence, fingerprint),
    safePayload: Object.freeze({}),
  });
}

function request(
  sequence: number,
  options: Partial<Omit<AnimationQueueRequest, 'event'>> & {
    readonly revisionSequence?: number;
    readonly fingerprint?: string;
  } = {},
): AnimationQueueRequest {
  return Object.freeze({
    event: event(sequence, options.revisionSequence ?? 1, options.fingerprint ?? 'fp-1'),
    ...(options.coalesceKey === undefined ? {} : { coalesceKey: options.coalesceKey }),
    ...(options.targetId === undefined ? {} : { targetId: options.targetId }),
    ...(options.onComplete === undefined ? {} : { onComplete: options.onComplete }),
  });
}

describe('演出队列使用权威因果顺序', () => {
  it('乱序到达仍按修订令牌与事件 sequence 播放', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(30, { revisionSequence: 2, fingerprint: 'fp-2' }));
    scheduler.enqueue(request(20));
    scheduler.enqueue(request(10));

    expect(scheduler.snapshot().pending.map((item) => item.sequence)).toEqual([10, 20, 30]);
    expect(scheduler.takeNext()[0]?.eventSequences).toEqual([10]);
    scheduler.completeActive();
    expect(scheduler.takeNext()[0]?.eventSequences).toEqual([20]);
    scheduler.completeActive();
    expect(scheduler.takeNext()[0]?.eventSequences).toEqual([30]);
  });

  it('同一修订序号但不同指纹时显式拒绝而不猜顺序', () => {
    const scheduler = createAnimationScheduler();
    expect(scheduler.enqueue(request(1))).toEqual({ accepted: true });
    expect(scheduler.enqueue(request(2, { fingerprint: 'conflict' }))).toEqual({
      accepted: false,
      reason: 'revision-conflict',
      conflictingSequence: 1,
    });
    expect(scheduler.snapshot().pending.map((item) => item.sequence)).toEqual([1]);
  });

  it('重复事件序号被拒绝', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(1));
    expect(scheduler.enqueue(request(1))).toEqual({
      accepted: false,
      reason: 'duplicate-sequence',
      conflictingSequence: 1,
    });
  });
});

describe('合并、完成与跳过保持全部语义结果', () => {
  it('仅显式同键且因果相邻的事件合并，并保留每个序号与语义类型', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(3, { coalesceKey: 'damage-burst' }));
    scheduler.enqueue(request(1, { coalesceKey: 'damage-burst' }));
    scheduler.enqueue(request(2, { coalesceKey: 'damage-burst' }));

    const started = scheduler.takeNext();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      kind: 'coalesce',
      eventSequences: [1, 2, 3],
      semanticTypes: ['event.1', 'event.2', 'event.3'],
    });

    const completed = scheduler.completeActive();
    expect(completed[0]).toMatchObject({
      kind: 'final-state',
      eventSequences: [1, 2, 3],
    });
    expect(completed.filter((command) => command.kind === 'announce')).toHaveLength(3);
  });

  it('未声明合并键的事件逐个播放', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(1));
    scheduler.enqueue(request(2));
    expect(scheduler.takeNext()[0]).toMatchObject({ kind: 'play', eventSequences: [1] });
    scheduler.completeActive();
    expect(scheduler.takeNext()[0]).toMatchObject({ kind: 'play', eventSequences: [2] });
  });

  it('跳过会立即逐事件产出最终态与必需播报并清空队列', () => {
    const onComplete = vi.fn<AnimationCompletionHandler>();
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(2, { onComplete }));
    scheduler.enqueue(request(1, { onComplete }));
    scheduler.takeNext();

    const commands = scheduler.skipAll();
    expect(commands.filter((command) => command.kind === 'final-state')).toHaveLength(2);
    expect(commands.filter((command) => command.kind === 'announce')).toHaveLength(2);
    expect(commands.filter((command) => command.kind === 'fast-forward')).toHaveLength(2);
    expect(scheduler.snapshot()).toEqual({ active: [], pending: [] });
    expect(onComplete.mock.calls.map(([info]) => Object.keys(info).sort())).toEqual([
      ['eventSequence', 'semanticType'],
      ['eventSequence', 'semanticType'],
    ]);
  });

  it('完成回调的类型只允许一个完成信息参数', () => {
    const valid: AnimationCompletionHandler = (_info) => undefined;
    const typeLevelChecks = (): void => {
      // @ts-expect-error 完成回调不能声明额外的必需能力参数
      const invalid: AnimationCompletionHandler = (_info, _capability: { invoke(): void }) => undefined;
      void invalid;
    };
    expect(typeof valid).toBe('function');
    expect(typeLevelChecks).toBeTypeOf('function');
  });
});

describe('过时演出的取消、重定向、快进与替换', () => {
  it('活动演出可重定向，取消时仍呈现最终态与播报', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(1, { targetId: 'old' }));
    scheduler.takeNext();
    expect(scheduler.retargetActive('new')).toEqual([
      expect.objectContaining({ kind: 'retarget', targetId: 'new', eventSequences: [1] }),
    ]);
    expect(scheduler.cancelActive().map((command) => command.kind)).toEqual([
      'cancel',
      'final-state',
      'announce',
    ]);
  });

  it('尚未播放的演出可以确定性替换', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(1));
    scheduler.enqueue(request(2));
    const result = scheduler.replacePending(2, request(4));
    expect(result.admission).toEqual({ accepted: true });
    expect(result.commands[0]).toMatchObject({ kind: 'cancel', eventSequences: [2] });
    expect(scheduler.snapshot().pending.map((item) => item.sequence)).toEqual([1, 4]);
  });

  it('新投影到达时活动旧演出快进、排队旧演出取消，并以新修订呈现最终态', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(1));
    scheduler.enqueue(request(2));
    scheduler.takeNext();

    const result = scheduler.reconcileToRevision(revision(2, 'fp-2'));
    expect(result.incomparableEventSequences).toEqual([]);
    expect(result.commands.map((command) => command.kind)).toEqual([
      'fast-forward',
      'final-state',
      'announce',
      'cancel',
      'final-state',
      'announce',
    ]);
    expect(result.commands.every((command) => command.revision.sequence === 2)).toBe(true);
    expect(scheduler.snapshot()).toEqual({ active: [], pending: [] });
  });

  it('与当前投影不可比较的演出被取消并显式报告', () => {
    const scheduler = createAnimationScheduler();
    scheduler.enqueue(request(7));
    const result = scheduler.reconcileToRevision(revision(1, 'different'));
    expect(result.incomparableEventSequences).toEqual([7]);
    expect(result.commands).toEqual([
      expect.objectContaining({ kind: 'cancel', eventSequences: [7] }),
    ]);
  });
});
