import { describe, expect, it } from 'vitest'
import { SpatialEntityStore } from '../stores/spatial-entity-store'

describe('SpatialEntityStore (P1)', () => {
  it('records entity → nodeId on update', () => {
    const s = new SpatialEntityStore()
    s.update({ entityId: 'e1', nodeId: 'n1' }, 1)
    expect(s.getNode('e1')).toBe('n1')
    expect(s.current().revision).toBe(1)
  })

  it('drops stale updates (older revision)', () => {
    const s = new SpatialEntityStore()
    s.update({ entityId: 'e1', nodeId: 'n1' }, 5)
    s.update({ entityId: 'e1', nodeId: 'n2' }, 3)
    expect(s.getNode('e1')).toBe('n1')
  })

  it('replayAll replaces snapshot with new revision', () => {
    const s = new SpatialEntityStore()
    s.update({ entityId: 'e1', nodeId: 'n1' }, 1)
    s.replayAll([{ entityId: 'e2', nodeId: 'n2' }], 5)
    expect(s.getNode('e1')).toBeUndefined()
    expect(s.getNode('e2')).toBe('n2')
  })

  it('replayAll skips entries with empty nodeId', () => {
    const s = new SpatialEntityStore()
    s.replayAll([
      { entityId: 'e1', nodeId: 'n1' },
      { entityId: 'e2', nodeId: '' },
    ], 1)
    expect(s.getNode('e1')).toBe('n1')
    expect(s.getNode('e2')).toBeUndefined()
  })

  it('notifies subscribers on each update', () => {
    const s = new SpatialEntityStore()
    const seen: number[] = []
    s.subscribe((snap) => seen.push(snap.revision))
    s.update({ entityId: 'e1', nodeId: 'n1' }, 1)
    s.update({ entityId: 'e2', nodeId: 'n2' }, 2)
    expect(seen).toEqual([0, 1, 2])
  })

  it('snapshot is deep-frozen', () => {
    const s = new SpatialEntityStore()
    s.update({ entityId: 'e1', nodeId: 'n1' }, 1)
    const snap = s.current()
    expect(Object.isFrozen(snap)).toBe(true)
    expect(Object.isFrozen(snap.records)).toBe(true)
  })
})
