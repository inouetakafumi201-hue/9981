'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BedDouble } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

// A single full-screen ceremony with two directions, not a loading spinner:
//   enter-dream:  bed resolves in -> figure+bed go pure white (~1s) -> color
//                 returns -> figure leaps free (hands off to battle-intro)
//   return-home:  figure goes pure white first -> the white sweeps back onto
//                 the bed -> color returns -> a short "waking up" beat, then
//                 hands back to residence-main
// Every phase is a step in one `AnimatePresence` sequence (not a linear
// opacity fade), and the whole thing is skippable — Esc/Enter or the skip
// affordance jumps straight to onComplete with no partial state left behind.
type Mode = 'enter-dream' | 'return-home'
type Phase = 0 | 1 | 2 | 3

const DURATIONS = [900, 1000, 700, 900] // ms per phase, tuned for a brisk but readable ceremony

export function TransitionDream({ mode, onComplete }: { mode: Mode; onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>(0)
  const [skipped, setSkipped] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    playSfx(mode === 'enter-dream' ? 'dream-enter' : 'dream-exit')
    let elapsed = 0
    DURATIONS.forEach((d, i) => {
      elapsed += d
      timers.current.push(
        setTimeout(() => {
          if (i === DURATIONS.length - 1) onComplete()
          else setPhase((i + 1) as Phase)
        }, elapsed),
      )
    })
    return () => timers.current.forEach(clearTimeout)
  }, [mode, onComplete])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'Enter') && !skipped) {
        setSkipped(true)
        timers.current.forEach(clearTimeout)
        onComplete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onComplete, skipped])

  // enter-dream goes person-dim -> whiteout -> person-lit -> leap
  // return-home goes person-lit -> whiteout -> person-dim -> settle
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
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <BedDouble size={30} strokeWidth={1.2} />
        </motion.div>

        <motion.div
          className={`td-figure ${figureLit ? 'is-lit' : 'is-dim'} ${phase === 3 ? (isEnter ? 'is-leaping' : 'is-settling') : ''}`}
          animate={
            phase === 3
              ? isEnter
                ? { y: -26, opacity: 0 }
                : { y: [8, 0], opacity: 1 }
              : {}
          }
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
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

      <div className="td-caption">
        <span className="kicker">{isEnter ? '进入造梦' : '返回驻地'} <span className="mock-tag">MOCK</span></span>
      </div>

      <button
        className="td-skip"
        onClick={() => {
          setSkipped(true)
          timers.current.forEach(clearTimeout)
          onComplete()
        }}
      >
        跳过
      </button>
    </div>
  )
}
