/**
 * realTransportAdapter 单元测试。
 * 覆盖：
 * - T1: accepted 翻译
 * - T2: rejected 翻译
 * - T3: stale 翻译
 * - T4: timeout（强制注入）翻译
 * - T5: cancel 路径
 * - T6: INTENT_NOT_REGISTERED 路径
 * - T7: 800ms 内无 revision 更新 → degraded
 * - T8: 玩家可见数值超界被拒绝
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createRealTransportAdapter,
  isRegisteredIntentId,
  REASON_CODES,
  DEFAULT_DEGRADED_TIMEOUT_MS,
} from '../v0-bridge/real-transport-adapter'
import type { InteractionIntent } from '../../../../ui/model/intent'
import type { SubmissionOutcome } from '../../../../ui/ports/action-port'
import type { UiSystem } from '../../../../ui/index'

function makeFakeUiSystem(behavior: (intent: InteractionIntent) => SubmissionOutcome): UiSystem {
  return {
    interaction: {
      sendIntent: vi.fn((intent: InteractionIntent) => behavior(intent)),
    },
  } as unknown as UiSystem
}

function makeShellRequest(overrides: Partial<{
  intentId: string
  requestId: string
  parameters: Record<string, unknown>
  revision: number
}> = {}) {
  return {
    intentId: 'menu.new-game',
    requestId: 'req-1',
    source: 'menu-title',
    target: 'residence-main',
    parameters: {},
    revision: 1,
    ...overrides,
  }
}

describe('realTransportAdapter', () => {
  describe('T1: accepted outcome translation', () => {
    it('returns accepted state when UiSystem returns accepted and projection revision bumps', async () => {
      let projectionRev = 0
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => {
          projectionRev += 1
          return projectionRev
        },
        // skip sleep for test speed
        sleep: vi.fn(async () => {}),
        now: () => 0,
      })

      const result = await adapter.request(makeShellRequest())
      expect(result.state).toBe('accepted')
      expect(result.reasonCode).toBeUndefined()
      expect(result.message).toBe('宿主已确认该请求。')
    })

    it('sendIntent is called with correctly translated InteractionIntent', async () => {
      const sendIntent = vi.fn(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const uiSystem = { interaction: { sendIntent } } as unknown as UiSystem
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 2,
        sleep: vi.fn(async () => {}),
      })

      await adapter.request(makeShellRequest({
        intentId: 'residence.match.start',
        parameters: { anchorSlot: 'slot-1' },
        revision: 5,
      }))

      expect(sendIntent).toHaveBeenCalledTimes(1)
      const intent = sendIntent.mock.calls[0]?.[0] as unknown as InteractionIntent
      expect(intent.intentId).toBe('residence.match.start')
      expect(intent.bindings).toEqual({ anchorSlot: 'slot-1' })
      expect(intent.agentId).toBe('player-1')
      expect(intent.inputSource).toBe('pointer')
    })
  })

  describe('T2: rejected outcome translation', () => {
    it('returns rejected with REAL_HOST_REJECTED when UiSystem returns rejected', async () => {
      const uiSystem = makeFakeUiSystem(() => ({
        kind: 'rejected',
        rejection: { kind: 'PERMISSION_DENIED', message: 'forbidden' },
      } as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
      })

      const result = await adapter.request(makeShellRequest())
      expect(result.state).toBe('rejected')
      expect(result.reasonCode).toBe('REAL_HOST_REJECTED')
    })
  })

  describe('T3: stale outcome translation', () => {
    it('returns stale with REAL_REVISION_STALE when UiSystem returns stale', async () => {
      const uiSystem = makeFakeUiSystem(() => ({
        kind: 'stale',
        rejection: { kind: 'STALE', message: 'obsolete' },
      } as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
      })

      const result = await adapter.request(makeShellRequest())
      expect(result.state).toBe('stale')
      expect(result.reasonCode).toBe('REAL_REVISION_STALE')
    })
  })

  describe('T4: timeout via forced outcome', () => {
    it('returns timeout with REAL_TIMEOUT when forced outcome is timeout', async () => {
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
        forcedOutcome: 'timeout',
      })

      const result = await adapter.request(makeShellRequest())
      expect(result.state).toBe('timeout')
      expect(result.reasonCode).toBe(REASON_CODES.REAL_TIMEOUT)
    })
  })

  describe('T5: cancel path', () => {
    it('cancel marks inflight as cancelled; subsequent degraded check returns cancelled if pending', async () => {
      let resolveSleep: (() => void) | null = null
      const sleepPromise = new Promise<void>((resolve) => { resolveSleep = resolve })
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(() => sleepPromise),
      })

      const requestPromise = adapter.request(makeShellRequest({ requestId: 'req-cancel' }))

      // Cancel before sleep resolves
      adapter.cancel('req-cancel')

      // Now resolve sleep — adapter should detect cancellation
      if (resolveSleep) resolveSleep()

      const result = await requestPromise
      expect(result.state).toBe('cancelled')
      expect(result.reasonCode).toBe(REASON_CODES.REAL_CANCELLED)
    })

    it('cancel on unknown requestId is a no-op (does not throw)', () => {
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
      })

      expect(() => adapter.cancel('unknown-id')).not.toThrow()
    })
  })

  describe('T6: INTENT_NOT_REGISTERED', () => {
    it('returns rejected with INTENT_NOT_REGISTERED when intentId is not in the map', async () => {
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
      })

      const result = await adapter.request(makeShellRequest({ intentId: 'unregistered.action' }))
      expect(result.state).toBe('rejected')
      expect(result.reasonCode).toBe(REASON_CODES.INTENT_NOT_REGISTERED)
      expect(result.message).toContain('not in IntentMap')
    })

    it('isRegisteredIntentId returns true for supported intentIds', () => {
      expect(isRegisteredIntentId('menu.new-game')).toBe(true)
      expect(isRegisteredIntentId('session.settle')).toBe(true)
      expect(isRegisteredIntentId('residence.exit')).toBe(true)
    })

    it('isRegisteredIntentId returns false for unknown intentIds', () => {
      expect(isRegisteredIntentId('random.action')).toBe(false)
      expect(isRegisteredIntentId('')).toBe(false)
    })
  })

  describe('T7: 800ms degraded threshold', () => {
    it('returns degraded when projection revision does not bump within 800ms', async () => {
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1, // never bumps
        sleep: vi.fn(async () => {}), // completes immediately but revision didn't bump
      })

      const result = await adapter.request(makeShellRequest())
      expect(result.state).toBe('degraded')
      expect(result.reasonCode).toBe(REASON_CODES.PROJECTION_NOT_REFRESHED)
    })

    it('accepts custom degradedTimeoutMs', async () => {
      const uiSystem = makeFakeUiSystem(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const sleep = vi.fn(async () => {})
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep,
        degradedTimeoutMs: 2000,
      })

      await adapter.request(makeShellRequest())
      // sleep called with custom value
      // 1st call is the 800ms degraded wait; using 2000ms
      // but accept() doesn't wait if revision bumps; here it doesn't so sleep is called with 2000
      const firstCall = sleep.mock.calls[0]?.[0]
      expect(firstCall).toBe(2000)
    })

    it('DEFAULT_DEGRADED_TIMEOUT_MS is 800', () => {
      expect(DEFAULT_DEGRADED_TIMEOUT_MS).toBe(800)
    })
  })

  describe('T8: player visible value guard (1-5)', () => {
    it('rejects apCost out of range with PLAYER_VISIBLE_VALUE_OOR', async () => {
      const sendIntent = vi.fn()
      const uiSystem = { interaction: { sendIntent } } as unknown as UiSystem
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
      })

      const result = await adapter.request(makeShellRequest({
        intentId: 'session.settle',
        parameters: { apCost: 10 }, // out of range
      }))

      expect(result.state).toBe('rejected')
      expect(result.reasonCode).toBe(REASON_CODES.PLAYER_VISIBLE_VALUE_OOR)
      expect(sendIntent).not.toHaveBeenCalled()
    })

    it('rejects range < 1 with PLAYER_VISIBLE_VALUE_OOR', async () => {
      const sendIntent = vi.fn()
      const uiSystem = { interaction: { sendIntent } } as unknown as UiSystem
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision: () => 1,
        sleep: vi.fn(async () => {}),
      })

      const result = await adapter.request(makeShellRequest({
        intentId: 'session.settle',
        parameters: { range: 0 },
      }))

      expect(result.state).toBe('rejected')
      expect(result.reasonCode).toBe(REASON_CODES.PLAYER_VISIBLE_VALUE_OOR)
    })

    it('accepts apCost in [1,5]', async () => {
      const sendIntent = vi.fn(() => ({ kind: "accepted", committedRevision: 1 } as unknown as SubmissionOutcome))
      const uiSystem = { interaction: { sendIntent } } as unknown as UiSystem
      const getProjectionRevision = vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2) // bump after sleep
      const adapter = createRealTransportAdapter({
        uiSystem,
        getCurrentRevision: () => 1,
        getProjectionRevision,
        sleep: vi.fn(async () => {}),
      })

      const result = await adapter.request(makeShellRequest({
        intentId: 'session.settle',
        parameters: { apCost: 3 },
      }))

      expect(result.state).toBe('accepted')
    })
  })
})
