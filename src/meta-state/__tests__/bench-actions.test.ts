import { describe, expect, it } from 'vitest'
import { assetRefForView } from '../asset-ref'
import { createMetaStateStore } from '../store'
import { extractToken, forgeModify, moldingSet, synthesizeClaim, synthesizeSubmit } from '../actions/bench-actions'
import type { MetaState } from '../types'

const state: MetaState = {
  identities: { base: { id: 'base', name: '基体', introduction: '基体', textureAssetRef: assetRefForView('asset:base', 'item-front'), quality: 1, displayCategory: '物品' } },
  materials: { base: { owned: true, source: 'standard', quality: 1, starred: false, modified: false, isUgcNew: false, equippedTokens: [], weakness: null, limitedFree: false } },
  tokens: { token: { id: 'token', name: '属性', category: '属性', owned: true, quality: 1, starred: false, collectedAt: null } },
  blueprints: {}, quickBar: { materialSlots: [null] }, moldingBar: { unlocked: [true], contents: [null] }, synthesisQueue: [],
}

describe('MetaState bench actions', () => {
  it('keeps extraction pending until whitelist converges', () => {
    const store = createMetaStateStore(state)
    expect(extractToken(store, 'base', '属性', store.getState().revision).kind).toBe('pending')
  })

  it('writes forge and molding through the store', () => {
    const store = createMetaStateStore(state)
    let revision = store.getState().revision
    expect(forgeModify(store, 'base', ['token'], 'save', revision).kind).toBe('accepted')
    revision = store.getState().revision
    expect(moldingSet(store, 0, 'base', revision).kind).toBe('accepted')
  })

  it('requires an owner-provided result id before claim', () => {
    const store = createMetaStateStore(state)
    const submitted = synthesizeSubmit(store, 'base', ['token'], 'job:1', store.getState().revision)
    expect(submitted.kind).toBe('accepted')
    const missing = synthesizeClaim(store, 'job:1', '', store.getState().revision)
    expect(missing.kind).toBe('rejected')
  })
})
