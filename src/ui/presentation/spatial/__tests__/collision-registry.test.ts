import { describe, expect, it } from 'vitest'
import { CollisionRegistry, type CollisionBox } from '../stores/collision-registry'

const box = (overrides: Partial<CollisionBox> = {}): CollisionBox => ({
  entityId: 'e1',
  center: { x: 0, y: 0 },
  radius: 8,
  mobility: 'movable-character',
  ...overrides,
})

describe('CollisionRegistry (R4)', () => {
  it('registers a new collision box', () => {
    const reg = new CollisionRegistry()
    const stored = reg.register(box())
    expect(stored).toEqual(box())
    expect(reg.size()).toBe(1)
  })

  it('returns the existing box on duplicate registration', () => {
    const reg = new CollisionRegistry()
    const first = reg.register(box())
    const second = reg.register(box({ radius: 16 }))
    expect(second).toBe(first)
    expect(reg.size()).toBe(1)
    expect(reg.get('e1')?.radius).toBe(8)
  })

  it('updates mobility without removing the box', () => {
    const reg = new CollisionRegistry()
    reg.register(box())
    expect(reg.setMobility('e1', 'immovable-entity')).toBe(true)
    expect(reg.get('e1')?.mobility).toBe('immovable-entity')
  })

  it('removes boxes for removed entities', () => {
    const reg = new CollisionRegistry()
    reg.register(box())
    expect(reg.deregister('e1')).toBe(true)
    expect(reg.size()).toBe(0)
  })

  it('rejects update on missing entity', () => {
    const reg = new CollisionRegistry()
    expect(reg.setMobility('missing', 'immovable-character')).toBe(false)
  })

  it('clears all boxes', () => {
    const reg = new CollisionRegistry()
    reg.register(box({ entityId: 'a' }))
    reg.register(box({ entityId: 'b' }))
    reg.clear()
    expect(reg.size()).toBe(0)
  })
})
