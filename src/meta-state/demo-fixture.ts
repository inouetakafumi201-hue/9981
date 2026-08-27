import { assetRefForView } from './asset-ref'
import type { MetaState } from './types'
import { createMetaStateStore, type MetaStateStore } from './store'

export function createDemoMetaStateStore(): MetaStateStore {
  const identity = {
    id: 'material:demo-locker',
    name: '演示储物柜',
    introduction: '可放置在梦境场景中的储物柜。',
    description: '开发期演示素材；真实目录由元状态 owner 提供。',
    iconAssetRef: assetRefForView('asset:demo-locker', 'icon'),
    textureAssetRef: assetRefForView('asset:demo-locker', 'world-top-down'),
    quality: 1 as const,
    displayCategory: '装置' as const,
  }
  const state: MetaState = {
    identities: { [identity.id]: identity },
    materials: {
      [identity.id]: { owned: true, source: 'standard', quality: 1, starred: false, modified: false, isUgcNew: false, equippedTokens: [], weakness: null, limitedFree: false },
    },
    tokens: {}, blueprints: {}, quickBar: { materialSlots: Array(7).fill(null) },
    moldingBar: { unlocked: Array(5).fill(false), contents: Array(5).fill(null) }, synthesisQueue: [],
  }
  return createMetaStateStore(state, 'demo-fixture')
}
