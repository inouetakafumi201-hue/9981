'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, ChevronDown, Radio, Sparkles, X } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

export type NoticeVariant = 'announcement' | 'event'

const COPY: Record<NoticeVariant, { icon: typeof Radio; kicker: string; headline: string; detail: string }> = {
  announcement: {
    icon: Radio,
    kicker: '公告',
    headline: '「深潜网络」信号强度提升 12%，请留意锚定导流仪的连接状态。',
    detail: '本次维护已完成对深潜网络中继节点的重新校准。若连接后仍出现延迟波动，可尝试重新建立锚定连接；异常情况将在下一轮广播中同步。',
  },
  event: {
    icon: Sparkles,
    kicker: '活动',
    headline: '限时活动「回声潮汐」现已开启，参与匹配可获得额定加成。',
    detail: '活动期间，完成任意一场匹配都会记录一次「潮汐印记」。占位说明——具体奖励与结算规则尚未接入，仅用于展示横幅与展开详情的交互形态。',
  },
}

/**
 * Passive banner with two semantic tones (announcement=cyan/blue,
 * event=orange/gold). Clicking expands an inline detail block via
 * height animation — not a modal — and can be dismissed independently.
 */
export function NoticeBroadcast({
  variant,
  onClose,
}: {
  variant: NoticeVariant
  onClose?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { icon: Icon, kicker, headline, detail } = COPY[variant]

  return (
    <motion.div
      className={`nb-banner nb-${variant}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      <button
        className="nb-summary"
        onClick={() => {
          setExpanded((v) => !v)
          playSfx('ui-confirm')
        }}
        aria-expanded={expanded}
      >
        <Icon size={14} className="nb-icon" />
        <span className="nb-kicker">
          {kicker} <span className="mock-tag">MOCK</span>
        </span>
        <span className="nb-headline">{headline}</span>
        <ChevronDown size={14} className={`nb-chevron ${expanded ? 'is-open' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="nb-detail-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.65, 0, 0.35, 1] }}
          >
            <div className="nb-detail">
              <CalendarClock size={12} />
              <p>{detail}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {onClose && (
        <button className="nb-close" aria-label="关闭公告" onClick={onClose}>
          <X size={13} />
        </button>
      )}
    </motion.div>
  )
}
