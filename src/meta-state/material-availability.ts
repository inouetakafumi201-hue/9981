import type { MetaStateStore } from './store'

export interface MaterialAvailability {
  readonly materialId: string
  readonly available: boolean
  readonly reason?: 'not-found' | 'not-owned' | 'limited-free' | 'pending'
}

export function createMaterialAvailability(store: MetaStateStore) {
  return {
    isAvailable(materialId: string): MaterialAvailability {
      const projection = store.getState()
      const material = projection.materials[materialId]
      if (!material) return { materialId, available: false, reason: 'not-found' as const }
      if (!material.owned) return { materialId, available: false, reason: 'not-owned' as const }
      if (material.limitedFree) return { materialId, available: false, reason: 'limited-free' as const }
      return { materialId, available: true }
    },
    registeredMaterials(): readonly string[] {
      return Object.keys(store.getState().identities)
    },
  }
}
