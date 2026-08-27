/**
 * V0 真后端 Boot Harness（双轨制端到端接线 · step 4）
 *
 * 目的：在 V0 浏览器端按需调起一次 `createLoadedMatch` 真实装载，让 V0 看到
 *       真实的 UiView / ActionList / Entities / Resources —— 而不是模块顶部
 *       手写的 mock 数组。**表现层（ORCA 寻路 / 节点动画 / 相机）暂不接通**，
 *       但游戏状态 / 行动枚举 / 提交回路已落到真实运行期。
 *
 * 设计（不另起端口、不引入 server 组件）：
 * - `createLoadedMatch` 是纯函数、无 fs / process.cwd / Node-only API，
 *   可直接在 `'use client'` 组件内同步调用。
 * - 用 `defaultCoreMechanicsConfig` + 默认官方玩法包 `CoreMechanicsPlaypack`
 *   装一个最小对局：1 玩家 + 1 NPC + 1 测试房间。
 * - 用 `wakeup-default.profile.json` 灌 UI Profile，让 `createUiSystem` 装配完整。
 * - 返回 `UiSystem`（createUiSystem 产物），UI 拿到的就是真实 7 端口。
 *
 * 调用者只需 useEffect 调一次；失败时把诊断回吐到控制台（HUD 显示 unmount
 * 状态即可，不在 V0 范围）。
 */

import { createEmptyWorldState } from '../../../core/kernel/state/world-state'
import { createEntityShape } from '../../../core/kernel/state/entity'
import { createAgentShape } from '../../../core/kernel/state/agent'
import { createContainerShape, createSlotShape, createNodeShape } from '../../../core/kernel/topology/types'
import { defaultCoreMechanicsConfig } from '../../../play/core-mechanics/load'
import { TAG_ROLL_PARTICIPANT, PROP_VITALITY } from '../../../play/core-mechanics/defs/ids'
import { createLoadedMatch } from '../../../play/loading-runtime'
import type { NpcEntry } from '../../../play/ai-runtime'
import { loadPresentationProfile } from '../../../ui/profile/profile-loader'
import type { UiSystem } from '../../../ui/model/view'
import defaultProfileJson from '../../../ui/profile/wakeup-default.profile.json'

const HERO = 'e:hero'
const ENEMY = 'e:enemy'
const HERO_AGENT = 'g:hero'
const NPC_ENTITY = 'e:npc-1'
const NPC_AGENT = 'g:npc-1'

// 节点 ID 必须与下方 TEST_MAP.nodes 一致
const HERO_NODE = 'n:map-a'
const ENEMY_NODE = 'n:map-b'

/** 预置世界：英雄 + 敌人 + 各自节点 + 英雄 bag 容器 + 英雄 agent。 */
function seedWorld() {
  const base = createEmptyWorldState('schedule:play.core')
  const agents = {
    [HERO_AGENT]: {
      ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'),
      controls: [{ $: HERO }],
    },
  }
  // 节点：与 TEST_MAP.nodes 同名
  const nodes = {
    [HERO_NODE]: createNodeShape(HERO_NODE, 'd:room'),
    [ENEMY_NODE]: createNodeShape(ENEMY_NODE, 'd:room'),
  }
  // entity 必须引用 map 节点，且 vitality/rollTier 用核心机制约定的 prop key
  const entities = {
    [HERO]: {
      ...createEntityShape(HERO, 'd:fighter'),
      node: HERO_NODE,
      props: { vitality: 4, rollTier: 3 },
      containers: { bag: 'c:hero-bag' },
      tags: [TAG_ROLL_PARTICIPANT],
    },
    [ENEMY]: {
      ...createEntityShape(ENEMY, 'd:fighter'),
      node: ENEMY_NODE,
      props: { [PROP_VITALITY]: 3 },
      tags: [],
    },
  }
  const heroBag = {
    ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'),
    slots: [createSlotShape('s:hero-bag-0')],
  }
  return {
    ...base,
    world: { ...base.world, agents },
    entities,
    nodes,
    containers: { 'c:hero-bag': heroBag },
  }
}

/** 最小合法地图：两个房间 + 一条双向门。 */
const TEST_MAP = {
  schemaVersion: '1.0' as const,
  id: 'map:test-room',
  name: '测试房间',
  backdrop: { image: 'backdrop.png', pixelWidth: 640, pixelHeight: 360, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: HERO_NODE, def: 'd:room', scale: 'small' as const, at: { x: 0.25, y: 0.5 }, floor: 0 },
    { id: ENEMY_NODE, def: 'd:room', scale: 'small' as const, at: { x: 0.75, y: 0.5 }, floor: 0 },
  ],
  edges: [
    {
      id: 'e:map-1',
      def: 'd:door',
      a: HERO_NODE,
      b: ENEMY_NODE,
      directionality: 'bidirectional' as const,
      path: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }],
    },
  ],
  // placement.def 必须是 entity-type def id（如 d:fighter），不是实例 id（e:hero）。
  // 实例 entity 由 initialWorld 提供（带 .node 字段），无需再通过 placement 创建。
  placements: [],
}

const NPC_BUDGET: () => ReadonlyArray<{ readonly entry: NpcEntry; readonly ap: number }> = () => [
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
]

export type BootResult = UiSystem

/**
 * 装载一次真对局，绑定真 UI 7 端口。失败返回 null，调用方应当回退到 mock 视图。
 */
export function bootUiBackend(): BootResult | null {
  const profileResult = loadPresentationProfile(JSON.stringify(defaultProfileJson))
  if (!profileResult.ok) {
    // eslint-disable-next-line no-console
    console.error('[V0 backend] profile load rejected:', profileResult.diagnostics)
    return null
  }
  const config = {
    ...defaultCoreMechanicsConfig(),
    rollPolicy: {
      enableRandomRoll: true,
      baseTierPolicyRef: 'd:base-tier.policy',
      boostBoundaryPolicyRef: 'd:boost-boundary.policy',
    },
    hookWiringAccepted: true,
  }
  const result = createLoadedMatch({
    scheduleId: 'schedule:play.core',
    config,
    playerEntityIds: [HERO],
    initialWorld: seedWorld(),
    map: TEST_MAP,
    npcBudget: NPC_BUDGET,
    seedDefs: [
      { id: 'd:fighter', kind: 'entity' },
      { id: 'd:room', kind: 'node' },
      { id: 'd:door', kind: 'link' },
      { id: 'd:base-tier.policy', kind: 'policy' },
      { id: 'd:boost-boundary.policy', kind: 'policy' },
    ],
    profile: profileResult.value,
  })
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error('[V0 backend] createLoadedMatch rejected:', result.diagnostics, 'blocked:', result.blocked)
    return null
  }
  if (result.match.ui === null) {
    // eslint-disable-next-line no-console
    console.error('[V0 backend] loaded match has no ui (profile missing)')
    return null
  }
  return result.match.ui
}
