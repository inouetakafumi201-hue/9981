'use client'

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Award, BarChart3, BookOpen, Bug, Clock, Gem, History, Lock, MapPin, MessageSquare, Package, Play, Split } from 'lucide-react'
import { useShellIntent } from '@/lib/shell-intent'
import { useArrowNavigation } from '@/lib/shell-a11y'
import { IntentFeedback, MockBoundary } from './shell-primitives'
import {
  ACHIEVEMENT_FIXTURES, CODEX_FIXTURES, PROGRESS_MAX_VISIBLE, RECAP_FIXTURES, STAT_FIXTURES,
  type CodexEntry, type RecapEntry,
} from '@/lib/progress-fixtures'

/**
 * V0-04 — stats / achievements / codex / recap as four independent pages.
 *
 * They no longer share one tabbed archive mount: each is its own catalog page
 * with its own states, so a single tab bar can never hide three of them.
 * All four are strictly read-only. The shell displays `displayValue` verbatim,
 * never computes, never unlocks, and never writes.
 */

const MAX = PROGRESS_MAX_VISIBLE

/* ---------------------------------- stats --------------------------------- */

export function StatsSurface() {
  const [category, setCategory] = useState('全部')
  const listRef = useRef<HTMLDivElement | null>(null)
  const onArrow = useArrowNavigation(listRef, '.pg-chip', 'horizontal')

  const categories = useMemo(() => ['全部', ...Array.from(new Set(STAT_FIXTURES.map((s) => s.category)))].slice(0, MAX), [])
  const visible = useMemo(
    () => (category === '全部' ? STAT_FIXTURES : STAT_FIXTURES.filter((s) => s.category === category)).slice(0, MAX),
    [category],
  )
  const comparison = useMemo(() => STAT_FIXTURES.filter((s) => s.comparisonGroup === '击杀分类').slice(0, MAX), [])
  const comparisonMax = Math.max(...comparison.map((s) => Number(s.displayValue) || 0), 1)

  return (
    <section className="pg-surface" aria-label="统计（只读）">
      <header className="pg-head">
        <span className="pg-kicker">READ ONLY <span className="mock-tag">MOCK</span></span>
        <h2>统计</h2>
        <p>壳层逐字显示投影给出的 displayValue，不做任何计算或聚合。</p>
      </header>

      <div className="pg-chips" role="tablist" aria-label="统计分类" ref={listRef} onKeyDown={onArrow}>
        {categories.map((item) => (
          <button key={item} role="tab" aria-selected={category === item} className={`pg-chip ${category === item ? 'is-active' : ''}`} onClick={() => setCategory(item)}>
            {item}
          </button>
        ))}
      </div>

      <ul className="pg-stat-list">
        {visible.map((stat) => (
          <li key={stat.statId} className="pg-stat">
            <span className="pg-stat-label">{stat.label}</span>
            <span className="pg-stat-value">{stat.displayValue}</span>
          </li>
        ))}
      </ul>

      <div className="pg-compare">
        <div className="pg-section-label"><BarChart3 size={12} /> 击杀分类 · 比较组（≤5 项）</div>
        <ul className="pg-bars">
          {comparison.map((stat) => (
            <li key={stat.statId} className="pg-bar-row">
              <span className="pg-bar-label">{stat.label.replace('击杀 · ', '')}</span>
              <span className="pg-bar-track"><span className="pg-bar-fill" style={{ width: `${(Number(stat.displayValue) / comparisonMax) * 100}%` }} /></span>
              <span className="pg-bar-value">{stat.displayValue}</span>
            </li>
          ))}
        </ul>
        <p className="pg-summary">文本摘要：常规 204、精英 27、首领 5。柱高与颜色都不是唯一语义，数值本身始终可读。</p>
      </div>

      <MockBoundary>统计值、分类与比较组均为 mock fixture。壳层不记录、不累加、不推断任何数值。</MockBoundary>
    </section>
  )
}

/* ------------------------------- achievements ----------------------------- */

export function AchievementsSurface() {
  return (
    <section className="pg-surface" aria-label="成就（只读）">
      <header className="pg-head">
        <span className="pg-kicker">READ ONLY <span className="mock-tag">MOCK</span></span>
        <h2>成就</h2>
        <p>状态完全由投影给出。点击成就不会解锁它，壳层没有解锁逻辑。</p>
      </header>

      <ul className="pg-ach-list" aria-label="成就列表（同屏 ≤5）">
        {ACHIEVEMENT_FIXTURES.slice(0, MAX).map((item) => (
          <li key={item.achievementId} className={`pg-ach is-${item.state}`}>
            <span className="pg-ach-badge" aria-hidden="true">
              {item.state === 'unlocked' ? <Award size={17} /> : item.state === 'in-progress' ? <Clock size={16} /> : <Lock size={15} />}
            </span>
            <span className="pg-ach-main">
              <b>{item.title}</b>
              <small>{item.description}</small>
            </span>
            <span className="pg-ach-state">
              {item.state === 'unlocked' ? '已解锁' : item.state === 'in-progress' ? (item.progressLabel ?? '进行中') : '未解锁'}
            </span>
          </li>
        ))}
      </ul>

      <MockBoundary>成就状态为 mock 投影。未解锁与进行中不显示隐藏内容，也不从内部知识补全描述。</MockBoundary>
    </section>
  )
}

/* ---------------------------------- codex --------------------------------- */

const CODEX_CATS = [
  { id: 'enemy' as const, label: '敌人', Icon: Bug },
  { id: 'item' as const, label: '道具', Icon: Package },
  { id: 'location' as const, label: '地点', Icon: MapPin },
]

export function CodexSurface() {
  const [category, setCategory] = useState<CodexEntry['category']>('enemy')
  const [selectedId, setSelectedId] = useState('c1')
  const { state, dispatch, retry, cancel, reset } = useShellIntent('codex')

  const entries = useMemo(() => CODEX_FIXTURES.filter((entry) => entry.category === category).slice(0, MAX), [category])
  const detail = useMemo(() => CODEX_FIXTURES.find((entry) => entry.entryId === selectedId) ?? null, [selectedId])

  const select = (entry: CodexEntry) => {
    setSelectedId(entry.entryId)
    void dispatch('codex.entry.select', entry.entryId, { unlocked: entry.unlocked })
  }

  return (
    <section className="pg-surface pg-codex" aria-label="图鉴（只读）">
      <header className="pg-head">
        <span className="pg-kicker">READ ONLY <span className="mock-tag">MOCK</span></span>
        <h2>图鉴</h2>
        <p>未解锁条目显示 ？？？。壳层不从内部知识库补全任何未解锁内容。</p>
      </header>

      <div className="pg-chips" role="tablist" aria-label="图鉴分类">
        {CODEX_CATS.map(({ id, label, Icon }) => (
          <button key={id} role="tab" aria-selected={category === id} className={`pg-chip ${category === id ? 'is-active' : ''}`} onClick={() => setCategory(id)}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      <div className="pg-codex-body">
        <div className="pg-codex-list" role="list">
          {entries.map((entry) => (
            <button
              key={entry.entryId}
              role="listitem"
              className={`pg-codex-item ${selectedId === entry.entryId ? 'is-selected' : ''} ${entry.unlocked ? '' : 'is-locked'}`}
              onClick={() => select(entry)}
              aria-label={entry.unlocked ? entry.title : '未解锁的图鉴条目'}
            >
              <span className="pg-codex-thumb" aria-hidden="true">{entry.unlocked ? <Gem size={15} /> : <Lock size={13} />}</span>
              <span>{entry.unlocked ? entry.title : '？？？'}</span>
            </button>
          ))}
        </div>
        <div className="pg-codex-detail">
          {detail?.unlocked ? (
            <>
              <h3>{detail.title}</h3>
              <p>{detail.description}</p>
              {detail.weaknesses && (
                <div className="pg-weakness">
                  <span className="pg-section-label">弱点</span>
                  <div className="pg-weakness-tags">{detail.weaknesses.map((item) => <span key={item}>{item}</span>)}</div>
                </div>
              )}
            </>
          ) : (
            <div className="pg-codex-locked">
              <Lock size={22} strokeWidth={1.25} />
              <b>？？？</b>
              <span>该条目尚未解锁。详情只在投影确认后显示。</span>
            </div>
          )}
        </div>
      </div>

      <IntentFeedback state={state} onRetry={retry} onCancel={cancel} onSafeReturn={reset} compact />
      <MockBoundary>图鉴条目与解锁状态为 mock。选择条目只提交一次读取 intent，不改变解锁事实。</MockBoundary>
    </section>
  )
}

/* ---------------------------------- recap --------------------------------- */

const RECAP_META: Record<RecapEntry['category'], { label: string; Icon: typeof MessageSquare }> = {
  story: { label: '剧情', Icon: BookOpen },
  dialogue: { label: '对话', Icon: MessageSquare },
  choice: { label: '选择', Icon: Split },
}

export function RecapSurface() {
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const { state, dispatch, retry, cancel, reset } = useShellIntent('recap')

  const replay = async (event: RecapEntry) => {
    setReplayingId(event.eventId)
    const result = await dispatch('recap.replay', event.eventId, { presentationOnly: true })
    window.setTimeout(() => setReplayingId(null), result.outcome === 'accepted' ? 1200 : 200)
  }

  return (
    <section className="pg-surface" aria-label="剧情回顾（只读）">
      <header className="pg-head">
        <span className="pg-kicker">READ ONLY <span className="mock-tag">MOCK</span></span>
        <h2>剧情回顾</h2>
        <p>回放只重演表现层。它不重放规则，不改写档案，也不推进旅程。</p>
      </header>

      <ol className="pg-recap" aria-label="剧情时间线（同屏 ≤5）">
        {RECAP_FIXTURES.slice(0, MAX).map((event) => {
          const meta = RECAP_META[event.category]
          const Icon = meta.Icon
          const isReplaying = replayingId === event.eventId
          return (
            <li key={event.eventId} className="pg-recap-event">
              <span className="pg-recap-rail" aria-hidden="true"><span /></span>
              <div className="pg-recap-card">
                <div className="pg-recap-top">
                  <span className="pg-recap-cat"><Icon size={11} /> {meta.label}</span>
                  <span className="pg-recap-time">{event.occurredAtLabel}</span>
                </div>
                <h3>{event.title}</h3>
                <p>{event.summary}</p>
                <AnimatePresence>
                  {isReplaying && state.phase === 'accepted' && (
                    <motion.span className="pg-recap-replaying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <History size={11} /> 表现层重播中 · 档案未改变
                    </motion.span>
                  )}
                </AnimatePresence>
                <button onClick={() => replay(event)} disabled={state.phase === 'pending'}>
                  <Play size={11} /> {isReplaying ? '重播中…' : '回放'}
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <IntentFeedback state={state} onRetry={retry} onCancel={cancel} onSafeReturn={reset} compact />
      <MockBoundary>时间线为 mock 事件。回放是表现层重演，被拒绝或超时时不会发生任何重演。</MockBoundary>
    </section>
  )
}
