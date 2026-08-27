/**
 * V0-11 — the demo journey graph.
 *
 * Round-2 finding this fixes: every page was individually reachable from the
 * control panel and almost none of them were reachable *from each other*. A
 * panel jump is a debugging affordance, not a journey — so this module states,
 * as data, the one continuous route a tester can walk with nothing but the
 * buttons the pages themselves render.
 *
 * Two node kinds, and the distinction matters:
 *   page node       a catalog pageId is mounted
 *   milestone node  a *state* inside a mounted page (residence roaming,
 *                   matching, shadow lobby, bed-front-ready, reward)
 *
 * Milestones are not fake pages. `residence-main` genuinely owns roaming,
 * the anchor's matching ribbon, the shadow-lobby silhouette layer and the
 * bed-A front-ready prompt in one scene — splitting those into separate
 * pageIds would invent four page contracts that do not exist. So they are
 * declared as milestones on the page that owns them, and the journey report
 * names the milestone rather than pretending a navigation happened.
 *
 * Nothing here executes. `lib/shell-route.ts` is the only runner.
 */

export type JourneyNodeKind = 'page' | 'milestone'

export interface ShellJourneyNode {
  /** Stable journey key. Never rename. */
  nodeId: string
  label: string
  kind: JourneyNodeKind
  /** The catalog pageId mounted at this node. */
  pageId: string
  /** Set for milestone nodes: the in-page state the node refers to. */
  milestoneId?: string
  /**
   * Where this node returns to when its own projection is unusable. This is
   * the declared safe point, not "whatever the previous page was".
   */
  safeReturnNodeId: string
}

export type JourneyTrigger = 'user-action' | 'accepted-result' | 'safe-return' | 'demo-control'

export interface ShellJourneyEdge {
  /** Stable transition key. Never rename. */
  transitionId: string
  fromNodeId: string
  toNodeId: string
  /** The intent the runner submits. Absent = local presentation-only move. */
  intentId?: string
  /** The literal control a tester operates. Written for reproduction, not prose. */
  actionLabel: string
  trigger: JourneyTrigger
  /** Node the tester lands on when the transition does not reach `accepted`. */
  fallbackNodeId: string
  /** Motion contract ids expected to play across this edge. */
  motionIds: readonly string[]
  /** Particle contract ids expected to play across this edge. */
  particleIds: readonly string[]
  /** Restated as a type: presentation can never be the reason a node advances. */
  advancedByMotion: false
}

/* ------------------------------------------------------------------ */
/* nodes                                                              */
/* ------------------------------------------------------------------ */

export const JOURNEY_NODES: readonly ShellJourneyNode[] = [
  { nodeId: 'boot.startup', label: '启动载入', kind: 'page', pageId: 'startup-loading', safeReturnNodeId: 'boot.startup' },
  { nodeId: 'menu.title', label: '标题菜单', kind: 'page', pageId: 'menu-title', safeReturnNodeId: 'menu.title' },
  { nodeId: 'residence.arrival', label: '驻地 · 抵达', kind: 'page', pageId: 'residence-main', safeReturnNodeId: 'menu.title' },
  { nodeId: 'residence.roaming', label: '驻地 · 漫游', kind: 'milestone', pageId: 'residence-main', milestoneId: 'roaming', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'residence.matching', label: '驻地 · 竞技匹配', kind: 'milestone', pageId: 'residence-main', milestoneId: 'matching', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'residence.shadow-lobby', label: '驻地 · 影子大厅', kind: 'milestone', pageId: 'residence-main', milestoneId: 'shadow-lobby', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'residence.bed-front-ready', label: '床 A · 就绪', kind: 'milestone', pageId: 'residence-main', milestoneId: 'bed-front-ready', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'transition.battle-intro', label: '转场 · 对局介绍', kind: 'page', pageId: 'transition-battle-intro', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'transition.dream-enter', label: '转场 · 入梦（纯白）', kind: 'page', pageId: 'transition-dream', milestoneId: 'enter-dream', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'session.hud', label: '对局 HUD', kind: 'page', pageId: 'hud-main', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'session.pause', label: '暂停菜单', kind: 'page', pageId: 'menu-pause', safeReturnNodeId: 'session.hud' },
  { nodeId: 'session.settings', label: '暂停 · 设置', kind: 'page', pageId: 'utility-settings', safeReturnNodeId: 'session.pause' },
  { nodeId: 'transition.result', label: '转场 · 结算', kind: 'page', pageId: 'transition-result', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'closure.reward', label: '奖励投影示例', kind: 'milestone', pageId: 'transition-result', milestoneId: 'reward', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'transition.dream-return', label: '转场 · 归途（纯白）', kind: 'page', pageId: 'transition-dream', milestoneId: 'return-home', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'residence.original-position', label: '驻地 · 原位置', kind: 'milestone', pageId: 'residence-main', milestoneId: 'original-position', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'creation.map-editor', label: '创作 · 地图编辑器', kind: 'page', pageId: 'map-editor', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'creation.asset-library', label: '创作 · 素材库', kind: 'page', pageId: 'asset-library', safeReturnNodeId: 'residence.arrival' },
  { nodeId: 'creation.research-bench', label: '创作 · 研究台', kind: 'page', pageId: 'research-bench', safeReturnNodeId: 'residence.arrival' },
]

export function getJourneyNode(nodeId: string): ShellJourneyNode | undefined {
  return JOURNEY_NODES.find((node) => node.nodeId === nodeId)
}

/* ------------------------------------------------------------------ */
/* edges                                                              */
/* ------------------------------------------------------------------ */

export const JOURNEY_EDGES: readonly ShellJourneyEdge[] = [
  {
    transitionId: 'boot.enter-title', fromNodeId: 'boot.startup', toNodeId: 'menu.title',
    intentId: 'boot.enter-title', actionLabel: '载入完成后的「进入标题」按钮', trigger: 'user-action',
    fallbackNodeId: 'boot.startup',
    motionIds: ['startup.loading-progress'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'menu.new-game', fromNodeId: 'menu.title', toNodeId: 'residence.arrival',
    intentId: 'menu.new-game', actionLabel: '标题菜单「新游戏」', trigger: 'user-action',
    fallbackNodeId: 'menu.title',
    motionIds: ['title.contour-reveal'], particleIds: ['ui.title-motes'], advancedByMotion: false,
  },
  {
    transitionId: 'menu.continue', fromNodeId: 'menu.title', toNodeId: 'residence.arrival',
    intentId: 'menu.continue', actionLabel: '标题菜单「继续」（需 mock 存档存在）', trigger: 'user-action',
    fallbackNodeId: 'menu.title',
    motionIds: ['title.contour-reveal'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'residence.start-roam', fromNodeId: 'residence.arrival', toNodeId: 'residence.roaming',
    actionLabel: 'WASD / 方向键（表现层位移，不提交 intent）', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: [], particleIds: ['environment.roam-dust'], advancedByMotion: false,
  },
  {
    transitionId: 'residence.open-anchor', fromNodeId: 'residence.roaming', toNodeId: 'residence.matching',
    intentId: 'residence.match.start', actionLabel: '锚定导流仪 →「发起竞技匹配」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['residence.anchor-pulse'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'residence.match-cancel', fromNodeId: 'residence.matching', toNodeId: 'residence.roaming',
    intentId: 'residence.match.cancel', actionLabel: '匹配状态条「取消」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'residence.match-accepted', fromNodeId: 'residence.matching', toNodeId: 'residence.shadow-lobby',
    intentId: 'residence.match.accept', actionLabel: '匹配完成投影送达（accepted-result）', trigger: 'accepted-result',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['residence.shadow-lobby-fade'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'residence.bed-a-approach', fromNodeId: 'residence.shadow-lobby', toNodeId: 'residence.bed-front-ready',
    actionLabel: '走进床 A 半径（空间事实，非点击）', trigger: 'user-action',
    fallbackNodeId: 'residence.shadow-lobby',
    motionIds: ['residence.ready-prompt'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'residence.bed-a-confirm', fromNodeId: 'residence.bed-front-ready', toNodeId: 'transition.battle-intro',
    intentId: 'residence.bed.confirm-ready', actionLabel: '床 A 就绪面板「确认就绪」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['battle-intro.map-forming'], particleIds: ['transition.intro-scan'], advancedByMotion: false,
  },
  {
    transitionId: 'battle-intro.to-dream', fromNodeId: 'transition.battle-intro', toNodeId: 'transition.dream-enter',
    intentId: 'session.enter-dream', actionLabel: '对局介绍「进入」（跳过只落终态，不推进）', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['dream.enter-white'], particleIds: ['transition.white-bloom'], advancedByMotion: false,
  },
  {
    transitionId: 'dream.to-hud', fromNodeId: 'transition.dream-enter', toNodeId: 'session.hud',
    intentId: 'session.hud.attach', actionLabel: '纯白显形终态出现后的「接入 HUD」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['dream.enter-white'], particleIds: ['transition.white-bloom'], advancedByMotion: false,
  },
  {
    transitionId: 'hud.pause', fromNodeId: 'session.hud', toNodeId: 'session.pause',
    actionLabel: 'HUD「暂停」／Esc（本地表现层挂起）', trigger: 'user-action',
    fallbackNodeId: 'session.hud',
    motionIds: ['overlay.pause-open'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'pause.resume', fromNodeId: 'session.pause', toNodeId: 'session.hud',
    actionLabel: '暂停菜单「继续」', trigger: 'safe-return',
    fallbackNodeId: 'session.hud',
    motionIds: ['overlay.pause-close'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'pause.settings', fromNodeId: 'session.pause', toNodeId: 'session.settings',
    actionLabel: '暂停菜单「设置」', trigger: 'user-action',
    fallbackNodeId: 'session.pause',
    motionIds: ['overlay.settings-open'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'settings.back-to-pause', fromNodeId: 'session.settings', toNodeId: 'session.pause',
    actionLabel: '设置「关闭」（焦点回到暂停菜单的设置按钮）', trigger: 'safe-return',
    fallbackNodeId: 'session.pause',
    motionIds: ['overlay.settings-close'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'pause.to-title', fromNodeId: 'session.pause', toNodeId: 'menu.title',
    intentId: 'session.abandon-to-title', actionLabel: '暂停菜单「返回标题」→ 确认', trigger: 'user-action',
    fallbackNodeId: 'session.pause',
    motionIds: ['overlay.pause-close'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'hud.to-result', fromNodeId: 'session.hud', toNodeId: 'transition.result',
    intentId: 'session.settle', actionLabel: 'HUD「结算此局（mock 投影）」', trigger: 'user-action',
    fallbackNodeId: 'session.hud',
    motionIds: ['result.seal'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'result.to-reward', fromNodeId: 'transition.result', toNodeId: 'closure.reward',
    actionLabel: '结算演出落到奖励投影行（同页里程碑）', trigger: 'accepted-result',
    fallbackNodeId: 'transition.result',
    motionIds: ['result.reward-rows'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'reward.to-return', fromNodeId: 'closure.reward', toNodeId: 'transition.dream-return',
    intentId: 'session.return-home', actionLabel: '结算页「返回驻地」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['dream.return-white'], particleIds: ['transition.white-bloom'], advancedByMotion: false,
  },
  {
    transitionId: 'return.to-original-position', fromNodeId: 'transition.dream-return', toNodeId: 'residence.original-position',
    intentId: 'residence.restore-position', actionLabel: '归途纯白终态后的「回到原位置」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: ['dream.return-white'], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'original-position.fallback', fromNodeId: 'residence.original-position', toNodeId: 'residence.arrival',
    actionLabel: '原位置投影缺失 → 默认出生点（声明的安全回退）', trigger: 'safe-return',
    fallbackNodeId: 'residence.arrival',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'residence.exit-to-title', fromNodeId: 'residence.arrival', toNodeId: 'menu.title',
    intentId: 'residence.exit', actionLabel: '驻地左上角「离开出租屋」', trigger: 'user-action',
    fallbackNodeId: 'residence.arrival',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'creation.open-map-editor', fromNodeId: 'residence.original-position', toNodeId: 'creation.map-editor',
    actionLabel: '控制面板「地图编辑器」', trigger: 'demo-control', fallbackNodeId: 'residence.arrival',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'creation.open-asset-library', fromNodeId: 'creation.map-editor', toNodeId: 'creation.asset-library',
    actionLabel: '创作页面「素材库」', trigger: 'demo-control', fallbackNodeId: 'creation.map-editor',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'creation.open-research-bench', fromNodeId: 'creation.asset-library', toNodeId: 'creation.research-bench',
    actionLabel: '创作页面「研究台」', trigger: 'demo-control', fallbackNodeId: 'creation.asset-library',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
  {
    transitionId: 'creation.return-to-game', fromNodeId: 'creation.research-bench', toNodeId: 'residence.arrival',
    actionLabel: '创作页面「退出并返回」', trigger: 'safe-return', fallbackNodeId: 'residence.arrival',
    motionIds: [], particleIds: [], advancedByMotion: false,
  },
]

export function edgesFrom(nodeId: string): readonly ShellJourneyEdge[] {
  return JOURNEY_EDGES.filter((edge) => edge.fromNodeId === nodeId)
}

export function getJourneyEdge(transitionId: string): ShellJourneyEdge | undefined {
  return JOURNEY_EDGES.find((edge) => edge.transitionId === transitionId)
}

/** The nodes a page can currently be showing, for the journey ribbon. */
export function nodesForPage(pageId: string): readonly ShellJourneyNode[] {
  return JOURNEY_NODES.filter((node) => node.pageId === pageId)
}

/* ------------------------------------------------------------------ */
/* the spine — the one route that must walk without the panel          */
/* ------------------------------------------------------------------ */

export const JOURNEY_SPINE: readonly string[] = [
  'boot.enter-title',
  'menu.new-game',
  'residence.start-roam',
  'residence.open-anchor',
  'residence.match-accepted',
  'residence.bed-a-approach',
  'residence.bed-a-confirm',
  'battle-intro.to-dream',
  'dream.to-hud',
  'hud.to-result',
  'result.to-reward',
  'reward.to-return',
  'return.to-original-position',
]

/**
 * The named paths the round-3 acceptance walks one by one. `expectFailure`
 * marks the ones whose point is that they must NOT advance.
 */
export interface JourneyPathSpec {
  pathId: string
  label: string
  transitionIds: readonly string[]
  /** Set when the path's purpose is to verify a refusal or a hold. */
  expectHold?: string
}

export const JOURNEY_PATHS: readonly JourneyPathSpec[] = [
  { pathId: 'spine', label: '主演示旅程（启动 → 原位置）', transitionIds: JOURNEY_SPINE },
  { pathId: 'title-new-game', label: '标题 → 新游戏 → 驻地', transitionIds: ['menu.new-game'] },
  { pathId: 'title-continue', label: '标题 → 继续（有 mock 存档）→ 驻地', transitionIds: ['menu.continue'] },
  {
    pathId: 'title-continue-empty', label: '标题 → 继续（无存档）', transitionIds: [],
    expectHold: '「继续」为 aria-disabled 且不在键盘序列内：没有存档时该入口不存在，不产生转移。',
  },
  {
    pathId: 'title-quit-hold', label: '标题 → 退出 → 非 accepted', transitionIds: [],
    expectHold: 'rejected / stale / timeout 全部留在标题页，退出确认脉冲动画不触发退出。',
  },
  { pathId: 'match-cancel', label: '匹配 → 取消 → 驻地漫游', transitionIds: ['residence.open-anchor', 'residence.match-cancel'] },
  { pathId: 'pause-settings-back', label: '暂停 → 设置 → 返回暂停', transitionIds: ['pause.settings', 'settings.back-to-pause'] },
  { pathId: 'pause-to-title', label: '暂停 → 返回标题', transitionIds: ['pause.to-title'] },
  { pathId: 'result-loop-close', label: '结算 → 奖励 → 归途 → 原位置', transitionIds: ['result.to-reward', 'reward.to-return', 'return.to-original-position'] },
  { pathId: 'original-position-missing', label: '原位置缺失 → 默认安全回退', transitionIds: ['original-position.fallback'] },
  {
    pathId: 'bed-b-deferred', label: '床 B → 明确后置不可用', transitionIds: [],
    expectHold: '床 B 为 aria-disabled 且 tabIndex=-1，点击只播报「后置开发」，没有出边。',
  },
  {
    pathId: 'bed-c-selftest', label: '床 C → 明确仅自测', transitionIds: [],
    expectHold: '床 C 打开自测说明面板，图上没有通往对局的出边。',
  },
]

/* ------------------------------------------------------------------ */
/* graph integrity — dev-time assertions, not decoration              */
/* ------------------------------------------------------------------ */

export interface JourneyGraphProblem {
  kind: 'unknown-node' | 'unknown-fallback' | 'orphan-node' | 'broken-path'
  detail: string
}

/**
 * An island is the exact defect round 2 shipped, so it is checked rather than
 * asserted in prose: every node except the entry must have an inbound edge,
 * and every edge must point at real nodes.
 */
export function journeyGraphProblems(): JourneyGraphProblem[] {
  const problems: JourneyGraphProblem[] = []
  const ids = new Set(JOURNEY_NODES.map((node) => node.nodeId))
  const inbound = new Set<string>()

  for (const edge of JOURNEY_EDGES) {
    if (!ids.has(edge.fromNodeId)) problems.push({ kind: 'unknown-node', detail: `${edge.transitionId}.from=${edge.fromNodeId}` })
    if (!ids.has(edge.toNodeId)) problems.push({ kind: 'unknown-node', detail: `${edge.transitionId}.to=${edge.toNodeId}` })
    if (!ids.has(edge.fallbackNodeId)) problems.push({ kind: 'unknown-fallback', detail: `${edge.transitionId}.fallback=${edge.fallbackNodeId}` })
    inbound.add(edge.toNodeId)
  }

  for (const node of JOURNEY_NODES) {
    if (node.nodeId === 'boot.startup') continue
    if (!inbound.has(node.nodeId)) problems.push({ kind: 'orphan-node', detail: node.nodeId })
    if (!ids.has(node.safeReturnNodeId)) problems.push({ kind: 'unknown-fallback', detail: `${node.nodeId}.safeReturn` })
  }

  for (const path of JOURNEY_PATHS) {
    for (let i = 0; i < path.transitionIds.length; i += 1) {
      const currentId = path.transitionIds[i]!
      const edge = getJourneyEdge(currentId)
      if (!edge) {
        problems.push({ kind: 'broken-path', detail: `${path.pathId}: unknown ${currentId}` })
        continue
      }
      const previous = i > 0 ? getJourneyEdge(path.transitionIds[i - 1]!) : undefined
      if (previous && previous.toNodeId !== edge.fromNodeId) {
        problems.push({ kind: 'broken-path', detail: `${path.pathId}: ${previous.transitionId} → ${edge.transitionId} 不连续` })
      }
    }
  }

  return problems
}
