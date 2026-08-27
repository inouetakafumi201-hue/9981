'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BedDouble } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'
import { TransitionAdvanceGate } from '@/components/transition-advance-gate'
import type { ShellRouteTransition } from '@/lib/shell-route'

/**
 * A single full-screen ceremony with two directions:
 *   enter-dream:  bed resolves in -> figure+bed go pure white -> colour
 *                 returns -> figure leaps free
 *   return-home:  figure goes pure white first -> the white sweeps back onto
 *                 the bed -> colour returns -> a short "waking up" beat
 *
 * V0-11 rework. Previously the last phase timer called `onComplete()`, which
 * navigated. That made "the animation ended" and "the host accepted the move"
 * the same event — the exact confusion the extraction contract forbids. Now:
 *
 *   final phase  -> `settled` (a presentation fact) -> unlocks the gate
 *   gate button  -> `onAdvance()` -> the router submits the transition
 *
 * Skip, Escape and reduced-motion all land on the same settled final state and
 * never advance. The two directions are separate motion contracts
 * (`dream.enter-white` / `dream.return-white`), not one shared fade.
 */
type Mode = 'enter-dream' | 'return-home'
type Phase = 0 | 1 | 2 | 3

const DURATIONS = [900, 1000, 700, 900] // ms per phase
const MOTION_IDS: Record<Mode, string> = {
  'enter-dream': 'dream.enter-white',
  'return-home': 'dream.return-white',
}

export function TransitionDream({
  mode,
  onAdvance,
  advanceLabel,
  transition,
  onRetry,
  onSafeReturn,
  onSettled,
  reducedMotion = false,
}: {
  mode: Mode
  onAdvance: () => void
  advanceLabel: string
  transition?: ShellRouteTransition
  onRetry?: () => void
  onSafeReturn?: () => void
  onSettled?: (semanticId: string) => void
  reducedMotion?: boolean
}) {
  const [phase, setPhase] = useState<Phase>(reducedMotion ? 3 : 0)
  const [settled, setSettled] = useState(reducedMotion)
  const [settleReason, setSettleReason] = useState<string | undefined>(
    reducedMotion ? '已按减少动效直接落到纯白显形终态，信息未丢失。' : undefined,
  )
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const settle = useCallback(
    (reason: string) => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      setPhase(3)
      setSettled(true)
      setSettleReason(reason)
      onSettled?.(MOTION_IDS[mode])
    },
    [mode, onSettled],
  )

  useEffect(() => {
    if (reducedMotion) {
      onSettled?.(MOTION_IDS[mode])
      return
    }
    playSfx(mode === 'enter-dream' ? 'dream-enter' : 'dream-exit')
    let elapsed = 0
    DURATIONS.forEach((d, i) => {
      elapsed += d
      timers.current.push(
        setTimeout(() => {
          // The last timer settles the motion. It does NOT navigate.
          if (i === DURATIONS.length - 1) settle('纯白显形已落终态。转移需要显式确认。')
          else setPhase((i + 1) as Phase)
        }, elapsed),
      )
    })
    return () => timers.current.forEach(clearTimeout)
  }, [mode, reducedMotion, settle, onSettled])

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

  const isEnter = mode === 'enter-dream'
  const figureLit = isEnter ? phase >= 2 : phase < 1
  const whiteout = phase === 1

  return (
    <div className="td-scene">
      <div className="td-backdrop" aria-hidden="true" />
      <div className="td-vignette" aria-hidden="true" />

      <div className="td-stage">
        <motion.div
          className="td-bed"
          initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.5 }}
        >
          <BedDouble size={30} strokeWidth={1.2} />
        </motion.div>

        <motion.div
          className={`td-figure ${figureLit ? 'is-lit' : 'is-dim'} ${phase === 3 ? (isEnter ? 'is-leaping' : 'is-settling') : ''}`}
          animate={phase === 3 ? (isEnter ? { y: -26, opacity: 0 } : { y: [8, 0], opacity: 1 }) : {}}
          transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <AnimatePresence>
        {whiteout && (
          <motion.div
            className="td-whiteout"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          />
        )}
      </AnimatePresence>

      {/* The semantic final state, always present once settled — the pure-white
          ceremony is never the only carrier of the phase information. */}
      <div className="td-caption">
        <span className="kicker">{isEnter ? '进入造梦' : '返回驻地'}</span>
        <span className="td-phase-label">
          {settled ? '纯白显形 · 终态' : `阶段 ${phase + 1} / ${DURATIONS.length}`}
        </span>
      </div>

      {!settled && (
        <button className="td-skip" onClick={() => settle('已跳过演出并落到终态。跳过不等于转移被确认。')}>
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
