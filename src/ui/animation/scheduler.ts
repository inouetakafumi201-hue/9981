/**
 * 演出队列与因果顺序（design.md §16.1、§16.2，tasks.md 任务 6.1）。
 *
 * 排序只依赖权威事件序号与修订令牌，不读取本地时间，也不以到达先后打破平局。
 * 动画完成回调只收到不可变的事件标识信息，不能获得任何提交能力。
 */

import type { RuleEventProjection } from '../model/event-projection';
import { compareRevision, revisionSortKey, type StateRevision } from '../model/revision';

export const PRESENTATION_COMMAND_KINDS = [
  'play',
  'coalesce',
  'retarget',
  'cancel',
  'fast-forward',
  'final-state',
  'announce',
] as const;
export type PresentationCommandKind = (typeof PRESENTATION_COMMAND_KINDS)[number];

export const NONESSENTIAL_COMMAND_KINDS: readonly PresentationCommandKind[] = Object.freeze([
  'play',
  'coalesce',
  'retarget',
]);

export interface PresentationCommand {
  readonly kind: PresentationCommandKind;
  readonly eventSequences: readonly number[];
  readonly semanticTypes: readonly string[];
  readonly revision: StateRevision;
  readonly targetId?: string;
}

export interface AnimationCompletionInfo {
  readonly eventSequence: number;
  readonly semanticType: string;
}

export type AnimationCompletionHandler = (info: AnimationCompletionInfo) => void;

export interface AnimationQueueRequest {
  readonly event: RuleEventProjection;
  /** 只有调用方显式给出同一个键时，队列才允许合并相邻演出。 */
  readonly coalesceKey?: string;
  readonly targetId?: string;
  readonly onComplete?: AnimationCompletionHandler;
}

export type AnimationAdmission =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: 'duplicate-sequence' | 'revision-conflict';
      readonly conflictingSequence: number;
    };

export interface AnimationSchedulerSnapshot {
  readonly active: readonly RuleEventProjection[];
  readonly pending: readonly RuleEventProjection[];
}

export interface AnimationReconcileResult {
  readonly commands: readonly PresentationCommand[];
  /** 同一修订序号却指向不同指纹的事件。队列不会猜测其顺序。 */
  readonly incomparableEventSequences: readonly number[];
}

export interface AnimationReplacementResult {
  readonly admission: AnimationAdmission;
  readonly commands: readonly PresentationCommand[];
}

export interface AnimationScheduler {
  enqueue(request: AnimationQueueRequest): AnimationAdmission;
  /** 取出权威顺序最前的一组并开始演出。已有活动组时返回空数组。 */
  takeNext(): readonly PresentationCommand[];
  /** 完成活动组，先呈现最终态与逐事件播报，再调用无提交能力的完成回调。 */
  completeActive(): readonly PresentationCommand[];
  cancelActive(): readonly PresentationCommand[];
  retargetActive(targetId: string): readonly PresentationCommand[];
  /** 用新事件替换尚未播放的指定事件；替换失败时原事件保持不变。 */
  replacePending(eventSequence: number, replacement: AnimationQueueRequest): AnimationReplacementResult;
  /** 以新权威投影修订收敛：过时演出被快进/取消，不可比较事件被显式报告。 */
  reconcileToRevision(revision: StateRevision): AnimationReconcileResult;
  /** 跳过全部演出，但逐事件立即呈现等价最终态与必需播报。 */
  skipAll(): readonly PresentationCommand[];
  snapshot(): AnimationSchedulerSnapshot;
}

function compareRequests(left: AnimationQueueRequest, right: AnimationQueueRequest): number {
  const leftRevision = revisionSortKey(left.event.observedAtRevision);
  const rightRevision = revisionSortKey(right.event.observedAtRevision);
  if (leftRevision < rightRevision) return -1;
  if (leftRevision > rightRevision) return 1;
  return left.event.sequence - right.event.sequence;
}

function sameRevision(left: StateRevision, right: StateRevision): boolean {
  return compareRevision(left, right) === 'same';
}

function freezeCommand(
  kind: PresentationCommandKind,
  requests: readonly AnimationQueueRequest[],
  revision = requests[0]?.event.observedAtRevision,
  targetId?: string,
): PresentationCommand {
  if (requests.length === 0 || revision === undefined) {
    throw new Error('presentation command requires at least one authoritative event');
  }
  return Object.freeze({
    kind,
    eventSequences: Object.freeze(requests.map((request) => request.event.sequence)),
    semanticTypes: Object.freeze(requests.map((request) => request.event.semanticType)),
    revision,
    ...(targetId === undefined ? {} : { targetId }),
  });
}

function finalStateAndAnnouncements(
  requests: readonly AnimationQueueRequest[],
  revision?: StateRevision,
): readonly PresentationCommand[] {
  if (requests.length === 0) return Object.freeze([]);
  const commands: PresentationCommand[] = [
    freezeCommand('final-state', requests, revision ?? requests[0]?.event.observedAtRevision),
  ];
  for (const request of requests) {
    commands.push(
      freezeCommand('announce', [request], revision ?? request.event.observedAtRevision),
    );
  }
  return Object.freeze(commands);
}

function completionInfo(request: AnimationQueueRequest): AnimationCompletionInfo {
  return Object.freeze({
    eventSequence: request.event.sequence,
    semanticType: request.event.semanticType,
  });
}

export function createAnimationScheduler(): AnimationScheduler {
  let pending: AnimationQueueRequest[] = [];
  let active: AnimationQueueRequest[] = [];

  function allRequests(exceptPendingSequence?: number): readonly AnimationQueueRequest[] {
    return [
      ...active,
      ...pending.filter((request) => request.event.sequence !== exceptPendingSequence),
    ];
  }

  function admissionFor(
    request: AnimationQueueRequest,
    exceptPendingSequence?: number,
  ): AnimationAdmission {
    for (const existing of allRequests(exceptPendingSequence)) {
      if (existing.event.sequence === request.event.sequence) {
        return Object.freeze({
          accepted: false as const,
          reason: 'duplicate-sequence' as const,
          conflictingSequence: existing.event.sequence,
        });
      }
      if (
        compareRevision(existing.event.observedAtRevision, request.event.observedAtRevision) ===
        'uncomparable'
      ) {
        return Object.freeze({
          accepted: false as const,
          reason: 'revision-conflict' as const,
          conflictingSequence: existing.event.sequence,
        });
      }
    }
    return Object.freeze({ accepted: true as const });
  }

  function invokeCompletions(requests: readonly AnimationQueueRequest[]): void {
    for (const request of requests) request.onComplete?.(completionInfo(request));
  }

  function snapshot(): AnimationSchedulerSnapshot {
    return Object.freeze({
      active: Object.freeze(active.map((request) => request.event)),
      pending: Object.freeze(pending.map((request) => request.event)),
    });
  }

  return Object.freeze({
    enqueue(request: AnimationQueueRequest): AnimationAdmission {
      const admission = admissionFor(request);
      if (!admission.accepted) return admission;
      pending = [...pending, request].sort(compareRequests);
      return admission;
    },

    takeNext(): readonly PresentationCommand[] {
      if (active.length > 0 || pending.length === 0) return Object.freeze([]);
      const first = pending[0];
      if (first === undefined) return Object.freeze([]);
      active = [first];
      pending = pending.slice(1);

      if (first.coalesceKey !== undefined) {
        while (pending.length > 0) {
          const candidate = pending[0];
          if (
            candidate === undefined ||
            candidate.coalesceKey !== first.coalesceKey ||
            !sameRevision(candidate.event.observedAtRevision, first.event.observedAtRevision)
          ) {
            break;
          }
          active.push(candidate);
          pending = pending.slice(1);
        }
      }

      const kind: PresentationCommandKind = active.length > 1 ? 'coalesce' : 'play';
      return Object.freeze([
        freezeCommand(kind, active, active[0]?.event.observedAtRevision, first.targetId),
      ]);
    },

    completeActive(): readonly PresentationCommand[] {
      if (active.length === 0) return Object.freeze([]);
      const completed = active;
      active = [];
      const commands = finalStateAndAnnouncements(completed);
      invokeCompletions(completed);
      return commands;
    },

    cancelActive(): readonly PresentationCommand[] {
      if (active.length === 0) return Object.freeze([]);
      const cancelled = active;
      active = [];
      const commands = Object.freeze([
        freezeCommand('cancel', cancelled),
        ...finalStateAndAnnouncements(cancelled),
      ]);
      invokeCompletions(cancelled);
      return commands;
    },

    retargetActive(targetId: string): readonly PresentationCommand[] {
      if (active.length === 0) return Object.freeze([]);
      return Object.freeze([freezeCommand('retarget', active, active[0]?.event.observedAtRevision, targetId)]);
    },

    replacePending(
      eventSequence: number,
      replacement: AnimationQueueRequest,
    ): AnimationReplacementResult {
      const replaced = pending.find((request) => request.event.sequence === eventSequence);
      if (replaced === undefined) {
        return Object.freeze({
          admission: Object.freeze({
            accepted: false as const,
            reason: 'duplicate-sequence' as const,
            conflictingSequence: eventSequence,
          }),
          commands: Object.freeze([]),
        });
      }
      const admission = admissionFor(replacement, eventSequence);
      if (!admission.accepted) {
        return Object.freeze({ admission, commands: Object.freeze([]) });
      }
      pending = [
        ...pending.filter((request) => request.event.sequence !== eventSequence),
        replacement,
      ].sort(compareRequests);
      return Object.freeze({
        admission,
        commands: Object.freeze([freezeCommand('cancel', [replaced])]),
      });
    },

    reconcileToRevision(revision: StateRevision): AnimationReconcileResult {
      const commands: PresentationCommand[] = [];
      const incomparable: number[] = [];

      if (active.length > 0) {
        const comparison = compareRevision(active[0]?.event.observedAtRevision ?? revision, revision);
        if (comparison === 'older') {
          const stale = active;
          active = [];
          commands.push(freezeCommand('fast-forward', stale, revision));
          commands.push(...finalStateAndAnnouncements(stale, revision));
          invokeCompletions(stale);
        } else if (comparison === 'uncomparable') {
          const conflicted = active;
          active = [];
          incomparable.push(...conflicted.map((request) => request.event.sequence));
          commands.push(freezeCommand('cancel', conflicted, revision));
        }
      }

      const retained: AnimationQueueRequest[] = [];
      for (const request of pending) {
        const comparison = compareRevision(request.event.observedAtRevision, revision);
        if (comparison === 'older') {
          commands.push(freezeCommand('cancel', [request], revision));
          commands.push(...finalStateAndAnnouncements([request], revision));
          invokeCompletions([request]);
        } else if (comparison === 'uncomparable') {
          incomparable.push(request.event.sequence);
          commands.push(freezeCommand('cancel', [request], revision));
        } else {
          retained.push(request);
        }
      }
      pending = retained.sort(compareRequests);
      return Object.freeze({
        commands: Object.freeze(commands),
        incomparableEventSequences: Object.freeze(incomparable.sort((left, right) => left - right)),
      });
    },

    skipAll(): readonly PresentationCommand[] {
      const skipped = [...active, ...pending].sort(compareRequests);
      active = [];
      pending = [];
      if (skipped.length === 0) return Object.freeze([]);
      const commands: PresentationCommand[] = [];
      for (const request of skipped) {
        commands.push(freezeCommand('fast-forward', [request]));
        commands.push(...finalStateAndAnnouncements([request]));
      }
      invokeCompletions(skipped);
      return Object.freeze(commands);
    },

    snapshot,
  });
}
