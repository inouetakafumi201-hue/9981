/**
 * 一局装载后生命周期（CEME C-2/C-3/C-4/C-5）。
 *
 * 全部写入只走 `OpRegistry.invoke`，不直接改 WorldState。
 * 专项 B 的对局外壳只消费本模块与投影暴露的只读查询，不在此实现。
 */
import type { OpRegistry } from '../../core/kernel/ops/registry.js';
import type { Result } from '../../core/kernel/ops/result.js';
import type { Value } from '../../core/kernel/state/value.js';
import type { WorldState } from '../../core/kernel/state/world-state.js';
import type { WorldStateHolder } from '../../core/kernel/ops/transaction.js';
import {
  PATH_MATCH_END_DETAIL,
  PATH_MATCH_ENDED,
  PATH_PLAYER_QUEUE,
  PATH_ROUND,
  PATH_SPAWN_CANDIDATES,
  PATH_SPAWN_COMPLETE,
  POOL_STAMINA,
  PROP_ROLL_TIER,
  PROP_VITALITY,
  SPAWN_ROLL_TIER_INITIAL,
  SPAWN_STAMINA_INITIAL,
  TAG_NPC,
  TAG_PERMANENT_EXIT,
  TAG_ROLL_PARTICIPANT,
  VITALITY_MAX,
} from './defs/ids.js';
import { CORE_OUTCOMES, TERMINAL_OUTCOME_NAMES } from './defs/outcomes.js';

export interface MatchEndDetail {
  readonly outcome: string;
  readonly scope: string;
  readonly rank: number | null;
}

export interface TerminalQuery {
  matchEnded(): boolean;
  matchEndDetail(): MatchEndDetail | null;
  /** Internal_Metric：供对局外壳消费，禁止当作 1-5 玩法值展示。 */
  round(): number;
}

export interface AssembleMatchStartInput {
  readonly registry: OpRegistry;
  readonly holder: WorldStateHolder;
  readonly playerEntityIds: readonly string[];
}

function invokeSet(registry: OpRegistry, path: string, value: Value): Result<void> {
  return registry.invoke<{ path: string; value: Value }, void>('prop.set', { path, value });
}

function playProps(state: WorldState): Record<string, unknown> {
  return ((state.world.props as Record<string, unknown> | undefined)?.['play'] ?? {}) as Record<string, unknown>;
}

/** 只读终局/胜负查询。round / matchEnded 均不进入玩家可见资源投影。 */
export function readTerminal(state: WorldState): {
  readonly matchEnded: boolean;
  readonly matchEndDetail: MatchEndDetail | null;
  readonly round: number;
} {
  const play = playProps(state);
  const matchEnded = play['matchEnded'] === true;
  const raw = play['matchEnd'];
  let matchEndDetail: MatchEndDetail | null = null;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec['outcome'] === 'string') {
      matchEndDetail = {
        outcome: rec['outcome'],
        scope: typeof rec['scope'] === 'string' ? rec['scope'] : 'game',
        rank: typeof rec['rank'] === 'number' ? rec['rank'] : null,
      };
    }
  }
  const round = typeof play['round'] === 'number' ? play['round'] : 0;
  return { matchEnded, matchEndDetail, round };
}

export function createTerminalQuery(getState: () => WorldState): TerminalQuery {
  return {
    matchEnded: () => readTerminal(getState()).matchEnded,
    matchEndDetail: () => readTerminal(getState()).matchEndDetail,
    round: () => readTerminal(getState()).round,
  };
}

/**
 * 装载期世界配置：终局字段、round、出生完成标记的初始值。
 * 任一步失败由调用方中止，不继续写后续字段。
 */
export function initializeMatchFields(registry: OpRegistry): Result<void> {
  const writes: readonly { readonly path: string; readonly value: Value }[] = [
    { path: PATH_MATCH_ENDED, value: false },
    { path: PATH_ROUND, value: 0 },
    { path: PATH_SPAWN_COMPLETE, value: false },
  ];
  for (const write of writes) {
    const result = invokeSet(registry, write.path, write.value);
    if (!result.ok) return result;
  }
  return { ok: true, value: undefined };
}

/**
 * 出生 + 参与者注册（C-2 / C-4）。
 *
 * 只处理玩家实体：NPC（带 `play:npc`）必须走 AI runtime 稳定编号路径，不得混入本函数。
 * 永久退出者不会被重新打上投点资格。
 */
export function assembleMatchStart(input: AssembleMatchStartInput): Result<void> {
  const { registry, holder, playerEntityIds } = input;
  const uniqueIds = [...new Set(playerEntityIds)];
  const candidates = uniqueIds.map((id) => ({ $: id }));
  const writeCandidates = invokeSet(registry, PATH_SPAWN_CANDIDATES, candidates);
  if (!writeCandidates.ok) return writeCandidates;

  for (const entityId of uniqueIds) {
    const entity = holder.getState().entities[entityId];
    if (entity === undefined) {
      return { ok: false, code: 'E_REF_MISSING', detail: `出生装配找不到玩家实体 ${entityId}` };
    }
    if ((entity.tags ?? []).includes(TAG_NPC)) {
      return { ok: false, code: 'E_OP_NOT_ACCEPTED', detail: `NPC ${entityId} 不得走玩家出生路径` };
    }
    if ((entity.tags ?? []).includes(TAG_PERMANENT_EXIT)) {
      continue;
    }

    if (!(entity.tags ?? []).includes(TAG_ROLL_PARTICIPANT)) {
      const tagged = registry.invoke('tag.add', {
        ref: { collection: 'entities', id: entityId },
        tag: TAG_ROLL_PARTICIPANT,
      });
      if (!tagged.ok) return tagged;
    }

    const afterTag = holder.getState().entities[entityId];
    if (afterTag?.props[PROP_ROLL_TIER] == null) {
      const tier = invokeSet(registry, `entities.${entityId}.props.${PROP_ROLL_TIER}`, SPAWN_ROLL_TIER_INITIAL);
      if (!tier.ok) return tier;
    }
    if (afterTag?.props[PROP_VITALITY] == null) {
      const vitality = invokeSet(registry, `entities.${entityId}.props.${PROP_VITALITY}`, VITALITY_MAX);
      if (!vitality.ok) return vitality;
    }

    const staminaAvailable = invokeSet(
      registry,
      `world.props.pools.${POOL_STAMINA}.${entityId}.available`,
      SPAWN_STAMINA_INITIAL,
    );
    if (!staminaAvailable.ok) return staminaAvailable;
    const staminaReal = invokeSet(
      registry,
      `world.props.pools.${POOL_STAMINA}.${entityId}.real`,
      SPAWN_STAMINA_INITIAL,
    );
    if (!staminaReal.ok) return staminaReal;
  }

  return invokeSet(registry, PATH_SPAWN_COMPLETE, true);
}

export interface RecordOutcomeInput {
  readonly registry: OpRegistry;
  readonly holder: WorldStateHolder;
  readonly outcomeName: string;
  readonly scope?: { readonly $: string };
  readonly ends: boolean;
  readonly rank?: number;
}

/**
 * 胜负读写环的写入端：`outcome.reach` 记录事实，`ends:true` 时同一调用序列写入终局字段。
 * 任一步失败提前返回；调用方看到失败时不应把半终结态当成已结算。
 */
export function recordOutcome(input: RecordOutcomeInput): Result<void> {
  const scope = input.scope ?? { $: 'w:0' };
  const reached = input.registry.invoke('outcome.reach', {
    outcomeName: input.outcomeName,
    scope,
    ends: input.ends,
    ...(input.rank === undefined ? {} : { rank: input.rank }),
  });
  if (!reached.ok) return reached;

  if (!input.ends) return { ok: true, value: undefined };
  if (!TERMINAL_OUTCOME_NAMES.includes(input.outcomeName)) {
    return { ok: true, value: undefined };
  }
  if (readTerminal(input.holder.getState()).matchEnded) {
    return { ok: true, value: undefined };
  }

  const ended = invokeSet(input.registry, PATH_MATCH_ENDED, true);
  if (!ended.ok) return ended;
  return invokeSet(input.registry, PATH_MATCH_END_DETAIL, {
    outcome: input.outcomeName,
    scope: scope.$,
    rank: input.rank ?? null,
  });
}

/**
 * 生产化清空玩家行动队列（PLAYER_QUEUE_GAP）。
 * 测试与外壳都必须走这条 invoke 通道，不得 `holder.setState` 改队列。
 */
export function consumePlayerQueue(registry: OpRegistry): Result<void> {
  return invokeSet(registry, PATH_PLAYER_QUEUE, []);
}

export function declaredOutcomeNames(): readonly string[] {
  return CORE_OUTCOMES.map((outcome) => outcome.name);
}
