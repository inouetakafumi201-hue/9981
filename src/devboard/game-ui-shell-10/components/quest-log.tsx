'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookMarked,
  Check,
  ChevronRight,
  Circle,
  Compass,
  Crosshair,
  Gift,
  Loader2,
  MapPin,
  Minus,
  Navigation,
  ScrollText,
  Target,
  X,
  AlertTriangle,
} from 'lucide-react'
import { useIntentChannel } from '@/lib/use-intent'
import { playSfx } from '@/lib/audio-slot'

/**
 * B5-02 — QuestLogAndObjectiveTracker.
 *
 * A read-only quest log (category tabs + status filter + list + detail +
 * objectives + reward preview + track button) plus a world-anchored objective
 * tracker. The log never creates / completes / fails a quest or updates an
 * objective: `quest.track` is an explicit intent, and the tracker only shows a
 * new quest *after* the host accepts and a fresh projection revision arrives
 * (simulated here by bumping `trackedQuestId` only on `accepted`). Objective
 * progress / distance / direction are rendered verbatim from the projection —
 * never computed locally. Every list group is capped at 5 visible items.
 */

type Category = 'main' | 'side' | 'daily'
type QuestState = 'available' | 'active' | 'completed' | 'failed'
type ObjState = 'not-started' | 'in-progress' | 'completed' | 'failed'
type CatFilter = 'all' | Category
type StatusFilter = 'all' | 'active' | 'completed' | 'failed'

interface Objective {
  objectiveId: string
  text: string
  state: ObjState
  progress?: { current: number; total: number }
  distanceLabel?: string
  directionLabel?: string
}
interface Reward {
  rewardId: string
  label: string
  detail: string
}
interface Quest {
  questId: string
  title: string
  description: string
  category: Category
  state: QuestState
  objectives: Objective[]
  rewards: Reward[]
  isMock: true
}

const CAT_META: Record<Category, { label: string; tone: string }> = {
  main: { label: '主线', tone: 'red' },
  side: { label: '支线', tone: 'cyan' },
  daily: { label: '日常', tone: 'green' },
}
const STATE_LABEL: Record<QuestState, string> = { available: '可接取', active: '进行中', completed: '已完成', failed: '失败' }
const OBJ_LABEL: Record<ObjState, string> = { 'not-started': '未开始', 'in-progress': '进行中', completed: '已完成', failed: '失败' }

const QUESTS: Quest[] = [
  {
    questId: 'q-main-01', title: '回声之下', description: '追踪深潜网络中反复出现的异常信号，抵达第七区中继站并确认其来源。',
    category: 'main', state: 'active', isMock: true,
    objectives: [
      { objectiveId: 'o1', text: '抵达第七区中继站', state: 'in-progress', distanceLabel: '≈ 240m', directionLabel: '东北' },
      { objectiveId: 'o2', text: '扫描三处信号锚点', state: 'in-progress', progress: { current: 1, total: 3 } },
      { objectiveId: 'o3', text: '与记录者重新建立连接', state: 'not-started' },
    ],
    rewards: [
      { rewardId: 'r1', label: '经验', detail: '主线进度 +1（非比较型摘要）' },
      { rewardId: 'r2', label: '道具', detail: '中继钥匙 ×1' },
    ],
  },
  {
    questId: 'q-side-01', title: '无名者的信标', description: '一名失联潜行者留下的求救信标仍在微弱地闪烁。找到它，决定如何处置。',
    category: 'side', state: 'active', isMock: true,
    objectives: [
      { objectiveId: 'o1', text: '定位信标残响', state: 'completed' },
      { objectiveId: 'o2', text: '回收信标核心', state: 'in-progress', distanceLabel: '≈ 60m', directionLabel: '正西' },
    ],
    rewards: [{ rewardId: 'r1', label: '声望', detail: '拾荒者阵营 好感（占位摘要）' }],
  },
  {
    questId: 'q-daily-01', title: '例行巡检', description: '对驻地周边的三台锚定导流仪进行例行检查，确保信号稳定。',
    category: 'daily', state: 'active', isMock: true,
    objectives: [{ objectiveId: 'o1', text: '检查导流仪', state: 'in-progress', progress: { current: 2, total: 3 } }],
    rewards: [{ rewardId: 'r1', label: '货币', detail: '信用点 ×3' }],
  },
  {
    questId: 'q-side-02', title: '褪色的合影', description: '在废墟里找到的一张旧照片，也许它的主人还在等一个答案。',
    category: 'side', state: 'completed', isMock: true,
    objectives: [
      { objectiveId: 'o1', text: '辨认照片中的地点', state: 'completed' },
      { objectiveId: 'o2', text: '归还照片', state: 'completed' },
    ],
    rewards: [{ rewardId: 'r1', label: '图鉴', detail: '解锁回顾条目（占位）' }],
  },
  {
    questId: 'q-main-02', title: '断裂的誓约', description: '一条已经无法挽回的路线。它保留在日志里，作为一个不再前进的坐标。',
    category: 'main', state: 'failed', isMock: true,
    objectives: [
      { objectiveId: 'o1', text: '在时限内抵达', state: 'failed' },
      { objectiveId: 'o2', text: '保护目标', state: 'failed' },
    ],
    rewards: [],
  },
  {
    questId: 'q-daily-02', title: '物资清点', description: '清点驻地临时仓的回收物资，超过 5 项时以滚动查看。',
    category: 'daily', state: 'active', isMock: true,
    objectives: [{ objectiveId: 'o1', text: '清点回收零件', state: 'in-progress', progress: { current: 4, total: 6 } }],
    rewards: [{ rewardId: 'r1', label: '货币', detail: '信用点 ×1' }],
  },
]

const CAT_TABS: { id: CatFilter; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'main', label: '主线' }, { id: 'side', label: '支线' }, { id: 'daily', label: '日常' },
]
const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'active', label: '进行中' }, { id: 'completed', label: '已完成' }, { id: 'failed', label: '失败' },
]

const MAX_VISIBLE = 5

function ObjectiveRow({ obj }: { obj: Objective }) {
  const Icon = obj.state === 'completed' ? Check : obj.state === 'failed' ? X : obj.state === 'in-progress' ? Target : Circle
  return (
    <li className={`ql-obj ql-obj-${obj.state}`}>
      <span className="ql-obj-icon" aria-hidden="true"><Icon size={13} /></span>
      <span className="ql-obj-main">
        <span className="ql-obj-text">{obj.text}</span>
        <span className="ql-obj-meta">
          <span className="ql-obj-state">{OBJ_LABEL[obj.state]}</span>
          {obj.progress && <span className="ql-obj-progress">{obj.progress.current}/{obj.progress.total}</span>}
          {obj.distanceLabel && <span className="ql-obj-dist"><MapPin size={10} /> {obj.distanceLabel}</span>}
          {obj.directionLabel && <span className="ql-obj-dir"><Compass size={10} /> {obj.directionLabel}</span>}
        </span>
      </span>
    </li>
  )
}

export function QuestLog({
  initialTrackedId = 'q-main-01',
  onTracked,
  onContinue,
}: {
  initialTrackedId?: string
  onTracked?: (questId: string) => void
  onContinue?: () => void
}) {
  const [open, setOpen] = useState(true)
  const [cat, setCat] = useState<CatFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState<string>('q-main-01')
  // Authoritative-ish tracked id: only updated when the host *accepts* a track
  // intent, standing in for a projection revision bump.
  const [trackedId, setTrackedId] = useState<string>(initialTrackedId)
  const [trackerCollapsed, setTrackerCollapsed] = useState(false)
  const [live, setLive] = useState('')
  const { state: intent, dispatch } = useIntentChannel('quest-log')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const filtered = useMemo(
    () => QUESTS.filter((q) => (cat === 'all' || q.category === cat) && (status === 'all' || q.state === status)),
    [cat, status],
  )
  const selected = useMemo(
    () => filtered.find((q) => q.questId === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  )
  const tracked = useMemo(() => QUESTS.find((q) => q.questId === trackedId) ?? null, [trackedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const key = e.key.toLowerCase()
      if (!open && key === 'j') { e.preventDefault(); openLog() }
      else if (open && e.key === 'Escape') { e.preventDefault(); closeLog() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => { if (open) requestAnimationFrame(() => dialogRef.current?.focus()) }, [open])

  const openLog = () => { setOpen(true); setLive('任务日志已打开（只读）'); playSfx('menu-open'); void dispatch('quest-log.open') }
  const closeLog = () => { setOpen(false); setLive('任务日志已关闭'); playSfx('menu-close'); void dispatch('quest-log.close'); requestAnimationFrame(() => triggerRef.current?.focus()) }
  const pickCat = (c: CatFilter) => { setCat(c); playSfx('ui-toggle'); void dispatch('quest.filter.category', { category: c }) }
  const pickStatus = (s: StatusFilter) => { setStatus(s); playSfx('ui-toggle'); void dispatch('quest.filter.status', { status: s }) }
  const selectQuest = (q: Quest) => { setSelectedId(q.questId); playSfx('ui-focus'); void dispatch('quest.select', { questId: q.questId }) }

  const trackQuest = useCallback(async (q: Quest) => {
    playSfx('ui-confirm')
    setLive(`请求追踪：${q.title}`)
    const result = await dispatch('quest.track', { questId: q.questId })
    // Only reflect the change after host confirmation — never on the click.
    if (result.status === 'accepted') {
      setTrackedId(q.questId)
      setTrackerCollapsed(false)
      setLive(`已追踪：${q.title}`)
      onTracked?.(q.questId)
    } else {
      setLive(`追踪未生效：${result.reason ?? result.status}`)
    }
  }, [dispatch, onTracked])

  const trackedObjectives = tracked?.objectives.filter((o) => o.state !== 'completed').slice(0, MAX_VISIBLE) ?? []

  return (
    <div className="ql-stage">
      {/* World-anchored objective tracker (top-right). */}
      <div className={`ql-tracker ${trackerCollapsed ? 'is-collapsed' : ''}`} aria-label="目标追踪器">
        <div className="ql-tracker-head">
          <span className="ql-tracker-title">
            <Crosshair size={12} />
            {tracked ? tracked.title : '未追踪任务'}
          </span>
          <button
            className="ql-tracker-toggle"
            onClick={() => { setTrackerCollapsed((c) => !c); void dispatch('tracker.toggle', { questId: trackedId }) }}
            aria-label={trackerCollapsed ? '展开追踪器' : '折叠追踪器'}
            aria-expanded={!trackerCollapsed}
          >
            {trackerCollapsed ? <Navigation size={12} /> : <Minus size={12} />}
          </button>
        </div>
        <AnimatePresence initial={false}>
          {!trackerCollapsed && tracked && (
            <motion.ul
              className="ql-tracker-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24 }}
            >
              {trackedObjectives.length === 0 && <li className="ql-tracker-empty">目标已全部完成</li>}
              <AnimatePresence initial={false}>
                {trackedObjectives.map((o) => (
                  <motion.li
                    key={o.objectiveId}
                    layout
                    className={`ql-tracker-obj ql-obj-${o.state}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                  >
                    <span className="ql-tracker-dot" aria-hidden="true" />
                    <span>{o.text}</span>
                    {o.progress && <span className="ql-tracker-prog">{o.progress.current}/{o.progress.total}</span>}
                    {o.directionLabel && <span className="ql-tracker-dir">{o.directionLabel}</span>}
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      <div className="ql-trigger-row">
        <button ref={triggerRef} className="ql-trigger" onClick={() => (open ? closeLog() : openLog())} aria-haspopup="dialog" aria-expanded={open}>
          <BookMarked size={14} /> {open ? '关闭任务日志' : '打开任务日志'} <kbd className="ql-kbd">J</kbd>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={dialogRef}
            className="ql-panel"
            role="dialog"
            aria-modal="false"
            aria-label="任务日志（只读，MOCK）"
            tabIndex={-1}
            initial={{ opacity: 0, x: -24, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: -20, filter: 'blur(6px)' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="ql-panel-head">
              <div>
                <span className="ql-kicker">任务日志 <span className="mock-tag">MOCK</span></span>
                <h3 className="ql-panel-title">只读检视 · 不可编辑</h3>
              </div>
              <button className="ql-close" onClick={closeLog} aria-label="关闭任务日志"><X size={15} /></button>
            </div>

            <div className="ql-filters">
              <div className="ql-tabs" role="tablist" aria-label="任务分类">
                {CAT_TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={cat === t.id} className={`ql-tab ${cat === t.id ? 'is-active' : ''}`} onClick={() => pickCat(t.id)}>{t.label}</button>
                ))}
              </div>
              <div className="ql-status-filter" role="tablist" aria-label="任务状态">
                {STATUS_TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={status === t.id} className={`ql-status-btn ${status === t.id ? 'is-active' : ''}`} onClick={() => pickStatus(t.id)}>{t.label}</button>
                ))}
              </div>
            </div>

            <div className="ql-body">
              <div className="ql-list" role="list" aria-label="任务列表（最多同屏 5 项，其余滚动）">
                {filtered.length === 0 && <p className="ql-empty">该筛选下暂无任务（mock）</p>}
                {filtered.map((q) => {
                  const meta = CAT_META[q.category]
                  const active = selected?.questId === q.questId
                  return (
                    <motion.button
                      layout
                      key={q.questId}
                      role="listitem"
                      className={`ql-item ql-tone-${meta.tone} ${active ? 'is-selected' : ''} ${q.state === 'failed' ? 'is-failed' : ''}`}
                      onClick={() => selectQuest(q)}
                      aria-current={active}
                    >
                      <span className="ql-item-cat">{meta.label}</span>
                      <span className="ql-item-main">
                        <span className="ql-item-title">{q.title}</span>
                        <span className="ql-item-sub">
                          <span className={`ql-item-state ql-state-${q.state}`}>{STATE_LABEL[q.state]}</span>
                          {q.questId === trackedId && <span className="ql-item-tracked"><Crosshair size={9} /> 追踪中</span>}
                        </span>
                      </span>
                      <ChevronRight size={14} className="ql-item-caret" />
                    </motion.button>
                  )
                })}
              </div>

              {selected && (
                <div className="ql-detail">
                  <div className="ql-detail-head">
                    <span className={`ql-detail-cat ql-tone-${CAT_META[selected.category].tone}`}>{CAT_META[selected.category].label}</span>
                    <h4 className="ql-detail-title">{selected.title}</h4>
                    <span className={`ql-detail-state ql-state-${selected.state}`}>{STATE_LABEL[selected.state]}</span>
                  </div>
                  <p className="ql-detail-desc">{selected.description}</p>

                  <div className="ql-section-label"><ScrollText size={12} /> 目标 <span className="ql-count">{selected.objectives.length}</span></div>
                  <ul className="ql-obj-list">
                    {selected.objectives.slice(0, MAX_VISIBLE).map((o) => <ObjectiveRow key={o.objectiveId} obj={o} />)}
                  </ul>

                  <div className="ql-section-label"><Gift size={12} /> 奖励预览（只读）</div>
                  {selected.rewards.length === 0 ? (
                    <p className="ql-reward-empty">无奖励记录</p>
                  ) : (
                    <ul className="ql-reward-list">
                      {selected.rewards.slice(0, MAX_VISIBLE).map((r) => (
                        <li key={r.rewardId} className="ql-reward">
                          <span className="ql-reward-label">{r.label}</span>
                          <span className="ql-reward-detail">{r.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="ql-detail-actions">
                    <button
                      className={`ql-track-btn ${trackedId === selected.questId ? 'is-tracked' : ''}`}
                      onClick={() => trackQuest(selected)}
                      disabled={intent.phase === 'pending' || selected.state === 'completed' || selected.state === 'failed'}
                    >
                      {intent.phase === 'pending' ? <Loader2 size={13} className="is-spin" /> : <Crosshair size={13} />}
                      {trackedId === selected.questId ? '追踪中' : '追踪此任务'}
                    </button>
                    {intent.phase !== 'idle' && intent.phase !== 'pending' && (
                      <span className={`ql-intent-pill ql-intent-${intent.phase}`}>
                        {intent.phase === 'accepted' ? <Check size={11} /> : <AlertTriangle size={11} />}
                        {intent.phase === 'accepted' ? '宿主已确认' : `${intent.phase}：${intent.reason ?? ''}`}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="ql-flow-foot">
              <p className="ql-foot">追踪按钮只提交 quest.track 意图；目标追踪器仅在宿主确认并刷新投影后更新。</p>
              {onContinue && <button className="ql-continue" onClick={onContinue} disabled={intent.phase === 'pending'}>返回世界并前往目标 <ChevronRight size={13} /></button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sr-only" aria-live="polite">{live}</div>
    </div>
  )
}
