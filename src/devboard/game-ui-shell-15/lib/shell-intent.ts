'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * V0-05 — the single mock intent adapter for the whole shell.
 *
 * Rules this module exists to enforce:
 *  1. Every user action that would change a fact is *requested*, never applied
 *     locally. The component renders pending, then whatever the adapter returns.
 *  2. All intents share one shape and one result union, so no surface can
 *     invent its own private result vocabulary.
 *  3. Failure never silently falls back to the happy path: `rejected`,
 *     `stale`, `timeout` and `cancelled` are terminal, readable states with an
 *     explicit retry / safe-return affordance owned by the caller.
 *
 * Extraction contract: replace `submitShellIntent` with a real port call. The
 * request shape, the result union and the hook API must stay identical.
 */

export type ShellIntentSource = 'mock'

export type ShellIntentOutcome = 'accepted' | 'rejected' | 'stale' | 'timeout' | 'cancelled' | 'degraded'
export type ShellIntentPhase = 'idle' | 'pending' | ShellIntentOutcome

export interface ShellIntentRequest {
  /** Namespaced verb, e.g. `menu.quit.confirm`. Stable extraction key. */
  intentId: string
  /** Unique per submission; lets the UI discard superseded replies. */
  requestId: string
  /** Which surface raised it — always a catalog pageId. */
  source: string
  /** What it acts on: a pageId, nodeId, slotId, settingId, etc. */
  target: string
  parameters: Record<string, unknown>
  /** Always true in the shell. A real adapter sets this false. */
  mock: true
  /** Where the surface returns to if this request cannot be resolved. */
  safeReturnTarget: string
  revision: number
}

export interface ShellIntentResult {
  request: ShellIntentRequest
  outcome: ShellIntentOutcome
  /** Machine reason code, always present for non-accepted outcomes. */
  reasonCode?: string
  /** Human-readable, screen-reader friendly explanation. */
  message: string
}

/**
 * Forced outcome for demos. `control-panel-main` sets this so every failure
 * branch in the shell is reproducible without a backend.
 */
export type ForcedOutcome = ShellIntentOutcome | 'auto'

let outcomeOverride: ForcedOutcome = 'auto'
export function setForcedIntentOutcome(next: ForcedOutcome) {
  outcomeOverride = next
}
export function getForcedIntentOutcome(): ForcedOutcome {
  return outcomeOverride
}

export const OUTCOME_MESSAGES: Record<ShellIntentOutcome, string> = {
  accepted: '宿主已确认该请求。',
  rejected: '宿主拒绝了该请求，界面保持原状态。',
  stale: '本地版本已过期，请重试以取得新的投影版本。',
  timeout: '请求超时，没有收到投影确认。',
  cancelled: '请求已取消，没有产生任何变更。',
  degraded: '请求已被宿主接受，但表现层未在 800ms 内更新投影，界面已降级展示。',
}

export const OUTCOME_REASONS: Record<Exclude<ShellIntentOutcome, 'accepted'>, string> = {
  rejected: 'MOCK_HOST_REJECTED',
  stale: 'MOCK_REVISION_STALE',
  timeout: 'MOCK_PORT_TIMEOUT',
  cancelled: 'MOCK_USER_CANCELLED',
  degraded: 'PROJECTION_NOT_REFRESHED',
}

export const OUTCOME_LABELS: Record<ShellIntentPhase, string> = {
  idle: '待提交', pending: '等待确认', accepted: '已确认',
  rejected: '已拒绝', stale: '版本过期', timeout: '请求超时', cancelled: '已取消', degraded: '已降级',
}

let revisionCounter = 0

export function createShellIntent(
  intentId: string,
  options: { source: string; target: string; parameters?: Record<string, unknown>; safeReturnTarget?: string },
): ShellIntentRequest {
  revisionCounter += 1
  return {
    intentId,
    requestId: `mock-${revisionCounter.toString().padStart(4, '0')}-${Date.now().toString(36)}`,
    source: options.source,
    target: options.target,
    parameters: options.parameters ?? {},
    mock: true,
    safeReturnTarget: options.safeReturnTarget ?? options.source,
    revision: revisionCounter,
  }
}

/* ── real intent bridge (H-G-1a) ───────────────────────────────────────── */
let _realSubmitIntent: ((req: ShellIntentRequest) => Promise<ShellIntentResult>) | null = null
export function registerRealSubmitIntent(fn: (req: ShellIntentRequest) => Promise<ShellIntentResult>) {
  _realSubmitIntent = fn
}
export function isRealIntentRegistered() {
  return _realSubmitIntent !== null
}

/* ── mock implementation ───────────────────────────────────────────────── */
export async function submitShellIntent(request: ShellIntentRequest): Promise<ShellIntentResult> {
  // H-G-1a: real adapter takes precedence; mock falls back to forcedOutcome override.
  if (_realSubmitIntent) return _realSubmitIntent(request)
  const forced = outcomeOverride
  const perRequest = request.parameters.demoOutcome as ShellIntentOutcome | undefined
  const outcome: ShellIntentOutcome = perRequest ?? (forced === 'auto' ? 'accepted' : forced)
  const delay = outcome === 'timeout' ? 1100 : 220
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  return {
    request,
    outcome,
    reasonCode: outcome === 'accepted' ? undefined : OUTCOME_REASONS[outcome],
    message: OUTCOME_MESSAGES[outcome],
  }
}

export interface ShellIntentState {
  phase: ShellIntentPhase
  intentId?: string
  requestId?: string
  target?: string
  reasonCode?: string
  message?: string
  /** Set when the last failure ended in a safe return rather than a retry. */
  safeReturnTarget?: string
  /**
   * V0-10: the request's global revision counter, surfaced so a demo can show
   * `projectionRevision` per the extraction acceptance contract. This is the
   * mock intent's own monotonic counter, not a real host projection version —
   * `source` on the request stays `'mock'` regardless.
   */
  revision?: number
}

const IDLE: ShellIntentState = { phase: 'idle' }

/**
 * One channel per surface. `dispatch` resolves with the result so callers can
 * gate their own presentation on `accepted` — they must never assume it.
 */
export function useShellIntent(source: string, safeReturnTarget = 'control-panel-main') {
  const [state, setState] = useState<ShellIntentState>(IDLE)
  const seq = useRef(0)
  const lastRequest = useRef<ShellIntentRequest | null>(null)

  const dispatch = useCallback(
    async (intentId: string, target: string, parameters: Record<string, unknown> = {}) => {
      const mySeq = ++seq.current
      const request = createShellIntent(intentId, { source, target, parameters, safeReturnTarget })
      lastRequest.current = request
      setState({ phase: 'pending', intentId, requestId: request.requestId, target, message: '已提交，等待宿主确认。', revision: request.revision })
      const result = await submitShellIntent(request)
      // A superseded reply must never overwrite a newer request's status.
      if (mySeq !== seq.current) return result
      setState({
        phase: result.outcome,
        intentId,
        requestId: request.requestId,
        target,
        reasonCode: result.reasonCode,
        message: result.message,
        safeReturnTarget: result.outcome === 'accepted' ? undefined : request.safeReturnTarget,
        revision: request.revision,
      })
      return result
    },
    [safeReturnTarget, source],
  )

  /** Re-submits the last request verbatim, as a new requestId. */
  const retry = useCallback(async () => {
    const previous = lastRequest.current
    if (!previous) return null
    return dispatch(previous.intentId, previous.target, previous.parameters)
  }, [dispatch])

  /** Locally cancels a pending request: the reply is discarded, not applied. */
  const cancel = useCallback(() => {
    seq.current += 1
    setState((current) =>
      current.phase === 'pending'
        ? { ...current, phase: 'cancelled', reasonCode: OUTCOME_REASONS.cancelled, message: OUTCOME_MESSAGES.cancelled }
        : current,
    )
  }, [])

  const reset = useCallback(() => {
    seq.current += 1
    setState(IDLE)
  }, [])

  const isPending = state.phase === 'pending'
  const isFailure = state.phase === 'rejected' || state.phase === 'stale' || state.phase === 'timeout'

  return useMemo(
    () => ({ state, dispatch, retry, cancel, reset, isPending, isFailure }),
    [cancel, dispatch, isFailure, isPending, reset, retry, state],
  )
}
