import { describe, expect, it } from 'vitest'
import { createDemoMetaStateStore } from '../../meta-state/demo-fixture'

describe('shell MetaState owner', () => {
  it('starts as an explicitly marked demo fixture', () => {
    const store = createDemoMetaStateStore()
    const projection = store.getState()
    expect(projection.authority).toBe('demo-fixture')
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.keys(projection.identities)).toContain('material:demo-locker')
  })
})
