import { describe, expect, it } from 'vitest'
import { assetRefForView } from '../asset-ref'
import { createMetaStateStore } from '../store'
import { quickBarSet, materialSetTexture, toggleStar } from '../actions/material-actions'
import type { MetaState } from '../types'

const initial: MetaState = {
  identities: {
    standard: { id: 'standard', name: '标准件', introduction: '标准素材', textureAssetRef: assetRefForView('asset:standard', 'item-front'), quality: 1, displayCategory: '物品' },
    crafted: { id: 'crafted', name: '合成物', introduction: '合成素材', textureAssetRef: assetRefForView('asset:crafted', 'item-front'), quality: 2, displayCategory: '物品' },
  },
  materials: {
    standard: { owned: true, source: 'standard', quality: 1, starred: false, modified: false, isUgcNew: false, equippedTokens: [], weakness: null, limitedFree: false },
    crafted: { owned: true, source: 'synthesized', quality: 2, starred: false, modified: false, isUgcNew: false, equippedTokens: [], weakness: null, limitedFree: false },
  },
  tokens: {}, blueprints: {}, quickBar: { materialSlots: [null] }, moldingBar: { unlocked: [true], contents: [null] }, synthesisQueue: [],
}

describe('MetaState material actions', () => {
  it('writes through revision and rejects stale calls', () => {
    const store = createMetaStateStore(initial)
    const revision = store.getState().revision
    const accepted = toggleStar(store, 'standard', revision)
    expect(accepted.kind).toBe('accepted')
    const stale = toggleStar(store, 'standard', revision)
    expect(stale.kind).toBe('stale')
  })

  it('enforces quickbar and texture ownership rules', () => {
    const store = createMetaStateStore(initial)
    const revision = store.getState().revision
    expect(quickBarSet(store, 'standard', 0, revision).kind).toBe('accepted')
    const nextRevision = store.getState().revision
    expect(materialSetTexture(store, 'standard', assetRefForView('asset:new', 'item-front'), nextRevision).kind).toBe('rejected')
    expect(materialSetTexture(store, 'crafted', assetRefForView('asset:new', 'item-front'), nextRevision).kind).toBe('accepted')
  })
})
