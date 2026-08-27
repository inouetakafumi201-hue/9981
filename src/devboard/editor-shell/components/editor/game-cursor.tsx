'use client'

import { useEffect, useRef } from 'react'

/**
 * Replaces the system arrow with a sci-fi reticle: an outer rotating ring,
 * a tight crosshair core, and a soft trailing glow. Position is driven by
 * direct style mutation on refs (no React state/re-render per pixel) and
 * throttled to one update per animation frame, so it costs nothing beyond
 * a normal CSS-transform animation.
 *
 * The reticle "locks" — tightens, brightens, and shows corner brackets —
 * whenever the pointer is over anything interactive (buttons, links,
 * inputs, or elements tagged data-cursor="target").
 */
export function GameCursor() {
  const glowRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Skip on touch-only devices — there is no real pointer to replace.
    const isTouch = window.matchMedia('(pointer: coarse)').matches
    if (isTouch) return

    document.documentElement.classList.add('game-cursor-active')

    let raf = 0
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let locked = false
    let pending = false

    const INTERACTIVE_SELECTOR =
      'button, a, input, select, textarea, [role="button"], [data-cursor="target"], .hud-b, .hud-btn'

    function apply() {
      pending = false
      const gx = `${x}px`
      const gy = `${y}px`
      if (glowRef.current) glowRef.current.style.transform = `translate3d(${gx}, ${gy}, 0)`
      if (ringRef.current) ringRef.current.style.transform = `translate3d(${gx}, ${gy}, 0)`
      if (coreRef.current) coreRef.current.style.transform = `translate3d(${gx}, ${gy}, 0)`
    }

    function schedule() {
      if (pending) return
      pending = true
      raf = requestAnimationFrame(apply)
    }

    function onMove(e: MouseEvent) {
      x = e.clientX
      y = e.clientY
      schedule()
      const target = e.target
      const isInteractive =
        target instanceof Element &&
        typeof target.closest === 'function' &&
        !!target.closest(INTERACTIVE_SELECTOR)
      if (isInteractive !== locked) {
        locked = isInteractive
        ringRef.current?.classList.toggle('game-cursor-locked', locked)
        coreRef.current?.classList.toggle('game-cursor-locked', locked)
        glowRef.current?.classList.toggle('game-cursor-locked', locked)
      }
    }

    function onDown() {
      ringRef.current?.classList.add('game-cursor-pulse')
      window.setTimeout(() => ringRef.current?.classList.remove('game-cursor-pulse'), 220)
    }

    function onLeave() {
      if (glowRef.current) glowRef.current.style.opacity = '0'
      if (ringRef.current) ringRef.current.style.opacity = '0'
      if (coreRef.current) coreRef.current.style.opacity = '0'
    }

    function onEnter() {
      if (glowRef.current) glowRef.current.style.opacity = ''
      if (ringRef.current) ringRef.current.style.opacity = ''
      if (coreRef.current) coreRef.current.style.opacity = ''
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseleave', onLeave)
    window.addEventListener('mouseenter', onEnter)

    return () => {
      document.documentElement.classList.remove('game-cursor-active')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('mouseenter', onEnter)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-[999]" aria-hidden>
      <div ref={glowRef} className="game-cursor-glow" />
      <div ref={ringRef} className="game-cursor-ring">
        <span className="game-cursor-bracket game-cursor-bracket-tl" />
        <span className="game-cursor-bracket game-cursor-bracket-tr" />
        <span className="game-cursor-bracket game-cursor-bracket-bl" />
        <span className="game-cursor-bracket game-cursor-bracket-br" />
      </div>
      <div ref={coreRef} className="game-cursor-core">
        <span className="game-cursor-core-h" />
        <span className="game-cursor-core-v" />
      </div>
    </div>
  )
}
