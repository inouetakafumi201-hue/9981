import {
  createShellRequest,
  mockTransportAdapter,
  type ShellTransportAdapter,
} from '../game-ui-shell-15/lib/shell-adapters'
import {
  getJourneyEdge,
  getJourneyNode,
  type JourneyTrigger,
} from '../game-ui-shell-15/lib/shell-journey'

export type HostTransitionState =
  | 'idle'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'timeout'
  | 'cancelled'
  | 'disconnected'
  | 'reconnecting'

export interface HostTransition {
  readonly transitionId: string
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly sourcePageId: string
  readonly targetPageId: string
  readonly fallbackPageId: string
  readonly trigger: JourneyTrigger
  readonly state: HostTransitionState
  readonly requestId?: string
  readonly revision: number
  readonly projectionCommitted: boolean
  readonly message?: string
}

export interface ShellJourneySnapshot {
  readonly nodeId: string
  readonly pageId: string
  readonly revision: number
  readonly transition: HostTransition
  readonly usedDemoControl: boolean
}

export interface ShellJourneyHost {
  snapshot(): ShellJourneySnapshot
  request(transitionId: string, parameters?: Record<string, unknown>): Promise<HostTransition>
  safeReturn(reason?: string): void
  cancel(): void
  demoJump(pageId: string, nodeId?: string): void
  subscribe(listener: (snapshot: ShellJourneySnapshot) => void): () => void
}

function outcomeState(state: string): HostTransitionState {
  switch (state) {
    case 'accepted':
    case 'rejected':
    case 'stale':
    case 'timeout':
    case 'cancelled':
    case 'disconnected':
    case 'reconnecting':
      return state
    default:
      return 'timeout'
  }
}

export function createShellJourneyHost(
  adapter: ShellTransportAdapter = mockTransportAdapter,
  initialNodeId = 'boot.startup',
): ShellJourneyHost {
  const initial = getJourneyNode(initialNodeId) ?? getJourneyNode('boot.startup')!
  let nodeId = initial.nodeId
  let revision = 0
  let activeRequestId: string | null = null
  let cancelledRequestId: string | null = null
  let usedDemoControl = false
  let transition: HostTransition = {
    transitionId: 'idle',
    sourceNodeId: nodeId,
    targetNodeId: nodeId,
    sourcePageId: initial.pageId,
    targetPageId: initial.pageId,
    fallbackPageId: initial.pageId,
    trigger: 'user-action',
    state: 'idle',
    revision,
    projectionCommitted: true,
  }
  const listeners = new Set<(snapshot: ShellJourneySnapshot) => void>()

  const snapshot = (): ShellJourneySnapshot => Object.freeze({
    nodeId,
    pageId: getJourneyNode(nodeId)?.pageId ?? initial.pageId,
    revision,
    transition,
    usedDemoControl,
  })
  const notify = () => listeners.forEach((listener) => listener(snapshot()))

  const host: ShellJourneyHost = {
    snapshot,
    async request(transitionId, parameters = {}) {
      const edge = getJourneyEdge(transitionId)
      const source = edge ? getJourneyNode(edge.fromNodeId) : undefined
      const target = edge ? getJourneyNode(edge.toNodeId) : undefined
      const fallback = edge ? getJourneyNode(edge.fallbackNodeId) : undefined
      if (!edge || !source || !target || !fallback || source.nodeId !== nodeId) {
        return transition
      }

      revision += 1
      const requestRevision = revision
      const base: HostTransition = {
        transitionId,
        sourceNodeId: source.nodeId,
        targetNodeId: target.nodeId,
        sourcePageId: source.pageId,
        targetPageId: target.pageId,
        fallbackPageId: fallback.pageId,
        trigger: edge.trigger,
        state: 'pending',
        revision: requestRevision,
        projectionCommitted: false,
      }
      transition = base
      notify()

      if (!edge.intentId) {
        transition = { ...base, state: 'accepted', projectionCommitted: true }
        nodeId = target.nodeId
        notify()
        return transition
      }

      const request = createShellRequest(edge.intentId, {
        source: source.pageId,
        target: target.pageId,
        parameters,
        safeReturnTarget: fallback.pageId,
        revision: requestRevision,
      })
      activeRequestId = request.requestId
      const result = await adapter.request(request)
      // Cancellation is a terminal outcome of the request that was cancelled;
      // a later revision is the stale outcome for a superseded request.
      if (cancelledRequestId === request.requestId) {
        cancelledRequestId = null
        activeRequestId = null
        transition = { ...base, state: 'cancelled', requestId: request.requestId, projectionCommitted: false, message: '请求已取消。' }
        notify()
        return transition
      }
      if (activeRequestId !== request.requestId || requestRevision !== revision) {
        return { ...base, state: 'stale', message: '请求已被更新的请求取代。' }
      }
      activeRequestId = null
      const state = outcomeState(result.state)
      const committed = state === 'accepted'
      transition = {
        ...base,
        state,
        requestId: result.requestId,
        projectionCommitted: committed,
        message: result.message,
      }
      if (committed) nodeId = target.nodeId
      notify()
      return transition
    },
    safeReturn(reason = '安全返回到声明的安全点。') {
      const current = getJourneyNode(nodeId) ?? initial
      const target = getJourneyNode(current.safeReturnNodeId) ?? initial
      activeRequestId = null
      revision += 1
      nodeId = target.nodeId
      transition = {
        transitionId: `${current.nodeId}→safe-return`,
        sourceNodeId: current.nodeId,
        targetNodeId: target.nodeId,
        sourcePageId: current.pageId,
        targetPageId: target.pageId,
        fallbackPageId: target.pageId,
        trigger: 'safe-return',
        state: 'accepted',
        revision,
        projectionCommitted: true,
        message: reason,
      }
      notify()
    },
    cancel() {
      if (!activeRequestId) return
      adapter.cancel(activeRequestId)
      cancelledRequestId = activeRequestId
      activeRequestId = null
      if (transition.state === 'pending') {
        transition = { ...transition, state: 'cancelled', projectionCommitted: false }
        notify()
      }
    },
    demoJump(pageId, targetNodeId) {
      const target = targetNodeId ? getJourneyNode(targetNodeId) : undefined
      const fallback = target ?? initial
      usedDemoControl = true
      revision += 1
      nodeId = fallback.nodeId
      transition = {
        transitionId: `demo-control→${pageId}`,
        sourceNodeId: transition.targetNodeId,
        targetNodeId: fallback.nodeId,
        sourcePageId: transition.targetPageId,
        targetPageId: pageId,
        fallbackPageId: pageId,
        trigger: 'demo-control',
        state: 'accepted',
        revision,
        projectionCommitted: true,
        message: '控制面板跳转：仅用于开发验证。',
      }
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
  }
  return Object.freeze(host)
}
