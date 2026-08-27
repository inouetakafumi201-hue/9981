/* =========================================================================
   梦境素材库 — 只读数据层 + 纯派生选择器（对齐《WakeUp 素材库完整需求文档》）

   角色定位：本界面是「检索优先的创作资源入口」，所有素材/蓝本/词条数据都来自
   共享元状态层的**只读投影**。真实接线前，这里用可确定性生成的占位数据把结构
   铺满（§7.1），字段命名与 §7.2 端口一一对应，方便后续把 mock 换成 projection。

   这里**只放数据与纯函数**（过滤/排序/角标派生），不含任何 React 状态；界面本地
   的 tab/scope/搜索/星标/快捷栏写操作在 library-store.ts。

   贴图：复用编辑器 8×8 像素图集（materials.ts / material-atlas.png），能量类叠
   青色辉光、灯火类叠暖色辉光，在同一套像素资源上还原「像素前景 + 暖光全息」。
   ========================================================================= */

import type { MaterialCategory } from './materials'
import { CATEGORIES, tileStyle } from './materials'

export type { MaterialCategory }
export { tileStyle }

/* ---------------------------------------------------------------- 品级 ---- */

/** 品级 1–5，描边取品级色：灰白1 / 绿2 / 蓝3 / 银4 / 金5（§2.2） */
export type Quality = 1 | 2 | 3 | 4 | 5

export const QUALITY_COLOR: Record<Quality, string> = {
  1: 'var(--q1)',
  2: 'var(--q2)',
  3: 'var(--q3)',
  4: 'var(--q4)',
  5: 'var(--q5)',
}
export const QUALITY_LABEL: Record<Quality, string> = {
  1: '普通',
  2: '优良',
  3: '稀有',
  4: '史诗',
  5: '传说',
}

/* --------------------------------------------------------------- 词条 ---- */

/** 词条挂载槽位语义：属性 / 技能 / 状态 / 防御 / 机动（§4.4，固定 5 槽） */
export type TokenSlot = 'attr' | 'skill' | 'state' | 'defense' | 'mobility'

export const TOKEN_SLOTS: { key: TokenSlot; label: string }[] = [
  { key: 'attr', label: '属性' },
  { key: 'skill', label: '技能' },
  { key: 'state', label: '状态' },
  { key: 'defense', label: '防御' },
  { key: 'mobility', label: '机动' },
]

export interface TokenMeta {
  id: string
  slot: TokenSlot
  name: string
  quality: Quality
}

/* ------------------------------------------------------------- 素材 ---- */

/** 来源：标准 / UGC / 合成物（合成物才带弱点裂缝，§4.4） */
export type MaterialSource = 'standard' | 'ugc' | 'craft'

/**
 * MaterialMeta —— 对齐 §7 的接线清单。界面绝不缓存/推断这些字段，一律只读。
 * equippedTokens 固定 5 项，与 TOKEN_SLOTS 顺序一致，null = 空槽。
 */
export interface MaterialMeta {
  id: string
  name: string
  category: MaterialCategory
  quality: Quality
  owned: boolean
  source: MaterialSource
  starred: boolean
  modified: boolean
  isUgcNew: boolean
  limitedFree: boolean
  weakness: string | null
  equippedTokens: (TokenMeta | null)[]
  /** —— 以下为视觉附加（占位期用；接线后由 sprite 管线替换）—— */
  tile: number
  glow: 'cyan' | 'warm' | null
  desc: string
  /** 限免剩余文案（limitedFree 时展示） */
  freeRemaining: string | null
}

/* ----------------------------------------------------------- 角标派生 ---- */

export type BadgeKind = 'free' | 'ugc' | 'craft' | 'modified' | 'starred'

/** badgeStateOf —— 纯函数派生卡片角标集合（§7.2「卡片角标」端口占位实现） */
export interface MaterialBadgeState {
  free: boolean
  ugc: boolean
  craft: boolean
  modified: boolean
  starred: boolean
}

export function badgeStateOf(m: MaterialMeta): MaterialBadgeState {
  return {
    free: m.limitedFree,
    ugc: m.isUgcNew || m.source === 'ugc',
    craft: m.source === 'craft',
    modified: m.modified,
    starred: m.starred,
  }
}

/* --------------------------------------------------------------- 蓝本 ---- */

export interface BlueprintMeta {
  mapId: string
  name: string
  sceneCount: number
  /** 熟悉度 0–100，满 100 解锁蓝本 */
  familiarity: number
  unlocked: boolean
  /** 封面占位贴图索引 */
  tile: number
  /** 只读构成预览（解锁后详情展示） */
  scenes: string[]
}

/* ==========================================================================
   占位数据生成
   ========================================================================== */

const TOKEN_NAMES: Record<TokenSlot, string[]> = {
  attr: ['烈焰', '寒霜', '雷鸣', '微光'],
  skill: ['速取', '连锁', '回响', '拆解'],
  state: ['稳定', '过载', '静滞', '共鸣'],
  defense: ['坚壁', '缓冲', '反射', '锈蚀'],
  mobility: ['轻羽', '滑轨', '悬浮', '锚定'],
}

function makeToken(slot: TokenSlot, seed: number): TokenMeta {
  const names = TOKEN_NAMES[slot]
  if (names.length === 0) throw new Error(`Token slot ${slot} has no names`)
  const q = (((seed % 5) + 1) as Quality)
  const name = names[seed % names.length]
  if (name === undefined) throw new Error(`Token slot ${slot} has no name at index`)
  return {
    id: `tk_${slot}_${seed}`,
    slot,
    name,
    quality: q,
  }
}

const SLOT_ORDER: TokenSlot[] = ['attr', 'skill', 'state', 'defense', 'mobility']

/** 按位图生成 5 槽词条（bit i = 1 表示该槽有词条） */
function tokensFrom(mask: number, seed: number): (TokenMeta | null)[] {
  return SLOT_ORDER.map((slot, i) => (mask & (1 << i) ? makeToken(slot, seed + i) : null))
}

/** §7.1 对齐：文档给出的精选样例（储物柜/感应灯/长椅），再补足参考图第一屏观感 */
const FEATURED: MaterialMeta[] = [
  {
    id: 'locker_7f3a',
    name: '储物柜',
    category: '装置',
    quality: 3,
    owned: true,
    source: 'standard',
    starred: true,
    modified: false,
    isUgcNew: false,
    limitedFree: false,
    weakness: null,
    equippedTokens: tokensFrom(0b00010, 1),
    tile: 0,
    glow: null,
    desc: '结实的金属储物柜，可作为遮挡或藏匿线索的容器，是驻地场景的常客。',
    freeRemaining: null,
  },
  {
    id: 'sensor_light_02',
    name: '感应灯',
    category: '照明',
    quality: 2,
    owned: false,
    source: 'standard',
    starred: false,
    modified: false,
    isUgcNew: false,
    limitedFree: true,
    weakness: null,
    equippedTokens: tokensFrom(0, 0),
    tile: 14,
    glow: 'warm',
    desc: '感知到梦境角色靠近才亮起的暖光灯，适合营造走廊的紧张引导。',
    freeRemaining: '3天2小时',
  },
  {
    id: 'bench_a1',
    name: '长椅',
    category: '陈设',
    quality: 1,
    owned: true,
    source: 'standard',
    starred: false,
    modified: false,
    isUgcNew: false,
    limitedFree: false,
    weakness: null,
    equippedTokens: tokensFrom(0, 0),
    tile: 24,
    glow: null,
    desc: '斑驳的木质长椅，为月台与候车场景添一处可停留的落点。',
    freeRemaining: null,
  },
  {
    id: 'dream_beacon',
    name: '梦能灯塔',
    category: '装置',
    quality: 5,
    owned: true,
    source: 'craft',
    starred: true,
    modified: true,
    isUgcNew: false,
    limitedFree: false,
    weakness: '受暗影侵蚀时，能量流失加快',
    equippedTokens: tokensFrom(0b10111, 3),
    tile: 59,
    glow: 'cyan',
    desc: '汇聚游离梦能的锚点装置，为周边场景持续供能，并在暗影迫近时发出预警脉冲。',
    freeRemaining: null,
  },
  {
    id: 'echo_altar',
    name: '回响祭坛',
    category: '交互',
    quality: 4,
    owned: false,
    source: 'ugc',
    starred: false,
    modified: false,
    isUgcNew: true,
    limitedFree: false,
    weakness: null,
    equippedTokens: tokensFrom(0b00100, 5),
    tile: 22,
    glow: 'cyan',
    desc: '触碰后回放场景最近一次梦境事件的交互祭坛，常作为解谜线索枢纽。',
    freeRemaining: null,
  },
  {
    id: 'gear_assembly',
    name: '齿轮组件',
    category: '装置',
    quality: 4,
    owned: true,
    source: 'craft',
    starred: false,
    modified: false,
    isUgcNew: false,
    limitedFree: false,
    weakness: '弱点：易蚀',
    equippedTokens: tokensFrom(0b01010, 7),
    tile: 44,
    glow: null,
    desc: '可与其它机械件拼接的齿轮总成，是解锁高级联动装置的合成前置。',
    freeRemaining: null,
  },
  {
    id: 'dream_shard',
    name: '梦境碎片',
    category: '线索',
    quality: 3,
    owned: false,
    source: 'standard',
    starred: false,
    modified: false,
    isUgcNew: false,
    limitedFree: true,
    weakness: null,
    equippedTokens: tokensFrom(0b00001, 9),
    tile: 17,
    glow: 'cyan',
    desc: '折射记忆残光的结晶碎片，收集足够数量可拼合出关键剧情线索。',
    freeRemaining: '6天5小时',
  },
  {
    id: 'signal_lamp',
    name: '信号灯',
    category: '交互',
    quality: 2,
    owned: true,
    source: 'standard',
    starred: true,
    modified: false,
    isUgcNew: false,
    limitedFree: false,
    weakness: null,
    equippedTokens: tokensFrom(0b00010, 11),
    tile: 36,
    glow: 'warm',
    desc: '可被拉杆或密码锁联动的信号灯，红绿切换驱动场景的通行逻辑。',
    freeRemaining: null,
  },
  {
    id: 'faded_signpost',
    name: '褪色路牌',
    category: '线索',
    quality: 1,
    owned: false,
    source: 'ugc',
    starred: false,
    modified: false,
    isUgcNew: true,
    limitedFree: false,
    weakness: null,
    equippedTokens: tokensFrom(0, 0),
    tile: 60,
    glow: null,
    desc: '字迹褪色的木质路牌，指向早已改道的方向，是引导玩家质疑现实的线索。',
    freeRemaining: null,
  },
  {
    id: 'tattered_curtain',
    name: '破旧布帘',
    category: '遮挡',
    quality: 1,
    owned: true,
    source: 'standard',
    starred: false,
    modified: false,
    isUgcNew: false,
    limitedFree: false,
    weakness: null,
    equippedTokens: tokensFrom(0, 0),
    tile: 66,
    glow: null,
    desc: '边角磨损的织物门帘，可柔和地遮断视线，营造半私密的过渡空间。',
    freeRemaining: null,
  },
]

/** 用 6 分类词库派生更多条目，把目录撑到多页量级（星标/角标/品级轮换分布） */
const NAMES: Record<MaterialCategory, string[]> = {
  装置: ['控制台', '配电箱', '通风口', '水管阀', '监控杆', '发电机', '售货机', '安检门', '广播塔', '维修梯', '闸机'],
  照明: ['应急灯', '壁灯', '射灯', '荧光管', '探照灯', '烛台', '霓虹牌', '地脚灯', '手电', '灯箱', '吊灯'],
  陈设: ['书架', '餐桌', '衣柜', '地毯', '盆栽', '窗帘', '挂钟', '画框', '床铺', '沙发', '柜台'],
  交互: ['拉杆', '按钮台', '密码锁', '对讲机', '电话', '开关箱', '感应门', '售票机', '终端', '手轮', '踏板'],
  线索: ['便签', '血迹', '脚印', '照片', '录音带', '日记', '钥匙', '票根', '涂鸦', '残页', '档案'],
  遮挡: ['木箱', '铁栏', '屏风', '货架', '幕布', '集装箱', '路障', '沙袋', '隔断', '铁皮', '卷帘'],
}

const CAT_TILES: Record<MaterialCategory, number[]> = {
  装置: [0, 15, 44, 52, 63, 13, 33, 43],
  照明: [14, 20, 59, 60, 36, 39],
  陈设: [23, 48, 49, 54, 51, 25],
  交互: [12, 45, 50, 38, 22, 37],
  线索: [17, 29, 30, 61, 32, 28],
  遮挡: [16, 5, 10, 58, 24, 42, 11, 26],
}

const SOURCE_CYCLE: MaterialSource[] = ['standard', 'standard', 'standard', 'ugc', 'craft', 'standard']

function derive(): MaterialMeta[] {
  const out: MaterialMeta[] = []
  if (SOURCE_CYCLE.length === 0) throw new Error('Source cycle must not be empty')
  let n = 0
  for (let round = 0; round < 3; round++) {
    CATEGORIES.forEach((cat) => {
      NAMES[cat].forEach((name, i) => {
        const tiles = CAT_TILES[cat]
        if (tiles.length === 0) throw new Error(`Category ${cat} has no tiles`)
        const tile = tiles[(i + round) % tiles.length]
        if (tile === undefined) throw new Error(`Category ${cat} has no tile at index`)
        const source = SOURCE_CYCLE[n % SOURCE_CYCLE.length]
        if (source === undefined) throw new Error('Source cycle has no source at index')
        const limitedFree = source === 'standard' && n % 7 === 0
        const owned = source !== 'ugc' && !limitedFree && n % 3 !== 0
        const quality = (((n + round) % 5) + 1) as Quality
        const mask = source === 'craft' || quality >= 4 ? (n % 32) : n % 4 === 0 ? 0b00010 : 0
        out.push({
          id: `${cat}_${round}_${i}`,
          name: round === 0 ? name : `${name}·变体${round}`,
          category: cat,
          quality,
          owned,
          source,
          starred: (n * 7) % 11 === 0,
          modified: n % 6 === 0,
          isUgcNew: source === 'ugc' && n % 2 === 0,
          limitedFree,
          weakness: source === 'craft' && n % 3 === 0 ? '弱点：结构易碎' : null,
          equippedTokens: tokensFrom(mask, n + 13),
          tile,
          glow: cat === '线索' && i % 4 === 0 ? 'cyan' : cat === '照明' && i % 3 === 0 ? 'warm' : null,
          desc: `${name}——梦境场景常用的${cat}预制体，可直接拖入画布布置。`,
          freeRemaining: limitedFree ? `${(n % 14) + 1}天${(n % 12) + 1}小时` : null,
        })
        n++
      })
    })
  }
  return out
}

export const MATERIALS_META: MaterialMeta[] = [...FEATURED, ...derive()]

export function materialMetaById(id: string): MaterialMeta | null {
  return MATERIALS_META.find((m) => m.id === id) ?? null
}

/* --------------------------------------------------------------- 蓝本 ---- */

export const BLUEPRINTS: BlueprintMeta[] = [
  { mapId: 'night_platform', name: '夜班月台', sceneCount: 4, familiarity: 100, unlocked: true, tile: 36, scenes: ['候车厅', '检票口', '站台', '轨道'] },
  { mapId: 'sleeper_car', name: '卧铺车厢', sceneCount: 3, familiarity: 62, unlocked: false, tile: 24, scenes: ['车厢过道', '卧铺区', '车顶通道'] },
  { mapId: 'rented_room', name: '出租屋', sceneCount: 5, familiarity: 100, unlocked: true, tile: 23, scenes: ['玄关', '客厅', '书房', '卧室', '阳台'] },
  { mapId: 'abandoned_mall', name: '废弃商场', sceneCount: 6, familiarity: 41, unlocked: false, tile: 44, scenes: ['中庭', '扶梯', '店铺', '仓库', '天台', '停车场'] },
  { mapId: 'clock_tower', name: '钟楼内部', sceneCount: 3, familiarity: 88, unlocked: false, tile: 20, scenes: ['齿轮室', '钟摆厅', '塔顶'] },
  { mapId: 'flooded_subway', name: '积水地铁', sceneCount: 4, familiarity: 100, unlocked: true, tile: 17, scenes: ['闸机厅', '月台', '隧道', '控制室'] },
]

/* ==========================================================================
   纯派生选择器（§6.1 filteredMaterials —— 本地派生，不写状态）
   ========================================================================== */

export type Scope = 'all' | 'owned'
export type CategoryFilter = '全部' | MaterialCategory

/** 星标置顶（同筛选栏内排首）；其余保持原序，稳定排序 */
export function starredFirst(list: MaterialMeta[], isStarred: (id: string) => boolean): MaterialMeta[] {
  return list
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const sa = isStarred(a.m.id) ? 0 : 1
      const sb = isStarred(b.m.id) ? 0 : 1
      return sa - sb || a.i - b.i
    })
    .map((x) => x.m)
}

export function filteredMaterials(
  all: MaterialMeta[],
  opts: { scope: Scope; category: CategoryFilter; query: string; isStarred: (id: string) => boolean },
): MaterialMeta[] {
  const scoped = opts.scope === 'owned' ? all.filter((m) => m.owned) : all
  const byCat = opts.category === '全部' ? scoped : scoped.filter((m) => m.category === opts.category)
  const q = opts.query.trim()
  const byQuery = q ? byCat.filter((m) => m.name.includes(q) || m.category.includes(q)) : byCat
  return starredFirst(byQuery, opts.isStarred)
}

export const PAGE_SIZE = 10

/** 分栏语义 + 类别筛选项（§4.2） */
export const SCOPE_ITEMS: { key: Scope; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'owned', label: '我的素材' },
]
export const CATEGORY_ITEMS: CategoryFilter[] = ['全部', ...CATEGORIES]

/** 图鉴统计（静态占位，后续接真实进度） */
export const COLLECTION = {
  collected: 312,
  total: 568,
  level: 23,
  levelPct: 81,
}

/** 快捷栏默认 7 格（§7.1 mockQuickBar 对齐：储物柜 / 感应灯 + 5 空） */
export const DEFAULT_QUICK_SLOTS: (string | null)[] = [
  'locker_7f3a',
  'sensor_light_02',
  'bench_a1',
  'signal_lamp',
  null,
  null,
  null,
]
