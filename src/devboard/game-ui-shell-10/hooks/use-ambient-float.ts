'use client'

import { useEffect, useRef } from 'react'

/**
 * Among Us-style "floating in space" motion for a character sprite: a slow
 * bobbing/drifting orbit plus a gentle rotation, both riding on top of
 * whatever the caller's own transforms already do (bounce, hover-scale,
 * parallax). Every parameter is randomized once per mount inside a small,
 * intentionally narrow band — so no two sessions (and, if this is ever
 * reused for a second character, no two characters) drift identically, but
 * the motion always stays a light accent rather than something that fights
 * for attention.
 *
 * Pure rAF + direct style writes on a ref: no React state, so the drift
 * never triggers a re-render, and the amplitude is randomized client-side
 * only (after mount) so server and client markup still match for hydration.
 *
 * Pointer proximity (measured from the element's own bounding box, reported
 * by the caller as normalized -0.5..0.5 offsets) adds a small responsive
 * lean+lift on top of the ambient drift, so the sprite reads as reactive to
 * the cursor without ever fighting the click target underneath it.
 */
export function useAmbientFloat<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const pointer = useRef({ px: 0, py: 0, active: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const rand = (min: number, max: number) => min + Math.random() * (max - min)
    const params = {
      driftX: rand(5, 11), // px, horizontal wander amplitude
      driftY: rand(7, 14), // px, vertical bob amplitude
      rotate: rand(1.6, 3.4), // deg, gentle tilt amplitude
      periodX: rand(6200, 8600), // ms per horizontal cycle
      periodY: rand(3400, 4600), // ms per vertical cycle
      periodR: rand(5200, 7400), // ms per rotation cycle
      phase: rand(0, Math.PI * 2),
    }

    let raf = 0
    const start = performance.now() + params.phase * 400

    const tick = (now: number) => {
      const t = now - start
      const driftX = Math.sin((t / params.periodX) * Math.PI * 2) * params.driftX
      const driftY = Math.sin((t / params.periodY) * Math.PI * 2) * params.driftY
      const rotate = Math.sin((t / params.periodR) * Math.PI * 2) * params.rotate

      const { px, py, active } = pointer.current
      const leanX = px * 10 * active
      const leanY = py * 6 * active

      el.style.setProperty('--float-x', `${(driftX + leanX).toFixed(2)}px`)
      el.style.setProperty('--float-y', `${(driftY + leanY).toFixed(2)}px`)
      el.style.setProperty('--float-r', `${(rotate + px * 2.5 * active).toFixed(2)}deg`)

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Caller feeds normalized pointer offsets (-0.5..0.5) relative to the
  // floating element itself; `active` eases in/out so the lean doesn't snap
  // the instant the cursor crosses the hit area's edge.
  const setPointer = (px: number, py: number, active: number) => {
    pointer.current = { px, py, active }
  }

  return { ref, setPointer }
}
