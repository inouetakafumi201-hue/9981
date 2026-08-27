import type { MetaStateProjection, MaterialRecord } from '../../meta-state/types'
export interface MaterialView {
  readonly id: string
  readonly name: string
  readonly introduction: string
  readonly description?: string
  readonly category: string
  readonly quality: 1 | 2 | 3 | 4 | 5
  readonly owned: boolean
  readonly starred: boolean
  readonly modified: boolean
  readonly limitedFree: boolean
  readonly equippedTokenIds: readonly (string | null)[]
  readonly textureAssetRef: MaterialRecord['textureAssetRef']
}

export function materialViews(projection: MetaStateProjection): readonly MaterialView[] {
  return Object.values(projection.identities).flatMap((identity) => {
    const meta = projection.materials[identity.id]
    if (!meta) return []
    return [{
      id: identity.id,
      name: identity.name,
      introduction: identity.introduction,
      ...(identity.description === undefined ? {} : { description: identity.description }),
      category: identity.displayCategory,
      quality: meta.quality,
      owned: meta.owned,
      starred: meta.starred,
      modified: meta.modified,
      limitedFree: meta.limitedFree,
      equippedTokenIds: meta.equippedTokens,
      textureAssetRef: identity.textureAssetRef,
    }]
  })
}

export function materialViewFor(projection: MetaStateProjection, id: string): MaterialView | undefined {
  return materialViews(projection).find((material) => material.id === id)
}
