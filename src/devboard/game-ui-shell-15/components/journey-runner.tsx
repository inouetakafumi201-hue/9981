'use client'

/**
 * V0-02 — the journey rendered from data, not from component branching.
 *
 * Everything on screen is derived from JOURNEY_NODES:
 *  - the rail is the node list
 *  - the advance button is `node.advanceIntentId` → `node.successNext`
 *  - the failure matrix is `node.failureStates`, one reproducible button each
 *  - retry / cancel / safe-return exist only when the node declares them
 *
 * Invariants this component is built to make un-bypassable:
 *  1. A failure NEVER lands further along the journey. It lands on
 *     `node.failureNext`, which is always at or behind the current node.
 *  2. `autoAdvance` completes a node's *presentation* only. The journey
 *     transition itself is always an intent the player confirms.
 *  3. Skip and animation failure resolve to a readable UI safe state.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Bed, Check, CircleSlash, Clock, Film, Loader2,
  Radio, RotateCcw, Shield, SkipForward, X,
} from 'lucide-react'
import {
  BED_GATES, FAILURE_DIAGNOSTICS, FAILURE_LABELS, INITIAL_JOURNEY_STATE,
  JOURNEY_NODES, JOURNEY_NODE_IDS, JOURNEY_NODE_LIST, nodeIndex,
  type JourneyFailureId, type JourneyNode, type JourneyNodeId, type JourneyState,
} from '@/lib/journey-nodes'
import { useShellIntent } from '@/lib/shell-intent'
import { IntentFeedback, MockBoundary } from './shell-primitives'

type PresentationState = 'idle' | 'playing' | 'complete' | 'skipped' | 'degraded'

const PRESENTATION_COPY: Record<PresentationState, string> = {
  idle: '演出未开始。',
  playing: '演出进行中。这不会推进节点。',
  complete: '演出已播完，停在最终静态状态，等待玩家确认推进。',
  skipped: '演出被跳过，已直接到最终静态状态。节点未推进。',
  degraded: '演出降级：素材不可用，只呈现最终静态状态。节点未推进。',
}

export function JourneyRunner() {
  const [journey, setJourney] = useState<JourneyState>(INITIAL_JOURNEY_STATE)
  const [presentation, setPresentation] = useState<PresentationState>('idle')
  const [log, setLog] = useState<string[]>(['journey.init · cold-start · revision 001'])
  const node = JOURNEY_NODES[journey.nodeId]
  const intent = useShellIntent(`journey.${journey.nodeId}`, node.safeReturn)

  const append = useCallback((line: string) => {
    setLog((entries) => [line, ...entries].slice(0, 8))
  }, [])

  const moveTo = useCallback(
    (nodeId: JourneyNodeId, patch: Partial<JourneyState>, reason: string) => {
      setJourney((current) => ({
        ...current,
        nodeId,
        phase: 'ready',
        failure: null,
        pendingIntentId: null,
        revision: current.revision + 1,
        ...patch,
      }))
      setPresentation('idle')
      append(reason)
    },
    [append],
  )

  /** The happy path. Only ever runs after the host accepts the intent. */
  const advance = useCallback(async () => {
    if (!node.successNext) return
    setJourney((current) => ({ ...current, phase: 'pending', pendingIntentId: node.advanceIntentId }))
    const result = await intent.dispatch(node.advanceIntentId, node.successNext)
    if (result.outcome === 'accepted') {
      moveTo(node.successNext, sideEffects(node.id), `${node.advanceIntentId} · accepted → ${node.successNext}`)
      return
    }
    // Rejected / stale / timeout / cancelled all stay put. Never forward.
    const failure: JourneyFailureId =
      result.outcome === 'timeout' ? 'timeout' : result.outcome === 'stale' ? 'stale' : result.outcome === 'cancelled' ? 'cancelled' : 'rejected'
    setJourney((current) => ({ ...current, phase: 'failed', failure, pendingIntentId: null, revision: current.revision + 1 }))
    append(`${node.advanceIntentId} · ${result.outcome} → 停留在 ${node.id}`)
  }, [append, intent, moveTo, node])

  /** Reproduce any failure this node declares, and land where it declares. */
  const injectFailure = useCallback(
    (failure: JourneyFailureId) => {
      const landing = node.failureNext
      const backwards = nodeIndex(landing) <= nodeIndex(node.id)
      setJourney((current) => ({
        ...current,
        nodeId: landing,
        phase: 'failed',
        failure,
        pendingIntentId: null,
        revision: current.revision + 1,
        ...(failure === 'origin-missing' ? { returnOrigin: null } : {}),
        ...(failure === 'relay-unavailable' ? { relay: 'unavailable' as const } : {}),
        ...(failure === 'relay-stale' ? { relay: 'stale' as const } : {}),
        ...(failure === 'match-failed' ? { match: 'none' as const } : {}),
      }))
      setPresentation(failure === 'asset-load-failed' || failure === 'asset-missing' ? 'degraded' : 'idle')
      append(`failure.${failure} → ${landing}${backwards ? '（未前进）' : '（越界！）'}`)
    },
    [append, node],
  )

  const safeReturn = useCallback(() => {
    intent.reset()
    moveTo(node.safeReturn, { phase: 'safe-return', failure: null }, `journey.safe-return → ${node.safeReturn}`)
  }, [intent, moveTo, node.safeReturn])

  const retryNode = useCallback(() => {
    intent.reset()
    setJourney((current) => ({ ...current, phase: 'ready', failure: null, revision: current.revision + 1 }))
    append(`journey.retry · ${node.id} · 新 requestId`)
  }, [append, intent, node.id])

  const restart = useCallback(() => {
    intent.reset()
    setJourney({ ...INITIAL_JOURNEY_STATE, revision: journey.revision + 1 })
    setPresentation('idle')
    setLog(['journey.restart · cold-start'])
  }, [intent, journey.revision])

  const progress = useMemo(
    () => Math.round(((nodeIndex(journey.nodeId) + 1) / JOURNEY_NODE_IDS.length) * 100),
    [journey.nodeId],
  )

  return (
    <main className="jr-root" aria-label="V0-02 旅程节点契约">
      <header className="jr-head">
        <div className="jr-head-id">
          <span className="jr-kicker">JOURNEY://NODE-CONTRACT</span>
          <h1>{node.label}</h1>
          <code>{node.id} · revision {String(journey.revision).padStart(3, '0')} · source {journey.source}</code>
        </div>
        <div className="jr-head-meta">
          <span className={`jr-phase is-${journey.phase}`}>{journey.phase}</span>
          <span className="jr-progress" aria-label={`旅程进度 ${progress}%`}><i style={{ width: `${progress}%` }} /></span>
          <button className="jr-restart" onClick={restart}><RotateCcw size={12} />回到冷启动</button>
        </div>
      </header>

      <div className="jr-body">
        <nav className="jr-rail" aria-label="旅程节点">
          <ol>
            {JOURNEY_NODE_LIST.map((item, index) => {
              const position = index < nodeIndex(journey.nodeId) ? 'past' : index === nodeIndex(journey.nodeId) ? 'current' : 'future'
              return (
                <li key={item.id} className={`is-${position}`}>
                  <button
                    onClick={() => moveTo(item.id, { phase: 'ready', failure: null }, `journey.jump → ${item.id}（调试跳转）`)}
                    aria-current={position === 'current'}
                  >
                    <em>{String(index + 1).padStart(2, '0')}</em>
                    <span>{item.label}</span>
                    {item.autoAdvance && <Film size={11} aria-label="含演出" />}
                    {position === 'past' && <Check size={11} aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <section className="jr-stage">
          <div className={`jr-node-card is-${journey.phase}`}>
            {journey.failure ? (
              <div className="jr-failure" role="alert" aria-live="assertive">
                <AlertTriangle size={22} />
                <b>{FAILURE_LABELS[journey.failure]}</b>
                <p>{FAILURE_DIAGNOSTICS[journey.failure]}</p>
                <code>落点 {node.id} · 安全返回 {node.safeReturn}</code>
              </div>
            ) : (
              <div className="jr-node-ready">
                <span className="jr-node-glyph" aria-hidden="true">
                  {journey.phase === 'pending' ? <Loader2 size={22} className="is-spin" /> : journey.phase === 'safe-return' ? <Shield size={22} /> : <Radio size={22} />}
                </span>
                <b>{node.label}</b>
                <p>{node.successNext ? `确认后推进到「${JOURNEY_NODES[node.successNext].label}」。` : '这是旅程终点，没有后续节点。'}</p>
                <code>{node.advanceIntentId}</code>
              </div>
            )}
            <MockBoundary>{node.mockBoundary}</MockBoundary>
          </div>

          <div className="jr-contract">
            <h2>节点契约</h2>
            <dl>
              <div><dt>成功落点</dt><dd>{node.successNext ? JOURNEY_NODES[node.successNext].label : '—（终点）'}</dd></div>
              <div><dt>失败落点</dt><dd>{JOURNEY_NODES[node.failureNext].label}<small>{nodeIndex(node.failureNext) <= nodeIndex(node.id) ? '不前进' : '越界'}</small></dd></div>
              <div><dt>安全返回</dt><dd>{JOURNEY_NODES[node.safeReturn].label}</dd></div>
              <div><dt>可重试</dt><dd>{node.retry ? '是' : '否'}</dd></div>
              <div><dt>可取消</dt><dd>{node.cancel ? '是' : '否'}</dd></div>
              <div><dt>可超时</dt><dd>{node.timeout ? '是' : '否'}</dd></div>
              <div><dt>含演出</dt><dd>{node.autoAdvance ? '是（仅表现，不推进）' : '否'}</dd></div>
            </dl>
          </div>

          {node.autoAdvance && (
            <div className={`jr-presentation is-${presentation}`}>
              <h2><Film size={13} />演出与推进分离</h2>
              <p>{PRESENTATION_COPY[presentation]}</p>
              <div className="jr-presentation-actions">
                <button onClick={() => setPresentation('playing')}><Film size={12} />播放演出</button>
                <button onClick={() => setPresentation('complete')}><Check size={12} />演出播完</button>
                <button onClick={() => setPresentation('skipped')}><SkipForward size={12} />跳过演出</button>
                <button onClick={() => { setPresentation('degraded'); injectFailure('asset-load-failed') }}><CircleSlash size={12} />演出素材失败</button>
              </div>
              <small>无论演出播完、被跳过还是失败，节点都停在这里，等待下面的 intent。</small>
            </div>
          )}

          {journey.nodeId === 'bed-front-ready' && (
            <div className="jr-beds">
              <h2><Bed size={13} />床位门控</h2>
              <ul>
                {BED_GATES.map((bed) => (
                  <li key={bed.bedId} className={`is-${bed.status}`}>
                    <b>{bed.label}</b>
                    <span>{bed.note}</span>
                    <em>{bed.status === 'available' ? '可入局' : bed.status === 'deferred' ? '后置' : '仅自测'}</em>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="jr-actions">
            <button className="is-primary" onClick={advance} disabled={!node.successNext || intent.isPending}>
              {intent.isPending ? <Loader2 size={13} className="is-spin" /> : <ArrowRight size={13} />}
              {intent.isPending ? '等待宿主确认…' : node.successNext ? `确认推进到 ${JOURNEY_NODES[node.successNext].label}` : '终点节点'}
            </button>
            {node.retry && <button onClick={retryNode}><RotateCcw size={13} />重试当前节点</button>}
            {node.cancel && <button onClick={intent.cancel} disabled={!intent.isPending}><X size={13} />取消请求</button>}
            <button onClick={safeReturn}><Shield size={13} />安全返回 {JOURNEY_NODES[node.safeReturn].label}</button>
          </div>

          <IntentFeedback state={intent.state} onRetry={intent.retry} onCancel={intent.cancel} onSafeReturn={safeReturn} />

          <div className="jr-matrix">
            <h2><AlertTriangle size={13} />失败矩阵 · 本节点可复现 {node.failureStates.length} 种</h2>
            <div className="jr-matrix-grid">
              {node.failureStates.map((failure) => (
                <button key={failure} onClick={() => injectFailure(failure)}>
                  {failure === 'timeout' ? <Clock size={12} /> : <AlertTriangle size={12} />}
                  <b>{FAILURE_LABELS[failure]}</b>
                  <small>{FAILURE_DIAGNOSTICS[failure]}</small>
                  <code>→ {JOURNEY_NODES[node.failureNext].label}</code>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="jr-side">
          <div className="jr-state">
            <h2>投影状态</h2>
            <dl>
              <div><dt>出发位置</dt><dd>{journey.returnOrigin ?? '未记录'}</dd></div>
              <div><dt>床 A</dt><dd>{journey.bedA}</dd></div>
              <div><dt>匹配</dt><dd>{journey.match}</dd></div>
              <div><dt>中继</dt><dd>{journey.relay}</dd></div>
              <div><dt>待确认 intent</dt><dd>{journey.pendingIntentId ?? '无'}</dd></div>
            </dl>
          </div>
          <div className="jr-log">
            <h2>迁移日志</h2>
            <ol aria-live="polite">
              {log.map((line, index) => <li key={`${line}-${index}`}><code>{line}</code></li>)}
            </ol>
          </div>
        </aside>
      </div>
    </main>
  )
}

/** State the host would have set alongside an accepted transition. */
function sideEffects(from: JourneyNodeId): Partial<JourneyState> {
  switch (from) {
    case 'residence':
      return { returnOrigin: 'residence:anchor-west' }
    case 'anchor-device':
      return { match: 'matching' }
    case 'matching':
      return { match: 'complete', relay: 'live', bedA: 'lit' }
    case 'shadow-lobby':
      return { bedA: 'ready' }
    case 'return-home':
      return { bedA: 'locked', match: 'none', relay: 'none' }
    default:
      return {}
  }
}

export type { JourneyNode }
