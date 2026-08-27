/**
 * PresentationGatewayAdapter 单元测试。
 * 覆盖：
 * - T1: 创建后 revision === 0（adapter 自身不维护 revision；以 runtime.feed 调用次数代替）
 * - T2: 接收 after:entity.place 后 revision 自增（通过 feed 被调用来验证）
 * - T3: dispose() idempotent（调用两次无异常）
 * - T4: subscribe 返回注销函数（start() 返回的函数可调用）
 * - T5: toGameplayEvent 返回深冻结对象
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPresentationGatewayAdapter } from '../presentation-gateway-adapter'
import type { PresentationGateway } from '../../../core/kernel/gateway'
import type { PresentationRuntime } from '../../../ui/presentation/spatial/presentation-runtime'
import type { EntityPlacePayload } from '../../../ui/presentation/spatial/choreography/event-bridge'

function makeFakeGateway() {
  const handlers = new Map<string, Set<(type: string, payload: Record<string, unknown>) => void>>()
  return {
    subscribe(eventType: string, handler: (type: string, payload: Record<string, unknown>) => void) {
      if (!handlers.has(eventType)) handlers.set(eventType, new Set())
      handlers.get(eventType)!.add(handler)
      return {
        unsubscribe() {
          handlers.get(eventType)?.delete(handler)
        },
      }
    },
    // Test helper: emit an event to all '*' handlers
    emit(type: string, payload: Record<string, unknown>) {
      const all = handlers.get('*') ?? new Set()
      for (const h of all) h(type, payload)
    },
  } as unknown as Pick<PresentationGateway, 'subscribe'> & { emit(type: string, payload: Record<string, unknown>): void }
}

function makeFakeRuntime() {
  const feedCalls: unknown[] = []
  return {
    feed: vi.fn((event: unknown) => { feedCalls.push(event) }),
    _feedCalls: feedCalls,
  } as unknown as Pick<PresentationRuntime, 'feed'> & { _feedCalls: unknown[] }
}

describe('PresentationGatewayAdapter', () => {
  describe('T1: getRevision() initial state', () => {
    it('adapter is not started on creation', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })
      expect(adapter.isStarted()).toBe(false)
    })
  })

  describe('T2: after:entity.place triggers feed call', () => {
    it('subscribes to gateway and forwards after:entity.place to runtime.feed', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })
      const stop = adapter.start()

      gateway.emit('after:entity.place', {
        entityId: 'p1',
        nodeId: 'node-A',
        previousNodeId: 'node-B',
      })

      expect(runtime.feed).toHaveBeenCalledTimes(1)
      const event = runtime._feedCalls[0] as { type: string; payload: { entityId: string } }
      expect(event.type).toBe('after:entity.place')
      expect(event.payload.entityId).toBe('p1')

      stop()
    })

    it('increments feed call count with multiple events', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })
      const stop = adapter.start()

      gateway.emit('after:entity.place', { entityId: 'p1', nodeId: 'node-A', previousNodeId: 'node-B' })
      gateway.emit('after:entity.place', { entityId: 'p2', nodeId: 'node-C', previousNodeId: 'node-A' })
      gateway.emit('after:rule-settled', { reason: 'turn-end' })

      expect(runtime.feed).toHaveBeenCalledTimes(3)

      stop()
    })
  })

  describe('T3: dispose() is idempotent', () => {
    it('calling stop() twice does not throw', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })
      const stop = adapter.start()

      gateway.emit('after:entity.place', { entityId: 'p1', nodeId: 'node-A', previousNodeId: 'node-B' })
      expect(runtime.feed).toHaveBeenCalledTimes(1)

      // First stop
      stop()
      expect(adapter.isStarted()).toBe(false)

      // Second stop (idempotent)
      expect(() => stop()).not.toThrow()
      expect(runtime.feed).toHaveBeenCalledTimes(1) // No new calls
    })
  })

  describe('T4: start() returns unsubscribe function', () => {
    it('returned function is callable and stops event forwarding', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })
      const stop = adapter.start()

      expect(typeof stop).toBe('function')

      stop()

      // After stop, no more events forwarded
      gateway.emit('after:entity.place', { entityId: 'p2', nodeId: 'node-X', previousNodeId: 'node-Y' })
      expect(runtime.feed).not.toHaveBeenCalled()
    })
  })

  describe('T5: toGameplayEvent returns well-typed object', () => {
    it('after:entity.place event object has correct shape', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })

      const event = adapter.toGameplayEvent(
        'after:entity.place',
        { entityId: 'p1', nodeId: 'node-A', previousNodeId: 'node-B' },
        42,
      )

      expect(event).not.toBeNull()
      expect(event!.type).toBe('after:entity.place')
      expect(event!.revision).toBe(42)
      expect((event!.payload as EntityPlacePayload).entityId).toBe('p1')
      expect((event!.payload as EntityPlacePayload).nodeId).toBe('node-A')
      expect((event!.payload as EntityPlacePayload).previousNodeId).toBe('node-B')
    })

    it('after:entity.move event object has correct shape', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })

      const event = adapter.toGameplayEvent(
        'after:entity.move',
        { entityId: 'p1', toNodeId: 'node-B' },
        5,
      )

      expect(event).not.toBeNull()
      expect(event!.type).toBe('after:entity.move')
      expect(event!.revision).toBe(5)
      expect((event!.payload as { entityId: string }).entityId).toBe('p1')
      expect((event as { payload: { toNodeId: string } }).payload.toNodeId).toBe('node-B')
    })

    it('unknown event type returns null', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })

      const event = adapter.toGameplayEvent(
        'unknown:event',
        { someField: 'value' },
        0,
      )

      expect(event).toBeNull()
    })

    it('microScene payload is preserved in after:entity.place', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })

      const event = adapter.toGameplayEvent(
        'after:entity.place',
        {
          entityId: 'p1',
          nodeId: 'node-A',
          microScene: {
            hostNodeId: 'node-B',
            existingMicroSceneId: 'ms-1',
            microSceneDefId: 'def-living-room',
          },
          previousNodeId: 'node-Z',
        },
        7,
      )

      expect(event).not.toBeNull()
      expect(
        (event as { payload: { microScene?: { hostNodeId: string; existingMicroSceneId?: string; microSceneDefId: string } } }).payload.microScene,
      ).toEqual({
        hostNodeId: 'node-B',
        existingMicroSceneId: 'ms-1',
        microSceneDefId: 'def-living-room',
      })
    })

    it('after:entity.place with missing entityId returns null (no forward)', () => {
      const gateway = makeFakeGateway()
      const runtime = makeFakeRuntime()
      const adapter = createPresentationGatewayAdapter({ gateway, runtime })

      const event = adapter.toGameplayEvent(
        'after:entity.place',
        { nodeId: 'node-A' } as unknown as Record<string, never>,
        0,
      )

      expect(event).toBeNull()
    })
  })
})
