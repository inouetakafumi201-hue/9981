'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MapPin, RotateCcw, SkipForward } from 'lucide-react'
import { useReducedMotion } from '@/lib/shell-a11y'
import { LOCATION_FIXTURE } from '@/lib/progress-fixtures'
import { AssetSlot } from './shell-primitives'

/**
 * V0-04 / V0-08 — the centred location-title performance as its own page.
 *
 * Motion contract:
 *  - `normal` plays the staged reveal.
 *  - `reduced-motion` renders the final state immediately.
 *  - `skip` and `asset-missing` also land on that same final state.
 *  - Nothing here advances the journey: the performance only reports arrival.
 *
 * A-301 (the graphical title asset) is not delivered, so the title renders as
 * readable text through `AssetSlot`'s labelled fallback rather than pretending
 * the art exists.
 */
export function LocationTitle({
  reducedMotionOverride,
  assetFailure = false,
}: {
  reducedMotionOverride?: boolean
  assetFailure?: boolean
}) {
  const reduced = useReducedMotion(reducedMotionOverride)
  const [phase, setPhase] = useState<'playing' | 'final'>(reduced ? 'final' : 'playing')
  const [runId, setRunId] = useState(0)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) { setPhase('final'); return }
    setPhase('playing')
    timer.current = window.setTimeout(() => setPhase('final'), 1800)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [reduced, runId])

  const skip = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setPhase('final')
  }

  return (
    <section className="lt-stage" aria-label="地点标题演出">
      <div className="lt-backdrop" aria-hidden="true" />

      <AnimatePresence mode="wait">
        <motion.div
          key={`${runId}-${phase}-${reduced ? 'reduced' : 'normal'}`}
          className="lt-title-block"
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 18, letterSpacing: '0.4em' }}
          animate={{ opacity: 1, y: 0, letterSpacing: '0.16em' }}
          transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="lt-eyebrow"><MapPin size={12} /> ARRIVAL</span>
          <AssetSlot assetId="A-301" className="lt-asset" forceFailure={assetFailure}>
            <span className="lt-asset-note">标题以可读文本排版渲染。</span>
          </AssetSlot>
          <h1 className="lt-title">{LOCATION_FIXTURE.title}</h1>
          <span className="lt-subtitle">{LOCATION_FIXTURE.subtitle}</span>
          <p className="lt-note">{LOCATION_FIXTURE.note}</p>
          <span className="lt-rule" aria-hidden="true" />
        </motion.div>
      </AnimatePresence>

      <div className="sr-only" aria-live="polite">
        {phase === 'playing' ? `正在进入 ${LOCATION_FIXTURE.title}` : `已抵达 ${LOCATION_FIXTURE.title}`}
      </div>

      <div className="lt-tools">
        <span className={`lt-phase is-${phase}`}>{phase === 'playing' ? '演出中' : '静态最终状态'}{reduced ? ' · 减少动效' : ''}</span>
        <button onClick={skip} disabled={phase === 'final'}><SkipForward size={12} /> 跳过演出</button>
        <button onClick={() => setRunId((value) => value + 1)}><RotateCcw size={12} /> 重播</button>
      </div>

    </section>
  )
}
