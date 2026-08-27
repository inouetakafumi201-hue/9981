'use client'

import { useCallback, useRef, useState } from 'react'

export type ToastKind = 'info' | 'error'

export interface ToastEntry {
  id: number
  kind: ToastKind
  message: string
}

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  info: 3500,
  error: 5000,
}

/**
 * Shared toast-stack state: a list of transient { id, kind, message } entries,
 * each with its own independent auto-dismiss timer keyed off its kind. Used by
 * both the notice-toast gallery page and utility-inventory's context-menu
 * action feedback, so the two share one visual/behavioral vocabulary for
 * "something just happened" — no separate ad-hoc toast implementations.
 */
export function useToastStack() {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const idRef = useRef(0)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = idRef.current++
      setToasts((prev) => [...prev, { id, kind, message }])
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS[kind])
      timersRef.current.set(id, timer)
      return id
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}
