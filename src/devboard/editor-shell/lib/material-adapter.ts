import { MATERIALS, materialById, type Material } from './materials'
import type { DisplayCategory, MaterialIdentity } from '../../../meta-state/types'
import { assetRefForView } from '../../../meta-state/asset-ref'

const DISPLAY_CATEGORY: Record<Material['category'], DisplayCategory> = {
  装置: '装置', 照明: '照明', 陈设: '陈设', 交互: '交互', 线索: '线索', 遮挡: '遮挡',
}

function slug(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
}

export function canonicalMaterialId(material: Material): string {
  return `material:${slug(material.name)}:${material.category}`
}

export function canonicalMaterialIdentity(material: Material): MaterialIdentity {
  return {
    id: canonicalMaterialId(material),
    name: material.name,
    introduction: `${material.name}，可用于梦境地图中的${material.category}表达。`,
    textureAssetRef: assetRefForView('asset:editor-material-atlas', 'world-top-down', `tile:${material.tile}`),
    quality: 1,
    displayCategory: DISPLAY_CATEGORY[material.category],
  }
}

const OLD_TO_CANONICAL = new Map(MATERIALS.map((material) => [material.id, canonicalMaterialId(material)]))
const CANONICAL_TO_OLD = new Map(MATERIALS.map((material) => [canonicalMaterialId(material), material.id]))

export function canonicalizeMaterialId(id: string): string | undefined {
  if (CANONICAL_TO_OLD.has(id)) return id
  return OLD_TO_CANONICAL.get(id)
}

export function legacyMaterialId(id: string): string | undefined {
  return CANONICAL_TO_OLD.get(id) ?? (materialById(id) ? id : undefined)
}

export function materialIdentityById(id: string): MaterialIdentity | undefined {
  const legacyId = legacyMaterialId(id)
  const material = legacyId ? materialById(legacyId) : undefined
  return material ? canonicalMaterialIdentity(material) : undefined
}

export const CANONICAL_MATERIALS = Object.freeze(MATERIALS.map(canonicalMaterialIdentity))
