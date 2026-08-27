'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Award,
  Bell,
  Coins,
  Radio,
  ScrollText,
  Sparkles,
  Swords,
  Terminal,
  Users,
  X,
  Layers,
} from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

/**
 * B4-04 — notification-history: the read-only history panel opened with `N`.
 * It consumes a mock projection (kind / priority / groupKey / stackCount /
 * occurredAtLabel) and only ever *displays* it: no create, claim, delete or
 * replay. Entries are grouped into 今天 / 昨天 / 更早, each group capped at 5
 * visible rows (the rest scroll), and selecting a row opens an inline detail —
 * never a business action. Everything a screen reader needs (kind, priority,
 * stack count, time) is exposed as text, not colour alone.
 */

type NoticeKind =
  | 'quest'
  | 'item'
  | 'skill'
  | 'achievement'
  | 'currency'
  | 'social'
  | 'system'
  | 'broadcast'
type Priority = 'high' | 'normal' | 'low'
type GroupId = 'today' | 'yesterday' | 'earlier'

interface HistoryItem {
  notificationId: string
  kind: NoticeKind
  priority: Priority
  group: GroupId
  groupKey?: string
  title: string
  message: string
  occurredAtLabel: string
  stackCount?: number
  source: 'mock'
}

const KIND_META: Record<NoticeKind, { icon: typeof Bell; label: string; tone: string }> = {
  quest: { icon: ScrollText, label: '任务', tone: 'green' },
  item: { icon: Layers, label: '道具', tone: 'yellow' },
  skill: { icon: Sparkles, label: '技能', tone: 'orange' },
  achievement: { icon: Award, label: '成就', tone: 'gold' },
  currency: { icon: Coins, label: '货币', tone: 'gold' },
  social: { icon: Users, label: '社交', tone: 'cyan' },
  system: { icon: Terminal, label: '系统', tone: 'white' },
  broadcast: { icon: Radio, label: '广播', tone: 'cyan' },
}

const PRIORITY_LABEL: Record<Priority, string> = { high: '高', normal: '中', low: '低' }

const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'earlier', label: '更早' },
]

// Mock projection — every entry is flagged source: 'mock'. Ordered newest-first
// within each group; group membership and stackCount come from the projection,
// never recomputed locally.
const HISTORY: HistoryItem[] = [
  { notificationId: 'n-01', kind: 'quest', priority: 'high', group: 'today', title: '主线推进', message: '「回声之下」阶段目标已更新：抵达第七区中继站。', occurredAtLabel: '刚刚', source: 'mock' },
  { notificationId: 'n-02', kind: 'item', priority: 'normal', group: 'today', groupKey: 'salvage', title: '拾取物资', message: '获得回收零件 ×3，已收纳进背包临时格。', occurredAtLabel: '2 分钟前', stackCount: 3, source: 'mock' },
  { notificationId: 'n-03', kind: 'achievement', priority: 'high', group: 'today', title: '成就解锁', message: '「毫发无伤」——在一次深潜中未受任何损伤。', occurredAtLabel: '11 分钟前', source: 'mock' },
  { notificationId: 'n-04', kind: 'social', priority: 'normal', group: 'today', title: '编组邀请', message: '玩家「灰隼」邀请你加入下一轮匹配。占位说明，不接入真实社交。', occurredAtLabel: '18 分钟前', source: 'mock' },
  { notificationId: 'n-05', kind: 'currency', priority: 'low', group: 'today', groupKey: 'credit', title: '货币结算', message: '结算获得 信用点 ×2。', occurredAtLabel: '24 分钟前', stackCount: 2, source: 'mock' },
  { notificationId: 'n-06', kind: 'system', priority: 'low', group: 'today', title: '系统消息', message: '连接已同步，投影修订版本 +1。', occurredAtLabel: '31 分钟前', source: 'mock' },
  { notificationId: 'n-07', kind: 'skill', priority: 'normal', group: 'yesterday', title: '技能解锁', message: '被动「回声感知」现已可在研究台装配（占位入口）。', occurredAtLabel: '昨天 22:14', source: 'mock' },
  { notificationId: 'n-08', kind: 'broadcast', priority: 'high', group: 'yesterday', title: '世界广播', message: '深潜网络信号强度提升 12%，留意锚定导流仪状态。', occurredAtLabel: '昨天 20:02', source: 'mock' },
  { notificationId: 'n-09', kind: 'quest', priority: 'normal', group: 'yesterday', title: '支线完成', message: '「无名者的信标」已归档，可在任务日志回看。', occurredAtLabel: '昨天 18:47', source: 'mock' },
  { notificationId: 'n-10', kind: 'item', priority: 'low', group: 'earlier', groupKey: 'salvage', title: '拾取物资', message: '获得回收零件 ×5（历史堆叠展示）。', occurredAtLabel: '3 天前', stackCount: 5, source: 'mock' },
  { notificationId: 'n-11', kind: 'achievement', priority: 'normal', group: 'earlier', title: '成就解锁', message: '「初次深潜」——完成了第一次匹配下潜。', occurredAtLabel: '5 天前', source: 'mock' },
]

export function NotificationHistory() {
  const [open, setOpen] = useState(true)
  const [group, setGroup] = useState<GroupId>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const entries = useMemo(() => HISTORY.filter((h) => h.group === group), [group])
  const selected = useMemo(() => HISTORY.find((h) => h.notificationId === selectedId) ?? null, [selectedId])

  // `N` opens the history; Esc closes it and returns focus to the trigger.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const key = e.key.toLowerCase()
      if (!open && key === 'n') {
        e.preventDefault()
        openHistory()
      } else if (open && e.key === 'Escape') {
        e.preventDefault()
        closeHistory()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) {
      // Move focus into the panel when it opens (focus trap entry point).
      requestAnimationFrame(() => dialogRef.current?.focus())
    }
  }, [open])

  const openHistory = () => {
    setOpen(true)
    setLive('通知历史已打开（只读）')
    playSfx('menu-open')
  }
  const closeHistory = () => {
    setOpen(false)
    setSelectedId(null)
    setLive('通知历史已关闭')
    playSfx('menu-close')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const changeGroup = (g: GroupId) => {
    setGroup(g)
    setSelectedId(null)
    setLive(`已切换到分组：${GROUPS.find((x) => x.id === g)?.label}`)
    playSfx('ui-toggle')
  }
  const selectEntry = (item: HistoryItem) => {
    setSelectedId((prev) => (prev === item.notificationId ? null : item.notificationId))
    const meta = KIND_META[item.kind]
    setLive(`${meta.label}通知，优先级${PRIORITY_LABEL[item.priority]}：${item.title}`)
    playSfx('ui-focus')
  }

  return (
    <div className="nh-stage">
      <div className="nh-triggers">
        <button
          ref={triggerRef}
          className="nh-trigger-btn"
          onClick={() => (open ? closeHistory() : openHistory())}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Bell size={14} /> {open ? '关闭历史' : '打开通知历史'}
          <kbd className="nh-kbd">N</kbd>
        </button>
        <p className="nh-trigger-note">
          按 <kbd className="nh-kbd">N</kbd> 打开／关闭 · <kbd className="nh-kbd">Esc</kbd> 关闭并归还焦点 · 历史只读
        </p>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={dialogRef}
            className="nh-dialog"
            role="dialog"
            aria-modal="false"
            aria-label="通知历史"
            tabIndex={-1}
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="nh-head">
              <div>
                <span className="nh-kicker">
                  通知历史
                </span>
                <h3 className="nh-title">已归档 {HISTORY.length} 条 · 只读</h3>
              </div>
              <button className="nh-close" aria-label="关闭通知历史" onClick={closeHistory}>
                <X size={15} />
              </button>
            </div>

            <div className="nh-tabs" role="tablist" aria-label="历史时间分组">
              {GROUPS.map((g) => {
                const count = HISTORY.filter((h) => h.group === g.id).length
                return (
                  <button
                    key={g.id}
                    role="tab"
                    aria-selected={group === g.id}
                    className={`nh-tab ${group === g.id ? 'is-active' : ''}`}
                    onClick={() => changeGroup(g.id)}
                  >
                    {g.label}
                    <span className="nh-tab-count">{count}</span>
                  </button>
                )
              })}
            </div>

            <div className="nh-list" role="list" aria-label={`${GROUPS.find((x) => x.id === group)?.label}的通知`}>
              {entries.length === 0 && <p className="nh-empty">该分组暂无通知（mock）</p>}
              {entries.map((item) => {
                const meta = KIND_META[item.kind]
                const Icon = meta.icon
                const active = item.notificationId === selectedId
                return (
                  <div key={item.notificationId} role="listitem">
                    <button
                      className={`nh-row nh-tone-${meta.tone} ${active ? 'is-open' : ''}`}
                      onClick={() => selectEntry(item)}
                      aria-expanded={active}
                    >
                      <span className={`nh-row-icon nh-prio-${item.priority}`}>
                        <Icon size={15} />
                      </span>
                      <span className="nh-row-main">
                        <span className="nh-row-title">{item.title}</span>
                        <span className="nh-row-meta">
                          <span className="nh-chip">{meta.label}</span>
                          <span className={`nh-chip nh-prio-chip nh-prio-${item.priority}`}>优先级·{PRIORITY_LABEL[item.priority]}</span>
                          {item.stackCount && item.stackCount > 1 && (
                            <span className="nh-chip nh-stack">
                              <Layers size={10} /> ×{item.stackCount}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="nh-row-time">{item.occurredAtLabel}</span>
                    </button>
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.div
                          className="nh-detail-wrap"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.24, ease: [0.65, 0, 0.35, 1] }}
                        >
                          <p className="nh-detail">{item.message}</p>
                          <p className="nh-detail-foot">只读记录 · 无法领取、删除或重放 · {item.occurredAtLabel}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>

            <p className="nh-foot">
              历史仅呈现宿主投影，最多同屏 5 条／组，其余滚动查看。关闭与删除是两回事——本面板不改动通知账本。
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sr-only" aria-live="polite">
        {live}
      </div>
    </div>
  )
}
