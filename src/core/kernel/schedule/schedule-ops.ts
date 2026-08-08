/**
 * L9 Schedule Ops: 通用、确定性的相位推进。
 * 相位边界 effect 与 turn 状态在同一个 Op 事务内完成；任何失败都会整体回滚。
 */
import type { OpContext, OpImpl, OpRegistry } from '../ops/registry.js';
import type { Result } from '../ops/result.js';
import { ok } from '../ops/result.js';
import type { Id } from '../state/ids.js';
import type { Value } from '../state/value.js';
import type { Def } from '../state/def.js';
import type { Effect } from '../events/effect-types.js';
import type { ScheduleDef } from './types.js';
import { checkInstantiable } from '../ops/def-guard.js';

export interface ScheduleAdvanceArgs {
  scheduleId?: Id;
}

export interface ScheduleOpsDeps {
  defLookup: (id: Id) => Def | null;
  /** 由组合根接入 FlowInterpreter；省略时只推进相位。vars 供延迟效果兑现时回填其排期时的作用域。 */
  runEffects?: (effects: Effect[], ctx: OpContext, vars?: Record<string, Value>) => Result<void>;
  /** 由组合根接入通用资源池运行时；相位与回合边界均在同一事务内重置。 */
  resetPools?: (trigger: 'phase' | 'turn', ctx: OpContext) => Result<void>;
  /**
   * 由组合根接入 Decision 超时处理（需求27.7：Decision 超过 deadline 时按 onTimeout 处理并推进相位）。
   * schedule.advance 在推进相位后调用它，与相位推进同一事务。省略时跳过超时处理。
   */
  processDecisionTimeouts?: (ctx: OpContext) => void;
}

function runBoundaryEffects(effects: Effect[] | undefined, ctx: OpContext, deps: ScheduleOpsDeps): Result<void> {
  if (!effects || effects.length === 0 || !deps.runEffects) return ok(undefined);
  return deps.runEffects(effects, ctx);
}

/**
 * 兑现所有到期的延迟效果（Flow after/at，需求22.1）：dueAt <= 当前相位的条目按 (dueAt, seq) 有序执行。
 * 先把到期条目从队列出队再执行，避免执行过程中重新排期的 after 0 在同一次 advance 内被重复兑现
 * （新排期的条目留待下一次 advance）。兑现在 schedule.advance 的同一事务内进行，任一失败整体回滚。
 */
function fireDueDeferred(ctx: OpContext, deps: ScheduleOpsDeps): Result<void> {
  if (!deps.runEffects) return ok(undefined);
  const draft = ctx.tx.getDraft();
  const nowPhase = draft.world.turn.phaseEnteredAt;
  const due = draft.world.deferredEffects
    .filter((entry) => entry.dueAt <= nowPhase)
    .sort((left, right) => (left.dueAt - right.dueAt) || (left.seq - right.seq));
  if (due.length === 0) return ok(undefined);

  const dueSeqs = new Set(due.map((entry) => entry.seq));
  ctx.tx.setDraft({
    ...draft,
    world: {
      ...draft.world,
      deferredEffects: draft.world.deferredEffects.filter((entry) => !dueSeqs.has(entry.seq)),
    },
  });

  for (const entry of due) {
    const result = deps.runEffects(entry.effects as unknown as Effect[], ctx, entry.vars);
    if (!result.ok) return result;
  }
  return ok(undefined);
}

function makeScheduleAdvance(deps: ScheduleOpsDeps): OpImpl<ScheduleAdvanceArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const turn = draft.world.turn;
    const schedId = args.scheduleId ?? turn.scheduleId;
    const guard = checkInstantiable(deps.defLookup, schedId, 'schedule');
    if (!guard.ok) return guard;

    const schedule = guard.value as ScheduleDef;
    if (schedule.phases.length === 0) return ok(undefined);

    const currentIndex = Math.min(turn.phaseIndex, schedule.phases.length - 1);
    const requestedIndex = currentIndex + 1;
    const wraps = requestedIndex >= schedule.phases.length;
    const nextIndex = wraps ? (schedule.loop ? 0 : currentIndex) : requestedIndex;

    // 非循环表已停在末相位：重复 advance 是幂等操作，不重复执行边界 effect。
    if (nextIndex === currentIndex) return ok(undefined);

    const exitResult = runBoundaryEffects(schedule.phases[currentIndex]?.onExit, ctx, deps);
    if (!exitResult.ok) return exitResult;

    if (wraps) {
      const roundResult = runBoundaryEffects(schedule.roundEnd, ctx, deps);
      if (!roundResult.ok) return roundResult;
      const turnReset = deps.resetPools?.('turn', ctx);
      if (turnReset && !turnReset.ok) return turnReset;
    }

    const afterExit = ctx.tx.getDraft();
    const nextTurn = {
      ...afterExit.world.turn,
      scheduleId: schedId,
      phaseIndex: nextIndex,
      // 这是可回放的逻辑相位序号，不读取 Date.now() 等外部非确定性来源。
      phaseEnteredAt: afterExit.world.turn.phaseEnteredAt + 1,
    };
    ctx.tx.setDraft({ ...afterExit, world: { ...afterExit.world, turn: nextTurn } });

    const phaseReset = deps.resetPools?.('phase', ctx);
    if (phaseReset && !phaseReset.ok) return phaseReset;

    const enterResult = runBoundaryEffects(schedule.phases[nextIndex]?.onEnter, ctx, deps);
    if (!enterResult.ok) return enterResult;

    // 需求27.7：相位推进后处理到期 Decision 的超时（deadline<=新相位者按 onTimeout 解算/作废）。
    // 放在延迟效果之前：超时决策可能产出新的即时状态，延迟效果应看到超时后的状态。
    deps.processDecisionTimeouts?.(ctx);

    // 相位进入效果之后兑现到期的延迟效果（需求22.1 的 after/at 落地）：新相位已就绪，
    // 此时触发"N 相位之后""在相位 M"排期的效果，与相位推进在同一事务内保证原子性。
    const deferredResult = fireDueDeferred(ctx, deps);
    if (!deferredResult.ok) return deferredResult;

    ctx.tx.logOp('schedule.advance', args, () => {});
    return ok(undefined);
  };
}

export function registerScheduleOps(registry: OpRegistry, deps: ScheduleOpsDeps): void {
  registry.register('schedule.advance', makeScheduleAdvance(deps));
}
