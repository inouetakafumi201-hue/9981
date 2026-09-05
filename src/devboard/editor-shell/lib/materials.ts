/* WakeUp 素材逻辑分类契约。旧语义分类只作为 tags，不再作为顶级逻辑分类。 */

export type MaterialCategory =
  | 'ai-unit'
  | 'npc'
  | 'vehicle'
  | 'container'
  | 'item'
  | 'mechanism'
  | 'decoration'
  | 'transition-scene'

export type PlacementMode = 'scene-bound' | 'free-decoration' | 'edge-bound-transition'
export type LegacyMaterialTag = 'device' | 'lighting' | 'furniture' | 'interactive' | 'clue' | 'occluder'

export const CATEGORIES: MaterialCategory[] = [
  'ai-unit', 'npc', 'vehicle', 'container', 'item', 'mechanism', 'decoration', 'transition-scene',
]

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  'ai-unit': 'AI 单位', npc: 'NPC', vehicle: '载具', container: '容器', item: '物品',
  mechanism: '机关装置', decoration: '装饰', 'transition-scene': '过渡场景',
}

export const CATEGORY_CONTRACT: Record<MaterialCategory, { adapterId: string | null; parameterSchemaId: string; placementMode: PlacementMode }> = {
  'ai-unit': { adapterId: 'runtime.ai-unit', parameterSchemaId: 'inspector.ai-unit', placementMode: 'scene-bound' },
  npc: { adapterId: 'runtime.npc', parameterSchemaId: 'inspector.npc', placementMode: 'scene-bound' },
  vehicle: { adapterId: 'runtime.vehicle', parameterSchemaId: 'inspector.vehicle', placementMode: 'scene-bound' },
  container: { adapterId: 'runtime.container', parameterSchemaId: 'inspector.container', placementMode: 'scene-bound' },
  item: { adapterId: 'runtime.item', parameterSchemaId: 'inspector.item', placementMode: 'scene-bound' },
  mechanism: { adapterId: 'runtime.mechanism', parameterSchemaId: 'inspector.mechanism', placementMode: 'scene-bound' },
  decoration: { adapterId: null, parameterSchemaId: 'inspector.decoration', placementMode: 'free-decoration' },
  'transition-scene': { adapterId: 'runtime.transition-scene', parameterSchemaId: 'inspector.transition-scene', placementMode: 'edge-bound-transition' },
}

export interface Material {
  id: string
  name: string
  category: MaterialCategory
  tags: LegacyMaterialTag[]
  tile: number
}

const NAMES: Record<MaterialCategory, string[]> = {
  'ai-unit': ['巡游影鸦', '守卫哨兵', '追迹兽'],
  npc: ['月台管理员', '旧站商贩', '无名旅客'],
  vehicle: ['梦轨列车', '悬浮车', '货运拖车'],
  container: ['储物柜', '补给箱', '冷藏柜'],
  item: ['梦境碎片', '旧钥匙', '能量电池'],
  mechanism: ['控制台', '感应灯', '信号灯', '齿轮组件'],
  decoration: ['长椅', '路牌', '破旧布帘', '盆栽'],
  'transition-scene': ['月台过渡', '车厢切换', '梦境裂隙'],
}

function tagsFor(category: MaterialCategory, index: number): LegacyMaterialTag[] {
  if (category === 'decoration') return index % 2 ? ['furniture'] : ['occluder']
  if (category === 'mechanism') return index % 2 ? ['interactive'] : ['device']
  if (category === 'container') return ['device']
  if (category === 'item') return ['clue']
  return []
}

function buildCatalog(): Material[] {
  const output: Material[] = []
  let tile = 0
  CATEGORIES.forEach((category) => NAMES[category].forEach((name, index) => {
    output.push({ id: `${category}-${index}-${name}`, name, category, tags: tagsFor(category, index), tile: tile % 64 })
    tile += 1
  }))
  return output
}

export const MATERIALS = buildCatalog()
export const MATERIALS_VERSION = 'logic-categories-v1'
export const QUICK_MATERIALS = ['储物柜', '感应灯', '长椅', '信号灯', '梦境碎片', '破旧布帘', '控制台']
  .map((name) => MATERIALS.find((material) => material.name === name)?.id ?? '')

export function materialById(id: string): Material | undefined { return MATERIALS.find((material) => material.id === id) }
export function categoryLabel(category: MaterialCategory): string { return CATEGORY_LABELS[category] }
export function categoryContract(category: MaterialCategory) { return CATEGORY_CONTRACT[category] }
export function categoryPlacementMode(category: MaterialCategory, insideScene: boolean): PlacementMode {
  if (category === 'transition-scene') return 'edge-bound-transition'
  if (category === 'decoration' || !insideScene) return 'free-decoration'
  return 'scene-bound'
}
export function legacyTagLabel(tag: LegacyMaterialTag): string {
  return { device: '装置', lighting: '照明', furniture: '陈设', interactive: '交互', clue: '线索', occluder: '遮挡' }[tag]
}
export function placementModeLabel(mode: PlacementMode): string {
  return mode === 'scene-bound' ? '场景逻辑' : mode === 'free-decoration' ? '仅表现' : '连线过渡'
}
export function isTransitionCategory(category: MaterialCategory): boolean { return category === 'transition-scene' }
export function isDecorationCategory(category: MaterialCategory): boolean { return category === 'decoration' }
export function hasLogic(category: MaterialCategory): boolean { return category !== 'decoration' && category !== 'transition-scene' }

const ATLAS = '/editor/material-atlas.png'
export function tileStyle(index: number): React.CSSProperties {
  const col = index % 8
  const row = Math.floor(index / 8)
  return {
    backgroundImage: `url(${ATLAS})`, backgroundSize: '800% 800%',
    backgroundPosition: `${(col / 7) * 100}% ${(row / 7) * 100}%`, imageRendering: 'pixelated',
  }
}
