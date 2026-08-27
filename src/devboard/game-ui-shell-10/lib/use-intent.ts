'use client'

import { useCallback, useRef, useState } from 'react'
import { createIntent, submitIntent, type B1IntentId, type IntentStatus } from './b1-contract'

// A small shared channel for the B5 narrative surfaces. Every user action goes
// through here as an explicit intent: the component only ever *requests*, then
// renders pending / accepted / rejected / timeout / stale. A dispatch is never
// treated as a confirmed business result — the host projection is the only
// authority, so callers wait for `accepted` before reflecting any change that
// a real projection revision would drive.
export type IntentPhase = 'idle' | 'pending' | IntentStatus

export interface IntentState {
  phase: IntentPhase
  intentId?: B1IntentId
  reason?: string
  requestId?: string
}

export function useIntentChannel(safeReturnTarget = 'menu-title') {
  const [state, setState] = useState<IntentState>({ phase: 'idle' })
  const seq = useRef(0)
  const lastCall = useRef<{ intentId: B1IntentId; payload: Record<string, unknown> } | null>(null)

  const dispatch = useCallback(
    async (intentId: B1IntentId, payload: Record<string, unknown> = {}) => {
      lastCall.current = { intentId, payload }
      const mySeq = ++seq.current
      const intent = createIntent(intentId, payload, safeReturnTarget)
      setState({ phase: 'pending', intentId, requestId: intent.requestId })
      const result = await submitIntent(intent)
      // Discard a superseded response so a stale reply can't overwrite a newer
      // request's visible status.
      if (mySeq !== seq.current) return result
      setState({ phase: result.status, intentId, reason: result.reason, requestId: intent.requestId })
      return result
    },
    [safeReturnTarget],
  )

  /** Re-submits the last dispatched intent verbatim, as a new requestId. */
  const retry = useCallback(async () => {
    const previous = lastCall.current
    if (!previous) return null
    return dispatch(previous.intentId, previous.payload)
  }, [dispatch])

  /** Locally cancels a pending request: the reply is discarded, not applied. */
  const cancel = useCallback(() => {
    seq.current += 1
    setState((current) => (current.phase === 'pending' ? { ...current, phase: 'cancelled', reason: '已取消' } : current))
  }, [])

  const reset = useCallback(() => {
    seq.current += 1
    setState({ phase: 'idle' })
  }, [])

  return { state, dispatch, retry, cancel, reset }
}
