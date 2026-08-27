'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

/**
 * V0-07 — one global input / focus / accessibility contract for the shell.
 *
 * Escape priority, highest first. Escape is consumed by exactly one layer:
 *   blocking-error → confirm → child-overlay → parent-overlay → pause → page
 *
 * Everything here is presentation-layer only. Nothing in this module can
 * advance the journey or write a rule fact.
 */

export const OVERLAY_LAYERS = ['blocking-error', 'confirm', 'child-overlay', 'parent-overlay', 'pause', 'page'] as const
export type OverlayLayer = (typeof OVERLAY_LAYERS)[number]

export const LAYER_PRIORITY: Record<OverlayLayer, number> = {
  'blocking-error': 100, confirm: 80, 'child-overlay': 60, 'parent-overlay': 40, pause: 20, page: 0,
}

export const LAYER_LABELS: Record<OverlayLayer, string> = {
  'blocking-error': '阻断错误', confirm: '确认对话', 'child-overlay': '子覆盖层',
  'parent-overlay': '父覆盖层', pause: '暂停', page: '页面',
}

type Entry = { id: string; layer: OverlayLayer; onEscape: () => void }

const stack: Entry[] = []
const listeners = new Set<(snapshot: Entry[]) => void>()

function notify() {
  const snapshot = [...stack]
  listeners.forEach((listener) => listener(snapshot))
}

function topEntry(): Entry | undefined {
  return [...stack].sort((a, b) => LAYER_PRIORITY[b.layer] - LAYER_PRIORITY[a.layer] || stack.indexOf(b) - stack.indexOf(a))[0]
}

let bound = false
function bindGlobalEscape() {
  if (bound || typeof window === 'undefined') return
  bound = true
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return
      const top = topEntry()
      if (!top) return
      event.preventDefault()
      event.stopPropagation()
      top.onEscape()
    },
    // Capture so a nested handler cannot steal Escape out of priority order.
    { capture: true },
  )
}

/**
 * Registers an overlay in the global Escape stack and traps focus inside it.
 * On unmount, focus returns to whatever triggered the overlay.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useOverlayLayer(
  ref: RefObject<HTMLElement | null>,
  options: { id: string; layer: OverlayLayer; active?: boolean; onEscape: () => void },
) {
  const { id, layer, active = true, onEscape } = options
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!active) return
    bindGlobalEscape()
    const entry: Entry = { id, layer, onEscape: () => escapeRef.current() }
    stack.push(entry)
    notify()
    return () => {
      const index = stack.indexOf(entry)
      if (index >= 0) stack.splice(index, 1)
      notify()
    }
  }, [active, id, layer])

  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = root.querySelector<HTMLElement>(FOCUSABLE) ?? root
    const raf = requestAnimationFrame(() => first.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null)
      if (!items.length) { event.preventDefault(); root.focus(); return }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus() }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus() }
    }
    root.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('keydown', onKeyDown)
      // Return focus to the control that opened this layer.
      requestAnimationFrame(() => previous?.focus())
    }
  }, [active, ref])
}

/** Read-only view of the current Escape stack, for the control panel readout. */
export function useOverlayStack() {
  const [snapshot, setSnapshot] = useState<Entry[]>([])
  useEffect(() => {
    const listener = (next: Entry[]) => setSnapshot(next)
    listeners.add(listener)
    setSnapshot([...stack])
    return () => { listeners.delete(listener) }
  }, [])
  return useMemo(
    () => ({
      entries: snapshot.map((entry) => ({ id: entry.id, layer: entry.layer })),
      top: snapshot.length ? topEntry()?.layer ?? null : null,
    }),
    [snapshot],
  )
}

/** OS-level preference plus a shell override so both paths are demonstrable. */
export function useReducedMotion(override?: boolean) {
  const [system, setSystem] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setSystem(query.matches)
    const listener = (event: MediaQueryListEvent) => setSystem(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])
  return override ?? system
}

/**
 * Keyboard equivalence for pointer-driven controls, and the gamepad-equivalent
 * key bindings the shell documents: Enter/Space = confirm, Escape = back,
 * arrows = move focus.
 */
export function useArrowNavigation<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  selector: string,
  orientation: 'vertical' | 'horizontal' | 'both' = 'vertical',
) {
  return useCallback(
    (event: React.KeyboardEvent) => {
      const container = containerRef.current
      if (!container) return
      const nextKeys = orientation === 'horizontal' ? ['ArrowRight'] : orientation === 'vertical' ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown']
      const prevKeys = orientation === 'horizontal' ? ['ArrowLeft'] : orientation === 'vertical' ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp']
      if (![...nextKeys, ...prevKeys, 'Home', 'End'].includes(event.key)) return
      const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((item) => item.offsetParent !== null)
      if (!items.length) return
      event.preventDefault()
      const currentIndex = items.findIndex((item) => item === document.activeElement)
      const delta = nextKeys.includes(event.key) ? 1 : prevKeys.includes(event.key) ? -1 : 0
      const target =
        event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (currentIndex + delta + items.length) % items.length
      items[Math.max(0, target)].focus()
    },
    [containerRef, orientation, selector],
  )
}

/** Politeness policy, stated once so surfaces stop choosing ad hoc. */
export const ARIA_LIVE_POLICY = {
  toast: 'polite',
  broadcast: 'polite',
  history: 'off',
  blockingError: 'assertive',
  intentResult: 'polite',
  stateTransition: 'polite',
} as const

/** Readable explanation for every disabled control, so it is never bare. */
export const DISABLED_EXPLANATIONS: Record<string, string> = {
  'continue.no-save': '没有可继续的存档，因此「继续」不可用。先开始新游戏。',
  'bed.deferred': '床 B 是后置功能，本版本不可用。',
  'bed.self-test': '床 C 仅用于自测，不进入正式对局。',
  'intent.pending': '上一次提交仍在等待宿主确认，期间不接受重复提交。',
  'reward.claimed': '这份奖励已提交过一次，重复确认已被拦截。',
  'burst.deferred': '爆发 +3 是后置档位，本版本仅保留视觉位，不可选择。',
  'asset.pending': '相关素材尚未交付，该操作暂不可用。',
}
