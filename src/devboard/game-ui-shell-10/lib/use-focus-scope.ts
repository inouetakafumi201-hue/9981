'use client'

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusScope(ref: RefObject<HTMLElement | null>, onEscape?: () => void) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = root.querySelector<HTMLElement>(FOCUSABLE) ?? root
    requestAnimationFrame(() => first.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscape) { event.preventDefault(); onEscape(); return }
      if (event.key !== 'Tab') return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null)
      if (!items.length) { event.preventDefault(); root.focus(); return }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus() }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus() }
    }
    root.addEventListener('keydown', onKeyDown)
    return () => { root.removeEventListener('keydown', onKeyDown); requestAnimationFrame(() => previous?.focus()) }
  }, [ref, onEscape])
}
