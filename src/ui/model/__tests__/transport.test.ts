import { describe, expect, it, vi } from 'vitest'
import type { InteractionIntent } from '../intent'
import {
  createIdempotencyLedger,
  reconnectNeedsSnapshot,
  validateTransportEnvelope,
  type IntentEnvelope,
  type ReconnectEnvelope,
  type ResultEnvelope,
} from '../transport'

const revision = { sequence: 3, fingerprint: 'state-3' }
const intent: InteractionIntent = {
  intentId: 'intent:1', agentId: 'player:1', target: { kind: 'action', actionId: 'inspect' },
  bindings: {}, observedRevision: revision, inputSource: 'keyboard',
}
const envelope: IntentEnvelope = {
  protocolVersion: '1.0', kind: 'intent', sessionId: 'session:1', mapBundleId: 'bundle:residence',
  requestId: 'request:1', idempotencyKey: 'intent:1', observedRevision: revision, intent,
}

describe('UI transport envelope', () => {
  it('requires correlation ids and matching revisions', () => {
    expect(validateTransportEnvelope(envelope)).toEqual([])
    const invalid = { ...envelope, observedRevision: { sequence: 2, fingerprint: 'state-2' } }
    expect(validateTransportEnvelope(invalid).map((item) => item.code)).toContain('REVISION_MISMATCH')
  })

  it('requires committedRevision before accepted can be reported', () => {
    const result: ResultEnvelope = { ...envelope, kind: 'result', status: 'accepted', diagnostics: [] }
    expect(validateTransportEnvelope(result).map((item) => item.code)).toContain('INVALID_ENVELOPE')
  })

  it('executes an idempotent request once and replays its result', () => {
    const execute = vi.fn(() => ({ ok: true }))
    const ledger = createIdempotencyLedger<{ ok: boolean }>()
    expect(ledger.resolve(envelope, execute).replayed).toBe(false)
    expect(ledger.resolve(envelope, execute).replayed).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects an idempotency key reused by a different request', () => {
    const ledger = createIdempotencyLedger<{ ok: boolean }>()
    ledger.resolve(envelope, () => ({ ok: true }))
    expect(() => ledger.resolve({ ...envelope, requestId: 'request:2' }, () => ({ ok: false }))).toThrow('IDEMPOTENCY_CONFLICT')
  })

  it('accepts rejected and stale results without a committed revision', () => {
    for (const status of ['rejected', 'stale'] as const) {
      const result: ResultEnvelope = { ...envelope, kind: 'result', status, diagnostics: [] }
      expect(validateTransportEnvelope(result)).toEqual([])
    }
  })

  it('requests a full snapshot on first connect, revision gaps, or fingerprint drift', () => {
    const reconnect: ReconnectEnvelope = { ...envelope, kind: 'reconnect', lastObservedRevision: null }
    expect(reconnectNeedsSnapshot(reconnect, revision)).toBe(true)
    expect(reconnectNeedsSnapshot({ ...reconnect, lastObservedRevision: { sequence: 2, fingerprint: 'state-2' } }, revision)).toBe(true)
    expect(reconnectNeedsSnapshot({ ...reconnect, lastObservedRevision: { sequence: 3, fingerprint: 'diverged' } }, revision)).toBe(true)
    expect(reconnectNeedsSnapshot({ ...reconnect, lastObservedRevision: revision }, revision)).toBe(false)
  })
})
