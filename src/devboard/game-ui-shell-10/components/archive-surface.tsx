'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Award,
  BarChart3,
  BookOpen,
  Bug,
  Check,
  Clock,
  Gem,
  History,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  Package,
  Play,
  Split,
  X,
} from 'lucide-react'
import { useIntentChannel } from '@/lib/use-intent'
import { playSfx } from '@/lib/audio-slot'

/**
 * B5-05 — StatsSurface / AchievementsSurface / CodexSurface / RecapSurface.
 *
 * One read-only archive mount with four tabs. Nothing is ever written: stats
 * are displayed (`displayValue` verbatim, comparison groups ≤5), achievements
 * show projection state (locked / in-progress / unlocked — never unlocked on
 * click), codex locked entries render `？？？` with a stable aria-label, and
 * recap `replay` is a presentation-only re-run submitted as an intent. Every
 * list / comparison / timeline is capped at 5 visible items.
 */

type Tab = 'stats' | 'achievements' | 'codex' | 'recap'
type AchState = 'locked' | 'in-progress' | 'unlocked'
type CodexCat = 'enemy' | 'item' | 'location'
type RecapCat = 'story' | 'dialogue' | 'choice'

interface Stat { statId: string; label: string; displayValue: string; category: string; comparisonGroup?: string }
interface Achievement { achievementId: string; title: string; description: string; state: AchState; progressLabel?: string }
interface CodexEntry { entryId: string; category: CodexCat; unlocked: boolean; title: string; description?: string; weaknesses?: string[] }
interface RecapEvent { eventId: string; occurredAtLabel: string; title: string; summary: string; category: RecapCat }

const STATS: Stat[] = [
  { statId: 's1', label: '累计游玩时间', displayValue: '14 小时 22 分', category: '总览' },
  { statId: 's2', label: '完成任务', displayValue: '18', category: '总览' },
  { statId: 's3', label: '深潜次数', displayValue: '31', category: '总览' },
  { statId: 's4', label: '击杀 · 常规', displayValue: '204', category: '战斗', comparisonGroup: '击杀分类' },
  { statId: 's5', label: '击杀 · 精英', displayValue: '27', category: '战斗', comparisonGroup: '击杀分类' },
  { statId: 's6', label: '击杀 · 首领', displayValue: '5', category: '战斗', comparisonGroup: '击杀分类' },
  { statId: 's7', label: '死亡次数', displayValue: '12', category: '战斗' },
  { statId: 's8', label: '探索区域', displayValue: '9 / 14', category: '探索' },
]

const ACHIEVEMENTS: Achievement[] = [
  { achievementId: 'a1', title: '初次深潜', description: '完成第一次匹配下潜。', state: 'unlocked' },
  { achievementId: 'a2', title: '毫发无伤', description: '在一次深潜中未受任何损伤。', state: 'unlocked' },
  { achievementId: 'a3', title: '锲而不舍', description: '累计完成 25 个任务。', state: 'in-progress', progressLabel: '18 / 25' },
  { achievementId: 'a4', title: '深渊回响', description: '抵达深潜网络的最深层。', state: 'locked' },
  { achievementId: 'a5', title: '收藏家', description: '解锁全部图鉴条目。', state: 'in-progress', progressLabel: '6 / 20' },
  { achievementId: 'a6', title: '守夜人', description: '在安全区连续驻留三个周期。', state: 'locked' },
]

const CODEX: CodexEntry[] = [
  { entryId: 'c1', category: 'enemy', unlocked: true, title: '锚定导流仪', description: '扫描型障碍，会周期性发出探测脉冲。', weaknesses: ['窗口期贴墙', '信号干扰弹'] },
  { entryId: 'c2', category: 'enemy', unlocked: false, title: '？？？', description: undefined },
  { entryId: 'c3', category: 'item', unlocked: true, title: '回收零件', description: '深潜途中最常见的可回收物资，用于补充信号强度。' },
  { entryId: 'c4', category: 'item', unlocked: true, title: '中继钥匙', description: '开启中继站封锁门的一次性密钥。' },
  { entryId: 'c5', category: 'item', unlocked: false, title: '？？？' },
  { entryId: 'c6', category: 'location', unlocked: true, title: '第七区 · 中继站', description: '深潜网络的关键节点，信号在此第一次变得清晰。' },
  { entryId: 'c7', category: 'location', unlocked: false, title: '？？？' },
]

const RECAP: RecapEvent[] = [
  { eventId: 'v1', occurredAtLabel: '第 1 天', title: '苏醒', summary: '你在一间陌生的房间里醒来，信号从墙缝间渗进来。', category: 'story' },
  { eventId: 'v2', occurredAtLabel: '第 1 天', title: '与记录者的第一次通话', summary: '「你还没真正醒来。」——一个自称记录者的声音这样说。', category: 'dialogue' },
  { eventId: 'v3', occurredAtLabel: '第 2 天', title: '关键抉择：信标', summary: '你选择了回收信标核心，而不是原地销毁它。', category: 'choice' },
  { eventId: 'v4', occurredAtLabel: '第 3 天', title: '抵达中继站', summary: '第七区中继站的封锁门在你面前打开。', category: 'story' },
  { eventId: 'v5', occurredAtLabel: '第 4 天', title: '断裂的誓约', summary: '一条无法挽回的路线，永远留在了日志里。', category: 'choice' },
  { eventId: 'v6', occurredAtLabel: '第 5 天', title: '更深的回响', summary: '信号指向网络更深处，那里还没有人回来过。', category: 'story' },
]

const TABS: { id: Tab; label: string; Icon: typeof BarChart3 }[] = [
  { id: 'stats', label: '统计', Icon: BarChart3 },
  { id: 'achievements', label: '成就', Icon: Award },
  { id: 'codex', label: '图鉴', Icon: BookOpen },
  { id: 'recap', label: '回顾', Icon: History },
]
const CODEX_CATS: { id: CodexCat; label: string; Icon: typeof Bug }[] = [
  { id: 'enemy', label: '敌人', Icon: Bug },
  { id: 'item', label: '道具', Icon: Package },
  { id: 'location', label: '地点', Icon: MapPin },
]
const RECAP_META: Record<RecapCat, { label: string; Icon: typeof MessageSquare; tone: string }> = {
  story: { label: '剧情', Icon: BookOpen, tone: 'cyan' },
  dialogue: { label: '对话', Icon: MessageSquare, tone: 'white' },
  choice: { label: '选择', Icon: Split, tone: 'gold' },
}
const MAX = 5

export function ArchiveSurface() {
  const [tab, setTab] = useState<Tab>('stats')
  const [statCat, setStatCat] = useState<string>('全部')
  const [codexCat, setCodexCat] = useState<CodexCat>('enemy')
  const [codexPage, setCodexPage] = useState(0)
  const [selectedCodex, setSelectedCodex] = useState<string>('c1')
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const { state: intent, dispatch } = useIntentChannel('archive')
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  const statCats = useMemo(() => ['全部', ...Array.from(new Set(STATS.map((s) => s.category)))], [])
  const visibleStats = useMemo(
    () => (statCat === '全部' ? STATS : STATS.filter((s) => s.category === statCat)).slice(0, MAX),
    [statCat],
  )
  const comparison = useMemo(() => STATS.filter((s) => s.comparisonGroup === '击杀分类'), [])
  const comparisonMax = Math.max(...comparison.map((s) => Number(s.displayValue) || 0), 1)

  const codexEntries = useMemo(() => CODEX.filter((c) => c.category === codexCat), [codexCat])
  const codexPages = Math.ceil(codexEntries.length / MAX)
  const pagedCodex = codexEntries.slice(codexPage * MAX, codexPage * MAX + MAX)
  const codexDetail = useMemo(() => CODEX.find((c) => c.entryId === selectedCodex) ?? null, [selectedCodex])

  const changeTab = (t: Tab) => { setTab(t); playSfx('ui-toggle'); void dispatch('archive.tab.select', { tab: t }); setLive(`已切换到档案分页：${TABS.find((x) => x.id === t)?.label}`) }

  const replay = useCallback(async (ev: RecapEvent) => {
    setReplayingId(ev.eventId)
    playSfx('option-select')
    setLive(`回放事件：${ev.title}（仅表现层重播）`)
    const r = await dispatch('recap.replay', { eventId: ev.eventId })
    if (r.status !== 'accepted') setLive(`回放未生效：${r.reason ?? r.status}`)
    setTimeout(() => setReplayingId(null), 1400)
  }, [dispatch])

  return (
    <div className="ar-stage" ref={surfaceRef} tabIndex={-1} aria-label="档案（只读，MOCK）">
      <div className="ar-world" aria-hidden="true" />

      <div className="ar-head">
        <span className="ar-kicker">进度档案 <span className="mock-tag">MOCK</span></span>
        <div className="ar-tabs" role="tablist" aria-label="档案分页">
          {TABS.map((t) => {
            const Icon = t.Icon
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`ar-tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => changeTab(t.id)}>
                <Icon size={13} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="ar-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="ar-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* --- STATS --- */}
            {tab === 'stats' && (
              <div className="ar-stats">
                <div className="ar-stat-filter" role="tablist" aria-label="统计分类">
                  {statCats.slice(0, 5).map((c) => (
                    <button key={c} role="tab" aria-selected={statCat === c} className={`ar-chip ${statCat === c ? 'is-active' : ''}`} onClick={() => { setStatCat(c); playSfx('ui-focus') }}>{c}</button>
                  ))}
                </div>
                <ul className="ar-stat-list">
                  {visibleStats.map((s) => (
                    <li key={s.statId} className="ar-stat">
                      <span className="ar-stat-label">{s.label}</span>
                      <span className="ar-stat-value">{s.displayValue}</span>
                    </li>
                  ))}
                </ul>
                <div className="ar-compare">
                  <div className="ar-section-label"><BarChart3 size={12} /> 击杀分类（比较组 ≤5）</div>
                  <ul className="ar-bars">
                    {comparison.map((s) => (
                      <li key={s.statId} className="ar-bar-row">
                        <span className="ar-bar-label">{s.label.replace('击杀 · ', '')}</span>
                        <span className="ar-bar-track"><span className="ar-bar-fill" style={{ width: `${(Number(s.displayValue) / comparisonMax) * 100}%` }} /></span>
                        <span className="ar-bar-value">{s.displayValue}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="ar-text-summary">文本摘要：常规 204、精英 27、首领 5，颜色与柱高均非唯一语义。</p>
                </div>
              </div>
            )}

            {/* --- ACHIEVEMENTS --- */}
            {tab === 'achievements' && (
              <ul className="ar-ach-list" aria-label="成就（同屏 ≤5）">
                {ACHIEVEMENTS.slice(0, MAX).map((a) => (
                  <li key={a.achievementId} className={`ar-ach ar-ach-${a.state}`}>
                    <span className="ar-ach-badge" aria-hidden="true">
                      {a.state === 'unlocked' ? <Award size={17} /> : a.state === 'in-progress' ? <Clock size={16} /> : <Lock size={15} />}
                    </span>
                    <span className="ar-ach-main">
                      <span className="ar-ach-title">{a.title}</span>
                      <span className="ar-ach-desc">{a.description}</span>
                    </span>
                    <span className="ar-ach-state">
                      {a.state === 'unlocked' ? '已解锁' : a.state === 'in-progress' ? (a.progressLabel ?? '进行中') : '未解锁'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* --- CODEX --- */}
            {tab === 'codex' && (
              <div className="ar-codex">
                <div className="ar-codex-cats" role="tablist" aria-label="图鉴分类">
                  {CODEX_CATS.map((c) => {
                    const Icon = c.Icon
                    return (
                      <button key={c.id} role="tab" aria-selected={codexCat === c.id} className={`ar-chip ${codexCat === c.id ? 'is-active' : ''}`} onClick={() => { setCodexCat(c.id); setCodexPage(0); playSfx('ui-toggle') }}>
                        <Icon size={12} /> {c.label}
                      </button>
                    )
                  })}
                </div>
                <div className="ar-codex-body">
                  <div className="ar-codex-list" role="list">
                    {pagedCodex.map((e) => (
                      <button
                        key={e.entryId}
                        role="listitem"
                        className={`ar-codex-item ${selectedCodex === e.entryId ? 'is-selected' : ''} ${!e.unlocked ? 'is-locked' : ''}`}
                        onClick={() => { setSelectedCodex(e.entryId); playSfx('ui-focus'); void dispatch('archive.entry.select', { entryId: e.entryId }) }}
                        aria-label={e.unlocked ? e.title : '未解锁的图鉴条目'}
                      >
                        <span className="ar-codex-thumb" aria-hidden="true">{e.unlocked ? <Gem size={15} /> : <Lock size={13} />}</span>
                        <span className="ar-codex-item-title">{e.unlocked ? e.title : '？？？'}</span>
                      </button>
                    ))}
                    {codexPages > 1 && (
                      <div className="ar-pager">
                        {Array.from({ length: codexPages }).map((_, i) => (
                          <button key={i} className={`ar-pager-dot ${codexPage === i ? 'is-active' : ''}`} onClick={() => setCodexPage(i)} aria-label={`第 ${i + 1} 页`} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ar-codex-detail">
                    {codexDetail?.unlocked ? (
                      <>
                        <h4>{codexDetail.title}</h4>
                        <p>{codexDetail.description}</p>
                        {codexDetail.weaknesses && (
                          <div className="ar-weakness">
                            <span className="ar-section-label">弱点</span>
                            <div className="ar-weakness-tags">{codexDetail.weaknesses.map((w) => <span key={w} className="ar-weakness-tag">{w}</span>)}</div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="ar-codex-locked">
                        <Lock size={22} strokeWidth={1.25} />
                        <p>？？？</p>
                        <span>该条目尚未解锁。详情将在投影确认后显示，不从内部知识库推断。</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* --- RECAP --- */}
            {tab === 'recap' && (
              <ol className="ar-recap" aria-label="剧情时间线（同屏 ≤5）">
                {RECAP.slice(0, MAX).map((ev) => {
                  const meta = RECAP_META[ev.category]
                  const Icon = meta.Icon
                  return (
                    <li key={ev.eventId} className={`ar-recap-event ar-tone-${meta.tone}`}>
                      <span className="ar-recap-rail" aria-hidden="true"><span className="ar-recap-node" /></span>
                      <div className="ar-recap-card">
                        <div className="ar-recap-top">
                          <span className="ar-recap-cat"><Icon size={11} /> {meta.label}</span>
                          <span className="ar-recap-time">{ev.occurredAtLabel}</span>
                        </div>
                        <h4 className="ar-recap-title">{ev.title}</h4>
                        <p className="ar-recap-summary">{ev.summary}</p>
                        <button
                          className="ar-recap-replay"
                          onClick={() => replay(ev)}
                          disabled={replayingId === ev.eventId || intent.phase === 'pending'}
                        >
                          {replayingId === ev.eventId ? <Loader2 size={11} className="is-spin" /> : <Play size={11} />}
                          {replayingId === ev.eventId ? '重播中…' : '回放'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="ar-foot">
        <span>只读档案 · 不记录统计 · 不解锁成就／图鉴 · 回放仅表现层重演</span>
        {intent.phase !== 'idle' && (
          <span className={`ar-intent-pill ar-intent-${intent.phase}`}>
            {intent.phase === 'pending' ? <Loader2 size={11} className="is-spin" /> : intent.phase === 'accepted' ? <Check size={11} /> : <X size={11} />}
            {intent.phase === 'pending' ? '意图处理中…' : intent.phase === 'accepted' ? '宿主已确认' : `${intent.phase}`}
          </span>
        )}
      </div>

      <div className="sr-only" aria-live="polite">{live}</div>
    </div>
  )
}
