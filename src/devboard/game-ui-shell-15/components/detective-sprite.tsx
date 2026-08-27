'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { useKeyedSpriteFrames } from '@/hooks/use-keyed-sprite-frames'
import { useAmbientFloat } from '@/hooks/use-ambient-float'

// A state-machine sprite player built from the 16 processed frames in
// public/games/menu/detective/. Rather than looping one static idle clip,
// it plays into the game's own "WakeUp" premise: left alone, the character
// nods off through a drowsy sequence and falls asleep; any interaction
// (hover or click) jolts them back awake through a matching wake-up
// sequence. That state machine — not a single spritesheet loop — is what
// gives the character real presence on the title screen instead of reading
// as a decorative image.
//
// The source sheet still ships on a solid magenta backing plate, so every
// frame is run through the chroma-key pass in lib/chroma-key.ts before it
// is ever drawn — nothing here paints a raw PNG onto the scene. On top of
// that, the whole sprite rides a slow, randomized float/rotate drift (see
// useAmbientFloat) and reacts to pointer proximity, so it reads as a small
// creature drifting in the holographic space rather than pasted map art.
type SpriteState = 'idle' | 'drowsy' | 'asleep' | 'waking'

const IDLE_FRAMES = ['f01', 'f02', 'f01', 'f03', 'f01', 'f04', 'f01', 'f05']
const DROWSY_FRAMES = ['f06', 'f07', 'f08', 'f09', 'f10', 'f12']
const FALL_FRAMES = ['f11']
const ASLEEP_FRAMES = ['f13', 'f14', 'f15', 'f14', 'f13']
const WAKING_FRAMES = ['f16', 'f10', 'f07', 'f01']

const ALL_FRAME_IDS = Array.from(new Set([...IDLE_FRAMES, ...DROWSY_FRAMES, ...FALL_FRAMES, ...ASLEEP_FRAMES, ...WAKING_FRAMES]))

const IDLE_STEP_MS = 420
const DROWSY_STEP_MS = 340
const ASLEEP_STEP_MS = 900
const WAKING_STEP_MS = 150
const IDLE_TIMEOUT_MS = 9000 // how long untouched before nodding off

function frameSrc(id: string) {
  return `/games/menu/detective/${id}.png`
}

const ALL_FRAME_SRCS = ALL_FRAME_IDS.map(frameSrc)

export function DetectiveSprite({ className = '' }: { className?: string }) {
  const [state, setState] = useState<SpriteState>('idle')
  const [frameIndex, setFrameIndex] = useState(0)
  const [nudge, setNudge] = useState(0) // increments to retrigger a wake reaction even if already idle
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Strip the magenta backing plate off every frame once, up front, and hold
  // a silhouette in reserve until that pass finishes so nothing ever flashes
  // the raw keyed color.
  const { frames: keyedFrames, ready: framesReady } = useKeyedSpriteFrames(ALL_FRAME_SRCS)

  // The floating rig owns the ambient drift; the button underneath keeps its
  // own hover/press affordance so click targeting never depends on the
  // drifted position.
  const { ref: floatRef, setPointer } = useAmbientFloat<HTMLDivElement>()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const onPointerMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const px = (e.clientX - rect.left) / rect.width - 0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5
      setPointer(px, py, 1)
    },
    [setPointer],
  )
  const onPointerLeave = useCallback(() => setPointer(0, 0, 0), [setPointer])

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }, [])

  const armIdleTimer = useCallback(() => {
    clearIdleTimer()
    idleTimer.current = setTimeout(() => setState('drowsy'), IDLE_TIMEOUT_MS)
  }, [clearIdleTimer])

  // Drive the frame stepper for whichever sequence the current state maps
  // to. Falling asleep chains drowsy -> a one-shot fall frame -> the asleep
  // loop; waking chains the waking frames -> back to the idle loop.
  useEffect(() => {
    if (stepTimer.current) clearTimeout(stepTimer.current)
    setFrameIndex(0)

    const sequence =
      state === 'idle' ? IDLE_FRAMES : state === 'drowsy' ? DROWSY_FRAMES : state === 'asleep' ? ASLEEP_FRAMES : WAKING_FRAMES
    const stepMs = state === 'idle' ? IDLE_STEP_MS : state === 'drowsy' ? DROWSY_STEP_MS : state === 'asleep' ? ASLEEP_STEP_MS : WAKING_STEP_MS

    let i = 0
    const tick = () => {
      i += 1
      if (state === 'drowsy' && i >= sequence.length) {
        // drowsy sequence finished nodding off -> play the single fall frame
        // briefly, then settle into the asleep loop.
        setState('asleep')
        return
      }
      if (state === 'waking' && i >= sequence.length) {
        setState('idle')
        armIdleTimer()
        return
      }
      setFrameIndex(i % sequence.length)
      stepTimer.current = setTimeout(tick, stepMs)
    }
    stepTimer.current = setTimeout(tick, stepMs)

    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current)
    }
  }, [state, armIdleTimer])

  // On mount, start the idle-timeout countdown toward drowsiness.
  useEffect(() => {
    armIdleTimer()
    return clearIdleTimer
  }, [armIdleTimer, clearIdleTimer])

  const wake = useCallback(() => {
    if (state === 'drowsy' || state === 'asleep') {
      setState('waking')
    } else {
      // already awake — just reset the countdown and give a tiny reaction
      // pulse so hovering still reads as "noticed", not inert.
      setNudge((n) => n + 1)
      armIdleTimer()
    }
  }, [state, armIdleTimer])

  const currentSequence =
    state === 'idle' ? IDLE_FRAMES : state === 'drowsy' ? DROWSY_FRAMES : state === 'asleep' ? ASLEEP_FRAMES : WAKING_FRAMES
  const frameId = currentSequence[frameIndex] ?? currentSequence[0]
  const isLying = state === 'asleep' || (state === 'drowsy' && frameIndex >= DROWSY_FRAMES.length - 1)
  const rawSrc = frameSrc(frameId)
  const keyedSrc = keyedFrames[rawSrc]

  return (
    <div
      ref={(el) => {
        floatRef.current = el
        rootRef.current = el
      }}
      className={`ds-float-rig ${framesReady ? 'is-keyed' : ''}`}
      onMouseMove={onPointerMove}
      onMouseLeave={onPointerLeave}
    >
      <span className="ds-float-glow" aria-hidden="true" />
      <button
        type="button"
        className={`ds-root ${className} ds-state-${state} ${isLying ? 'ds-lying' : ''}`}
        style={{ '--ds-nudge': nudge % 2 } as CSSProperties}
        onMouseEnter={wake}
        onClick={wake}
        aria-label={state === 'asleep' || state === 'drowsy' ? '轻触以唤醒角色' : '角色待命中'}
      >
        <span className="ds-shadow" aria-hidden="true" />
        {/* Until the chroma-key pass resolves, hold a dim silhouette instead
            of the raw magenta-backed frame — this only shows for one frame
            of work on first mount, since results are cached module-wide. */}
        {!framesReady && <span className="ds-silhouette" aria-hidden="true" />}
        {keyedSrc && (
          // No `key` here on purpose: keying by frameId would force React to
          // unmount/remount this <img> on every frame step instead of just
          // swapping `src` in place, which is what produced the flicker.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keyedSrc} alt="" className="ds-frame" draggable={false} />
        )}
        {(state === 'asleep' || (state === 'drowsy' && frameIndex >= 3)) && (
          <span className="ds-zzz" aria-hidden="true">
            z z z
          </span>
        )}
      </button>
    </div>
  )
}
