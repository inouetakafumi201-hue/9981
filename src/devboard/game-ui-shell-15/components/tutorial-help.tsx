'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  GraduationCap,
  Keyboard,
  Loader2,
  MapPinned,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkle,
  X,
} from 'lucide-react'
import { useIntentChannel } from '@/lib/use-intent'
import { playSfx } from '@/lib/audio-slot'

/**
 * B5-03 — TutorialHelpAndLocationTitle.
 *
 * Three guidance surfaces over the world layer: a tutorial popup (title / body
 * / steps ≤5 / acknowledge · more-help · replay · dismiss), an `F1` help menu
 * (categories ≤5 + entries ≤5 + detail), and a centred location-title演出
 * (left-slide-in → hold → right-slide-out, optional first-exploration badge).
 * Buttons are visual triggers only — they emit intents; `seen` and
 * first-exploration are host-confirmed, never written locally. The world stays
 * running (no pause) during a location title.
 */

type Mode = 'tutorial' | 'help' | 'location'

interface TutorialStep { stepId: string; text: string; keyHint?: string }
interface TutorialProjection {
  tutorialId: string; title: string; body: string; steps: TutorialStep[]; seen: boolean; isMock: true
}
interface HelpEntry { entryId: string; title: string; body: string; available: boolean; reason?: string }
interface HelpCategory { categoryId: string; label: string; entries: HelpEntry[] }
interface LocationProjection {
  eventId: string; title: string; subtitle?: string; semanticTone: 'safe' | 'danger' | 'neutral'; firstExploration: boolean; isMock: true
}

const TUTORIAL: TutorialProjection = {
  tutorialId: 't-dive-basics', title: '初次深潜', seen: false, isMock: true,
  body: '深潜时信号会周期性波动。保持移动，利用掩体规避锚定导流仪的扫描，并在窗口期推进。',
  steps: [
    { stepId: 's1', text: '按住方向键移动，穿过掩体之间的空隙', keyHint: 'WASD' },
    { stepId: 's2', text: '在扫描窗口期贴近墙体，降低暴露', keyHint: 'Shift' },
    { stepId: 's3', text: '拾取沿途的回收零件补充信号强度', keyHint: 'E' },
    { stepId: 's4', text: '抵达中继站触发下一段引导', keyHint: '—' },
  ],
}

const HELP_CATEGORIES: HelpCategory[] = [
  {
    categoryId: 'c-basics', label: '基础操作',
    entries: [
      { entryId: 'e1', title: '移动与视角', body: '使用 WASD 移动，鼠标控制视角。移动不会中断已开始的对话，对话默认不暂停世界。', available: true },
      { entryId: 'e2', title: '交互提示', body: '靠近可交互对象时会出现上下文提示；提示由宿主投影驱动，本 UI 不判断距离。', available: true },
      { entryId: 'e3', title: '暂停与设置', body: '暂停菜单可调整设置，但暂停策略仍由宿主决定，引导 UI 不自行暂停。', available: true },
    ],
  },
  {
    categoryId: 'c-dive', label: '深潜机制',
    entries: [
      { entryId: 'e4', title: '信号波动', body: '信号强度会周期性下降。字幕与视觉提示会告知当前窗口，颜色不是唯一依据。', available: true },
      { entryId: 'e5', title: '锚定导流仪', body: '扫描型障碍。规避细节在遭遇后由投影解锁。', available: false, reason: '需先遭遇该机制' },
    ],
  },
  {
    categoryId: 'c-archive', label: '档案与回顾',
    entries: [
      { entryId: 'e6', title: '任务日志', body: '按 J 打开只读任务日志；追踪任务只提交意图。', available: true },
      { entryId: 'e7', title: '通知历史', body: '按 N 查看只读通知历史，按今天／昨天／更早分组。', available: true },
    ],
  },
]

const LOCATIONS: LocationProjection[] = [
  { eventId: 'loc-1', title: '第七区 · 中继站', subtitle: '信号在这里第一次变得清晰', semanticTone: 'neutral', firstExploration: true, isMock: true },
  { eventId: 'loc-2', title: '锈蚀回廊', subtitle: '危险区域 · 保持移动', semanticTone: 'danger', firstExploration: false, isMock: true },
  { eventId: 'loc-3', title: '避风驻地', subtitle: '安全区 · 可以喘口气', semanticTone: 'safe', firstExploration: false, isMock: true },
]

const TONE_META = {
  safe: { label: '安全', tone: 'green', Icon: BadgeCheck },
  danger: { label: '危险', tone: 'red', Icon: ShieldAlert },
  neutral: { label: '中性', tone: 'cyan', Icon: MapPinned },
} as const

const MODES: { id: Mode; label: string; Icon: typeof GraduationCap }[] = [
  { id: 'tutorial', label: '教程弹窗', Icon: GraduationCap },
  { id: 'help', label: 'F1 帮助', Icon: CircleHelp },
  { id: 'location', label: '区域名', Icon: MapPinned },
]

export function TutorialHelp({
  initialSeen = TUTORIAL.seen,
  onAcknowledged,
  onLocationComplete,
}: {
  initialSeen?: boolean
  onAcknowledged?: () => void
  onLocationComplete?: () => void
}) {
  const [mode, setMode] = useState<Mode>('tutorial')
  const [seen, setSeen] = useState(initialSeen)
  const [catId, setCatId] = useState(HELP_CATEGORIES[0].categoryId)
  const [entryId, setEntryId] = useState(HELP_CATEGORIES[0].entries[0].entryId)
  const [locIndex, setLocIndex] = useState(0)
  const [locPhase, setLocPhase] = useState<'idle' | 'entering' | 'hold' | 'exiting'>('idle')
  const [live, setLive] = useState('')
  const { state: intent, dispatch } = useIntentChannel('tutorial-help')
  const reduce = useReducedMotion()
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const category = useMemo(() => HELP_CATEGORIES.find((c) => c.categoryId === catId) ?? HELP_CATEGORIES[0], [catId])
  const entry = useMemo(() => category.entries.find((e) => e.entryId === entryId) ?? category.entries[0], [category, entryId])
  const loc = LOCATIONS[locIndex]
  const toneMeta = TONE_META[loc.semanticTone]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'F1') { e.preventDefault(); setMode('help'); playSfx('menu-open'); void dispatch('help.open') }
      else if (e.key === 'Escape' && mode !== 'location') { e.preventDefault(); void dispatch(mode === 'help' ? 'help.close' : 'tutorial.dismiss', { tutorialId: TUTORIAL.tutorialId }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Location演出 timeline: entering → hold → exiting → idle.
  const playLocation = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    setLocPhase('entering')
    setLive(`进入区域：${loc.title}${loc.subtitle ? '，' + loc.subtitle : ''}`)
    playSfx('dream-enter')
    const enterMs = reduce ? 0 : 600
    setTimeout(() => {
      setLocPhase('hold')
      holdTimer.current = setTimeout(() => {
        setLocPhase('exiting')
        setTimeout(() => {
          setLocPhase('idle')
          onLocationComplete?.()
        }, reduce ? 0 : 500)
      }, 2200)
    }, enterMs)
  }, [loc, onLocationComplete, reduce])

  useEffect(() => {
    if (mode === 'location') playLocation()
    else { if (holdTimer.current) clearTimeout(holdTimer.current); setLocPhase('idle') }
    return () => { if (holdTimer.current) clearTimeout(holdTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, locIndex])

  useEffect(() => { if (mode !== 'location') requestAnimationFrame(() => surfaceRef.current?.focus()) }, [mode])

  const acknowledge = async () => {
    playSfx('ui-confirm')
    const r = await dispatch('tutorial.acknowledge', { tutorialId: TUTORIAL.tutorialId })
    if (r.status === 'accepted') {
      setSeen(true)
      setLive('教程已确认。正在载入第七区中继站。')
      onAcknowledged?.()
      setMode('location')
    } else setLive(`确认未��效：${r.reason ?? r.status}`)
  }
  const replay = async () => {
    playSfx('option-select')
    setLive('请求重放教程演出')
    // Replay is a presentation-only re-run; it never re-marks seen locally.
    await dispatch('tutorial.replay', { tutorialId: TUTORIAL.tutorialId })
  }

  const intentPill = intent.phase !== 'idle' && (
    <span className={`th-intent-pill th-intent-${intent.phase}`}>
      {intent.phase === 'pending' ? <Loader2 size={11} className="is-spin" /> : intent.phase === 'accepted' ? <Check size={11} /> : <RotateCcw size={11} />}
      {intent.phase === 'pending' ? '意图处理中…' : intent.phase === 'accepted' ? '宿主已确认' : `${intent.phase}：${intent.reason ?? ''}`}
    </span>
  )

  return (
    <div className="th-stage">
      <div className="th-world" aria-hidden="true">
        <div className="th-world-grid" />
        <div className="th-world-glow" />
      </div>

      <div className="th-mode-switch" role="group" aria-label="引导表面切换">
        {MODES.map((m) => {
          const Icon = m.Icon
          return (
            <button key={m.id} className={`th-mode-btn ${mode === m.id ? 'is-active' : ''}`} onClick={() => { setMode(m.id); playSfx('ui-toggle') }} aria-pressed={mode === m.id}>
              <Icon size={13} /> {m.label}
            </button>
          )
        })}
        <span className="th-hint">F1 帮助 · Esc 关闭</span>
      </div>

      {/* --- Tutorial popup --- */}
      <AnimatePresence mode="wait">
        {mode === 'tutorial' && (
          <motion.div
            key="tutorial"
            ref={surfaceRef}
            className="th-tutorial"
            role="dialog"
            aria-modal="false"
            aria-label={`教程：${TUTORIAL.title}`}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, rotate: reduce ? 0 : -0.6, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, rotate: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="th-tut-head">
              <span className="th-tut-kicker"><GraduationCap size={12} /> 教程</span>
              <span className={`th-seen ${seen ? 'is-seen' : ''}`}>{seen ? '已看' : '未看'}</span>
            </div>
            <h3 className="th-tut-title">{TUTORIAL.title}</h3>
            <div className="th-tut-asset" aria-hidden="true"><Sparkle size={26} strokeWidth={1.25} /><span>示意图占位</span></div>
            <p className="th-tut-body">{TUTORIAL.body}</p>
            <ol className="th-step-list" aria-label="教程步骤（最多同屏 5）">
              {TUTORIAL.steps.slice(0, 5).map((s, i) => (
                <li key={s.stepId} className="th-step">
                  <span className="th-step-index">{i + 1}</span>
                  <span className="th-step-text">{s.text}</span>
                  {s.keyHint && <span className="th-step-key"><Keyboard size={10} /> {s.keyHint}</span>}
                </li>
              ))}
            </ol>
            <div className="th-tut-actions">
              <button className="th-btn is-primary" onClick={acknowledge} disabled={intent.phase === 'pending'}>
                {intent.phase === 'pending' ? <Loader2 size={13} className="is-spin" /> : <Check size={13} />} 明白了
              </button>
              <button className="th-btn" onClick={() => { playSfx('ui-focus'); setMode('help'); void dispatch('tutorial.more-help', { tutorialId: TUTORIAL.tutorialId }) }}>
                <BookOpen size={13} /> 查看更多
              </button>
              <button className="th-btn" onClick={replay} disabled={intent.phase === 'pending'}>
                <Play size={13} /> 重放
              </button>
              <button className="th-btn is-ghost" onClick={() => { playSfx('ui-cancel'); void dispatch('tutorial.dismiss', { tutorialId: TUTORIAL.tutorialId }) }}>
                稍后
              </button>
            </div>
            {intentPill}
          </motion.div>
        )}

        {/* --- Help menu (F1) --- */}
        {mode === 'help' && (
          <motion.div
            key="help"
            ref={surfaceRef}
            className="th-help"
            role="dialog"
            aria-modal="false"
            aria-label="帮助菜单（F1）"
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.98, filter: 'blur(6px)' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="th-help-head">
              <span className="th-tut-kicker"><CircleHelp size={12} /> 帮助 · 教程重放</span>
              <button className="th-close" aria-label="关闭帮助" onClick={() => { playSfx('menu-close'); void dispatch('help.close'); setMode('tutorial') }}><X size={14} /></button>
            </div>
            <div className="th-help-body">
              <div className="th-help-cats" role="tablist" aria-label="帮助分类">
                {HELP_CATEGORIES.slice(0, 5).map((c) => (
                  <button key={c.categoryId} role="tab" aria-selected={catId === c.categoryId} className={`th-help-cat ${catId === c.categoryId ? 'is-active' : ''}`} onClick={() => { setCatId(c.categoryId); setEntryId(c.entries[0].entryId); playSfx('ui-toggle') }}>
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="th-help-entries" role="list" aria-label="帮助条目">
                {category.entries.slice(0, 5).map((e) => (
                  <button
                    key={e.entryId}
                    role="listitem"
                    className={`th-help-entry ${entryId === e.entryId ? 'is-active' : ''} ${!e.available ? 'is-locked' : ''}`}
                    onClick={() => { if (!e.available) return; setEntryId(e.entryId); playSfx('ui-focus'); void dispatch('help.select-entry', { entryId: e.entryId }) }}
                    disabled={!e.available}
                    aria-disabled={!e.available}
                  >
                    <span>{e.title}</span>
                    {e.available ? <ChevronRight size={13} /> : <span className="th-entry-lock">{e.reason}</span>}
                  </button>
                ))}
              </div>
              <div className="th-help-detail">
                <h4>{entry.title}</h4>
                <p>{entry.body}</p>
              </div>
            </div>
            {intentPill}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Location title演出 --- */}
      {mode === 'location' && (
        <>
          <div className="th-loc-controls">
            {LOCATIONS.map((l, i) => (
              <button key={l.eventId} className={`th-loc-btn ${locIndex === i ? 'is-active' : ''}`} onClick={() => { setLocIndex(i); playSfx('ui-toggle') }} aria-pressed={locIndex === i}>
                {TONE_META[l.semanticTone].label}
              </button>
            ))}
            <button className="th-loc-replay" onClick={playLocation}><RotateCcw size={12} /> 重播</button>
          </div>
          <AnimatePresence>
            {locPhase !== 'idle' && (
              <motion.div
                key={loc.eventId + locPhase}
                className={`th-location th-tone-${toneMeta.tone}`}
                initial={{ opacity: 0, x: reduce ? 0 : -80, clipPath: 'inset(0 100% 0 0)' }}
                animate={{ opacity: 1, x: 0, clipPath: 'inset(0 0% 0 0)' }}
                exit={{ opacity: 0, x: reduce ? 0 : 80, clipPath: 'inset(0 0 0 100%)' }}
                transition={{ duration: reduce ? 0.01 : 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="th-loc-tone-mark"><toneMeta.Icon size={15} /> {toneMeta.label}区域</span>
                <h2 className="th-loc-title" aria-live="polite">{loc.title}</h2>
                {loc.subtitle && <p className="th-loc-subtitle">{loc.subtitle}</p>}
                {loc.firstExploration && <span className="th-first-badge"><Compass size={11} /> 首次探索</span>}
                <span className="th-loc-slash" aria-hidden="true" />
              </motion.div>
            )}
          </AnimatePresence>
          <p className="th-loc-note">区域名默认不暂停世界，环境层保持可见；首次探索徽章由投影标记，UI 不通过坐标判断进入。</p>
        </>
      )}

      <div className="sr-only" aria-live="polite">{live}</div>
    </div>
  )
}
