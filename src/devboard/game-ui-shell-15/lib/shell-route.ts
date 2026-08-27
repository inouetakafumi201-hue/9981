'use client'

/**
 * V0-11 — the transition runner. The ONLY thing in the shell that changes
 * which page is mounted.
 *
 * Round-2 defect: pages received an `onComplete` and the host called
 * `setPageId` from inside an animation callback. That made "the animation
 * finished" indistinguishable from "the host accepted the move", which is
 * exactly the confusion the extraction contract exists to prevent.
 *
 * The rules this file enforces mechanically:
 *  1. A leaf never navigates. It calls `request(transitionId)` and re-renders
 *     from the returned state.
 *  2. `accepted` means the adapter accepted the *request*. The page swap is
 *     performed here, afterwards, by the runner.
 *  3. `rejected` / `stale` / `timeout` / `cancelled` keep the source page
 *     mounted and expose `fallbackPageId` — no partial navigation.
 *  4. There is no `setTimeout` that advances a page. Ever.
 *  5. Motion completion is reported through `notifyMotionSettled`, which
 *     unlocks the page's own advance control but never moves the page.
 *
 * Extraction contract: swap `mockTransportAdapter`. Keep the state union.
 *
 * H-G-1 wiring mode: callers can call `setActiveRouterAdapter()` at boot time
 * to switch from the mock to a real adapter (or iter-V0 variant). The hook
 * reads the registry on every call, so changes take effect without remount.
 */

/* ── adapter registry (H-G-1) ─────────────────────────────────────────── */
let _activeAdapter: ShellTransportAdapter | null = null
export function setActiveRouterAdapter(a: ShellTransportAdapter) { _activeAdapter = a }
export function getActiveRouterAdapter(): ShellTransportAdapter {
  return _activeAdapter ?? mockTransportAdapter
}

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  createShellRequest,
  mockTransportAdapter,
  type ShellTransportAdapter,
  type ShellTransportState,
} from './shell-adapters'
import {
  JOURNEY_EDGES,
  getJourneyEdge,
  getJourneyNode,
  type JourneyTrigger,
  type ShellJourneyEdge,
} from './shell-journey'

/** Mirrors the round-3 acceptance contract exactly. */
export interface ShellRouteTransition {
  transitionId: string
  sourcePageId: string
  targetPageId: string
  intentId?: string
  trigger: JourneyTrigger
  state: 'idle' | 'pending' | 'accepted' | 'rejected' | 'stale' | 'timeout' | 'cancelled'
  fallbackPageId: string
  mock: boolean
  /** Node ids, kept alongside pageIds because milestones share a pageId. */
  sourceNodeId: string
  targetNodeId: string
  /** Reason + message straight from the adapter; never rewritten optimistically. */
  reasonCode?: string
  message?: string
  requestId?: string
  startedAt: number
}

const IDLE_TRANSITION: ShellRouteTransition = {
  transitionId: 'idle',
  sourcePageId: 'startup-loading',
  targetPageId: 'startup-loading',
  trigger: 'user-action',
  state: 'idle',
  fallbackPageId: 'startup-loading',
  mock: true,
  sourceNodeId: 'boot.startup',
  targetNodeId: 'boot.startup',
  startedAt: 0,
}

/** Adapter states that are not part of the route union collapse to `timeout`. */
function toRouteState(state: ShellTransportState): ShellRouteTransition['state'] {
  switch (state) {
    case 'accepted': return 'accepted'
    case 'rejected': return 'rejected'
    case 'stale': return 'stale'
    case 'cancelled': return 'cancelled'
    case 'pending': return 'pending'
    // A link that is down or reconnecting has not accepted anything. Treating
    // it as its own route state would multiply the failure vocabulary without
    // changing what the UI must do, which is hold and offer safe return.
    case 'disconnected':
    case 'reconnecting':
    case 'timeout':
    default: return 'timeout'
  }
}

export interface JourneyLogEntry {
  seq: number
  transitionId: string
  sourceNodeId: string
  targetNodeId: string
  intentId?: string
  trigger: JourneyTrigger
  state: ShellRouteTransition['state']
  landedNodeId: string
  at: number
}

export interface UseShellRouterResult {
  nodeId: string
  pageId: string
  milestoneId?: string
  transition: ShellRouteTransition
  /** Edges leaving the current node — what the leaf is allowed to offer. */
  available: readonly ShellJourneyEdge[]
  /** Walk one declared edge. Resolves with the terminal transition record. */
  request: (transitionId: string, parameters?: Record<string, unknown>) => Promise<ShellRouteTransition>
  /** Local, immediate recovery to a declared safe point. Never a host request. */
  safeReturn: (reason?: string) => void
  /** Panel-only jump. Tagged `demo-control` so reports can exclude it. */
  demoJump: (pageId: string, nodeId?: string) => void
  /** Abandons a pending request; the reply is discarded, not applied. */
  cancel: () => void
  /** A motion reached its final state. Records it; does not move the page. */
  notifyMotionSettled: (semanticId: string) => void
  settledMotions: readonly string[]
  log: readonly JourneyLogEntry[]
  resetLog: () => void
  /** True while the panel's own jumps have polluted the current run. */
  usedDemoControl: boolean
}

export function useShellRouter(
  initialNodeId = 'boot.startup',
  adapter?: ShellTransportAdapter,
): UseShellRouterResult {
  // H-G-1：wiring mode 决定 adapter 选择（mock / real / iter-V0）。
  // 由 createShellRouter() 工厂动态注入；组件侧不直接依赖 mockTransportAdapter。
  const resolvedAdapter = adapter ?? getActiveRouterAdapter()
  const [nodeId, setNodeId] = useState(initialNodeId)
  const [transition, setTransition] = useState<ShellRouteTransition>(IDLE_TRANSITION)
  const [log, setLog] = useState<readonly JourneyLogEntry[]>([])
  const [settledMotions, setSettledMotions] = useState<readonly string[]>([])
  const [usedDemoControl, setUsedDemoControl] = useState(false)
  const seq = useRef(0)
  const pendingRequestId = useRef<string | null>(null)

  const node = getJourneyNode(nodeId) ?? getJourneyNode('boot.startup')!

  const append = useCallback((entry: Omit<JourneyLogEntry, 'seq' | 'at'>) => {
    seq.current += 1
    const full: JourneyLogEntry = { ...entry, seq: seq.current, at: Date.now() }
    setLog((current) => [...current.slice(-40), full])
  }, [])

  const request = useCallback(
    async (transitionId: string, parameters: Record<string, unknown> = {}) => {
      const edge = getJourneyEdge(transitionId)
      if (!edge) {
        console.log('[v0] route: unknown transitionId', transitionId)
        return transition
      }
      const source = getJourneyNode(edge.fromNodeId)
      const target = getJourneyNode(edge.toNodeId)
      const fallback = getJourneyNode(edge.fallbackNodeId)
      if (!source || !target || !fallback) return transition

      const base: ShellRouteTransition = {
        transitionId: edge.transitionId,
        sourcePageId: source.pageId,
        targetPageId: target.pageId,
        sourceNodeId: source.nodeId,
        targetNodeId: target.nodeId,
        intentId: edge.intentId,
        trigger: edge.trigger,
        state: 'pending',
        fallbackPageId: fallback.pageId,
        mock: resolvedAdapter === mockTransportAdapter,
        startedAt: Date.now(),
      }

      // Presentation-only edges (roaming, proximity, overlay open/close) have
      // no intentId because there is no fact to change. They still go through
      // the runner so that nothing else in the tree owns page identity.
      if (!edge.intentId) {
        const settled: ShellRouteTransition = { ...base, state: 'accepted', message: '表现层转移，未提交 intent。' }
        setTransition(settled)
        setNodeId(target.nodeId)
        setSettledMotions([])
        append({
          transitionId: edge.transitionId, sourceNodeId: source.nodeId, targetNodeId: target.nodeId,
          intentId: undefined, trigger: edge.trigger, state: 'accepted', landedNodeId: target.nodeId,
        })
        return settled
      }

      setTransition(base)

      const hostRequest = createShellRequest(edge.intentId, {
        source: source.pageId,
        target: target.pageId,
        parameters: { ...parameters, transitionId: edge.transitionId },
        safeReturnTarget: fallback.pageId,
      })
      pendingRequestId.current = hostRequest.requestId

      const result = await resolvedAdapter.request(hostRequest)
      // A superseded reply must never move the page.
      if (pendingRequestId.current !== hostRequest.requestId) return base
      pendingRequestId.current = null

      const state = toRouteState(result.state)
      const settled: ShellRouteTransition = {
        ...base,
        state,
        requestId: result.requestId,
        reasonCode: result.reasonCode,
        message: result.message,
      }
      setTransition(settled)

      // The one place a page swap happens, and only after `accepted`.
      const landedNodeId = state === 'accepted' ? target.nodeId : source.nodeId
      if (state === 'accepted') {
        setNodeId(target.nodeId)
        setSettledMotions([])
      }
      append({
        transitionId: edge.transitionId, sourceNodeId: source.nodeId, targetNodeId: target.nodeId,
        intentId: edge.intentId, trigger: edge.trigger, state, landedNodeId,
      })
      return settled
    },
    [adapter, append, transition],
  )

  const safeReturn = useCallback(
    (reason = '安全返回到声明的安全点。') => {
      const current = getJourneyNode(nodeId)
      const target = getJourneyNode(current?.safeReturnNodeId ?? 'menu.title') ?? getJourneyNode('menu.title')!
      pendingRequestId.current = null
      setNodeId(target.nodeId)
      setSettledMotions([])
      setTransition({
        transitionId: `${nodeId}→safe-return`,
        sourcePageId: current?.pageId ?? target.pageId,
        targetPageId: target.pageId,
        sourceNodeId: nodeId,
        targetNodeId: target.nodeId,
        trigger: 'safe-return',
        state: 'accepted',
        fallbackPageId: target.pageId,
        mock: true,
        message: reason,
        startedAt: Date.now(),
      })
      append({
        transitionId: `${nodeId}→safe-return`, sourceNodeId: nodeId, targetNodeId: target.nodeId,
        trigger: 'safe-return', state: 'accepted', landedNodeId: target.nodeId,
      })
    },
    [append, nodeId],
  )

  const demoJump = useCallback(
    (pageId: string, targetNodeId?: string) => {
      const resolved = targetNodeId
        ?? JOURNEY_EDGES.find((edge: { toNodeId: string }) => getJourneyNode(edge.toNodeId)?.pageId === pageId)?.toNodeId
      pendingRequestId.current = null
      setUsedDemoControl(true)
      setSettledMotions([])
      if (resolved) setNodeId(resolved)
      setTransition({
        transitionId: `demo-control→${pageId}`,
        sourcePageId: node.pageId,
        targetPageId: pageId,
        sourceNodeId: nodeId,
        targetNodeId: resolved ?? nodeId,
        trigger: 'demo-control',
        state: 'accepted',
        fallbackPageId: pageId,
        mock: true,
        message: '控制面板跳页：调试用途，不计入旅程验收。',
        startedAt: Date.now(),
      })
      append({
        transitionId: `demo-control→${pageId}`, sourceNodeId: nodeId, targetNodeId: resolved ?? nodeId,
        trigger: 'demo-control', state: 'accepted', landedNodeId: resolved ?? nodeId,
      })
    },
    [append, node.pageId, nodeId],
  )

  const cancel = useCallback(() => {
    const requestId = pendingRequestId.current
    if (!requestId) return
    resolvedAdapter.cancel(requestId)
    pendingRequestId.current = null
    setTransition((current) =>
      current.state === 'pending'
        ? { ...current, state: 'cancelled', reasonCode: 'MOCK_USER_CANCELLED', message: '请求已取消，页面保持原状态。' }
        : current,
    )
  }, [adapter])

  const notifyMotionSettled = useCallback((semanticId: string) => {
    setSettledMotions((current) => (current.includes(semanticId) ? current : [...current, semanticId]))
  }, [])

  const resetLog = useCallback(() => {
    seq.current = 0
    setLog([])
    setUsedDemoControl(false)
  }, [])

  const available = useMemo(() => JOURNEY_EDGES.filter((edge: { fromNodeId: string }) => edge.fromNodeId === nodeId), [nodeId])

  return {
    nodeId,
    pageId: node.pageId,
    milestoneId: node.milestoneId,
    transition,
    available,
    request,
    safeReturn,
    demoJump,
    cancel,
    notifyMotionSettled,
    settledMotions,
    log,
    resetLog,
    usedDemoControl,
  }
}
