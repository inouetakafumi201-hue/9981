'use client'

import { useEffect, useRef, useState } from 'react'
import { useKeyedSpriteFrames } from '@/hooks/use-keyed-sprite-frames'
import { usePerfTier, type PerfTier } from '@/hooks/use-perf-tier'
import { useCritterRoam, type ComicBeat, type RoamActorSpec } from '@/hooks/use-critter-roam'
import { useMenuSignal } from '@/lib/menu-signal-bus'

// ---------------------------------------------------------------------------
// Second narrative layer: the cast still roams the air, but it is now a cast
// with declared roles rather than sprites sprinkled around an orbit.
//
//   primary   — one actor, clearest silhouette, mid-low brightness
//   secondary — two actors parked outside the rift, dimmer
//   echo      — after-images that only materialise while a pulse is passing
//
// Salience is strictly below the core, the title and the focused row. A comic
// beat may lift an actor briefly, then it drops back to its own tier. Safe
// zones, deterministic seeding and beat floor control all live in
// use-critter-roam.ts; this file owns only the sprite surface.
// ---------------------------------------------------------------------------

function frameSrc(id: string) {
  return `/games/menu/detective/${id}.png`
}

const IDLE_FRAMES = ['f01', 'f02', 'f01', 'f03', 'f01', 'f04']
const ALL_FRAME_IDS = Array.from({ length: 16 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`)
const ALL_FRAME_SRCS = ALL_FRAME_IDS.map(frameSrc)

// Every gag has a declared end pose, so a beat cut short by an overlay, a
// suppression or an unmount still leaves a legible static frame.
const BEAT_POSE: Record<ComicBeat, string> = {
  'brake-and-swerve': 'f09',
  'bounced-by-scan': 'f12',
  'reverse-cruise': 'f06',
  'yield-to-peer': 'f05',
  'peek-at-menu': 'f14',
  'forgot-direction': 'f07',
  'drop-and-chase': 'f11',
  'wrong-orbit-relock': 'f10',
}

const ACTORS: RoamActorSpec[] = [
  {
    actorId: 'lead-signal-witness',
    spriteId: 'detective',
    lane: 'right-edge',
    seed: 20240617,
    speed: 4.6,
    direction: 1,
    scale: 1,
    opacity: 0.82,
    glowGain: 0.18,
    role: 'primary',
    comicBeats: ['brake-and-swerve', 'forgot-direction', 'drop-and-chase', 'wrong-orbit-relock'],
  },
  {
    actorId: 'upper-drifter',
    spriteId: 'detective',
    lane: 'upper-right',
    seed: 9911237,
    speed: 5.4,
    direction: -1,
    scale: 0.78,
    opacity: 0.5,
    glowGain: 0.3,
    role: 'secondary',
    comicBeats: ['bounced-by-scan', 'reverse-cruise', 'yield-to-peer', 'forgot-direction'],
  },
  {
    actorId: 'low-scout',
    spriteId: 'detective',
    lane: 'lower-far',
    seed: 4457301,
    speed: 3.8,
    direction: 1,
    scale: 0.62,
    opacity: 0.42,
    glowGain: 0.34,
    role: 'secondary',
    comicBeats: ['peek-at-menu', 'yield-to-peer', 'brake-and-swerve'],
  },
  {
    actorId: 'pulse-echo',
    spriteId: 'detective',
    lane: 'outer-ring',
    seed: 7730015,
    speed: 6.8,
    direction: -1,
    scale: 0.52,
    opacity: 0.04,
    glowGain: 0.92,
    role: 'echo',
    comicBeats: ['reverse-cruise', 'wrong-orbit-relock'],
  },
]

function Actor({
  spec,
  tier,
  containerEl,
  keyedFrames,
  framesReady,
}: {
  spec: RoamActorSpec
  tier: PerfTier
  containerEl: HTMLElement | null
  keyedFrames: Record<string, string>
  framesReady: boolean
}) {
  const bus = useMenuSignal()
  const { ref, beat, state, near, pop, shard, trailAt } = useCritterRoam<HTMLDivElement>({
    spec,
    tier,
    containerEl,
    bus,
  })
  const [frameIndex, setFrameIndex] = useState(0)
  const [bursting, setBursting] = useState(false)
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Idle frames breathe on a lazy, per-instance cadence. A click runs the
  // full 16-frame sheet fast — the "click to snap through poses" interaction
  // is kept exactly as it was, it is only the flight logic underneath that
  // changed.
  const burstStepMs = 500 / ALL_FRAME_IDS.length
  const nextIdleDelay = useRef(() => 5000 + ((spec.seed % 97) / 97) * 9000)

  useEffect(() => {
    if (beat) return // a gag holds one declared pose instead of cycling
    const sequence = bursting ? ALL_FRAME_IDS : IDLE_FRAMES
    let i = 0
    const tick = () => {
      i += 1
      if (bursting && i >= ALL_FRAME_IDS.length) {
        setBursting(false)
        setFrameIndex(0)
        return
      }
      setFrameIndex(i % sequence.length)
      stepTimer.current = setTimeout(tick, bursting ? burstStepMs : nextIdleDelay.current())
    }
    stepTimer.current = setTimeout(tick, bursting ? burstStepMs : nextIdleDelay.current())
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current)
    }
  }, [bursting, burstStepMs, beat])

  const sequence = bursting ? ALL_FRAME_IDS : IDLE_FRAMES
  const frameId = beat ? BEAT_POSE[beat] : (sequence[frameIndex] ?? sequence[0])
  const keyedSrc = keyedFrames[frameSrc(frameId)]
  const showTrail = tier === 'standard' && spec.role !== 'echo'

  return (
    <>
      {/* The echoes are *siblings* of the critter, not children: trailAt()
          returns field-space percentages, so nesting them inside the critter
          would resolve those percentages against the critter's own box and
          pile every ghost on top of the sprite as one smear. */}
      {showTrail && framesReady && <TrailEcho keyedSrc={keyedSrc} trailAt={trailAt} msAgo={120} opacity={0.16} />}
      {showTrail && framesReady && <TrailEcho keyedSrc={keyedSrc} trailAt={trailAt} msAgo={240} opacity={0.08} />}
      <div
        ref={ref}
        className="msf-critter"
        data-role={spec.role}
        data-state={state}
        data-beat={beat ?? 'none'}
        style={{ zIndex: spec.role === 'primary' ? 3 : spec.role === 'secondary' ? 2 : 1 }}
      >
        <button
          type="button"
          tabIndex={-1}
          className={`msf-hit ${near ? 'is-near' : ''} ${tier === 'standard' ? 'has-glow' : ''}`}
          onClick={() => {
            pop()
            setFrameIndex(0)
            setBursting(true)
          }}
          aria-label="空中漫游的角色，点击可切换姿态"
        >
          <span className="msf-glow" aria-hidden="true" />
          {!framesReady && <span className="msf-silhouette" aria-hidden="true" />}
          {keyedSrc && (
            <span className="msf-frame-wrap">
              {/* No `key` on the img: a per-frame remount is what made these
                  ambient actors flicker. The src swaps in place. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={keyedSrc} alt="" className="msf-frame" draggable={false} />
              <span
                className="msf-scan"
                aria-hidden="true"
                style={{ '--msf-mask': `url(${JSON.stringify(keyedSrc)})` } as React.CSSProperties}
              />
            </span>
          )}
        </button>
      </div>
      {shard && <span className="msf-shard" style={{ left: `${shard.x}%`, top: `${shard.y}%` }} aria-hidden="true" />}
    </>
  )
}

// Faint after-image sampled from the flight loop's own short position ring
// buffer. Purely decorative, never interactive, and it stops sampling the
// moment the parent unmounts.
function TrailEcho({
  keyedSrc,
  trailAt,
  msAgo,
  opacity,
}: {
  keyedSrc: string | undefined
  trailAt: (msAgo: number) => { x: number; y: number } | null
  msAgo: number
  opacity: number
}) {
  const ref = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = ref.current
      const p = trailAt(msAgo)
      if (el && p) {
        el.style.left = `${p.x}%`
        el.style.top = `${p.y}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [msAgo, trailAt])
  if (!keyedSrc) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={keyedSrc} alt="" aria-hidden="true" className="msf-trail" draggable={false} style={{ opacity }} />
}

export function MenuSpriteField({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const tier = usePerfTier()
  const { frames: keyedFrames, ready: framesReady } = useKeyedSpriteFrames(ALL_FRAME_SRCS)
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setContainerEl(containerRef.current)
  }, [containerRef])

  // low tier keeps the primary only; reduced keeps primary + one secondary
  // holding a static readable pose, so the spatial hierarchy never collapses.
  const cast = tier === 'low' ? ACTORS.slice(0, 1) : tier === 'reduced' ? ACTORS.slice(0, 2) : ACTORS

  return (
    <div className="msf-field" aria-hidden="true">
      {cast.map((spec) => (
        <Actor
          key={spec.actorId}
          spec={spec}
          tier={tier}
          containerEl={containerEl}
          keyedFrames={keyedFrames}
          framesReady={framesReady}
        />
      ))}
    </div>
  )
}
