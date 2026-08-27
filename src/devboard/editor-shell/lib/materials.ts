/* =========================================================================
   快捷素材库目录 — 70 个预制体，6 个分类
   ========================================================================= */

export type MaterialCategory =
  | '装置'
  | '照明'
  | '陈设'
  | '交互'
  | '线索'
  | '遮挡'

export interface Material {
  id: string
  name: string
  category: MaterialCategory
  /** 8×8 图集索引 */
  tile: number
}

export const CATEGORIES: MaterialCategory[] = [
  '装置',
  '照明',
  '陈设',
  '交互',
  '线索',
  '遮挡',
]

const NAMES: Record<MaterialCategory, string[]> = {
  装置: ['储物柜', '控制台', '配电箱', '通风口', '水管阀', '监控杆', '发电机', '售货机', '安检门', '广播塔', '维修梯', '闸机'],
  照明: ['感应灯', '应急灯', '吊灯', '射灯', '信号灯', '荧光管', '探照灯', '烛台', '霓虹牌', '地脚灯', '手电', '灯箱'],
  陈设: ['长椅', '书架', '餐桌', '衣柜', '地毯', '盆栽', '窗帘', '钟表', '画框', '床铺', '沙发', '柜台'],
  交互: ['信号灯', '拉杆', '按钮台', '密码锁', '对讲机', '电话', '开关箱', '感应门', '售票机', '终端', '手轮', '踏板'],
  线索: ['便签', '血迹', '脚印', '照片', '录音带', '日记', '钥匙', '票根', '涂鸦', '碎片', '符号', '档案'],
  遮挡: ['木箱', '铁栏', '屏风', '货架', '幕布', '集装箱', '路障', '沙袋', '隔断', '铁皮', '石墩', '卷帘'],
}

function buildCatalog(): Material[] {
  const out: Material[] = []
  let tile = 0
  CATEGORIES.forEach((cat) => {
    NAMES[cat].forEach((name, i) => {
      out.push({
        id: `${cat}-${i}-${name}`,
        name,
        category: cat,
        tile: tile % 64,
      })
      tile++
    })
  })
  return out.slice(0, 70)
}

export const MATERIALS: Material[] = buildCatalog()

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id)
}

/** 收藏栏默认展示的 7 个快捷素材 */
export const QUICK_MATERIALS: string[] = [
  MATERIALS.find((m) => m.name === '储物柜')!.id,
  MATERIALS.find((m) => m.name === '感应灯')!.id,
  MATERIALS.find((m) => m.name === '长椅')!.id,
  MATERIALS.find((m) => m.name === '信号灯' && m.category === '交互')!.id,
  MATERIALS.find((m) => m.name === '便签')!.id,
  MATERIALS.find((m) => m.name === '木箱')!.id,
  MATERIALS.find((m) => m.name === '控制台')!.id,
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
