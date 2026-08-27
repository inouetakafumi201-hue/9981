import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventBridge } from '../choreography/event-bridge'
import { SpatialEntityStore } from '../stores/spatial-entity-store'
import { ClusterStore } from '../stores/cluster-store'
import type { MicroSceneEvent } from '../stores/cluster-store'

describe('EventBridge (P2: 真正驱动 stores)', () => {
  let entities: SpatialEntityStore
  let clusters: ClusterStore
  let bridge: EventBridge

  beforeEach(() => {
    entities = new SpatialEntityStore()
    clusters = new ClusterStore()
    bridge = new EventBridge({ entities, clusters })
  })

  // ── R6: stale 丢弃 ──────────────────────────────────────────────────────────

  it('drops stale events (older revision)', () => {
    bridge.consume({ type: 'after:entity.place', payload: { entityId: 'e1', nodeId: 'n1' }, revision: 5 })
    bridge.consume({ type: 'after:entity.place', payload: { entityId: 'e1', nodeId: 'n2' }, revision: 3 })
    expect(entities.getNode('e1')).toBe('n1')
  })

  // ── R1/R6: after:entity.place → SpatialEntityStore.update ─────────────────

  it('updates SpatialEntityStore on after:entity.place (direct nodeId)', () => {
    bridge.consume({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n1' },
      revision: 1,
    })
    expect(entities.getNode('e1')).toBe('n1')
    expect(entities.current().revision).toBe(1)
  })

  it('updates SpatialEntityStore on after:entity.place (microScene target)', () => {
    bridge.consume({
      type: 'after:entity.place',
      payload: {
        entityId: 'e1',
        microScene: { hostNodeId: 'h1', existingMicroSceneId: 'ms1', microSceneDefId: 'd:cell' },
      },
      revision: 2,
    })
    // Falls back to existingMicroSceneId
    expect(entities.getNode('e1')).toBe('ms1')
  })

  // ── R6: after:rule-settled 透传 ───────────────────────────────────────────

  it('forwards after:rule-settled to subscribers without consuming state', () => {
    const handler = vi.fn()
    bridge.subscribe(handler)
    bridge.consume({ type: 'after:rule-settled', payload: { reason: 'movement' }, revision: 1 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'after:rule-settled' }),
    )
  })

  // ── R6: 订阅者能收到 after:entity.place ────────────────────────────────────

  it('emits after:entity.place to subscribers', () => {
    const handler = vi.fn()
    bridge.subscribe(handler)
    bridge.consume({ type: 'after:entity.place', payload: { entityId: 'e1', nodeId: 'n1' }, revision: 1 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0].type).toBe('after:entity.place')
  })

  // ── P2: after:entity.move → SpatialEntityStore.update ─────────────────────

  it('updates SpatialEntityStore on after:entity.move', () => {
    entities.update({ entityId: 'e1', nodeId: 'n0' }, 0)
    bridge.consume({
      type: 'after:entity.move',
      payload: { entityId: 'e1', toNodeId: 'n1' },
      revision: 1,
    })
    expect(entities.getNode('e1')).toBe('n1')
  })

  // ── P2: 端到端 — kernel 事件驱动 stores，revision 正确 ───────────────────

  it('drives entities + clusters revision in lock-step from kernel events', () => {
    const handler = vi.fn()
    bridge.subscribe(handler)

    bridge.consume({ type: 'after:entity.place', payload: { entityId: 'e1', nodeId: 'n1' }, revision: 1 })
    expect(entities.current().revision).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)

    bridge.consume({ type: 'after:entity.place', payload: { entityId: 'e2', nodeId: 'n2' }, revision: 2 })
    expect(entities.current().revision).toBe(2)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  // ── P2: clear 解除所有订阅 ─────────────────────────────────────────────────

  it('clear() removes all subscribers', () => {
    const handler = vi.fn()
    bridge.subscribe(handler)
    bridge.clear()
    bridge.consume({ type: 'after:rule-settled', payload: { reason: 'x' }, revision: 1 })
    expect(handler).not.toHaveBeenCalled()
  })
})
