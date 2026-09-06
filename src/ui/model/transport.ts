import type { UiDiagnostic } from './diagnostic'
import type { InteractionIntent } from './intent'
import type { StateRevision } from './revision'

export const UI_TRANSPORT_PROTOCOL_VERSION = '1.0' as const

interface EnvelopeBase {
  readonly protocolVersion: typeof UI_TRANSPORT_PROTOCOL_VERSION
  readonly sessionId: string
  readonly mapBundleId: string
  readonly requestId: string
  readonly idempotencyKey: string
}

export interface IntentEnvelope extends EnvelopeBase {
  readonly kind: 'intent'
  readonly observedRevision: StateRevision
  readonly intent: InteractionIntent
}

export interface ResultEnvelope extends EnvelopeBase {
  readonly kind: 'result'
  readonly status: 'accepted' | 'rejected' | 'stale'
  readonly committedRevision?: StateRevision
  readonly diagnostics: readonly UiDiagnostic[]
}

export interface SnapshotEnvelope extends EnvelopeBase {
  readonly kind: 'snapshot'
  readonly revision: StateRevision
  readonly projection: unknown
}

export interface ReconnectEnvelope extends EnvelopeBase {
  readonly kind: 'reconnect'
  readonly lastObservedRevision: StateRevision | null
}

export type UiTransportEnvelope = IntentEnvelope | ResultEnvelope | SnapshotEnvelope | ReconnectEnvelope

export type TransportDiagnosticCode =
  | 'UNSUPPORTED_PROTOCOL'
  | 'INVALID_ENVELOPE'
  | 'REVISION_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'

export interface TransportDiagnostic {
  readonly code: TransportDiagnosticCode
  readonly message: string
  readonly correction: string
}

export function validateTransportEnvelope(envelope: UiTransportEnvelope): readonly TransportDiagnostic[] {
  const diagnostics: TransportDiagnostic[] = []
  if (envelope.protocolVersion !== UI_TRANSPORT_PROTOCOL_VERSION) {
    diagnostics.push({ code: 'UNSUPPORTED_PROTOCOL', message: `不支持协议版本 ${envelope.protocolVersion}`, correction: `使用 ${UI_TRANSPORT_PROTOCOL_VERSION} 并请求全量快照。` })
  }
  if (!envelope.sessionId || !envelope.mapBundleId || !envelope.requestId || !envelope.idempotencyKey) {
    diagnostics.push({ code: 'INVALID_ENVELOPE', message: '通信包络缺少 session/map/request/idempotency 标识。', correction: '补齐全部关联标识后重试。' })
  }
  if (envelope.kind === 'intent' && (envelope.observedRevision.sequence !== envelope.intent.observedRevision.sequence || envelope.observedRevision.fingerprint !== envelope.intent.observedRevision.fingerprint)) {
    diagnostics.push({ code: 'REVISION_MISMATCH', message: '包络修订与意图修订不一致。', correction: '从同一份当前投影重新构造意图。' })
  }
  if (envelope.kind === 'result' && envelope.status === 'accepted' && envelope.committedRevision === undefined) {
    diagnostics.push({ code: 'INVALID_ENVELOPE', message: 'accepted 结果缺少 committedRevision。', correction: '权威侧必须返回已提交修订，客户端观察到该修订后才算完成。' })
  }
  return Object.freeze(diagnostics.map((item) => Object.freeze(item)))
}

export interface IdempotencyLedger<T> {
  resolve(envelope: EnvelopeBase, execute: () => T): { readonly replayed: boolean; readonly value: T }
}

export function createIdempotencyLedger<T>(): IdempotencyLedger<T> {
  const results = new Map<string, { readonly requestId: string; readonly value: T }>()
  return Object.freeze({
    resolve(envelope: EnvelopeBase, execute: () => T) {
      const key = `${envelope.sessionId}:${envelope.mapBundleId}:${envelope.idempotencyKey}`
      const previous = results.get(key)
      if (previous !== undefined) {
        if (previous.requestId !== envelope.requestId) {
          throw new Error('IDEMPOTENCY_CONFLICT')
        }
        return Object.freeze({ replayed: true, value: previous.value })
      }
      const value = execute()
      results.set(key, Object.freeze({ requestId: envelope.requestId, value }))
      return Object.freeze({ replayed: false, value })
    },
  })
}

export function reconnectNeedsSnapshot(request: ReconnectEnvelope, current: StateRevision): boolean {
  return request.lastObservedRevision === null
    || request.lastObservedRevision.sequence !== current.sequence
    || request.lastObservedRevision.fingerprint !== current.fingerprint
}
