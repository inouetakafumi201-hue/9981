import { describe, expect, it } from 'vitest'
import { assetRefForView } from '../../meta-state/asset-ref'
import { createMetaStateStore } from '../../meta-state/store'
import { bindMetaStateShell } from '../wiring/meta-state-shell-binding'
import { getLibApp, toggleStar } from '../editor-shell/lib/library-store'
import type { MetaState } from '../../meta-state/types'

const state: MetaState = {
  identities: { material: { id: 'material', name: '素材', introduction: '素材', textureAssetRef: assetRefForView('asset:m', 'item-front'), quality: 1, displayCategory: '物品' } },
  materials: { material: { owned: true, source: 'standard', quality: 1, starred: false, modified: false, isUgcNew: false, equippedTokens: [], weakness: null, limitedFree: false } },
  tokens: {}, blueprints: {}, quickBar: { materialSlots: [null] }, moldingBar: { unlocked: [true], contents: [null] }, synthesisQueue: [],
}

describe('MetaState shell binding', () => {
  it('routes library writes through the shared owner', () => {
    const store = createMetaStateStore(state)
    const binding = bindMetaStateShell(store)
    toggleStar('material')
    expect(store.getState().materials.material?.starred).toBe(true)
    expect(getLibApp().starred.has('material')).toBe(true)
    binding.unbind()
  })
})
