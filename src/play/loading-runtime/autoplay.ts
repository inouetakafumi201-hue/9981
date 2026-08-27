/**
 * 白盒自洽驱动 `playAutonomousMatch` —— 把"已装载对局"跑成一局规则自洽的完整循环。
 *
 * 玩家化身和 NPC 都从当前合法动作集选择动作，并经 facade.submit -> facade.resolve
 * 走同一条真实判罚路径；驱动本身不依赖渲染或素材挂载。
 */
import type { LoadedMatch } from './types';
import type { WorldState } from '../../core/kernel/state/world-state';
import type { Value } from '../../core/kernel/state/value';
import type { LegalAction } from '../../core/kernel/actions/types';
import { isRef } from '../../core/kernel/state/ids';

export interface AutoPlayMetrics {
  /** 驱动观察到的 phase 序列，包含每次 advance 前的 phase。 */
  readonly phases: readonly string[];
  /** 与 phases 对齐的内部 round 序列。 */
  readonly rounds: readonly number[];
  /** 实际提交过的动作 id。 */
  readonly actionIds: readonly string[];
  /** submit 或 resolve 未落地的动作次数。 */
  readonly failedActions: number;
}

export interface ActiveStep {
  readonly phase: string;
  readonly round: number;
  readonly actor: string;
  readonly actionId: string;
  readonly applied: boolean;
  readonly detail?: string;
}

export interface AutoPlayResult {
  readonly steps: number;
  readonly ended: boolean;
  readonly capped: boolean;
  readonly round: number;
  readonly phase: string;
  readonly outcome: LoadedMatch['shell']['outcome'];
  readonly playerActions: number;
  readonly npcActions: number;
  readonly actLog: readonly ActiveStep[];
  readonly metrics: AutoPlayMetrics;
}

export interface AutoPlayOptions {
  readonly maxSteps?: number;
  /** 玩家与 NPC 共用的动作裁决器；缺省使用 greedySurvivor。 */
  readonly actor?: PlayActor;
}

export interface PlayActor {
  decide(
    actorId: string,
    legal: readonly LegalAction[],
  ): { readonly actionId: string; readonly bindings: Record<string, Value> } | null;
}

const DEFAULT_MAX_STEPS = 200;

/** 优先治疗，其次攻击非自身目标，否则选择排序后的首个合法动作。 */
export const greedySurvivor: PlayActor = {
  decide(actorId, legal) {
    if (legal.length === 0) return null;
    const heal = legal.find((action) => /health|medic|stamina|heal/.test(action.action));
    if (heal !== undefined) {
      return { actionId: heal.action, bindings: heal.bindings as Record<string, Value> };
    }
    const attack = legal.find((action) => {
      if (!/attack|strike|combat/.test(action.action)) return false;
      const target = action.bindings['target'];
      return !isRef(target) || target.$ !== actorId;
    }) ?? legal.find((action) => /attack|strike|combat/.test(action.action));
    if (attack !== undefined) {
      return { actionId: attack.action, bindings: attack.bindings as Record<string, Value> };
    }
    const first = legal[0]!;
    return { actionId: first.action, bindings: first.bindings as Record<string, Value> };
  },
};

function currentRound(match: LoadedMatch): number {
  return match.shell.round;
}

function syncMatchSnapshot(match: LoadedMatch): void {
  const ai = match.ai;
  if (ai === null) return;
  const currentState = ai.holder.getState();
  const currentPlay = (currentState.world.props as Record<string, unknown>)['play'] as Record<string, unknown> | undefined;
  const currentNpcQueue = Array.isArray(currentPlay?.['npcQueue']) ? structuredClone(currentPlay['npcQueue']) : undefined;
  const snapshot = structuredClone(match.getWorldState()) as WorldState;
  // 主 holder 只登记玩家 agent；AI runtime 的决策环需要它自持的 agent（含 controls 指向 NPC 实体）
  // 与 NPC 实体本身。同步主世界快照时保留 AI 侧已登记的 agent 与 NPC 实体，避免覆盖成空壳。
  const currentAgents = currentState.world.agents;
  const currentEntities = currentState.entities;
  const mergedAgents = { ...snapshot.world.agents, ...currentAgents };
  const mergedEntities = { ...snapshot.entities, ...currentEntities };
  const mergedWorld = { ...snapshot.world, agents: mergedAgents };
  const merged = { ...snapshot, world: mergedWorld, entities: mergedEntities };
  if (currentNpcQueue !== undefined) {
    const mergedProps = merged.world.props as Record<string, unknown>;
    const mergedPlay = (mergedProps['play'] ?? {}) as Record<string, unknown>;
    mergedProps['play'] = { ...mergedPlay, npcQueue: currentNpcQueue };
  }
  ai.holder.setState(merged);
}

function actorQueueIds(match: LoadedMatch): readonly string[] {
  const state = match.getWorldState();
  const play = (state.world.props as Record<string, unknown>)['play'] as Record<string, unknown> | undefined;
  const queue = Array.isArray(play?.['playerQueue']) ? (play['playerQueue'] as readonly unknown[]) : [];
  return queue
    .map((ref) => {
      if (typeof ref === 'string') return ref;
      if (isRef(ref)) return ref.$;
      return (ref as { $?: string })?.$;
    })
    .filter((id): id is string => typeof id === 'string');
}

function queryActorActions(match: LoadedMatch, actorId: string): readonly LegalAction[] {
  return match.engine.actionCatalog.queryActions({ $: actorId }, 'ui');
}

function submitAndResolve(
  match: LoadedMatch,
  actorId: string,
  actionId: string,
  bindings: Record<string, Value>,
): boolean {
  const submitted = match.facade.submit({ actorRef: { $: actorId }, actionId, bindings });
  if (!submitted.ok || submitted.value === undefined) return false;
  return match.facade.resolve(submitted.value.intentId).ok;
}

export function playAutonomousMatch(match: LoadedMatch, options: AutoPlayOptions = {}): AutoPlayResult {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const actor = options.actor ?? greedySurvivor;
  syncMatchSnapshot(match);
  const actLog: ActiveStep[] = [];
  const phases: string[] = [];
  const rounds: number[] = [];
  const actionIds: string[] = [];
  let failedActions = 0;
  let steps = 0;
  let playerActions = 0;
  let npcActions = 0;

  const result = (ended: boolean, capped: boolean): AutoPlayResult => ({
    steps,
    ended,
    capped,
    round: match.shell.round,
    phase: match.shell.phase,
    outcome: match.shell.outcome,
    playerActions,
    npcActions,
    actLog,
    metrics: { phases, rounds, actionIds, failedActions },
  });

  for (;;) {
    if (match.shell.ended) return result(true, false);
    if (steps >= maxSteps) return result(false, true);

    const phase = match.shell.phase;
    phases.push(phase);
    rounds.push(match.shell.round);

    if (phase === 'playerAction') {
      for (const actorId of actorQueueIds(match)) {
        const decided = actor.decide(actorId, queryActorActions(match, actorId));
        if (decided === null) continue;
        actionIds.push(decided.actionId);
        const applied = submitAndResolve(match, actorId, decided.actionId, decided.bindings);
        if (!applied) failedActions += 1;
        playerActions += 1;
        actLog.push({ phase, round: currentRound(match), actor: actorId, actionId: decided.actionId, applied });
      }
      const drained = match.control.drainPlayerQueue();
      if (!drained.ok) return result(match.shell.ended, false);
    }

    if (phase === 'npcAction' && match.ai !== null) {
      let guard = 0;
      while (match.ai.queuedNpcIds.length > 0 && guard++ < 100) {
        const popped = match.ai.popNextNpc();
        if (popped.ok && popped.value !== undefined) {
          npcActions += 1;
          actionIds.push(popped.value.legalAction.action);
          actLog.push({
            phase,
            round: currentRound(match),
            actor: popped.value.actor.$,
            actionId: popped.value.legalAction.action,
            applied: true,
          });
        } else {
          failedActions += 1;
        }
        if (!popped.ok || popped.value === undefined) break;
      }
    }

    const stepped = match.control.advance();
    if (!stepped.ok) return result(match.shell.ended, false);
    steps += 1;
  }
}
