import { MATERIALS, materialById, type Material } from './materials'
import type { MaterialIdentity, MaterialLogicCategory, MaterialPlacementMode } from '../../../meta-state/types'
import { assetRefForView } from '../../../meta-state/asset-ref'

function slug(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
}

export function canonicalMaterialId(material: Material): string {
  return `material:${slug(material.name)}:${slug(material.category)}`
}

export function canonicalMaterialIdentity(material: Material): MaterialIdentity {
  return {
    id: canonicalMaterialId(material),
    name: material.name,
    introduction: `${material.name}，属于${material.category}逻辑素材。`,
    textureAssetRef: assetRefForView('asset:editor-material-atlas', 'world-top-down', `tile:${material.tile}`),
    quality: 1,
    displayCategory: material.displayCategory,
    logicCategory: material.category,
    defaultPlacementMode: material.defaultPlacementMode,
    ...(material.runtimeEntityRef ? { runtimeEntityRef: material.runtimeEntityRef } : {}),
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

export function logicCategoryOf(identity: MaterialIdentity): MaterialLogicCategory {
  if (identity.logicCategory) return identity.logicCategory
  switch (identity.displayCategory) {
    case '角色': return 'NPC'
    case '生物': return 'AI 单位'
    case '载具': return '载具'
    case '物品': case '武器': case '线索': return '物品'
    case '遮挡': return '容器'
    case '装置': case '交互': case '机制': return '机关装置'
    default: return '装饰'
  }
}

export function defaultPlacementModeOf(identity: MaterialIdentity): MaterialPlacementMode {
  return logicCategoryOf(identity) === '装饰' ? 'presentation-only' : (identity.defaultPlacementMode ?? 'native')
}

export const CANONICAL_MATERIALS = Object.freeze(MATERIALS.map(canonicalMaterialIdentity))
