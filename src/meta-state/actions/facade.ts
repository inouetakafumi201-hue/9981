import type { AssetRef } from '../types'
import type { MetaStateStore } from '../store'
import { materialSetTexture, quickBarClear, quickBarSet, toggleStar } from './material-actions'
import type { MetaActionResult } from './result'

export interface MetaStateActions {
  toggleStar(materialId: string, expectedRevision: number): MetaActionResult
  quickBarSet(materialId: string, slot: number, expectedRevision: number): MetaActionResult
  quickBarClear(slot: number, expectedRevision: number): MetaActionResult
  materialSetTexture(materialId: string, assetRef: AssetRef, expectedRevision: number): MetaActionResult
}

export function createMetaStateActions(store: MetaStateStore): MetaStateActions {
  return Object.freeze({
    toggleStar: (id: string, revision: number) => toggleStar(store, id, revision),
    quickBarSet: (id: string, slot: number, revision: number) => quickBarSet(store, id, slot, revision),
    quickBarClear: (slot: number, revision: number) => quickBarClear(store, slot, revision),
    materialSetTexture: (id: string, ref: AssetRef, revision: number) => materialSetTexture(store, id, ref, revision),
  })
}
