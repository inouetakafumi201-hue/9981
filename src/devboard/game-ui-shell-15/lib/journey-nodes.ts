/**
 * V0-02 — the journey as a data contract, not as component branching.
 *
 * Each node declares, explicitly and auditably:
 *   successNext   where a confirmed intent goes
 *   failureNext   where an unrecoverable failure lands (never "forward")
 *   failureStates which failures this node can actually produce
 *   retry / cancel / timeout / safeReturn  the recovery affordances
 *
 * Hard rules encoded here:
 *  - No node advances on a timer alone. `autoAdvance` only ever moves a node
 *    into its own *presentation* completion; the transition itself is an intent.
 *  - Animation failure, skip, or a missing asset resolves to a UI safe state.
 *    It never advances the journey.
 *  - Beds are loading gates: A is the only competitive entry, B is deferred,
 *    C is self-test only. The single teleport表现 is the whiteout (enter-dream /
 *    return-home).
 */

export const JOURNEY_NODE_IDS = [
  'cold-start',
  'loading',
  'title',
  'residence',
  'anchor-device',
  'matching',
  'residence-roaming',
  'shadow-lobby',
  'bed-front-ready',
  'battle-intro',
  'enter-dream',
  'battle-hud',
  'overlays',
  'result',
  'reward',
  'return-home',
  'residence-original-position',
] as const

export type JourneyNodeId = (typeof JOURNEY_NODE_IDS)[number]

/** Every failure the shell can drive, per node. */
export type JourneyFailureId =
  | 'load-error'
  | 'timeout'
  | 'asset-missing'
  | 'asset-load-failed'
  | 'rejected'
  | 'stale'
  | 'cancelled'
  | 'device-unavailable'
  | 'match-failed'
  | 'relay-unavailable'
  | 'relay-stale'
  | 'roam-interrupted'
  | 'gate-locked'
  | 'projection-empty'
  | 'projection-failed'
  | 'disconnected'
  | 'reconnecting'
  | 'duplicate-submit'
  | 'origin-missing'

export const FAILURE_LABELS: Record<JourneyFailureId, string> = {
  'load-error': '载入失败',
  timeout: '请求超时',
  'asset-missing': '素材缺失',
  'asset-load-failed': '素材载入失败',
  rejected: '宿主拒绝',
  stale: '版本过期',
  cancelled: '已取消',
  'device-unavailable': '设备不可用',
  'match-failed': '匹配失败',
  'relay-unavailable': '影子中继不可用',
  'relay-stale': '影子中继陈旧',
  'roam-interrupted': '漫游中断',
  'gate-locked': '门控未开放',
  'projection-empty': '空投影',
  'projection-failed': '投影失败',
  disconnected: '连接中断',
  reconnecting: '正在重连',
  'duplicate-submit': '重复提交被拦截',
  'origin-missing': '出发位置缺失',
}

/** Diagnostics a player can actually read. Never a bare code. */
export const FAILURE_DIAGNOSTICS: Record<JourneyFailureId, string> = {
  'load-error': '投影载入未完成。当前节点未改变，可以重试或安全返回。',
  timeout: '没有在期限内收到宿主确认。原节点与出发位置保持不变。',
  'asset-missing': '关键素材未登记。语义槽位已保留，显示的是分类 fallback，不是成品。',
  'asset-load-failed': '素材已登记但载入失败。演出降级到最终静态状态，旅程未推进。',
  rejected: '宿主拒绝了这次推进请求。没有任何事实被修改。',
  stale: '本地投影版本落后于宿主。请重试以取得新版本。',
  cancelled: '你取消了这次请求。焦点已回到发起控件。',
  'device-unavailable': '锚定导流仪当前不可用。可以重试，或返回驻地。',
  'match-failed': '匹配未能建立。队列已释放，驻地输入保持开放。',
  'relay-unavailable': '队友中继影像不可用。影子大厅只显示占位语义槽位。',
  'relay-stale': '中继影像版本陈旧，显示的是上一版本，不代表当前队伍。',
  'roam-interrupted': '漫游被中断。已回到匹配视图，队列状态未改变。',
  'gate-locked': '该床位不是正式入局门。床 B 为后置功能，床 C 仅自测。',
  'projection-empty': '投影为空。界面结构保持稳定，不推断缺失数据。',
  'projection-failed': '结算／奖励投影不可用。没有发放任何奖励，可重试或安全返回。',
  disconnected: '连接中断。低优先级输入已冻结，对局事实不被本地修改。',
  reconnecting: '正在重连。期间显示的是最后一次已确认的投影。',
  'duplicate-submit': '上一次提交仍在等待确认，重复提交已被拦截。',
  'origin-missing': '出发位置缺失。将回退到驻地默认位置，并显示明确诊断。',
}

export interface JourneyNode {
  id: JourneyNodeId
  label: string
  /** Intent raised to leave this node on the happy path. */
  advanceIntentId: string
  successNext: JourneyNodeId | null
  /** Where an unrecoverable failure lands. Never further along the journey. */
  failureNext: JourneyNodeId
  failureStates: JourneyFailureId[]
  retry: boolean
  cancel: boolean
  /** Node can time out while waiting for a projection. */
  timeout: boolean
  /** The node a safe return unwinds to. */
  safeReturn: JourneyNodeId
  /** Presentation-only completion. Never a journey advance on its own. */
  autoAdvance: boolean
  /** Stated plainly so nothing here can be mistaken for a rule. */
  mockBoundary: string
}

export const JOURNEY_NODES: Record<JourneyNodeId, JourneyNode> = {
  'cold-start': {
    id: 'cold-start', label: '冷启动', advanceIntentId: 'journey.cold-start.continue',
    successNext: 'loading', failureNext: 'cold-start',
    failureStates: ['load-error', 'timeout', 'asset-missing'],
    retry: true, cancel: false, timeout: true, safeReturn: 'cold-start', autoAdvance: true,
    mockBoundary: '启动探测为 mock，不读取任何真实存档或版本。',
  },
  loading: {
    id: 'loading', label: '载入投影', advanceIntentId: 'journey.loading.continue',
    successNext: 'title', failureNext: 'cold-start',
    failureStates: ['load-error', 'timeout', 'asset-missing', 'asset-load-failed', 'projection-empty'],
    retry: true, cancel: true, timeout: true, safeReturn: 'cold-start', autoAdvance: true,
    mockBoundary: '进度条是表现层，不反映真实资源加载量。',
  },
  title: {
    id: 'title', label: '标题', advanceIntentId: 'journey.title.new-game',
    successNext: 'residence', failureNext: 'title',
    failureStates: ['rejected', 'stale', 'timeout', 'cancelled', 'projection-empty'],
    retry: true, cancel: true, timeout: true, safeReturn: 'title', autoAdvance: false,
    mockBoundary: '存档存在性、继续与退出结果全部为 mock。',
  },
  residence: {
    id: 'residence', label: '驻地', advanceIntentId: 'journey.residence.open-anchor',
    successNext: 'anchor-device', failureNext: 'residence',
    failureStates: ['rejected', 'stale', 'timeout', 'cancelled', 'device-unavailable'],
    retry: true, cancel: true, timeout: true, safeReturn: 'title', autoAdvance: false,
    mockBoundary: '房间是固定像素场景，不含地图拓扑与寻路。',
  },
  'anchor-device': {
    id: 'anchor-device', label: '锚定导流仪', advanceIntentId: 'journey.anchor.start-match',
    successNext: 'matching', failureNext: 'residence',
    failureStates: ['device-unavailable', 'rejected', 'stale', 'timeout', 'cancelled'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '设备可用性与启动结果为 mock；取消后焦点回到设备控件。',
  },
  matching: {
    id: 'matching', label: '匹配中', advanceIntentId: 'journey.matching.complete',
    successNext: 'shadow-lobby', failureNext: 'residence',
    failureStates: ['match-failed', 'timeout', 'cancelled', 'relay-unavailable', 'stale'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '队列进度为 mock；匹配期间驻地输入保持开放。',
  },
  'residence-roaming': {
    id: 'residence-roaming', label: '驻地漫游', advanceIntentId: 'journey.roaming.return-to-match',
    successNext: 'matching', failureNext: 'matching',
    failureStates: ['roam-interrupted', 'disconnected', 'stale', 'cancelled'],
    retry: true, cancel: true, timeout: false, safeReturn: 'matching', autoAdvance: false,
    mockBoundary: '漫游是同一驻地的视角切换，不是独立场景载入。',
  },
  'shadow-lobby': {
    id: 'shadow-lobby', label: '影子大厅', advanceIntentId: 'journey.shadow-lobby.go-to-bed',
    successNext: 'bed-front-ready', failureNext: 'residence',
    failureStates: ['relay-unavailable', 'relay-stale', 'timeout', 'stale', 'cancelled'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '队友中继影像叠加在原驻地上，没有独立大厅载入。',
  },
  'bed-front-ready': {
    id: 'bed-front-ready', label: '床 A 就绪', advanceIntentId: 'journey.bed.load-dive',
    successNext: 'battle-intro', failureNext: 'residence',
    failureStates: ['gate-locked', 'load-error', 'timeout', 'cancelled', 'rejected', 'duplicate-submit'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '床是装载入口。床 A 可入局，床 B 后置，床 C 仅自测。',
  },
  'battle-intro': {
    id: 'battle-intro', label: '对局介绍', advanceIntentId: 'journey.battle-intro.continue',
    successNext: 'enter-dream', failureNext: 'bed-front-ready',
    failureStates: ['asset-missing', 'asset-load-failed', 'timeout', 'projection-empty'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: true,
    mockBoundary: '跳过只跳过演出，不推进节点；节点推进仍由 intent 决定。',
  },
  'enter-dream': {
    id: 'enter-dream', label: '进入梦境', advanceIntentId: 'journey.enter-dream.continue',
    successNext: 'battle-hud', failureNext: 'bed-front-ready',
    failureStates: ['asset-missing', 'asset-load-failed', 'timeout', 'cancelled'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: true,
    mockBoundary: '纯白显形是唯一传送表现。素材失败时只到静态最终状态。',
  },
  'battle-hud': {
    id: 'battle-hud', label: '对局 HUD', advanceIntentId: 'journey.battle.request-result',
    successNext: 'result', failureNext: 'battle-hud',
    failureStates: ['disconnected', 'reconnecting', 'stale', 'timeout', 'projection-empty', 'duplicate-submit'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: 'HUD 全部数值来自 mock projection fixture，不是规则事实。',
  },
  overlays: {
    id: 'overlays', label: '覆盖层仲裁', advanceIntentId: 'journey.overlays.close',
    successNext: 'battle-hud', failureNext: 'battle-hud',
    failureStates: ['stale', 'timeout', 'cancelled', 'disconnected'],
    retry: true, cancel: true, timeout: false, safeReturn: 'battle-hud', autoAdvance: false,
    mockBoundary: '覆盖层优先级是壳层输入仲裁，不冻结任何规则。',
  },
  result: {
    id: 'result', label: '对局结算', advanceIntentId: 'journey.result.continue',
    successNext: 'reward', failureNext: 'battle-hud',
    failureStates: ['projection-failed', 'projection-empty', 'timeout', 'stale', 'disconnected'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '结算数值为 mock 投影；空结果与投影失败可独立复现。',
  },
  reward: {
    id: 'reward', label: '奖励确认', advanceIntentId: 'journey.reward.confirm',
    successNext: 'return-home', failureNext: 'result',
    failureStates: ['projection-failed', 'duplicate-submit', 'timeout', 'cancelled', 'stale'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '奖励不在壳层发放；重复提交被拦截而不是重复确认。',
  },
  'return-home': {
    id: 'return-home', label: '返回驻地', advanceIntentId: 'journey.return-home.continue',
    successNext: 'residence-original-position', failureNext: 'reward',
    failureStates: ['asset-missing', 'asset-load-failed', 'timeout', 'cancelled'],
    retry: true, cancel: true, timeout: true, safeReturn: 'residence', autoAdvance: true,
    mockBoundary: '返回同样只用纯白显形；失败时停在可读状态，不静默回家。',
  },
  'residence-original-position': {
    id: 'residence-original-position', label: '原位置恢复', advanceIntentId: 'journey.origin.settle',
    successNext: null, failureNext: 'residence',
    failureStates: ['origin-missing', 'stale', 'projection-empty'],
    retry: true, cancel: false, timeout: false, safeReturn: 'residence', autoAdvance: false,
    mockBoundary: '出发位置为 mock 坐标；缺失时回退到驻地默认位置并显示诊断。',
  },
}

export const JOURNEY_NODE_LIST: JourneyNode[] = JOURNEY_NODE_IDS.map((id) => JOURNEY_NODES[id])

/** Bed gating semantics, kept as data so no component can quietly widen it. */
export const BED_GATES = [
  { bedId: 'A', label: '床 A', status: 'available', note: '唯一正式竞技入局门。' },
  { bedId: 'B', label: '床 B', status: 'deferred', note: '后置功能，暂不可用。' },
  { bedId: 'C', label: '床 C', status: 'self-test', note: '仅自测，不进入正式对局。' },
] as const

export type BedGate = (typeof BED_GATES)[number]

export function nodeIndex(id: JourneyNodeId): number {
  return JOURNEY_NODE_IDS.indexOf(id)
}

/** Journey phase as seen by a surface. Distinct from an intent phase. */
export type JourneyNodePhase = 'idle' | 'presenting' | 'pending' | 'ready' | 'failed' | 'safe-return'

export interface JourneyState {
  nodeId: JourneyNodeId
  phase: JourneyNodePhase
  failure: JourneyFailureId | null
  revision: number
  source: 'mock'
  returnOrigin: string | null
  bedA: 'locked' | 'lit' | 'ready'
  match: 'none' | 'matching' | 'complete'
  relay: 'none' | 'live' | 'stale' | 'unavailable'
  pendingIntentId: string | null
}

export const INITIAL_JOURNEY_STATE: JourneyState = {
  nodeId: 'cold-start', phase: 'idle', failure: null, revision: 1, source: 'mock',
  returnOrigin: null, bedA: 'locked', match: 'none', relay: 'none', pendingIntentId: null,
}
