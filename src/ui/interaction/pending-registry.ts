/**
 * 待决登记表（design.md §8.1、J-12，tasks.md 任务 5.3）。
 *
 * 以 `controlId` 为键，**不**以动作标识为键：Requirement 5.1 约束的是"同一个待决**控件**上的
 * 额外激活尝试"。同一动作可能合法地同时出现在两个入口（轮次栏与动作面板），用动作标识作键
 * 会误杀第二个合法入口。
 *
 * 这里登记的是"体验优化"，**不是**规则安全边界（§7.3）：即便登记被绕过，到达
 * `ActionPort` 的意图仍须经过完整的当前状态复校。
 */

import { compareRevision, type StateRevision } from '../model/revision.js';
import type { InteractionIntent } from '../model/intent.js';
import type { SubmissionOutcome } from '../ports/action-port.js';

export type RegisterOutcome =
  | { readonly kind: 'registered'; readonly intentId: string }
  | { readonly kind: 'already-pending'; readonly intentId: string };

export interface PendingRegistry {
  /** 登记成功返回 `registered`；该控件已有待决意图时返回 `already-pending` 且不产生新意图。 */
  tryRegister(controlId: string, intent: InteractionIntent): RegisterOutcome;
  settle(intentId: string, outcome: SubmissionOutcome): void;
  /** 修订变化时批量失效受影响绑定，返回被失效的控件标识（按码点序）。 */
  invalidateByRevision(current: StateRevision): readonly string[];
  isPending(controlId: string): boolean;
  pendingControlIds(): readonly string[];
  pendingIntent(controlId: string): InteractionIntent | undefined;
}

export function createPendingRegistry(): PendingRegistry {
  const pending = new Map<string, InteractionIntent>();
  const controlByIntentId = new Map<string, string>();

  return Object.freeze({
    tryRegister(controlId: string, intent: InteractionIntent): RegisterOutcome {
      const existing = pending.get(controlId);
      if (existing !== undefined) {
        return Object.freeze({ kind: 'already-pending' as const, intentId: existing.intentId });
      }
      pending.set(controlId, intent);
      controlByIntentId.set(intent.intentId, controlId);
      return Object.freeze({ kind: 'registered' as const, intentId: intent.intentId });
    },

    settle(intentId: string, _outcome: SubmissionOutcome): void {
      const controlId = controlByIntentId.get(intentId);
      if (controlId === undefined) return;
      pending.delete(controlId);
      controlByIntentId.delete(intentId);
    },

    invalidateByRevision(current: StateRevision): readonly string[] {
      const invalidated: string[] = [];
      for (const [controlId, intent] of [...pending.entries()]) {
        if (compareRevision(intent.observedRevision, current) === 'same') continue;
        invalidated.push(controlId);
        pending.delete(controlId);
        controlByIntentId.delete(intent.intentId);
      }
      return Object.freeze(invalidated.sort());
    },

    isPending(controlId: string): boolean {
      return pending.has(controlId);
    },

    pendingControlIds(): readonly string[] {
      return Object.freeze([...pending.keys()].sort());
    },

    pendingIntent(controlId: string): InteractionIntent | undefined {
      return pending.get(controlId);
    },
  });
}
