import type { AssetRef } from '../types'
import type { MetaStateStore } from '../store'
import { rejected, type MetaActionResult } from './result'

function stale(store: MetaStateStore, expectedRevision: number): MetaActionResult | null {
  const projection = store.getState()
  return projection.revision !== expectedRevision
    ? { kind: 'stale', code: 'STALE_PROJECTION', message: '素材投影已更新，请重新读取后重试。', projection }
    : null
}

export function toggleStar(store: MetaStateStore, materialId: string, expectedRevision: number): MetaActionResult {
  const staleResult = stale(store, expectedRevision)
  if (staleResult) return staleResult
  const projection = store.getState()
  const current = projection.materials[materialId]
  if (!current) return rejected(projection, 'MATERIAL_NOT_FOUND', `未知素材：${materialId}`)
  const materials = { ...projection.materials, [materialId]: { ...current, starred: !current.starred } }
  const next = store.commit({ ...projection, materials }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

export function quickBarSet(store: MetaStateStore, materialId: string, slot: number, expectedRevision: number): MetaActionResult {
  const staleResult = stale(store, expectedRevision)
  if (staleResult) return staleResult
  const projection = store.getState()
  const material = projection.materials[materialId]
  if (!material) return rejected(projection, 'MATERIAL_NOT_FOUND', `未知素材：${materialId}`)
  if (!material.owned) return rejected(projection, 'MATERIAL_NOT_OWNED', '未拥有的素材不能放入快捷栏。')
  if (material.limitedFree) return rejected(projection, 'LIMITED_FREE_NOT_ALLOWED', '限免素材不能放入快捷栏。')
  if (!Number.isInteger(slot) || slot < 0 || slot >= projection.quickBar.materialSlots.length) return rejected(projection, 'QUICK_BAR_SLOT_INVALID', '快捷栏位置无效。')
  const materialSlots = [...projection.quickBar.materialSlots]
  materialSlots[slot] = materialId
  const next = store.commit({ ...projection, quickBar: { materialSlots } }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

export function quickBarClear(store: MetaStateStore, slot: number, expectedRevision: number): MetaActionResult {
  const staleResult = stale(store, expectedRevision)
  if (staleResult) return staleResult
  const projection = store.getState()
  if (!Number.isInteger(slot) || slot < 0 || slot >= projection.quickBar.materialSlots.length) return rejected(projection, 'QUICK_BAR_SLOT_INVALID', '快捷栏位置无效。')
  const materialSlots = [...projection.quickBar.materialSlots]
  materialSlots[slot] = null
  const next = store.commit({ ...projection, quickBar: { materialSlots } }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

export function materialSetTexture(store: MetaStateStore, materialId: string, assetRef: AssetRef, expectedRevision: number): MetaActionResult {
  const staleResult = stale(store, expectedRevision)
  if (staleResult) return staleResult
  const projection = store.getState()
  const identity = projection.identities[materialId]
  const material = projection.materials[materialId]
  if (!identity || !material) return rejected(projection, 'MATERIAL_NOT_FOUND', `未知素材：${materialId}`)
  if (material.source !== 'synthesized') return rejected(projection, 'TEXTURE_NOT_ALLOWED', '只有合成物可以修改贴图。')
  const identities = { ...projection.identities, [materialId]: { ...identity, textureAssetRef: assetRef } }
  const next = store.commit({ ...projection, identities }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}
