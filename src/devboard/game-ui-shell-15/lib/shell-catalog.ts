/**
 * V0-01 — Authoritative shell PageCatalog.
 *
 * This module is the single source of truth for "what pages exist in the shell".
 * It is data only: no JSX, no routing, no host wiring. The control panel
 * (`control-panel-main`) is the only navigation centre and reads this catalog;
 * every other surface is a leaf.
 *
 * Extraction contract: a downstream integrator replaces mock fixtures and the
 * intent adapter only. `pageId` / `variantId` / `stateId` are stable keys and
 * must not be renamed when wiring real projections.
 */

/** Product pages ship to players. Everything else is a shell-internal surface. */
export type PageKind =
  | 'product'
  /** Batch workbench kept for development demos only. Never a product page. */
  | 'development-demo'
  /** Older flow kept for provenance. Superseded by a product page. */
  | 'heritage-only'
  /** Look-and-feel study. Not a page contract. */
  | 'visual-reference'

export type PageFamily =
  | 'boot'
  | 'menu'
  | 'world'
  | 'narrative'
  | 'transition'
  | 'notice'
  | 'utility'
  | 'progress'
  | 'hud'
  | 'control'
  | 'workbench'

/** Honest implementation status. `unimplemented` MUST render a visible fallback. */
export type BaselineStatus = 'implemented' | 'partial' | 'unimplemented'

/** Every shell surface must be reachable in each of these states it declares. */
export type ShellStateId =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'error'
  | 'timeout'
  | 'retrying'
  | 'cancelled'
  | 'safe-return'
  | 'unimplemented'

export const SHELL_STATE_LABELS: Record<ShellStateId, string> = {
  ready: '就绪',
  loading: '载入中',
  empty: '空投影',
  error: '错误',
  timeout: '超时',
  retrying: '重试中',
  cancelled: '已取消',
  'safe-return': '安全返回',
  unimplemented: '未实现',
}

export type VariantId = 'default' | 'compact' | 'cinematic'

export const VARIANT_LABELS: Record<VariantId, string> = {
  default: 'Default / A',
  compact: 'Compact / B',
  cinematic: 'Cinematic / C',
}

export interface PageDescriptor {
  /** Stable extraction key. Never rename. */
  pageId: string
  label: string
  family: PageFamily
  /** Which prompt batch owns this surface (provenance, not a runtime concern). */
  batchId: string
  kind: PageKind
  /** States this surface can be driven into from control-panel-main. */
  stateIds: ShellStateId[]
  variantIds: VariantId[]
  /** Control-panel entry key used to mount the surface. */
  entryId: string
  baselineStatus: BaselineStatus
  /** State the surface falls back to when its projection is unusable. */
  fallbackState: ShellStateId
  /** What is mock here, stated plainly. Read by the extraction report. */
  mockBoundary: string
  eyebrow: string
  title: string
  description: string
  /** Non-product surfaces explain why they are retained. */
  retentionReason?: string
}

const FULL_STATES: ShellStateId[] = ['ready', 'loading', 'empty', 'error', 'timeout', 'retrying', 'cancelled', 'safe-return']
const ONLY_DEFAULT: VariantId[] = ['default']
const ALL_VARIANTS: VariantId[] = ['default', 'compact', 'cinematic']

/* ------------------------------------------------------------------ */
/* Product pages — the authoritative player-facing surface list.       */
/* ------------------------------------------------------------------ */

const PRODUCT_PAGES: PageDescriptor[] = [
  {
    pageId: 'control-panel-main', label: '控制面板', family: 'control', batchId: 'B1', kind: 'product',
    stateIds: ['ready'], variantIds: ONLY_DEFAULT, entryId: 'entry.control-panel-main',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '页面目录、状态驱动器与 intent 结果均为壳层 mock，不代表宿主导航事实。',
    eyebrow: 'SHELL AUTHORITY', title: '唯一导航中心。', description: '页面选择、分类过滤、变体、状态迁移、点击播放与抽取元数据的唯一入口。',
  },
  {
    pageId: 'startup-loading', label: '启动载入', family: 'boot', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.startup-loading',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '启动阶段、存档存在性与资源挂载结果全部为 mock。',
    eyebrow: 'BOOT PROJECTION', title: '恢复信号。', description: '冷启动、恢复载入、空存档、版本不兼容、超时与安全回退。',
  },
  {
    pageId: 'menu-title', label: '标题菜单', family: 'menu', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.menu-title',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '存档存在性、退出结果与设置保存结果为 mock。',
    eyebrow: 'ENTRY POINT', title: '最后一盏灯还亮着。', description: '新游戏、继续、设置、退出，退出走完整确认与结果生命周期。',
  },
  {
    pageId: 'menu-pause', label: '暂停菜单', family: 'menu', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.menu-pause',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '世界冻结仅为演示视觉；重开与返回标题不写入任何规则事实。',
    eyebrow: 'SYSTEM HOLD', title: '世界在等待。', description: '继续、设置、重新开始、返回标题，各自具备确认与失败闭环。',
  },
  {
    pageId: 'residence-main', label: '驻地主场景', family: 'world', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.residence-main',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '床位门控、锚定导流仪与出发位置均为 mock 投影，不含地图拓扑。',
    eyebrow: 'SAFE HOUSE', title: '四面墙，三张床，一个信号。', description: '每次下潜之间回到的房间。床是装载入口，不是传送门。',
  },
  {
    pageId: 'hud-main', label: '对局 HUD', family: 'hud', batchId: 'B2', kind: 'product',
    stateIds: FULL_STATES, variantIds: ALL_VARIANTS, entryId: 'entry.hud-main',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: 'HP/SP/AP、单位、动作卡、目标与回合顺序全部来自显式 mock projection fixture。',
    eyebrow: 'LIVE OVERLAY', title: '读懂战场。', description: '爆发档位 0/1/2，+3 仅置灰保留位；选择效果与触发效果分离。',
  },
  {
    pageId: 'dialog-line', label: '对话 · 单行', family: 'narrative', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.dialog-line',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '台词、立绘与语音状态为 mock；跳过与继续不推进任何规则。',
    eyebrow: 'SIGNAL RECEIVED', title: '有些声音活过了沉默。', description: '逐字文本、立绘降级链、语音状态、字幕与继续交互。',
  },
  {
    pageId: 'dialog-options', label: '对话 · 选项', family: 'narrative', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.dialog-options',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '选项后果为 mock 文案，选择结果由 intent 结果决定而非本地点击。',
    eyebrow: 'BRANCH POINT', title: '一次选择，留下一道痕。', description: '选项列表、禁用解释、确认与被拒绝后的可读回退。',
  },
  {
    pageId: 'transition-dream', label: '转场 · 纯白显形', family: 'transition', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.transition-dream',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '纯白显形是唯一传送表现；素材缺失时只到最终 UI 状态，不推进旅程。',
    eyebrow: 'SEQUENCE', title: '穿过纯白。', description: '醒着的房间与下潜之间唯一的传送仪式。',
  },
  {
    pageId: 'transition-battle-intro', label: '转场 · 对局介绍', family: 'transition', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.transition-battle-intro',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '对局信息为 mock；跳过只跳过表现，不跳过节点。',
    eyebrow: 'SEQUENCE', title: '地图开始成形。', description: 'HUD 接管之前的一次屏息。',
  },
  {
    pageId: 'transition-result', label: '转场 · 结算', family: 'transition', batchId: 'B1', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.transition-result',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '结算数值为 mock 投影，空结果与投影失败都可独立复现。',
    eyebrow: 'SEQUENCE', title: '这次下潜的代价与所得。', description: '收束一次循环，而不是弹一个窗。',
  },
  {
    pageId: 'notice-broadcast', label: '通告 · 广播', family: 'notice', batchId: 'B4', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.notice-broadcast',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '广播内容为 mock，被动横幅不抢占输入。',
    eyebrow: 'INCOMING', title: '黑暗里有东西动了。', description: '可展开的被动横幅，用于公告与世界事件。',
  },
  {
    pageId: 'notice-toast', label: '通告 · 浮层', family: 'notice', batchId: 'B4', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.notice-toast',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '消息流为 mock，堆叠上限与消失时间是表现规则而非玩法规则。',
    eyebrow: 'INCOMING', title: '信息到来，然后淡去。', description: '角落堆叠的瞬时信息与错误反馈。',
  },
  {
    pageId: 'notification-history', label: '通告 · 历史', family: 'notice', batchId: 'B4', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.notification-history',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '只读历史，永不作为消息中心，不发起写入。',
    eyebrow: 'ARCHIVE', title: '说过的话不会消失。', description: '按 N 打开的只读分组历史。',
  },
  {
    pageId: 'utility-settings', label: '工具 · 设置', family: 'utility', batchId: 'B3', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.utility-settings',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '设置项与保存结果为 mock；取消、保存失败与保存成功可分别演示。',
    eyebrow: 'CONFIGURATION', title: '调准信号。', description: '显示、声音、输入、无障碍、语言、图形、减少动效与字幕。',
  },
  {
    pageId: 'utility-inventory', label: '工具 · 背包', family: 'utility', batchId: 'B3', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.utility-inventory',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '格位内容为 mock；拖放重排仅提交 intent，不本地改写事实。',
    eyebrow: 'FIELD KIT', title: '你带的东西让你活着。', description: '拖动重排格网，右键使用／查看／丢弃菜单。',
  },
  {
    pageId: 'utility-safe', label: '工具 · 保险箱', family: 'utility', batchId: 'B3', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.utility-safe',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '密码校验为 mock，成功与失败均由 intent 结果决定。',
    eyebrow: 'LOCKED CACHE', title: '有些东西要挣来才打开。', description: '四位数字键盘锁小面板。',
  },
  {
    pageId: 'utility-match', label: '工具 · 匹配', family: 'utility', batchId: 'B3', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.utility-match',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '队列进度为 mock；取消、超时、失败与重试都可复现。',
    eyebrow: 'QUEUE STATE', title: '等其他人到齐。', description: '搜索、找到、确认或拒绝的完整匹配队列。',
  },
  {
    pageId: 'quest-log', label: '任务日志', family: 'progress', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.quest-log',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '任务条目只读；追踪切换提交 intent，不本地完成任务。',
    eyebrow: 'ACTIVE THREAD', title: '活儿永远做不完。', description: '按 J 打开的只读任务日志。',
  },
  {
    pageId: 'objective-tracker', label: '目标追踪器', family: 'progress', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.objective-tracker',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '世界锚定追踪器为只读投影；不含地图拓扑与寻路。',
    eyebrow: 'WORLD ANCHOR', title: '目标就挂在世界上。', description: '独立的世界锚定目标追踪器，可折叠、可隐藏、可失效。',
  },
  {
    pageId: 'tutorial-help', label: '教学与帮助', family: 'narrative', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.tutorial-help',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '教学条目为 mock；已读确认提交 intent。',
    eyebrow: 'GUIDANCE', title: '不离开世界也能学会它。', description: '教学弹窗与 F1 帮助索引。',
  },
  {
    pageId: 'location-title', label: '地点标题', family: 'narrative', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.location-title',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '地点名称为 mock 文本；演出失败只回到静态最终状态。',
    eyebrow: 'ARRIVAL', title: '地名先到，人后到。', description: '居中的地点标题演出，含减少动效与素材缺失降级。',
  },
  {
    pageId: 'stats', label: '统计', family: 'progress', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.stats',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '统计值逐字显示 mock displayValue，壳层不做任何计算。',
    eyebrow: 'READ ONLY', title: '数字只是被显示。', description: '独立统计页：分类过滤、比较组与文本摘要。',
  },
  {
    pageId: 'achievements', label: '成就', family: 'progress', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.achievements',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '成就状态由 mock 投影给出；点击永不解锁。',
    eyebrow: 'READ ONLY', title: '解锁不是点出来的。', description: '独立成就页：未解锁、进行中、已解锁。',
  },
  {
    pageId: 'codex', label: '图鉴', family: 'progress', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.codex',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '未解锁条目显示 ？？？，壳层不从内部知识推断内容。',
    eyebrow: 'READ ONLY', title: '记住世界���掉的。', description: '独立图鉴页：敌人、道具、地点与锁定详情。',
  },
  {
    pageId: 'recap', label: '剧情回顾', family: 'progress', batchId: 'B5', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.recap',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '回放仅表现层重演，不重放规则，不改写档案。',
    eyebrow: 'READ ONLY', title: '走过的路留在日志里。', description: '独立回顾页：时间线、分类与表现层回放。',
  },
  {
    pageId: 'subtitle-overlay', label: '字幕与声音替代', family: 'notice', batchId: 'B4', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.subtitle-overlay',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '字幕与声音事件为 mock，颜色从不是唯一语义。',
    eyebrow: 'ACCESSIBLE FEEDBACK', title: '每个声音都有可见形状。', description: '底部安全区字幕与关键声音的图标／方向替代。',
  },
  {
    pageId: 'connection-error', label: '连接错误', family: 'notice', batchId: 'B4', kind: 'product',
    stateIds: FULL_STATES, variantIds: ONLY_DEFAULT, entryId: 'entry.connection-error',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '断线与恢复为 mock；阻断层拥有最高 Escape 优先级。',
    eyebrow: 'LINK STATE', title: '信号会断，也会回来。', description: '丢失、重连、失败、超时与安全返回的阻断层。',
  },
  {
    pageId: 'map-editor', label: '地图编辑器', family: 'workbench', batchId: 'CREATION', kind: 'product',
    stateIds: ['ready'], variantIds: ONLY_DEFAULT, entryId: 'entry.map-editor',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '地图编辑、素材与研究状态沿用创作套件的 MetaState 投影。',
    eyebrow: 'CREATION SUITE', title: '绘制世界的骨架。', description: '从游戏端口进入的地图编辑页面。',
  },
  {
    pageId: 'asset-library', label: '素材库', family: 'workbench', batchId: 'CREATION', kind: 'product',
    stateIds: ['ready'], variantIds: ONLY_DEFAULT, entryId: 'entry.asset-library',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '素材筛选、详情与收藏沿用创作套件的 MetaState 投影。',
    eyebrow: 'CREATION SUITE', title: '找到世界的零件。', description: '从游戏端口进入的素材库页面。',
  },
  {
    pageId: 'research-bench', label: '研究台', family: 'workbench', batchId: 'CREATION', kind: 'product',
    stateIds: ['ready'], variantIds: ONLY_DEFAULT, entryId: 'entry.research-bench',
    baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '研究、提取与锻造沿用创作套件的 MetaState 投影。',
    eyebrow: 'CREATION SUITE', title: '让素材变成能力。', description: '从游戏端口进入的研究台页面。',
  },
]

/* ------------------------------------------------------------------ */
/* Non-product surfaces — retained, but never product page substitutes. */
/* ------------------------------------------------------------------ */

const NON_PRODUCT_PAGES: PageDescriptor[] = [
  {
    pageId: 'b6-journey', label: 'B6 · 旅程节点契约', family: 'workbench', batchId: 'B6', kind: 'development-demo',
    stateIds: ['ready', 'loading', 'error', 'timeout', 'retrying', 'cancelled', 'safe-return'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.b6-journey', baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '17 节点旅程全部由 journey-nodes 数据契约驱动，不是宿主状态机，也不是组件分支。',
    eyebrow: 'DEVELOPMENT DEMO', title: '从黑幕到归途。', description: '节点契约、成功／失败落点、完整失败矩阵与安全返回的验收台。',
    retentionReason: '旅程节点契约的唯一可视化验收台，供接线方逐节点核对失败矩阵。',
  },
  {
    pageId: 'b7-motion', label: 'B7 · 动效收束', family: 'workbench', batchId: 'B7', kind: 'development-demo',
    stateIds: ['ready', 'loading', 'error', 'timeout', 'safe-return'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.b7-motion', baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '动效母题、性能档位与降级链均为壳层内 mock 注册表。',
    eyebrow: 'DEVELOPMENT DEMO', title: '动作有来源，结果有落点。', description: '动效注册表与确定性降级矩阵的演示台。',
    retentionReason: '动效来源与降级矩阵的验收台。',
  },
  {
    pageId: 'b5-flow', label: 'B5 · 连贯叙事', family: 'workbench', batchId: 'B5', kind: 'development-demo',
    stateIds: ['ready', 'loading', 'error', 'safe-return'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.b5-flow', baselineStatus: 'implemented', fallbackState: 'safe-return',
    mockBoundary: '章节串联为 mock 会话，不写入任何档案。',
    eyebrow: 'DEVELOPMENT DEMO', title: '一次选择，贯穿所有系统。', description: '叙事页面之间的串联演示，不替代任何单页契约。',
    retentionReason: '验证叙事页面可以串联，不作为任何单页的实现。',
  },
  {
    pageId: 'dialog-portrait-legacy', label: 'Legacy · 立绘对话台', family: 'workbench', batchId: 'B5', kind: 'heritage-only',
    stateIds: ['ready', 'error', 'safe-return'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.dialog-portrait-legacy', baselineStatus: 'partial', fallbackState: 'safe-return',
    mockBoundary: '早期立绘降级链演示，已被 dialog-line 取代。',
    eyebrow: 'HERITAGE ONLY', title: '立绘降级链的旧演示台。', description: '保留以追溯 dialog-line 的来源。',
    retentionReason: 'dialog-line 的来源，保留用于对照与素材降级追溯。',
  },
  {
    pageId: 'map', label: 'Legacy · 区域图', family: 'workbench', batchId: 'B0', kind: 'heritage-only',
    stateIds: ['ready', 'safe-return'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.map', baselineStatus: 'partial', fallbackState: 'safe-return',
    mockBoundary: '节点与连线是视觉草图，不是地图拓扑，也不含寻路。',
    eyebrow: 'HERITAGE ONLY', title: '不是地图系统。', description: '早期区域视觉草图，明确不承载拓扑语义。',
    retentionReason: '保留视觉草图，避免被误当作地图系统契约。',
  },
  {
    pageId: 'click-play', label: 'Reference · 点击反馈', family: 'workbench', batchId: 'B0', kind: 'visual-reference',
    stateIds: ['ready'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.click-play', baselineStatus: 'partial', fallbackState: 'safe-return',
    mockBoundary: '单次输入的触感参考，不是任何页面的实现。',
    eyebrow: 'VISUAL REFERENCE', title: '每次输入都有脉冲。', description: '点击播放的触感语言参考。',
    retentionReason: '点击播放动效的手感基准。',
  },
  {
    pageId: 'combat-feedback', label: 'Reference · 命中反馈', family: 'workbench', batchId: 'B0', kind: 'visual-reference',
    stateIds: ['ready'], variantIds: ONLY_DEFAULT,
    entryId: 'entry.combat-feedback', baselineStatus: 'partial', fallbackState: 'safe-return',
    mockBoundary: '命中确认视觉参考，数值为占位。',
    eyebrow: 'VISUAL REFERENCE', title: '打击就是信息。', description: '命中确认的视觉语言参考。',
    retentionReason: 'HUD 触发效果的视觉基准。',
  },
  {
    pageId: 'victory', label: 'Reference · 胜利演出', family: 'workbench', batchId: 'B0', kind: 'visual-reference',
    stateIds: ['ready'], variantIds: ALL_VARIANTS,
    entryId: 'entry.victory', baselineStatus: 'partial', fallbackState: 'safe-return',
    mockBoundary: '胜利演出参考，已被 transition-result 取代为产品页面。',
    eyebrow: 'VISUAL REFERENCE', title: '噪声之后的静止。', description: '结算演出的早期视觉参考。',
    retentionReason: 'transition-result 的视觉来源。',
  },
]

export const PAGE_CATALOG: PageDescriptor[] = [...PRODUCT_PAGES, ...NON_PRODUCT_PAGES]

export const PRODUCT_PAGE_IDS = PRODUCT_PAGES.map((page) => page.pageId)

export const PAGE_KIND_LABELS: Record<PageKind, string> = {
  product: '产品页面',
  'development-demo': '开发演示',
  'heritage-only': '历史保留',
  'visual-reference': '视觉参考',
}

export const FAMILY_LABELS: Record<PageFamily, string> = {
  boot: '启动', menu: '菜单', world: '世界', narrative: '叙事', transition: '转场',
  notice: '通告', utility: '工具', progress: '进度', hud: 'HUD', control: '控制', workbench: '演示台',
}

export const BASELINE_LABELS: Record<BaselineStatus, string> = {
  implemented: '已实现', partial: '部分实现', unimplemented: '未实现',
}

export function getPage(pageId: string): PageDescriptor | undefined {
  return PAGE_CATALOG.find((page) => page.pageId === pageId)
}

/** Fails loudly in development if two descriptors ever claim the same key. */
export function findDuplicatePageIds(): string[] {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const page of PAGE_CATALOG) {
    if (seen.has(page.pageId)) duplicates.push(page.pageId)
    seen.add(page.pageId)
  }
  return duplicates
}
