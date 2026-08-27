import { describe, expect, it } from 'vitest'
import { assertFrozenProjection, isFreshProjection } from '../projection'
import { createMetaStateStore } from '../store'
import type { MetaState } from '../types'

const state: MetaState = {
  identities: {}, materials: {}, tokens: {}, blueprints: {},
  quickBar: { materialSlots: [null] },
  moldingBar: { unlocked: [false], contents: [null] },
  synthesisQueue: [],
}

describe('MetaState store', () => {
  it('publishes frozen snapshots with monotonic revision', () => {
    const store = createMetaStateStore(state)
    const first = store.getState()
    const second = store.commit(state)
    expect(second.revision).toBeGreaterThan(first.revision)
    expect(second.authority).toBe('demo-fixture')
    expect(assertFrozenProjection(second)).toBe(second)
    expect(isFreshProjection(second, first.revision)).toBe(true)
  })
})
