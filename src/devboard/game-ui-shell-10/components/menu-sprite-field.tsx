'use client'

import { useEffect, useRef, useState } from 'react'
import { useKeyedSpriteFrames } from '@/hooks/use-keyed-sprite-frames'
import { usePerfTier } from '@/hooks/use-perf-tier'
import { useFloatingCritterMotion, type CritterRegion } from '@/hooks/use-floating-critter-motion'

// Ambient background layer for the holographic menu screens: 1-3 copies of
// the same 16-frame character sheet, each drifting on its own bounded
// Lissajous wander inside a "home" region, self-rotating slowly, leaning
// toward the cursor, and accelerating/growing when the pointer lingers
// nearby. Clicking one plays a full 16-frame loop and an elastic bounce
// without ever touching its wander path.
//
// This replaces the earlier single-fixed-icon treatment the notes called
// out as reading like a flat, hard-pasted map sprite: instances here are
// chroma-keyed off their magenta backing plate, filtered (blur/brightness/
// contrast) so they never render as a raw PNG, optionally bloom-glowed, and
// trail 1-2 faint motion echoes — all budgeted down per the perf tier.
//
// `containerRef` must point at the scene root that already owns real
// mousemove/mouseleave listeners (or is happy to receive new ones); the
// field itself stays `pointer-events: none` end to end except each
// critter's own small hit target, so it can never intercept clicks or Tab
// navigation meant for the menu's real buttons.
function frameSrc(id: string) {
  return `/games/menu/detective/${id}.png`
}

const IDLE_FRAMES = ['f01', 'f02', 'f01', 'f03', 'f01', 'f04']
const ALL_FRAME_IDS = Array.from({ length: 16 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`)
const ALL_FRAME_SRCS = ALL_FRAME_IDS.map(frameSrc)

// Home regions live in the upper/right portion of the scene, deliberately
// clear of the bottom-left title/nav column (`.mt-content`) so a critter
// drifting through its full ellipse never has a chance to sit over a menu
// button or the title text.
const REGIONS: CritterRegion[] = [
  { cx: 78, cy: 22, rx: 13, ry: 12 }, // upper right, echoes the diagnostic panel's neighborhood
  { cx: 83, cy: 60, rx: 11, ry: 14 }, // right edge, mid-height
  { cx: 50, cy: 14, rx: 18, ry: 7 }, // top band, above the title
]

function Critter({
  region,
  depthIndex,
  tier,
  containerEl,
  keyedFrames,
  framesReady,
}: {
  region: CritterRegion
  depthIndex: number
  tier: 'standard' | 'reduced' | 'low'
  containerEl: HTMLElement | null
  keyedFrames: Record<string, string>
  framesReady: boolean
}) {
  const { ref, near, pulse, sampleTrailAt } = useFloatingCritterMotion<HTMLDivElement>({
    region,
    depthIndex,
    tier,
    containerEl,
  })
  const [frameIndex, setFrameIndex] = useState(0)
  const [bursting, setBursting] = useState(false)
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Idle breathing frames should read as an occasional, lazy blink/shift —
  // not a flip-book. Each instance rolls its own random cadence in the
  // 5-15s range once on mount, and re-rolls a fresh random delay after
  // every step so instances never fall into a shared, noticeable rhythm.
  const burstStepMs = 500 / ALL_FRAME_IDS.length // full 16-frame loop inside ~0.5s
  const nextIdleDelay = useRef(() => 5000 + Math.random() * 10000)

  useEffect(() => {
    const sequence = bursting ? ALL_FRAME_IDS : IDLE_FRAMES
    let i = frameIndex % sequence.length
    const scheduleNext = (delay: number) => {
      stepTimer.current = setTimeout(tick, delay)
    }
    const tick = () => {
      i += 1
      if (bursting && i >= ALL_FRAME_IDS.length) {
        setBursting(false)
        setFrameIndex(0)
        return
      }
      setFrameIndex(i % sequence.length)
      scheduleNext(bursting ? burstStepMs : nextIdleDelay.current())
    }
    scheduleNext(bursting ? burstStepMs : nextIdleDelay.current())
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current)
    }
    // frameIndex intentionally excluded — this effect owns its own stepping
    // and only needs to restart when the sequence itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bursting, burstStepMs])

  const sequence = bursting ? ALL_FRAME_IDS : IDLE_FRAMES
  const frameId = sequence[frameIndex] ?? sequence[0]
  const keyedSrc = keyedFrames[frameSrc(frameId)]

  const depthScale = depthIndex === 0 ? 1 : depthIndex === 1 ? 0.85 : 0.72
  const depthOpacity = depthIndex === 0 ? 1 : depthIndex === 1 ? 0.85 : 0.68
  const showTrail = tier === 'standard'

  const handleClick = () => {
    pulse()
    setBursting(true)
    setFrameIndex(0)
  }

  return (
    <div
      ref={ref}
      className="msf-critter"
      style={{ zIndex: 3 - depthIndex, '--msf-depth-scale': depthScale, '--msf-depth-opacity': depthOpacity } as React.CSSProperties}
    >
      {showTrail && framesReady && (
        <TrailEcho keyedSrc={keyedSrc} sampleTrailAt={sampleTrailAt} msAgo={90} opacity={0.22} scale={depthScale} />
      )}
      {showTrail && framesReady && (
        <TrailEcho keyedSrc={keyedSrc} sampleTrailAt={sampleTrailAt} msAgo={180} opacity={0.14} scale={depthScale} />
      )}
      <button
        type="button"
        tabIndex={-1}
        className={`msf-hit ${near ? 'is-near' : ''} ${tier === 'standard' ? 'has-glow' : ''}`}
        onClick={handleClick}
        aria-label="漂浮的角色剪影，点击可与其互动"
      >
        <span className="msf-pad" aria-hidden="true" />
        <span className="msf-glow" aria-hidden="true" />
        {!framesReady && <span className="msf-silhouette" aria-hidden="true" />}
        {keyedSrc && (
          <span className="msf-frame-wrap">
            {/* No `key={frameId}`: that forces a remount per frame step
                instead of an in-place `src` swap and is the source of the
                flicker on these ambient critters. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={keyedSrc} alt="" className="msf-frame" draggable={false} />
            {/* Scanline sweep masked to this exact frame's alpha silhouette,
                so the holo texture rides the pixel shape instead of tinting
                a rectangle behind it — the piece that welds the character
                sheet into the same console-glass language as the rest of
                the screen. */}
            <span className="msf-scan" aria-hidden="true" style={{ '--msf-mask': `url(${JSON.stringify(keyedSrc)})` } as React.CSSProperties} />
          </span>
        )}
      </button>
    </div>
  )
}

// A faint after-image sampled from the exact same closed-form wander curve
// at an earlier timestamp — no position history buffer needed, since the
// curve is deterministic in time. Purely decorative; never interactive.
function TrailEcho({
  keyedSrc,
  sampleTrailAt,
  msAgo,
  opacity,
  scale,
}: {
  keyedSrc: string | undefined
  sampleTrailAt: (msAgo: number, nowMs: number) => { cx: number; cy: number }
  msAgo: number
  opacity: number
  scale: number
}) {
  const ref = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      const el = ref.current
      if (el) {
        const { cx, cy } = sampleTrailAt(msAgo, now)
        el.style.left = `${cx}%`
        el.style.top = `${cy}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [msAgo, sampleTrailAt])
  if (!keyedSrc) return null
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      ref={ref}
      src={keyedSrc}
      alt=""
      aria-hidden="true"
      className="msf-trail"
      draggable={false}
      style={{ opacity, transform: `translate(-50%, -50%) scale(${scale})` }}
    />
  )
}

export function MenuSpriteField({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const tier = usePerfTier()
  const { frames: keyedFrames, ready: framesReady } = useKeyedSpriteFrames(ALL_FRAME_SRCS)
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setContainerEl(containerRef.current)
  }, [containerRef])

  const instanceCount = tier === 'low' ? 1 : tier === 'reduced' ? 2 : 3
  const regions = REGIONS.slice(0, instanceCount)

  return (
    <div className="msf-field" aria-hidden="true">
      {regions.map((region, i) => (
        <Critter
          key={i}
          region={region}
          depthIndex={i}
          tier={tier}
          containerEl={containerEl}
          keyedFrames={keyedFrames}
          framesReady={framesReady}
        />
      ))}
    </div>
  )
}
