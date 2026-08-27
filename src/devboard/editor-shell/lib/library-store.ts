'use client'

/* =========================================================================
   素材库 UI 导航状态 — 一个独立于 editor-store 的极小外部 store。

   为什么单独一个 store：素材库是覆盖在编辑器之上的整屏界面，它的开合/过场
   与地图文档、撤销历史完全无关，不应污染 editor-store 的历史栈与 diff。这里
   沿用同一套「模块级可变 state + useSyncExternalStore」范式，保证和编辑器其
   它部分行为一致（稳定快照、无 tearing）。

   关键设计——「进出不对称」：
   - 打开走一段暖色「传送门」过场（entering → open），有仪式感；
   - 关闭只做一次轻量淡出（leaving → closed），刻意不复用开机终端动画，
     因为素材库是同一个 page 内的覆盖层、编辑器从未卸载，返回时不存在任何
     「重新加载」，硬塞一段命令行动画只会让人觉得卡顿。
   ========================================================================= */

import { useSyncExternalStore } from 'react'
import {
  MATERIALS_META,
  materialMetaById,
  DEFAULT_QUICK_SLOTS,
  type Scope,
  type CategoryFilter,
} from './library-data'
import type { TextureData } from './painter-types'
import type { AssetRef } from '../../../meta-state/types'
import type { MetaStateActions } from '../../../meta-state/actions/facade'

let metaActions: MetaStateActions | null = null
let metaRevision = 0

export function bindMetaStateActions(actions: MetaStateActions, revision: number): void {
  metaActions = actions
  metaRevision = revision
}

export function unbindMetaStateActions(): void {
  metaActions = null
}

export type LibPhase = 'closed' | 'entering' | 'open' | 'leaving'

interface LibState {
  phase: LibPhase
  /** 传送门起始点（编辑器里点按钮的屏幕坐标），过场光晕从这里绽开 */
  origin: { x: number; y: number }
}

let state: LibState = {
  phase: 'closed',
  origin: { x: 0.5, y: 0.5 },
}

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function setState(patch: Partial<LibState>) {
  state = { ...state, ...patch }
  emit()
}

export function getLibState(): LibState {
  return state
}

/* 过场时长，需与 globals.css 里的 lib-portal / lib-leave 动画时长保持一致 */
const ENTER_MS = 760
const LEAVE_MS: number = 340

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * 打开素材库。`origin` 传入触发按钮中心的「视口归一化坐标」(0–1)，传送门
 * 光晕会从该点绽开——不传则默认从屏幕中心。重复调用（已在 open/entering）
 * 时忽略，避免过场被打断重放。
 */
export function openLibrary(origin?: { x: number; y: number }) {
  if (state.phase === 'open' || state.phase === 'entering') return
  if (timer) clearTimeout(timer)
  setState({ phase: 'entering', origin: origin ?? { x: 0.5, y: 0.5 } })
  timer = setTimeout(() => setState({ phase: 'open' }), ENTER_MS)
}

/**
 * 返回编辑器。只做一次淡出（leaving）再置为 closed，全程不触发任何终端/开机
 * 动画——这正是需求里「回跳不应出现命令行加载动画」的落点。
 */
export function closeLibrary() {
  if (state.phase === 'closed' || state.phase === 'leaving') return
  if (timer) clearTimeout(timer)
  setState({ phase: 'leaving' })
  timer = setTimeout(() => setState({ phase: 'closed' }), LEAVE_MS)
}

export function useLibrary<T>(selector: (s: LibState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selector(state),
    () => selector(state),
  )
}

/* =========================================================================
   素材库「应用状态」slice —— 独立于上面的过场 slice。

   两类状态（§5.2）：
   - 界面本地：activeTab / scope / category / query / detailOpenId /
     blueprintOpenId / hoveredId / drag（拖拽进行中）/ rejectSlot（红闪目标）;
   - 共享（占位：真实版从元状态层投影读，写走动作通道）：starred 星标集合、
     quickBar 7 格 + 展开态。真实接线后 starred/quickBar 换成 projection，
     这里的 toggleStar/quickBarSet 换成 actions.* 动作调用。

   放在模块级而非组件 useState 的原因：素材库是覆盖层，反复开合时筛选/星标/快捷
   栏必须**完整保留**（§1「全屏切换、状态保留」），组件卸载不应丢状态。
   ========================================================================= */

export type LibTab = 'element' | 'blueprint'

export interface Toast {
  id: number
  msg: string
  tone: 'info' | 'reject'
}

interface AppState {
  tab: LibTab
  scope: Scope
  category: CategoryFilter
  query: string
  detailOpenId: string | null
  blueprintOpenId: string | null
  hoveredId: string | null
  /** 正在拖拽的素材 id（拖入快捷栏配置用） */
  dragId: string | null
  /** 拖拽被拒绝时红闪的槽位下标 */
  rejectSlot: number | null
  starred: Set<string>
  quickSlots: (string | null)[]
  quickExpanded: boolean
  toast: Toast | null
  /** 素材自定义贴图覆盖（占位期本地持有；真实版由绘制器 onSave 走
   *  actions.materialSetTexture 写入元状态层，这里只读投影刷新）。 */
  textures: Record<string, TextureData>
}

const initialStarred = new Set<string>(MATERIALS_META.filter((m) => m.starred).map((m) => m.id))

let app: AppState = {
  tab: 'element',
  scope: 'all',
  category: '全部',
  query: '',
  detailOpenId: 'dream_beacon',
  blueprintOpenId: null,
  hoveredId: null,
  dragId: null,
  rejectSlot: null,
  starred: initialStarred,
  quickSlots: [...DEFAULT_QUICK_SLOTS],
  quickExpanded: false,
  toast: null,
  textures: {},
}

const appListeners = new Set<() => void>()
function emitApp() {
  appListeners.forEach((l) => l())
}
function setApp(patch: Partial<AppState>) {
  app = { ...app, ...patch }
  emitApp()
}

export function getLibApp(): AppState {
  return app
}

export function useLibApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      appListeners.add(cb)
      return () => appListeners.delete(cb)
    },
    () => selector(app),
    () => selector(app),
  )
}

/* ------- 界面本地：tab / 筛选 / 搜索 / 详情 ------- */

export function setTab(tab: LibTab) {
  setApp({ tab })
}
export function setScope(scope: Scope) {
  setApp({ scope })
}
export function setCategory(category: CategoryFilter) {
  setApp({ category })
}
export function setQuery(query: string) {
  setApp({ query })
}
export function openDetail(id: string) {
  setApp({ detailOpenId: id })
}
export function closeDetail() {
  setApp({ detailOpenId: null })
}
export function openBlueprint(mapId: string | null) {
  setApp({ blueprintOpenId: mapId })
}
export function setHovered(id: string | null) {
  setApp({ hoveredId: id })
}

/* ------- 共享（写走动作通道；占位期直接改本地集合） ------- */

/**
 * 星标切换（§6.1 乐观更新）。真实版：actions.toggleStar(id) → 元状态层权威 →
 * 投影刷新。占位期直接翻转本地集合。
 */
export function toggleStar(id: string) {
  if (metaActions) {
    const result = metaActions.toggleStar(id, metaRevision)
    if (result.kind === 'accepted') {
      metaRevision = result.committedRevision
      setApp({ starred: new Set(Object.entries(result.projection.materials).filter(([, meta]) => meta.starred).map(([materialId]) => materialId)) })
      return
    }
    showToast(result.message, 'reject')
    return
  }
  const next = new Set(app.starred)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setApp({ starred: next })
}

export function isStarred(id: string): boolean {
  return app.starred.has(id)
}

/**
 * 把素材拖入/设入快捷栏第 index 格（§6.1 onDragToQuickBar）。
 * 保护规则（数据层已拒绝，这里做交互层双保险）：
 * - 限免素材（绿角标）不可拖入 → 红闪 + 提示；
 * - UGC 素材不可拖入 → 提示「请到研究台处理」。
 */
export function quickBarSet(index: number, materialId: string): boolean {
  if (metaActions) {
    const result = metaActions.quickBarSet(materialId, index, metaRevision)
    if (result.kind === 'accepted') {
      metaRevision = result.committedRevision
      setApp({ quickSlots: [...result.projection.quickBar.materialSlots] })
      return true
    }
    showToast(result.message, 'reject')
    flashReject(index)
    return false
  }
  const m = materialMetaById(materialId)
  if (!m) return false
  if (m.limitedFree) {
    flashReject(index)
    showToast('限免素材不能加入快捷栏', 'reject')
    return false
  }
  if (m.isUgcNew || m.source === 'ugc') {
    showToast('UGC 素材请到研究台处理', 'reject')
    return false
  }
  const slots = [...app.quickSlots]
  slots[index] = materialId
  setApp({ quickSlots: slots })
  return true
}

export function quickBarClear(index: number) {
  if (metaActions) {
    const result = metaActions.quickBarClear(index, metaRevision)
    if (result.kind === 'accepted') {
      metaRevision = result.committedRevision
      setApp({ quickSlots: [...result.projection.quickBar.materialSlots] })
      return
    }
    showToast(result.message, 'reject')
    return
  }
  const slots = [...app.quickSlots]
  slots[index] = null
  setApp({ quickSlots: slots })
}

export function setQuickExpanded(expanded: boolean) {
  setApp({ quickExpanded: expanded })
}

export function setDrag(id: string | null) {
  setApp({ dragId: id })
}

let rejectTimer: ReturnType<typeof setTimeout> | null = null
function flashReject(index: number) {
  if (rejectTimer) clearTimeout(rejectTimer)
  setApp({ rejectSlot: index })
  rejectTimer = setTimeout(() => setApp({ rejectSlot: null }), 450)
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastSeq = 0
export function showToast(msg: string, tone: 'info' | 'reject' = 'info') {
  if (toastTimer) clearTimeout(toastTimer)
  setApp({ toast: { id: ++toastSeq, msg, tone } })
  toastTimer = setTimeout(() => setApp({ toast: null }), 2200)
}

/* ------- 贴图（像素绘制器接线，§7.2「保存写贴图」端口占位实现） ------- */

/**
 * 只读投影：绘制器悬浮窗打开时，调用方从这里取 initialTexture 传入 props——
 * 组件本身绝不读这个 store，解耦职责见 pixel-painter-connector.tsx。
 */
export function materialTexture(id: string): TextureData | null {
  return app.textures[id] ?? null
}

/**
 * 写动作通道占位：真实版为 actions.materialSetTexture(materialId, texture)，
 * 非合成物会被拒绝——这里占位期先直接接受并刷新投影 + 弹 toast。
 */
export function materialSetTexture(materialId: string, texture: TextureData) {
  if (metaActions) {
    const assetRef: AssetRef = {
      manifestId: `asset:material/${materialId}`,
      view: 'item-front',
    }
    const result = metaActions.materialSetTexture(materialId, assetRef, metaRevision)
    if (result.kind === 'accepted') {
      metaRevision = result.committedRevision
      setApp({ textures: { ...app.textures, [materialId]: texture } })
      showToast('贴图已保存')
      return
    }
    showToast(result.message, 'reject')
    return
  }
  setApp({ textures: { ...app.textures, [materialId]: texture } })
  showToast('贴图已保存')
}
