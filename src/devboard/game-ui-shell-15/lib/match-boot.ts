/**
 * V0 真后端 Boot Harness（双轨制端到端接线 · step 4）
 *
 * 目的：在 V0 浏览器端按需调起一次 `createLoadedMatch` 真实装载，让 V0 看到
 *       真实的 UiView / ActionList / Entities / Resources —— 而不是模块顶部
 *       手写的 mock 数组。**表现层（ORCA 寻路 / 节点动画 / 相机）暂不接通**，
 *       但游戏状态 / 行动枚举 /提交回路已落到真实运行期。
 *
 * 地图：asset-pipeline 产物 office-v1.json，4 节点（office_root / meeting_room /
 *       work_zone / archive_closet）+ 3 边（door_meeting / door_work / door_archive）
 *       + 1 实体放置（office_locker）。这是 1 局能跑出真实 pathfinder 拓扑的最小
 *       体积，又带 1 个有「父节点→子节点」关系的天然场景。
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
import type { UiSystem } from '../../../ui/index'
import defaultProfileJson from '../../../ui/profile/wakeup-default.profile.json'
import type { MapDataDocument } from '../../../play/map/types'
import officeV1Json from './fixtures/office-v1.json'

const HERO = 'e:hero'
const ENEMY = 'e:enemy'
const HERO_AGENT = 'g:hero'
const NPC_ENTITY = 'e:npc-1'
const NPC_AGENT = 'g:npc-1'

// 节点 ID 与 OFFICE_V1_MAP 的 nodes 严格对齐（office_root / meeting_room）。
const HERO_NODE = 'office_root'
const ENEMY_NODE = 'meeting_room'

/**
 * 真实底图：办公室示意图（asset-pipeline 产物）。
 *
 * `as MapDataDocument`：devboard 的 tsconfig 已 exclude 主仓 `src/`，所以
 * 静态推断把 office-v1.json 当成宽松的 `unknown`，需要在这里收紧到
 * 装载入口期望的形状。fixture 文件本身是 asset-pipeline 的合法产物，运行时
 * 由 `compileMap` → `validateMapStructure` 再次校验。
 */
const OFFICE_V1_MAP = officeV1Json as MapDataDocument

/** 预置世界：英雄 + 敌人 + 各自节点 + 英雄 bag 容器 + 英雄 agent。 */
function seedWorld() {
  const base = createEmptyWorldState('schedule:play.core')
  const agents = {
    [HERO_AGENT]: {
      ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'),
      controls: [{ $: HERO }],
    },
  }
  // 节点：与 OFFICE_V1_MAP.nodes 的 office_root / meeting_room 同名
  const nodes = {
    [HERO_NODE]: createNodeShape(HERO_NODE, 'd:scene/yard'),
    [ENEMY_NODE]: createNodeShape(ENEMY_NODE, 'd:scene/room'),
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
    map: OFFICE_V1_MAP,
    npcBudget: NPC_BUDGET,
    // office-v1.json 引用以下 def：3 档天然场景 + 1 个 transition 门 + 1 个实体放置
    // （inst_locker_7f3a）。没有它们时 prefab.spawn 会在 E_REF_KIND 阶段拒绝。
    seedDefs: [
      { id: 'd:fighter', kind: 'entity' },
      { id: 'd:scene/yard', kind: 'node' },
      { id: 'd:scene/room', kind: 'node' },
      { id: 'd:scene/closet', kind: 'node' },
      { id: 'd:transition/door', kind: 'link' },
      { id: 'inst_locker_7f3a', kind: 'entity' },
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
