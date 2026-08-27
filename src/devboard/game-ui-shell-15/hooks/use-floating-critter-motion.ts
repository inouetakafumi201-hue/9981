'use client'

import { useEffect, useRef, useState } from 'react'
import type { PerfTier } from './use-perf-tier'

// Drives one ambient menu-background character instance: a bounded,
// continuous Lissajous-style wander inside its own "home" ellipse (so it
// never needs to teleport across the screen — the curve simply loops), a
// free-running slow self-rotation, a pointer-proximity boost, a subtle
// parallax lean toward the cursor, and an imperative `pulse()` for the
// click-triggered elastic bounce. Everything is written straight to the
// element's inline style from a single rAF loop — no React state per
// frame — so this never re-renders the tree while it animates.
//
// Position math is exposed via `sampleAt(tMs)` so the caller (the trailing
// after-image echoes) can ask "where was this instance N ms ago" using the
// exact same closed-form curve, instead of recording a position history.
export type CritterRegion = { cx: number; cy: number; rx: number; ry: number }

export type FloatingCritterMotionOptions = {
  region: CritterRegion // home ellipse, in percent of the field container
  depthIndex: number // 0 = nearest/front, higher = further back
  tier: PerfTier
  containerEl: HTMLElement | null // receives the real mousemove/mouseleave listeners
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export function useFloatingCritterMotion<T extends HTMLElement>({
  region,
  depthIndex,
  tier,
  containerEl,
}: FloatingCritterMotionOptions) {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)

  // Stable per-instance randomization, regenerated only if the tier changes
  // (e.g. a live prefers-reduced-motion toggle), never on every render.
  const paramsRef = useRef(makeParams(tier, depthIndex))
  paramsRef.current = paramsRef.current // keep referential stability across renders
  useEffect(() => {
    paramsRef.current = makeParams(tier, depthIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier])

  const pointerRef = useRef({ xPct: -1, yPct: -1, active: 0 })
  const pulseStartRef = useRef<number | null>(null)
  const nearAmountRef = useRef(0)

  useEffect(() => {
    if (!containerEl) return
    const onMove = (e: MouseEvent) => {
      const rect = containerEl.getBoundingClientRect()
      pointerRef.current = {
        xPct: ((e.clientX - rect.left) / rect.width) * 100,
        yPct: ((e.clientY - rect.top) / rect.height) * 100,
        active: 1,
      }
    }
    const onLeave = () => {
      pointerRef.current = { ...pointerRef.current, active: 0 }
    }
    containerEl.addEventListener('mousemove', onMove)
    containerEl.addEventListener('mouseleave', onLeave)
    return () => {
      containerEl.removeEventListener('mousemove', onMove)
      containerEl.removeEventListener('mouseleave', onLeave)
    }
  }, [containerEl])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const start = performance.now()
    let lastT = start
    let lastNear = false
    let raf = 0

    const tick = (now: number) => {
      const t = now - start
      const dt = now - lastT
      lastT = now
      const p = paramsRef.current

      // Free-running slow self-rotation; boosted while a cursor lingers
      // nearby so proximity reads as "it noticed you" rather than static.
      const boost = 1 + nearAmountRef.current * 1.6
      p.rotAngle = (p.rotAngle + p.rotSpeedDegMs * dt * boost) % 360

      const { cx, cy } = sample(p, region, t)

      // Field-relative pointer position, compared in real pixels via the
      // container rect so the 120px proximity threshold means the same
      // thing regardless of the field's percent-space size.
      const rect = containerEl?.getBoundingClientRect()
      let targetNear = false
      let leanX = 0
      let leanY = 0
      if (rect && pointerRef.current.active && p.parallax) {
        const selfPxX = rect.left + (cx / 100) * rect.width
        const selfPxY = rect.top + (cy / 100) * rect.height
        const pointerPxX = rect.left + (pointerRef.current.xPct / 100) * rect.width
        const pointerPxY = rect.top + (pointerRef.current.yPct / 100) * rect.height
        const dx = pointerPxX - selfPxX
        const dy = pointerPxY - selfPxY
        const distPx = Math.hypot(dx, dy)
        targetNear = distPx < (lastNear ? 150 : 120) // small hysteresis band to stop flicker at the boundary

        // Parallax lean: a fraction of the pointer's offset from the field
        // center, capped well under the "<=30% of pointer displacement"
        // ceiling and eased by depth (farther instances lean less).
        const fieldCenterPxX = rect.left + rect.width / 2
        const fieldCenterPxY = rect.top + rect.height / 2
        const offX = pointerPxX - fieldCenterPxX
        const offY = pointerPxY - fieldCenterPxY
        const leanFactor = 0.12 * p.depthLean
        leanX = Math.max(-26, Math.min(26, offX * leanFactor))
        leanY = Math.max(-18, Math.min(18, offY * leanFactor))
      }
      lastNear = targetNear

      // Ease the near-boost in/out instead of snapping, so the accelerated
      // spin/scale ramps rather than jumping.
      const nearTarget = targetNear ? 1 : 0
      nearAmountRef.current += (nearTarget - nearAmountRef.current) * Math.min(1, dt / 220)
      if (targetNear !== near) setNear(targetNear)

      // Click pulse: a 400ms elastic overshoot (1 -> 1.3 -> 0.9 -> 1),
      // purely additive to whatever scale the proximity boost already
      // wants — the wander path itself never reads this.
      let pulseScale = 1
      if (pulseStartRef.current !== null) {
        const e2 = now - pulseStartRef.current
        if (e2 >= 400) {
          pulseStartRef.current = null
        } else {
          const u = e2 / 400
          pulseScale =
            u < 0.35 ? 1 + (0.3 * u) / 0.35 : u < 0.7 ? 1.3 - (0.4 * (u - 0.35)) / 0.35 : 0.9 + (0.1 * (u - 0.7)) / 0.3
        }
      }

      const nearScale = 1 + nearAmountRef.current * 0.1
      const nearLift = -nearAmountRef.current * 8

      el.style.left = `${cx}%`
      el.style.top = `${cy}%`
      el.style.transform = `translate(-50%, -50%) translate(${leanX.toFixed(1)}px, ${(leanY + nearLift).toFixed(1)}px) rotate(${p.rotAngle.toFixed(2)}deg) scale(${(pulseScale * nearScale).toFixed(3)})`

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // region/containerEl are stable per instance for the component's
    // lifetime; tier changes are picked up through paramsRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pulse = () => {
    pulseStartRef.current = performance.now()
  }

  return { ref, near, pulse, sampleTrailAt: (msAgo: number, nowMs: number) => sample(paramsRef.current, region, nowMs - msAgo) }
}

type WanderParams = {
  periodX: number
  periodY: number
  phaseX: number
  phaseY: number
  rotAngle: number
  rotSpeedDegMs: number
  depthLean: number
  parallax: boolean
  bobOnly: boolean
  bobPeriod: number
  bobPhase: number
}

function makeParams(tier: PerfTier, depthIndex: number): WanderParams {
  const depthSlow = 1 + depthIndex * 0.35 // farther instances drift more slowly
  const bobOnly = tier === 'reduced'
  return {
    periodX: rand(18000, 34000) * depthSlow,
    periodY: rand(15000, 28000) * depthSlow,
    phaseX: rand(0, Math.PI * 2),
    phaseY: rand(0, Math.PI * 2),
    rotAngle: rand(0, 360),
    rotSpeedDegMs: bobOnly ? 0 : (360 / (rand(26000, 55000) * depthSlow)) * (rand(0, 1) < 0.5 ? 1 : -1),
    depthLean: Math.max(0.35, 1 - depthIndex * 0.3),
    parallax: tier === 'standard',
    bobOnly,
    bobPeriod: rand(3400, 4800),
    bobPhase: rand(0, Math.PI * 2),
  }
}

function sample(p: WanderParams, region: CritterRegion, t: number) {
  if (p.bobOnly) {
    // reduced-motion: no horizontal wander, no rotation — just a slow,
    // gentle vertical drift so the scene still reads as "alive".
    const cy = region.cy + Math.sin(t / p.bobPeriod + p.bobPhase) * Math.min(region.ry, 5)
    return { cx: region.cx, cy }
  }
  const cx = region.cx + Math.sin(t / p.periodX + p.phaseX) * region.rx
  const cy = region.cy + Math.sin(t / p.periodY + p.phaseY) * region.ry
  return { cx, cy }
}
