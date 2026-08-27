import { describe, expect, it } from 'vitest'
import { MoveChoreographer } from '../choreography/move-choreographer'
import { SpatialProjectionStore } from '../stores/projection-store'

describe('MoveChoreographer (R7)', () => {
  it('accepts a move when projection revision is current', () => {
    const projection = new SpatialProjectionStore()
    projection.commit({ revision: 4, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [], buildingRenderMode: { kind: 'exterior' as const } })
    const mc = new MoveChoreographer({ projection, mode: 'single' })
    const r = mc.submit({ entityId: 'e1', toRevision: 4, path: [{ x: 0, y: 0 }] })
    expect(r).toEqual({ accepted: true, stale: false })
    expect(mc.queueSize).toBe(1)
  })

  it('rejects a move whose target revision is older than current', () => {
    const projection = new SpatialProjectionStore()
    projection.commit({ revision: 4, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [], buildingRenderMode: { kind: 'exterior' as const } })
    const mc = new MoveChoreographer({ projection, mode: 'single' })
    const r = mc.submit({ entityId: 'e1', toRevision: 2, path: [{ x: 0, y: 0 }] })
    expect(r).toEqual({ accepted: false, stale: true })
    expect(mc.queueSize).toBe(0)
  })

  it('accepts a move when the projection has not been committed (initial state)', () => {
    const projection = new SpatialProjectionStore()
    const mc = new MoveChoreographer({ projection, mode: 'multi' })
    const r = mc.submit({ entityId: 'e1', toRevision: 1, path: [{ x: 0, y: 0 }] })
    expect(r).toEqual({ accepted: true, stale: false })
  })

  it('queues multiple moves and drains in order', () => {
    const projection = new SpatialProjectionStore()
    projection.commit({ revision: 3, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [], buildingRenderMode: { kind: 'exterior' as const } })
    const mc = new MoveChoreographer({ projection, mode: 'multi' })
    mc.submit({ entityId: 'e1', toRevision: 3, path: [{ x: 0, y: 0 }] })
    mc.submit({ entityId: 'e2', toRevision: 3, path: [{ x: 1, y: 0 }] })
    const drained = mc.drainPending()
    expect(drained.length).toBe(2)
    expect(mc.queueSize).toBe(0)
  })
})
