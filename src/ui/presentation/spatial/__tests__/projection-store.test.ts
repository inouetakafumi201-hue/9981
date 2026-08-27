import { describe, expect, it } from 'vitest'
import { SpatialProjectionStore, deepFreeze } from '../stores/projection-store'
import type { SpatialProjection } from '../spatial-view'

const projection = (revision: number): SpatialProjection => ({
  revision,
  layers: [],
  nodes: [],
  edges: [],
  entities: [],
  clusters: [],
  tiles: [],
  buildingRenderMode: { kind: 'exterior' as const },
})

describe('SpatialProjectionStore (R1, R13)', () => {
  it('returns null before any commit', () => {
    const s = new SpatialProjectionStore()
    expect(s.current()).toBeNull()
    expect(s.isPending()).toBe(true)
  })

  it('exposes a deep-frozen projection after commit', () => {
    const s = new SpatialProjectionStore()
    s.commit(projection(3))
    const snap = s.current()
    expect(snap).not.toBeNull()
    expect(Object.isFrozen(snap)).toBe(true)
  })

  it('rejects a commit whose revision is older than the current', () => {
    const s = new SpatialProjectionStore()
    s.commit(projection(10))
    s.commit(projection(5))
    expect(s.current()?.revision).toBe(10)
  })

  it('replaces the snapshot atomically on a newer commit', () => {
    const s = new SpatialProjectionStore()
    const first = projection(1)
    const second = { ...projection(2), layers: [] }
    s.commit(first)
    s.commit(second)
    const snap = s.current()
    expect(snap?.revision).toBe(2)
    expect(Object.isFrozen(snap)).toBe(true)
  })

  it('notifies subscribers on each commit', () => {
    const s = new SpatialProjectionStore()
    const seen: (number | null)[] = []
    s.subscribe((snap) => seen.push(snap?.revision ?? null))
    expect(seen[0]).toBeNull()
    s.commit(projection(7))
    s.commit(projection(8))
    expect(seen).toEqual([null, 7, 8])
  })

  it('notifies subscribers of a pending state before any commit', () => {
    const s = new SpatialProjectionStore()
    let initial: number | undefined
    s.subscribe((snap) => { initial = snap?.revision })
    expect(initial).toBeUndefined()
    expect(s.isPending()).toBe(true)
  })

  it('returns rejection state when upstream rejects', () => {
    const s = new SpatialProjectionStore()
    s.commit(projection(2))
    s.reject({ error: 'map-load-failed', revision: 3 })
    expect(s.isPending()).toBe(true)
    expect(s.current()).toBeNull()
  })

  it('deepFreeze freezes nested objects and arrays', () => {
    const p = {
      revision: 1,
      layers: [{ id: 'l1', name: 'Layer 1', height: 0, opacity: 1 }],
      nodes: [],
      edges: [],
      entities: [],
      clusters: [],
      tiles: [],
    }
    const f = deepFreeze(p)
    expect(Object.isFrozen(f)).toBe(true)
    expect(Object.isFrozen(f.layers)).toBe(true)
    expect(Object.isFrozen(f.layers[0])).toBe(true)
  })
})
