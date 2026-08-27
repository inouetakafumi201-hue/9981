'use client'

/* =========================================================================
   研究台 —— 导航过场 slice + 界面本地状态 slice（独立于 editor / library store）。

   过场（与 library-store 同构，但主题不同）：
   - 进入：素材详情「去研究台锻造」触发，青色传送门（entering → open）；
   - 退出：「回素材库」触发，暖色传送门（leaving → closed），落回底下仍 open 的
     素材库——与「编辑器 → 素材库」同款暖色特效（需求明确要求）。

   状态管理（§5.2）：activeSection / activeCategory / 拖拽 / 选中 / 演出阶段机
   都是界面本地；词条/素材/队列/塑形数据接线后从只读投影读，写走动作通道。占位期
   动作直接改本地态并弹 toast，注释标注真实端口。
   ========================================================================= */

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_FORGE_SLOTS,
  DEFAULT_FORGE_BASE,
  DEFAULT_MOLDING,
  DEMO_JOBS,
  tokenById,
  randomSynthesisDuration,
  jobIsFinished,
  type ForgeSlotState,
  type MoldingBarState,
  type SynthesisJob,
  type TokenSlot,
} from './bench-data'
import { materialMetaById } from './library-data'
import type { PortalTheme } from '@/components/fx/portal-transition'
import { moldingSet as metaMoldingSet, forgeModify as metaForgeModify, extractToken as metaExtractToken } from '../../../meta-state/actions/bench-actions'
import type { MetaStateStore } from '../../../meta-state/store'

let metaStore: MetaStateStore | null = null
let metaRevision = 0
export function bindMetaStateBench(store: MetaStateStore): void {
  metaStore = store
  metaRevision = store.getState().revision
}
export function unbindMetaStateBench(): void { metaStore = null }

/* ============================ 过场 slice ============================ */

export type BenchPhase = 'closed' | 'entering' | 'open' | 'leaving'

interface NavState {
  phase: BenchPhase
  origin: { x: number; y: number }
  portalTheme: PortalTheme
}

let nav: NavState = { phase: 'closed', origin: { x: 0.5, y: 0.5 }, portalTheme: 'cyan' }
const navListeners = new Set<() => void>()
function emitNav() {
  navListeners.forEach((l) => l())
}
function setNav(patch: Partial<NavState>) {
  nav = { ...nav, ...patch }
  emitNav()
}

const ENTER_MS = 760
const LEAVE_MS = 620
let navTimer: ReturnType<typeof setTimeout> | null = null

/** 进入研究台：青色传送门。origin = 触发按钮视口归一化坐标。 */
export function openBench(origin?: { x: number; y: number }) {
  if (nav.phase === 'open' || nav.phase === 'entering') return
  if (navTimer) clearTimeout(navTimer)
  setNav({ phase: 'entering', origin: origin ?? { x: 0.5, y: 0.5 }, portalTheme: 'cyan' })
  navTimer = setTimeout(() => setNav({ phase: 'open' }), ENTER_MS)
}

/** 回素材库：暖色传送门（与编辑器→素材库同款），淡出后落回底下的素材库。 */
export function closeBench(origin?: { x: number; y: number }) {
  if (nav.phase === 'closed' || nav.phase === 'leaving') return
  if (navTimer) clearTimeout(navTimer)
  setNav({ phase: 'leaving', origin: origin ?? { x: 0.5, y: 0.08 }, portalTheme: 'warm' })
  navTimer = setTimeout(() => setNav({ phase: 'closed' }), LEAVE_MS)
}

export function useBenchNav<T>(selector: (s: NavState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      navListeners.add(cb)
      return () => navListeners.delete(cb)
    },
    () => selector(nav),
    () => selector(nav),
  )
}

/* ============================ 应用状态 slice ============================ */

export type BenchSection = 'tokens' | 'forge'
export type ExtractStage = 'idle' | 'dissolve' | 'emerge'

export interface BenchToastT {
  id: number
  msg: string
  tone: 'info' | 'reject' | 'good'
}

export interface TokenDrag {
  kind: 'token'
  id: string
  /** 若拖拽源是某个锻造槽（用于「拖回恢复默认」），记录该槽下标 */
  fromSlot?: number
}

interface AppState {
  activeSection: BenchSection
  activeCategory: TokenSlot
  selectedTokenId: string | null
  hoveredTokenId: string | null
  /** 词条拖拽（拖入锻造槽用）；素材拖拽走 library-store 的 dragId */
  tokenDrag: TokenDrag | null
  starredTokens: Set<string>

  forgeBase: string
  forgeSlots: ForgeSlotState[]
  /** 槽位红闪（非法落点） */
  forgeRejectSlot: number | null

  molding: MoldingBarState
  moldingRejectSlot: number | null

  /** 异步合成任务：真实开始时间 + 真实时长，状态由时间纯派生（见 bench-data.ts）。 */
  jobs: SynthesisJob[]
  /** 当前展开查看的任务（研究舱大图）；null = 全部收起，仅剩队列小卡片。 */
  focusedJobId: string | null

  /** 提取演出（素材溶解 → 词条浮现，短流程，与合成任务无关） */
  extractStage: ExtractStage
  extractMaterialId: string | null

  toast: BenchToastT | null
}

const STARRED_INIT = new Set<string>(['tk_attr_0', 'tk_state_0'])

let app: AppState = {
  activeSection: 'forge',
  activeCategory: 'attr',
  selectedTokenId: 'tk_attr_0',
  hoveredTokenId: null,
  tokenDrag: null,
  starredTokens: STARRED_INIT,

  forgeBase: DEFAULT_FORGE_BASE,
  forgeSlots: DEFAULT_FORGE_SLOTS.map((s) => ({ ...s })),
  forgeRejectSlot: null,

  molding: { slots: [...DEFAULT_MOLDING.slots], unlocked: [...DEFAULT_MOLDING.unlocked] },
  moldingRejectSlot: null,

  jobs: DEMO_JOBS.map((j) => ({ ...j })),
  focusedJobId: null,

  extractStage: 'idle',
  extractMaterialId: null,

  toast: null,
}

const appListeners = new Set<() => void>()
function emitApp() {
  appListeners.forEach((l) => l())
}
function setApp(patch: Partial<AppState>) {
  app = { ...app, ...patch }
  emitApp()
}

export function getBenchApp(): AppState {
  return app
}

export function useBench<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      appListeners.add(cb)
      return () => appListeners.delete(cb)
    },
    () => selector(app),
    () => selector(app),
  )
}

/* ---------------- 界面本地：分区 / 分类 / 选中 / 悬停 ---------------- */

export function setSection(activeSection: BenchSection) {
  setApp({ activeSection })
}
export function setCategory(activeCategory: TokenSlot) {
  setApp({ activeCategory })
}
export function selectToken(id: string) {
  setApp({ selectedTokenId: id })
}
export function setHoveredToken(id: string | null) {
  setApp({ hoveredTokenId: id })
}
export function setTokenDrag(d: TokenDrag | null) {
  setApp({ tokenDrag: d })
}

/* ---------------- 星标（写走动作通道；占位改本地集合） ---------------- */

export function toggleTokenStar(id: string) {
  const next = new Set(app.starredTokens)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setApp({ starredTokens: next })
}
export function isTokenStarred(id: string) {
  return app.starredTokens.has(id)
}

/* ---------------- 锻造：底图感（只替换 / 拖回恢复默认） ---------------- */

let forgeRejectTimer: ReturnType<typeof setTimeout> | null = null
function flashForge(index: number) {
  if (forgeRejectTimer) clearTimeout(forgeRejectTimer)
  setApp({ forgeRejectSlot: index })
  forgeRejectTimer = setTimeout(() => setApp({ forgeRejectSlot: null }), 450)
}

/**
 * 拖词条进第 index 槽（§6.1 onTokenDropToSlot）。
 * - 类别必须匹配该槽（属性词条只进属性槽）；
 * - 已占用槽 = 替换，空槽 = 填充（无「清空」操作，只替换）。
 * 真实端口：actions.forgeSetToken(baseId, slotIndex, tokenId)。
 */
export function forgeSetToken(index: number, tokenId: string): boolean {
  const tok = tokenById(tokenId)
  const slot = app.forgeSlots[index]
  if (!tok || !slot) return false
  if (tok.category !== slot.category) {
    flashForge(index)
    showBenchToast(`「${tok.name}」是${categoryName(tok.category)}词条，不能放进${categoryName(slot.category)}槽`, 'reject')
    return false
  }
  const slots = app.forgeSlots.map((s, i) => (i === index ? { ...s, currentTokenId: tokenId } : s))
  setApp({ forgeSlots: slots })
  return true
}

/** 拖回词条库/快捷栏 = 默认值自动恢复（底图弹回来）。 */
export function forgeRestoreDefault(index: number) {
  const slots = app.forgeSlots.map((s, i) => (i === index ? { ...s, currentTokenId: s.defaultTokenId } : s))
  setApp({ forgeSlots: slots })
}

export function setForgeBase(materialId: string) {
  setApp({ forgeBase: materialId })
}

function categoryName(c: TokenSlot) {
  return { attr: '属性', skill: '技能', state: '状态', defense: '防御', mobility: '机动' }[c]
}

/* ---------------- 锻造结果：保存 / 派生（占位） ---------------- */

export function forgeSave() {
  if (metaStore) {
    const tokenIds = app.forgeSlots.map((slot) => slot.currentTokenId).filter((id): id is string => id !== null)
    const result = metaForgeModify(metaStore, app.forgeBase, tokenIds, 'save', metaRevision)
    if (result.kind === 'accepted') { metaRevision = result.committedRevision; showBenchToast('保存完成', 'good'); return }
    showBenchToast(result.message, 'reject'); return
  }
  showBenchToast('保存（覆盖自身）待接线', 'info')
}
export function forgeDerive() {
  if (metaStore) { showBenchToast('派生结果由玩法 owner 返回', 'info'); return }
  showBenchToast('派生（新 ID + 溯源）待接线', 'info')
}

/* ---------------- 提取演出（素材溶解 → 词条浮现） ---------------- */

let extractTimer: ReturnType<typeof setTimeout> | null = null
export function startExtract() {
  if (metaStore) {
    const result = metaExtractToken(metaStore, app.forgeBase, categoryName(app.forgeSlots[0]?.category ?? 'attr'), metaRevision)
    if (result.kind !== 'accepted') { showBenchToast(result.message, 'reject'); return }
    metaRevision = result.committedRevision
  }
  if (app.extractStage !== 'idle') return
  setApp({ extractStage: 'dissolve', extractMaterialId: app.forgeBase })
  extractTimer = setTimeout(() => setApp({ extractStage: 'emerge' }), 1100)
}
export function finishExtract() {
  if (extractTimer) clearTimeout(extractTimer)
  setApp({ extractStage: 'idle', extractMaterialId: null })
  showBenchToast('提取完成 · 词条已进入词条库（待接线）', 'good')
}

/* ---------------- 合成：异步任务（不阻塞，可随时离开） ---------------- */

/**
 * 提交合成任务。**不弹任何阻塞式加载动画**——立即返回，任务在后台用真实
 * 时间戳计时（60–120s，对齐 LLM 侧真实生成时长）。结果在提交时就已确定
 * （占位期用规则派生：矛盾元素 = 烈焰(fire)+寒霜(ice) 同挂 → 失败），计时
 * 结束才向玩家揭示；接线后 outcome 整段改由 actions.synthesizeSubmit 返回。
 */
function deriveOutcome(): { quality: import('./bench-data').Quality; name: string; willFail: boolean; failReason: string } {
  const toks = app.forgeSlots.map((s) => tokenById(s.currentTokenId)).filter(Boolean) as NonNullable<
    ReturnType<typeof tokenById>
  >[]
  const hasFire = toks.some((t) => t.accent === 'fire')
  const hasIce = toks.some((t) => t.accent === 'ice')
  const base = materialMetaById(app.forgeBase)
  if (hasFire && hasIce) {
    return {
      quality: 2,
      name: '',
      willFail: true,
      failReason: '烈焰与寒霜相互抵消，这次没能成型——材料之间不太合，换个搭配再试试。',
    }
  }
  const quality = Math.min(5, Math.max(2, toks.reduce((m, t) => Math.max(m, t.quality), 2))) as 1 | 2 | 3 | 4 | 5
  return { quality, name: `强化·${base?.name ?? '成品'}`, willFail: false, failReason: '' }
}

/** 后台计时器：只要还有未完结任务，每 500ms 触发一次重渲染，让各处的
 *  正计时 / 进度环用 Date.now() 重新派生；不改变任何数据，纯粹是「时钟走字」。 */
let tickHandle: ReturnType<typeof setInterval> | null = null
function ensureTicking() {
  if (tickHandle) return
  tickHandle = setInterval(() => {
    if (!app.jobs.some((j) => !jobIsFinished(j))) {
      if (tickHandle) clearInterval(tickHandle)
      tickHandle = null
      return
    }
    // 秒表/进度环都从 `jobs` 派生，因此「走字」必须换一次数组引用才能让
    // useSyncExternalStore 的订阅方重渲染（数据本身不变，只是钟在走）。
    setApp({ jobs: [...app.jobs] })
  }, 500)
}

export function startSynthesis() {
  const toks = app.forgeSlots.map((s) => tokenById(s.currentTokenId)).filter(Boolean) as NonNullable<
    ReturnType<typeof tokenById>
  >[]
  const base = materialMetaById(app.forgeBase)
  const outcome = deriveOutcome()
  const job: SynthesisJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    baseMaterialId: app.forgeBase,
    baseName: base?.name ?? '成品',
    tokenNames: toks.map((t) => t.name),
    tokenAccents: toks.map((t) => t.accent),
    startedAt: Date.now(),
    durationMs: randomSynthesisDuration(),
    willFail: outcome.willFail,
    resultName: outcome.name,
    resultQuality: outcome.quality,
    failReason: outcome.failReason,
  }
  setApp({ jobs: [job, ...app.jobs], focusedJobId: job.id })
  ensureTicking()
  showBenchToast(`已提交合成 · 预计需要 ${Math.round(job.durationMs / 1000)} 秒，随时可以离开去做别的事`, 'good')
}

/** 展开/收起研究舱大图；只是视图切换，不影响任务本身的计时。 */
export function focusJob(id: string | null) {
  setApp({ focusedJobId: id })
}

export function claimJob(id: string) {
  const job = app.jobs.find((j) => j.id === id)
  if (!job || !jobIsFinished(job) || job.willFail) return
  setApp({
    jobs: app.jobs.filter((j) => j.id !== id),
    focusedJobId: app.focusedJobId === id ? null : app.focusedJobId,
  })
  showBenchToast(`「${job.resultName}」已收下 · 进入拥有库（待接线）`, 'good')
}

export function dismissFailedJob(id: string) {
  const job = app.jobs.find((j) => j.id === id)
  if (!job || !jobIsFinished(job) || !job.willFail) return
  setApp({
    jobs: app.jobs.filter((j) => j.id !== id),
    focusedJobId: app.focusedJobId === id ? null : app.focusedJobId,
  })
  showBenchToast('材料与词条已原样返还（驳回，待接线）', 'info')
}

/** 消耗记忆碎片立即完成——正式玩法钩子（也是常见的「加速完成」付费点）。 */
export function rushJob(id: string) {
  const job = app.jobs.find((j) => j.id === id)
  if (!job || jobIsFinished(job)) return
  const jobs = app.jobs.map((j) => (j.id === id ? { ...j, startedAt: Date.now() - j.durationMs } : j))
  setApp({ jobs })
  ensureTicking()
  showBenchToast('已消耗记忆碎片 · 研究立即完成（数值待接线）', 'info')
}

// 页面首次加载时若已有未完结的种子任务，直接开始计时。
if (app.jobs.some((j) => !jobIsFinished(j))) ensureTicking()

/* ---------------- 塑形备选栏（拖入替换 / 解锁 / 限免拒绝） ---------------- */

let moldingRejectTimer: ReturnType<typeof setTimeout> | null = null
function flashMolding(index: number) {
  if (moldingRejectTimer) clearTimeout(moldingRejectTimer)
  setApp({ moldingRejectSlot: index })
  moldingRejectTimer = setTimeout(() => setApp({ moldingRejectSlot: null }), 450)
}

export function moldingSet(index: number, materialId: string): boolean {
  if (metaStore) {
    const result = metaMoldingSet(metaStore, index, materialId, metaRevision)
    if (result.kind !== 'accepted') { flashMolding(index); showBenchToast(result.message, 'reject'); return false }
    metaRevision = result.committedRevision
    return true
  }
  if (!app.molding.unlocked[index]) {
    flashMolding(index)
    showBenchToast('该塑形格尚未解锁', 'reject')
    return false
  }
  const m = materialMetaById(materialId)
  if (m?.limitedFree) {
    flashMolding(index)
    showBenchToast('限免素材不能放入塑形备选栏', 'reject')
    return false
  }
  const slots = [...app.molding.slots]
  slots[index] = materialId
  setApp({ molding: { ...app.molding, slots } })
  return true
}

export function moldingClear(index: number) {
  const slots = [...app.molding.slots]
  slots[index] = null
  setApp({ molding: { ...app.molding, slots } })
}

/* ---------------- Toast ---------------- */

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastSeq = 0
export function showBenchToast(msg: string, tone: BenchToastT['tone'] = 'info') {
  if (toastTimer) clearTimeout(toastTimer)
  setApp({ toast: { id: ++toastSeq, msg, tone } })
  toastTimer = setTimeout(() => setApp({ toast: null }), 2400)
}
