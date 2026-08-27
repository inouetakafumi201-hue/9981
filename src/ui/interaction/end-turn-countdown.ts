/**
 * 回合末倒计时（design.md §8.4、D-042、J-5，tasks.md 任务 5.5）。
 *
 * 三条纪律：
 * 1. 秒数取自 profile 且是 `Internal_Metric`，不受 1—5 约束。
 * 2. 倒计时期间动作合法性、成本与效果**保持不变**；可在任意时刻取消（反悔窗口）。
 *    本文件不读取也不修改任何合法性/成本字段，因此"倒计时影响规则"无处发生。
 * 3. 倒计时自然结束时，经**与其他意图完全相同**的权威通道提交"结束回合"意图；
 *    **不得**把倒计时结束本身当作回合已结束（Requirement 5.13）。因此状态机里
 *    只有 `submitted`，没有任何表示"回合已结束"的取值——那个判断只能来自权威投影。
 */

import type { InternalMetric } from '../presentation/gameplay-value';
import type { PresentationProfile } from '../model/profile';
import type { SubmissionOutcome } from '../ports/action-port';

export const COUNTDOWN_STATES = ['idle', 'running', 'cancelled', 'submitted'] as const;
export type CountdownState = (typeof COUNTDOWN_STATES)[number];

export interface CountdownOutcome {
  readonly state: CountdownState;
  /** 剩余时间。内部度量，不是玩法数值。 */
  readonly remaining: InternalMetric<number>;
  /** 仅在 `submitted` 时存在：经权威通道提交结束回合意图的结果。 */
  readonly submission?: SubmissionOutcome;
}

export interface EndTurnCountdownDeps {
  readonly profile: PresentationProfile;
  /**
   * 提交结束回合意图。
   *
   * 由组合根注入，内部走 `ActionPort.submit`——与其他意图**同一条**通道。
   * 本文件不持有 `ActionPort`，因此不可能出现"倒计时走了另一条提交路径"。
   */
  readonly submitEndTurn: () => SubmissionOutcome;
}

export interface EndTurnCountdown {
  start(nowMs: number): CountdownOutcome;
  cancel(): CountdownOutcome;
  tick(nowMs: number): CountdownOutcome;
  state(): CountdownState;
}

export function createEndTurnCountdown(deps: EndTurnCountdownDeps): EndTurnCountdown {
  const seconds = deps.profile.endTurnCountdown.seconds;
  const durationMs = seconds.value * 1_000;
  let state: CountdownState = 'idle';
  let startedAtMs: number | undefined;

  function remaining(nowMs: number): InternalMetric<number> {
    if (state !== 'running' || startedAtMs === undefined) {
      return Object.freeze({ __brand: 'InternalMetric' as const, value: 0, unit: 'ms' });
    }
    const left = Math.max(0, durationMs - (nowMs - startedAtMs));
    return Object.freeze({ __brand: 'InternalMetric' as const, value: left, unit: 'ms' });
  }

  function outcome(nowMs: number, submission?: SubmissionOutcome): CountdownOutcome {
    return Object.freeze({
      state,
      remaining: remaining(nowMs),
      ...(submission === undefined ? {} : { submission }),
    });
  }

  return Object.freeze({
    start(nowMs: number): CountdownOutcome {
      state = 'running';
      startedAtMs = nowMs;
      return outcome(nowMs);
    },

    cancel(): CountdownOutcome {
      // 任意时刻可取消，且取消不改变任何规则语义（Requirement 5.12、5.14）。
      if (!deps.profile.endTurnCountdown.cancellable) return outcome(startedAtMs ?? 0);
      state = 'cancelled';
      const at = startedAtMs ?? 0;
      startedAtMs = undefined;
      return outcome(at);
    },

    tick(nowMs: number): CountdownOutcome {
      if (state !== 'running' || startedAtMs === undefined) return outcome(nowMs);
      if (nowMs - startedAtMs < durationMs) return outcome(nowMs);
      state = 'submitted';
      startedAtMs = undefined;
      // 只提交意图；回合是否结束由权威投影回答，不由这里的计时器回答。
      return outcome(nowMs, deps.submitEndTurn());
    },

    state(): CountdownState {
      return state;
    },
  });
}
