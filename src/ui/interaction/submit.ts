/**
 * 提交与完成确认（design.md §7.1、§8.3，tasks.md 任务 5.4）。
 *
 * 成功的唯一判据是**观察到含 `committedRevision` 的投影**。按钮变灰、动画开始、音效播放、
 * 请求已离开客户端，四者都不是成功信号（Requirement 5.7）。
 *
 * `stale` 与 `rejected` 走**不同**路径：前者先重同步到新鲜投影才重新启用交互
 * （Requirement 5.6），后者只展示可见性安全的结构化拒绝并刷新受影响投影。
 * 两条路径都**不合成任何补偿写入**（Requirement 4.6）。
 */

import { compareRevision, type StateRevision } from '../model/revision.js';
import type { UiDiagnostic } from '../model/diagnostic.js';
import type { InteractionIntent } from '../model/intent.js';
import type { ActionPort, SubmissionOutcome } from '../ports/action-port.js';
import type { PendingRegistry } from './pending-registry.js';

export const SUBMISSION_STATES = [
  'idle',
  'already-pending',
  'awaiting-committed-revision',
  'completed',
  'rejected',
  'resyncing',
] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export interface SubmitStep {
  readonly controlId: string;
  readonly state: SubmissionState;
  /** 是否需要先重同步到新鲜投影才能重新启用该交互。 */
  readonly requiresResync: boolean;
  /** 是否需要刷新受影响投影（普通拒绝也要刷新，但不触发重同步门禁）。 */
  readonly requiresRefresh: boolean;
  readonly awaitedRevision?: StateRevision;
  readonly displayText?: string;
  readonly diagnostics: readonly UiDiagnostic[];
}

export interface SubmitFlowDeps {
  readonly actionPort: ActionPort;
  readonly registry: PendingRegistry;
}

export interface SubmitFlow {
  /** 一次控件激活。已有待决时**不提交**、不产生第二个意图。 */
  activate(controlId: string, intent: InteractionIntent): SubmitStep;
  /** 观察到新投影。返回因此完成的提交步骤。 */
  observeRevision(observed: StateRevision): readonly SubmitStep[];
  stateOf(controlId: string): SubmissionState;
}

interface AwaitingEntry {
  readonly controlId: string;
  readonly committedRevision: StateRevision;
}

export function createSubmitFlow(deps: SubmitFlowDeps): SubmitFlow {
  const states = new Map<string, SubmissionState>();
  const awaiting: AwaitingEntry[] = [];

  function step(partial: Omit<SubmitStep, 'diagnostics'> & { diagnostics?: readonly UiDiagnostic[] }): SubmitStep {
    states.set(partial.controlId, partial.state);
    return Object.freeze({ ...partial, diagnostics: Object.freeze([...(partial.diagnostics ?? [])]) });
  }

  return Object.freeze({
    activate(controlId: string, intent: InteractionIntent): SubmitStep {
      const registered = deps.registry.tryRegister(controlId, intent);
      if (registered.kind === 'already-pending') {
        return step({
          controlId,
          state: 'already-pending',
          requiresResync: false,
          requiresRefresh: false,
        });
      }

      const outcome: SubmissionOutcome = deps.actionPort.submit(intent);
      deps.registry.settle(intent.intentId, outcome);

      if (outcome.kind === 'accepted') {
        awaiting.push({ controlId, committedRevision: outcome.committedRevision });
        return step({
          controlId,
          // 权威侧已提交 ≠ 操作完成：必须等到观察到含该修订的投影。
          state: 'awaiting-committed-revision',
          requiresResync: false,
          requiresRefresh: false,
          awaitedRevision: outcome.committedRevision,
        });
      }
      if (outcome.kind === 'stale') {
        return step({
          controlId,
          state: 'resyncing',
          requiresResync: true,
          requiresRefresh: true,
          displayText: outcome.rejection.displayText,
          diagnostics: outcome.rejection.diagnostics,
        });
      }
      return step({
        controlId,
        state: 'rejected',
        requiresResync: false,
        requiresRefresh: true,
        displayText: outcome.rejection.displayText,
        diagnostics: outcome.rejection.diagnostics,
      });
    },

    observeRevision(observed: StateRevision): readonly SubmitStep[] {
      const completed: SubmitStep[] = [];
      for (let index = awaiting.length - 1; index >= 0; index--) {
        const entry = awaiting[index];
        if (entry === undefined) continue;
        const comparison = compareRevision(observed, entry.committedRevision);
        if (comparison !== 'same' && comparison !== 'newer') continue;
        awaiting.splice(index, 1);
        completed.push(
          step({
            controlId: entry.controlId,
            state: 'completed',
            requiresResync: false,
            requiresRefresh: false,
            awaitedRevision: entry.committedRevision,
          }),
        );
      }
      return Object.freeze(
        completed.sort((left, right) => (left.controlId < right.controlId ? -1 : left.controlId > right.controlId ? 1 : 0)),
      );
    },

    stateOf(controlId: string): SubmissionState {
      return states.get(controlId) ?? 'idle';
    },
  });
}
