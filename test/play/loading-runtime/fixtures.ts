/**
 * 专项 B 契约测试夹具：把真实引擎/玩法/AI/UI/地图组合成 `createLoadedMatch` 的可复现装载请求。
 *
 * 世界预置（与 `state-machine.e2e.test.ts` 同构）：英雄/敌人/节点/容器/agent 在装载前用
 * `createEmptyWorldState` 预置（settle 要查参与者、池初始化按 agent 展开），然后经组合根
 * `createLoadedMatch` 走完整装载序（引擎装配 → 门禁 → 出生装配 → 地图 spawn → AI seed）。
 */
import { createEmptyWorldState, type WorldState } from '../../../src/core/kernel/state/world-state.js';
import { createEntityShape } from '../../../src/core/kernel/state/entity.js';
import { createAgentShape } from '../../../src/core/kernel/state/agent.js';
import { createContainerShape, createSlotShape, createNodeShape } from '../../../src/core/kernel/topology/types.js';
import { setPath } from '../../../src/core/kernel/ops/path.js';
import { defaultCoreMechanicsConfig, type CoreMechanicsConfig } from '../../../src/play/core-mechanics/load.js';
import { TAG_ROLL_PARTICIPANT } from '../../../src/play/core-mechanics/defs/ids.js';
import type { MapDataDocument } from '../../../src/play/map/types.js';
import type { NpcEntry } from '../../../src/play/ai-runtime.js';

export const HERO = 'e:hero';
export const ENEMY = 'e:enemy';
export const HERO_AGENT = 'g:hero';
export const NPC_ENTITY = 'e:npc-1';
export const NPC_AGENT = 'g:npc-1';

/** 预置玩家实体（英雄 + 敌人）与英雄 agent。 */
export function seedWorld(): WorldState {
  const base = createEmptyWorldState('schedule:play.core');
  const agents: WorldState['world']['agents'] = {
    [HERO_AGENT]: { ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'), controls: [{ $: HERO }] },
  };
  const entities: WorldState['entities'] = {
    [HERO]: {
      ...createEntityShape(HERO, 'd:fighter'),
      node: 'n:hero-a',
      props: { vitality: 4, rollTier: 3 },
      containers: { bag: 'c:hero-bag' },
      tags: [TAG_ROLL_PARTICIPANT],
    },
    [ENEMY]: { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:enemy-a', props: { vitality: 3 }, tags: [] },
  };
  const nodes: WorldState['nodes'] = {
    'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
    'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
  };
  const heroBag = { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] };
  return {
    ...base,
    world: { ...base.world, agents },
    entities,
    nodes,
    containers: { 'c:hero-bag': heroBag },
  };
}

/** 生产 config：U-001 开放（随机投点 + 双策略引用）使标准回合可推进；T-001 伤害表留空（未冻结）。 */
export function productionConfig(): CoreMechanicsConfig {
  return {
    ...defaultCoreMechanicsConfig(),
    rollPolicy: {
      enableRandomRoll: true,
      baseTierPolicyRef: 'd:base-tier.policy',
      boostBoundaryPolicyRef: 'd:boost-boundary.policy',
    },
    hookWiringAccepted: true,
  };
}

/** 最小合法地图：两个房间 + 一条双向门。 */
export function testMap(): MapDataDocument {
  return {
    schemaVersion: '1.0',
    id: 'map:test-room',
    name: '测试房间',
    backdrop: { image: 'backdrop.png', pixelWidth: 640, pixelHeight: 360, tileRows: 1, tileCols: 1 },
    floors: [0],
    nodes: [
      { id: 'n:map-a', def: 'd:room', scale: 'small', at: { x: 0.25, y: 0.5 }, floor: 0 },
      { id: 'n:map-b', def: 'd:room', scale: 'small', at: { x: 0.75, y: 0.5 }, floor: 0 },
    ],
    edges: [
      { id: 'e:map-1', def: 'd:door', a: 'n:map-a', b: 'n:map-b', directionality: 'bidirectional', path: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }] },
    ],
    placements: [],
  };
}

/** 一条稳定编号的 NPC 预算条目。 */
export function npcBudgetFixture(): { readonly entry: NpcEntry; readonly ap: number }[] {
  return [
    {
      entry: {
        agentId: NPC_AGENT,
        controlledEntity: { $: NPC_ENTITY },
        policy: { $: 'd:ai-policy' },
        behaviorBinding: { $: 'd:ai-binding' },
        intent: 'move',
      },
      ap: 1,
    },
  ];
}

/** 把预置世界合入组合根后的合并状态：保留装载写入的玩法配置与 turn.scheduleId。 */
export function mergeSeeded(loaded: WorldState, seeded: WorldState): WorldState {
  return {
    ...loaded,
    world: {
      ...loaded.world,
      agents: seeded.world.agents,
      props: { ...(loaded.world.props ?? {}), ...(seeded.world.props ?? {}) },
      turn: { ...loaded.world.turn, scheduleId: 'schedule:play.core' },
    },
    entities: seeded.entities,
    nodes: seeded.nodes,
    containers: seeded.containers,
  };
}

export { setPath };
