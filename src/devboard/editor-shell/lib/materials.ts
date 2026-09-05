import type { DisplayCategory, MaterialLogicCategory, MaterialPlacementMode, RuntimeEntityRef } from '../../../meta-state/types'

/* =========================================================================
   快捷素材库目录：八类逻辑素材。视觉目录仅用于展示，不再驱动玩法。
   ========================================================================= */

export type LegacyMaterialCategory = '装置' | '照明' | '陈设' | '交互' | '线索' | '遮挡'
export type MaterialCategory = MaterialLogicCategory

export const CATEGORIES: readonly MaterialCategory[] = [
  'AI 单位',
  'NPC',
  '载具',
  '容器',
  '物品',
  '机关装置',
  '装饰',
  '过渡场景',
]

export const MATERIAL_CATEGORY_LABELS: Readonly<Record<MaterialCategory, string>> = {
  'AI 单位': 'AI 单位',
  NPC: 'NPC',
  载具: '载具',
  容器: '容器',
  物品: '物品',
  机关装置: '机关装置',
  装饰: '装饰',
  过渡场景: '过渡场景',
}

export const LEGACY_CATEGORY_MIGRATION: Readonly<Record<LegacyMaterialCategory, MaterialCategory>> = {
  装置: '机关装置',
  照明: '装饰',
  陈设: '装饰',
  交互: '机关装置',
  线索: '物品',
  遮挡: '容器',
}

export interface Material {
  id: string
  name: string
  /** 唯一逻辑分类。 */
  category: MaterialCategory
  /** 纯视觉目录，不参与放置规则。 */
  displayCategory: DisplayCategory
  defaultPlacementMode: MaterialPlacementMode
  runtimeEntityRef?: RuntimeEntityRef
  /** 8×8 图集索引 */
  tile: number
}

const NAMES: Record<MaterialCategory, readonly string[]> = {
  'AI 单位': ['巡逻无人机', '安保机器人', '搜救机蜂', '自动炮塔', '清扫机群', '维修傀儡', '侦察球', '搬运机'],
  NPC: ['站务员', '商人', '医生', '维修师', '守卫', '向导', '调查员', '幸存者'],
  载具: ['轨道车', '装甲车', '摩托艇', '升降平台', '运输车', '雪地车', '叉车', '穿梭艇'],
  容器: ['储物柜', '木箱', '铁柜', '工具箱', '货架', '保险柜', '补给箱', '档案柜'],
  物品: ['钥匙', '录音带', '医疗包', '电池', '撬棍', '门禁卡', '日记', '零件'],
  机关装置: ['控制台', '配电箱', '水管阀', '发电机', '闸机', '密码锁', '按钮台', '感应门'],
  装饰: ['感应灯', '长椅', '地毯', '盆栽', '血迹', '海报', '霓虹牌', '碎石'],
  过渡场景: ['楼梯', '安全门', '通风管', '电梯', '舱门', '桥梁', '窗口', '传送门'],
}

const DISPLAY_CATEGORY: Record<MaterialCategory, DisplayCategory> = {
  'AI 单位': '生物', NPC: '角色', 载具: '载具', 容器: '遮挡', 物品: '物品',
  机关装置: '装置', 装饰: '陈设', 过渡场景: '机制',
}

const RUNTIME_KIND: Partial<Record<MaterialCategory, RuntimeEntityRef['kind']>> = {
  'AI 单位': 'npc', NPC: 'npc', 载具: 'vehicle', 容器: 'interactive', 物品: 'item', 机关装置: 'interactive', 过渡场景: 'environment',
}

function buildCatalog(): Material[] {
  let tile = 0
  return CATEGORIES.flatMap((category) => NAMES[category].map((name, index) => {
    const kind = RUNTIME_KIND[category]
    const id = `${category}-${index}-${name}`
    const defaultPlacementMode: MaterialPlacementMode = category === '装饰' ? 'presentation-only' : 'native'
    const material: Material = {
      id,
      name,
      category,
      displayCategory: DISPLAY_CATEGORY[category],
      defaultPlacementMode,
      tile: tile++ % 64,
    }
    return kind ? { ...material, runtimeEntityRef: { kind, id: `entity:${id}` } } : material
  }))
}

export const MATERIALS: readonly Material[] = Object.freeze(buildCatalog())

export function isMaterialCategory(value: string): value is MaterialCategory {
  return (CATEGORIES as readonly string[]).includes(value)
}

export function migrateLegacyCategory(category: LegacyMaterialCategory | MaterialCategory): MaterialCategory {
  return isMaterialCategory(category) ? category : LEGACY_CATEGORY_MIGRATION[category]
}

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((material) => material.id === id || `material:${material.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()}:${material.category.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()}` === id)
}

/** 收藏栏默认覆盖普通素材与过渡场景。 */
export const QUICK_MATERIALS: readonly string[] = [
  MATERIALS.find((material) => material.category === '容器')!.id,
  MATERIALS.find((material) => material.category === '机关装置')!.id,
  MATERIALS.find((material) => material.category === '装饰')!.id,
  MATERIALS.find((material) => material.category === '物品')!.id,
  MATERIALS.find((material) => material.category === 'NPC')!.id,
  MATERIALS.find((material) => material.category === 'AI 单位')!.id,
  MATERIALS.find((material) => material.category === '过渡场景')!.id,
]

const ATLAS = '/editor/material-atlas.png'
const ATLAS_COLS = 8
const ATLAS_ROWS = 8

export function tileStyle(index: number): React.CSSProperties {
  const col = index % ATLAS_COLS
  const row = Math.floor(index / ATLAS_COLS)
  return {
    backgroundImage: `url(${ATLAS})`,
    backgroundSize: `${ATLAS_COLS * 100}% ${ATLAS_ROWS * 100}%`,
    backgroundPosition: `${(col / (ATLAS_COLS - 1)) * 100}% ${(row / (ATLAS_ROWS - 1)) * 100}%`,
    imageRendering: 'pixelated',
  }
}
