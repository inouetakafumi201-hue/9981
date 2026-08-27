'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Gem, Loader2, Medal, ScrollText, Sparkles, X } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'
import { createIntent, submitIntent } from '@/lib/b1-contract'

type Category = 'memento' | 'relic' | 'record'

interface SafeEntry {
  id: string
  category: Category
  title: string
  glyph: string
  canUse: boolean
  note: string
}

const CATEGORY_LABEL: Record<Category, string> = { memento: '纪念品', relic: '遗物', record: '记录' }
const CATEGORY_ICON: Record<Category, typeof Gem> = { memento: Medal, relic: Gem, record: ScrollText }
const CATEGORIES: Category[] = ['memento', 'relic', 'record']

// Collection display cabinet — high-value / commemorative objects only, never
// stacked materials or a junk inventory. Each category holds at most 5
// entries visible at once, per the shared "≤5 side-by-side" ceiling.
const ENTRIES: SafeEntry[] = [
  { id: 's1', category: 'memento', title: '第一枚锚定核心', glyph: '\u25C6', canUse: true, note: '第一次成功建立锚定连接时留下的核心残片。占位描述——真实文案接入后填充。' },
  { id: 's2', category: 'memento', title: '折角的旧车票', glyph: '\u25A3', canUse: false, note: '来自某次任务的纪念物。canUse: false —— 当前投影未授权任何操作。' },
  { id: 's3', category: 'relic', title: '共鸣棱镜·初代', glyph: '\u2735', canUse: true, note: '早期共鸣实验的遗留样本，具备可用占位动作。' },
  { id: 's4', category: 'relic', title: '锈蚀的信标外壳', glyph: '\u25B3', canUse: false, note: '损毁信标的外壳，仅供陈列，没有可执行动作。' },
  { id: 's5', category: 'record', title: '深潜日志·卷一', glyph: '\u2261', canUse: true, note: '记录了最初三次深潜的概要。可翻阅（占位 intent）。' },
]

interface UtilitySafeProps {
  onClose: () => void
}

type UseState = 'idle' | 'pending' | 'accepted' | 'rejected' | 'timeout'

/**
 * Gallery page for `utility-safe`: a collection display cabinet, not a
 * keypad-lock puzzle. Category rail on the left, a drawer-style central
 * display, and a detail/large-image panel on the right — matching
 * operations-safe-library-04's "safe = collection display, never a
 * materials warehouse" ruling.
 */
export function UtilitySafe({ onClose }: UtilitySafeProps) {
  const [phase, setPhase] = useState<'opening' | 'browse'>('opening')
  const [category, setCategory] = useState<Category>('memento')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [useState_, setUseState] = useState<UseState>('idle')
  const [useReason, setUseReason] = useState<string | undefined>()

  useEffect(() => {
    const timer = setTimeout(() => setPhase('browse'), 420)
    return () => clearTimeout(timer)
  }, [])

  const categoryEntries = ENTRIES.filter((e) => e.category === category)
  const selected = ENTRIES.find((e) => e.id === selectedId) ?? null

  async function selectEntry(id: string) {
    playSfx('ui-hover')
    setSelectedId(id)
    setUseState('idle')
    setUseReason(undefined)
    await submitIntent(createIntent('safe.select-entry', { entryId: id }))
  }

  async function changeCategory(next: Category) {
    setCategory(next)
    setSelectedId(null)
    await submitIntent(createIntent('safe.category', { category: next }))
  }

  async function useEntry(demoFailure?: 'rejected' | 'timeout') {
    if (!selected) return
    setUseState('pending')
    const result = await submitIntent(createIntent('safe.use', { entryId: selected.id, demoFailure: demoFailure ?? '' }, 'residence-main'))
    if (result.status === 'accepted') {
      setUseState('accepted')
      playSfx('safe-open')
      return
    }
    setUseState(result.status === 'timeout' ? 'timeout' : 'rejected')
    setUseReason(result.reason)
    playSfx('item-invalid')
  }

  return (
    <div className="rm-overlay-card us-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="保险箱陈列室">
      <div className="rm-overlay-head">
        <span>保险箱 · 收藏陈列室 <span className="mock-tag">MOCK</span></span>
        <button aria-label="关闭" onClick={onClose}><X size={14} /></button>
      </div>

      {phase === 'opening' ? (
        <div className="us-opening" role="status" aria-live="polite">
          <Loader2 size={18} className="us-opening-spin" /> 正在打开陈列室（mock）…
        </div>
      ) : (
        <div className="us-body">
          <nav className="us-category-rail" aria-label="收藏类别">
            {CATEGORIES.map((cat) => {
              const CatIcon = CATEGORY_ICON[cat]
              const count = ENTRIES.filter((e) => e.category === cat).length
              return (
                <button
                  key={cat}
                  className={`us-category-btn ${category === cat ? 'is-active' : ''}`}
                  aria-current={category === cat ? 'true' : undefined}
                  onClick={() => void changeCategory(cat)}
                >
                  <CatIcon size={14} />
                  <span>{CATEGORY_LABEL[cat]}</span>
                  <span className="us-category-count">{count}</span>
                </button>
              )
            })}
          </nav>

          <div className="us-drawer" aria-label={`${CATEGORY_LABEL[category]} 陈列抽屉`}>
            {categoryEntries.length === 0 ? (
              <p className="us-drawer-empty">该类别暂无陈列条目（mock）。</p>
            ) : (
              categoryEntries.slice(0, 5).map((entry) => (
                <button
                  key={entry.id}
                  className={`us-entry ${selectedId === entry.id ? 'is-selected' : ''}`}
                  onClick={() => void selectEntry(entry.id)}
                  aria-describedby={!entry.canUse ? `${entry.id}-nocanuse` : undefined}
                >
                  <span className="us-entry-glyph">{entry.glyph}</span>
                  <span className="us-entry-title">{entry.title}</span>
                  {!entry.canUse && <span id={`${entry.id}-nocanuse`} className="sr-only">当前不可执行操作</span>}
                </button>
              ))
            )}
          </div>

          <div className="us-detail">
            {selected ? (
              <>
                <span className="us-detail-glyph" aria-hidden="true">{selected.glyph}</span>
                <h3>{selected.title}</h3>
                <span className="us-detail-category"><Sparkles size={11} /> {CATEGORY_LABEL[selected.category]}</span>
                <p>{selected.note}</p>

                {selected.canUse ? (
                  <>
                    <button className="us-use-btn" disabled={useState_ === 'pending'} onClick={() => void useEntry()}>
                      {useState_ === 'pending' ? <Loader2 size={13} className="us-opening-spin" /> : <Check size={13} />}
                      {useState_ === 'pending' ? '提交中…' : useState_ === 'accepted' ? '已确认' : '使用（占位 intent）'}
                    </button>
                    {(useState_ === 'rejected' || useState_ === 'timeout') && (
                      <div className="us-use-error" role="alert">
                        <AlertTriangle size={12} />
                        <span>{useState_ === 'timeout' ? `请求超时：${useReason ?? 'MOCK_TIMEOUT'}` : `已拒绝：${useReason ?? 'MOCK_REJECTED'}`}</span>
                        <button onClick={() => void useEntry()}>重试</button>
                      </div>
                    )}
                    {useState_ === 'accepted' && <p className="us-use-success">投影已接受该动作（mock），实际效果由稳定端口承接。</p>}
                  </>
                ) : (
                  <p className="us-detail-locked">当前投影未授权任何操作 · 仅供陈列</p>
                )}
              </>
            ) : (
              <p className="us-detail-placeholder">选择左侧条目以查看详情与大图。</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
