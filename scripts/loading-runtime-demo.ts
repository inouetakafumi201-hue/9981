import { pathToFileURL } from 'node:url';
import { setPath } from '../src/core/kernel/ops/path.js';
import type { Def } from '../src/core/kernel/state/def.js';
import type { Value } from '../src/core/kernel/state/value.js';
import { resetIdCounters } from '../src/core/kernel/state/ids.js';
import { createAgentShape } from '../src/core/kernel/state/agent.js';
import { createEntityShape } from '../src/core/kernel/state/entity.js';
import { createNodeShape } from '../src/core/kernel/topology/types.js';
import type { WorldState } from '../src/core/kernel/state/world-state.js';
import { TAG_NPC } from '../src/play/core-mechanics/defs/ids.js';
import { createLoadedMatch, simulateWholeMatch } from '../src/play/loading-runtime/index.js';
import type { AutoPlayResult, PlayActor } from '../src/play/loading-runtime/autoplay.js';
import type { LoadedMatch } from '../src/play/loading-runtime/types.js';
import type { WorldState } from '../src/core/kernel/state/world-state.js';
import { ACT_ATTACK } from '../src/play/core-mechanics/defs/ids.js';
import { CORE_PAID_ACTIONS } from '../src/play/core-mechanics/defs/actions.paid.js';
import { coreSchedule } from '../src/play/core-mechanics/defs/schedule.js';
import { attackLoadRequest, TEST_DAMAGE_AMOUNT } from '../test/play/loading-runtime/attack-kill-fixture.js';
import { ENEMY, HERO, NPC_AGENT, NPC_ENTITY, npcBudgetFixture } from '../test/play/loading-runtime/fixtures.js';

const POLICY = 'd:ai-policy';
const BINDING = 'd:ai-binding';

const CORE_SEED: Def[] = [
  ...(CORE_PAID_ACTIONS as unknown as Def[]),
  coreSchedule as unknown as Def,
  { id: POLICY, kind: 'policy', abstract: true, mode: 'search' },
  {
    id: BINDING,
    kind: 'policy',
    extends: [POLICY],
    mode: 'search',
    policy: POLICY,
    props: {
      alertLevel: 2,
      relevantActions: CORE_PAID_ACTIONS.map((action) => action.id),
    },
  },
];

const attackOnly: PlayActor = {
  decide(actorId, legal) {
    if (actorId !== HERO) return null;
    const attack = legal.find((action) => action.action === ACT_ATTACK && (action.bindings.target as { readonly $?: string } | undefined)?.$ === ENEMY);
    if (attack === undefined) return null;
    return { actionId: attack.action, bindings: attack.bindings as Record<string, Value> };
  },
};

function setupNpcSnapshot(match: LoadedMatch): void {
  if (match.ai === null) return;
  const ai = match.ai;
  // seedNpcQueue 已登记 agent（world.agents.g:npc-1.controls=[e:npc-1]）、实体 AP 池
  // （pools.ap.e:npc-1=1）与 npcQueue。这里**不要重建** e:npc-1 / g:npc-1，那会抹掉 controls
  // 与 AP 预算，使 authorize 报「Actor e:npc-1 is not controlled」。只补齐判罚前哨字段：
  // 实体的 node（供移动动作）与 vitality、nodes 落位、以及 AI holder 的 damageAmountRef
  // （主要求由宿主注入，AI 自持快照的 play 区不自动带上）。
  let state = ai.holder.getState();
  if (state.entities[NPC_ENTITY] === undefined) {
    state = setPath(state, `entities.${NPC_ENTITY}`, {
      ...createEntityShape(NPC_ENTITY, 'd:fighter'),
      node: 'n:npc-a',
      props: { vitality: 4 },
      tags: [TAG_NPC],
    } as never) as never;
  } else {
    const existing = state.entities[NPC_ENTITY] as { node?: string; props?: Record<string, unknown> };
    const patched = {
      ...existing,
      node: existing.node ?? 'n:npc-a',
      props: { ...(existing.props ?? {}), vitality: 4 },
    };
    state = setPath(state, `entities.${NPC_ENTITY}`, patched as never) as never;
  }
  if (state.nodes['n:npc-a'] === undefined) {
    state = setPath(state, 'nodes.n:npc-a', createNodeShape('n:npc-a', 'd:room') as never) as never;
  }
  if ((state.world.props as Record<string, unknown>)?.['play']?.['damageAmountRef'] === undefined) {
    state = setPath(state, 'world.props.play.damageAmountRef', TEST_DAMAGE_AMOUNT as never) as never;
  }
  ai.holder.setState(state);
}

function runNpcProbe(match: LoadedMatch): { readonly ok: boolean; readonly action?: string } {
  if (match.ai === null) return { ok: false };
  setupNpcSnapshot(match);
  const popped = match.ai.popNextNpc();
  return popped.ok && popped.value !== undefined ? { ok: true, action: popped.value.legalAction.action } : { ok: false };
}

export interface LoadingRuntimeDemoRun {
  readonly match: LoadedMatch;
  readonly result: AutoPlayResult;
  readonly npcQueueAfter: readonly string[];
}

export function buildLoadingRuntimeDemoMatch(): LoadedMatch {
  resetIdCounters();
  const baseRequest = attackLoadRequest();
  const loaded = createLoadedMatch({
    ...baseRequest,
    playerEntityIds: [HERO],
    seedDefs: [...CORE_SEED, ...baseRequest.seedDefs] as Def[],
    npcBudget: () => npcBudgetFixture(),
  });
  if (!loaded.ok) {
    throw new Error(`createLoadedMatch 失败：${loaded.diagnostics.map((d) => d.message).join('; ')}`);
  }
  const { match } = loaded;
  const write = match.engine.registry.invoke('prop.set', {
    path: 'world.props.play.damageAmountRef',
    value: TEST_DAMAGE_AMOUNT,
  });
  if (!write.ok) {
    throw new Error(`写入 damageAmountRef 失败：${write.detail}`);
  }
  return match;
}

export function runLoadingRuntimeDemo(): LoadingRuntimeDemoRun {
  const match = buildLoadingRuntimeDemoMatch();
  const npcProbe = runNpcProbe(match);
  const aiStateAfterProbe = match.ai?.holder.getState() as WorldState | undefined;
  if (match.ai !== null && aiStateAfterProbe !== undefined) {
    match.ai.holder.setState(structuredClone(match.getWorldState()) as WorldState);
  }
  const result = simulateWholeMatch(match, { maxSteps: 20, actor: attackOnly });
  const npcQueueAfter = match.ai?.queuedNpcIds ?? [];

  if (!npcProbe.ok) {
    throw new Error('demo 没有真实 NPC submitted 候选：popNextNpc 未通过 canonical intent 生命周期。');
  }
  if (!result.ended) {
    throw new Error('demo 未终局：simulateWholeMatch 没有推进到 last-standing。');
  }
  if (result.outcome?.name !== 'last-standing') {
    throw new Error(`demo 终局不对：${result.outcome?.name ?? 'none'}`);
  }
  if (result.playerActions === 0) {
    throw new Error('demo 没有任何玩家动作提交。');
  }
  if (result.metrics.failedActions !== 0) {
    throw new Error(`demo 存在未落地动作：${result.metrics.failedActions}`);
  }
  if (npcQueueAfter.length !== 0) {
    throw new Error(`demo 结束时 NPC 队列未清空：${npcQueueAfter.join(',')}`);
  }

  return { match, result, npcQueueAfter };
}

function isMain(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  const { result, npcQueueAfter } = runLoadingRuntimeDemo();
  console.log(JSON.stringify({
    ended: result.ended,
    capped: result.capped,
    outcome: result.outcome?.name ?? null,
    steps: result.steps,
    playerActions: result.playerActions,
    npcActions: result.npcActions,
    failedActions: result.metrics.failedActions,
    npcQueueAfter,
    actLog: result.actLog.map((step) => ({
      phase: step.phase,
      round: step.round,
      actor: step.actor,
      actionId: step.actionId,
      applied: step.applied,
    })),
  }, null, 2));
}
