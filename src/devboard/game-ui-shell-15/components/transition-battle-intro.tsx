'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, ShieldAlert, Swords, Users } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'
import { TransitionAdvanceGate } from '@/components/transition-advance-gate'
import type { ShellRouteTransition } from '@/lib/shell-route'

// Full-screen ceremony that stands between residence and the live HUD — mock
// map name + a couple of ruleset callouts staged as floating cards over the
// same holographic light language as the title screen, not a boxy loading
// grid.
//
// V0-11 rework (matching transition-dream.tsx): the beat settling was
// previously the same event as navigation — the timer, Escape, Enter and the
// skip button all called `onComplete()` directly. That collapses "the
// ceremony reached its final frame" (a presentation fact) into "the host
// accepted the transition" (a router fact). Now the beat only sets `settled`;
// only `TransitionAdvanceGate`'s button calls `onAdvance`, which is the sole
// thing that submits the transition through the router.
const CALLOUTS = [
  { icon: MapPin, label: '地图', value: '断潮矿脊 · 第 7 区' },
  { icon: Users, label: '编队', value: '3v3 · 竞技' },
  { icon: ShieldAlert, label: '规则', value: '标准回合 · 无重开' },
]

export function TransitionBattleIntro({
  onAdvance,
  advanceLabel = '确认进入对局',
  transition,
  onRetry,
  onSafeReturn,
  reducedMotion = false,
}: {
  onAdvance: () => void
  advanceLabel?: string
  transition?: ShellRouteTransition
  onRetry?: () => void
  onSafeReturn?: () => void
  reducedMotion?: boolean
}) {
  const [settled, setSettled] = useState(reducedMotion)
  const [settleReason, setSettleReason] = useState<string | undefined>(
    reducedMotion ? '已按减少动效直接落到终态，信息未丢失。' : undefined,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const settle = useCallback((reason: string) => {
    clearTimeout(timer.current)
    setSettled(true)
    setSettleReason(reason)
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    playSfx('battle-intro')
    timer.current = setTimeout(() => settle('对局前奏已落终态。转移需要显式确认。'), 2600)
    return () => clearTimeout(timer.current)
  }, [reducedMotion, settle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'Enter') && !settled) {
        e.preventDefault()
        settle('已跳过演出并落到终态。跳过不等于转移被确认。')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settle, settled])

  return (
    <div className="tbi-scene">
      <div className="tbi-backdrop" aria-hidden="true" />
      <div className="tbi-rays" aria-hidden="true" />

      <motion.div
        className="tbi-emblem"
        initial={{ opacity: reducedMotion ? 1 : 0, scale: reducedMotion ? 1 : 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <Swords size={26} strokeWidth={1.3} />
      </motion.div>

      <motion.h2
        className="tbi-title"
        initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reducedMotion ? 0 : 0.15, duration: reducedMotion ? 0 : 0.5 }}
      >
        对局即将开始
      </motion.h2>

      <div className="tbi-callouts">
        {CALLOUTS.map(({ icon: Icon, label, value }, i) => (
          <motion.div
            key={label}
            className="tbi-callout"
            initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reducedMotion ? 0 : 0.3 + i * 0.12, duration: reducedMotion ? 0 : 0.45 }}
          >
            <Icon size={14} />
            <div>
              <span className="tbi-callout-label">{label}</span>
              <span className="tbi-callout-value">{value}</span>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="tbi-caption">
        <span className="td-phase-label">{settled ? '前奏 · 终态' : '前奏演出中…'}</span>
      </div>

      {!settled && (
        <button className="tbi-skip" onClick={() => settle('已跳过演出并落到终态。跳过不等于转移被确认。')}>
          跳过
        </button>
      )}

      <TransitionAdvanceGate
        settled={settled}
        label={advanceLabel}
        onAdvance={onAdvance}
        transition={transition}
        onRetry={onRetry}
        onSafeReturn={onSafeReturn}
        settleReason={settleReason}
      />
    </div>
  )
}
