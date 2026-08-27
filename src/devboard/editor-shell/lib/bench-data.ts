/* =========================================================================
   研究台（素材级工作台）— 只读数据层 + 纯派生选择器
   （对齐《WakeUp 研究台完整需求文档》§7 接线清单）

   角色：本界面是「把攒的材料变成作品」的加工厂。所有词条/素材/合成队列/塑形栏
   数据都来自共享元状态层的**只读投影**；接线前这里用确定性占位铺满结构，字段命名
   与 §7.2 端口一一对应。写操作全部走动作通道（在 bench-store.ts 里以占位实现）。

   词条贴图：占位期用「元素强调色 + 首字」像素徽标（真实版由 sprite-forge 产出）。
   基体/塑形/快捷栏素材：复用素材库同一份 MaterialMeta（§4.6 三界面共享）。
   ========================================================================= */

import type { Quality, TokenSlot } from './library-data'
import { QUALITY_COLOR } from './library-data'

export type { Quality, TokenSlot }
export { QUALITY_COLOR }

/* --------------------------------------------------------- 五大类 ---- */

/** 词条五大类（= 锻造 5 槽），每类一个语义色标签（§2.2 五大类标签色） */
export const TOKEN_CATEGORIES: { key: TokenSlot; label: string; tint: string }[] = [
  { key: 'attr', label: '属性', tint: 'var(--bench-cat-attr)' },
  { key: 'skill', label: '技能', tint: 'var(--bench-cat-skill)' },
  { key: 'state', label: '状态', tint: 'var(--bench-cat-state)' },
  { key: 'defense', label: '防御', tint: 'var(--bench-cat-defense)' },
  { key: 'mobility', label: '机动', tint: 'var(--bench-cat-mobility)' },
]

export const CATEGORY_LABEL: Record<TokenSlot, string> = {
  attr: '属性',
  skill: '技能',
  state: '状态',
  defense: '防御',
  mobility: '机动',
}

/* ------------------------------------------------- 元素强调色 ---- */

/** 词条元素强调色（承载「这是什么机制」的语义，非装饰；控制在既有色板内） */
export type ElementAccent = 'fire' | 'ice' | 'volt' | 'poison' | 'shield' | 'arcane' | 'neutral'

export const ACCENT_COLOR: Record<ElementAccent, string> = {
  fire: 'var(--orange)',
  ice: 'var(--cyan)',
  volt: 'var(--q3)',
  poison: 'var(--free)',
  shield: 'var(--q3)',
  arcane: 'var(--gold)',
  neutral: 'var(--bench-dim)',
}

/* ------------------------------------------------------------ 词条 ---- */

/** 研究台词条（收集册条目）。owned=false → 未收集剪影 + 「？」。 */
export interface BenchToken {
  id: string
  category: TokenSlot
  name: string
  quality: Quality
  owned: boolean
  description: string
  collectedAt: number | null
  accent: ElementAccent
}

type Seed = [name: string, quality: Quality, owned: boolean, accent: ElementAccent, desc: string, day?: number]

const RAW: Record<TokenSlot, Seed[]> = {
  attr: [
    ['烈焰', 4, true, 'fire', '造成火焰伤害，对易燃目标额外效果', 12],
    ['穿透', 3, true, 'arcane', '子弹穿透目标，命中多个敌人', 28],
    ['电击', 3, true, 'volt', '触发连锁电击，跳跃至邻近目标', 1],
    ['寒霜', 3, false, 'ice', '造成冰冻伤害，对冷脆目标额外效果'],
    ['腐蚀', 4, false, 'poison', '持续腐蚀伤害，降低目标防御'],
    ['雷暴', 5, false, 'volt', '召唤范围落雷，短暂麻痹群体'],
    ['真空', 2, false, 'arcane', '拉拽命中点附近的目标聚拢'],
    ['碎冰', 2, false, 'ice', '对冰冻目标造成额外碎裂伤害'],
  ],
  skill: [
    ['快拔', 2, true, 'neutral', '换弹速度提升，背包内 0 费换手', 18],
    ['连射', 3, false, 'fire', '短时间内提升射速'],
    ['蓄力', 4, false, 'arcane', '蓄力后释放强化一击'],
    ['拆解', 2, false, 'neutral', '击杀返还部分材料'],
    ['回响', 5, false, 'volt', '技能命中有概率立即重置冷却'],
    ['二连', 3, false, 'fire', '每次攻击附带一次追随打击'],
  ],
  state: [
    ['中毒', 4, true, 'poison', '命中附加中毒，持续流失生命', 20],
    ['灼烧', 3, false, 'fire', '命中附加灼烧，范围蔓延'],
    ['眩晕', 3, false, 'volt', '命中有概率短暂眩晕目标'],
    ['冰封', 4, false, 'ice', '命中叠加冰冻，满层冻结'],
    ['虚弱', 2, false, 'poison', '降低目标造成的伤害'],
    ['标记', 2, false, 'arcane', '标记目标，受到伤害提升'],
  ],
  defense: [
    ['护盾', 3, true, 'shield', '受到伤害时生成护盾', 22],
    ['反弹', 3, false, 'shield', '格挡时反弹部分伤害'],
    ['荆棘', 2, false, 'poison', '近身攻击者受到反伤'],
    ['硬化', 4, false, 'neutral', '短时间大幅提升减伤'],
    ['吸血', 4, false, 'fire', '造成伤害时回复生命'],
    ['壁垒', 5, false, 'shield', '生成可驻守的能量壁垒'],
  ],
  mobility: [
    ['疾风', 3, false, 'ice', '短时间大幅提升移动速度'],
    ['冲刺', 2, false, 'neutral', '向前突进一段距离'],
    ['闪现', 4, false, 'volt', '瞬间位移到指向位置'],
    ['悬浮', 3, false, 'arcane', '短暂悬空，无视地面陷阱'],
    ['滑铲', 2, false, 'neutral', '低姿滑行，躲避高位攻击'],
    ['残影', 5, false, 'volt', '留下诱敌残影并加速'],
  ],
}

const DAY = 86400000
const BASE_TS = 1750000000000

function buildTokens(): BenchToken[] {
  const out: BenchToken[] = []
  ;(Object.keys(RAW) as TokenSlot[]).forEach((cat) => {
    RAW[cat].forEach(([name, quality, owned, accent, desc, day], i) => {
      out.push({
        id: `tk_${cat}_${i}`,
        category: cat,
        name,
        quality,
        owned,
        description: desc,
        collectedAt: owned ? BASE_TS - (day ?? 30) * DAY : null,
        accent,
      })
    })
  })
  return out
}

export const BENCH_TOKENS: BenchToken[] = buildTokens()

export function tokensOfCategory(cat: TokenSlot): BenchToken[] {
  return BENCH_TOKENS.filter((t) => t.category === cat)
}

export function tokenById(id: string | null): BenchToken | null {
  if (!id) return null
  return BENCH_TOKENS.find((t) => t.id === id) ?? null
}

/** 每类收集进度（§4.2 顶部「x / y 已收集」） */
export function collectProgress(cat: TokenSlot): { owned: number; total: number } {
  const list = tokensOfCategory(cat)
  return { owned: list.filter((t) => t.owned).length, total: list.length }
}

export const TOKEN_PAGE_SIZE = 9

/* -------------------------------------------------------- 锻造槽 ---- */

/**
 * 锻造槽位（底图感）：每槽记录「默认词条」（素材自带底图印字）与「当前词条」。
 * - 空槽 = default 与 current 均 null；
 * - 只替换不删除：拖新词条 → current 变；拖回词条库 → current 回落到 default。
 */
export interface ForgeSlotState {
  category: TokenSlot
  defaultTokenId: string | null
  currentTokenId: string | null
}

/** 默认锻造态：对齐参考图（属性=烈焰 / 技能=快拔 / 状态=中毒 / 防御=护盾 / 机动=空） */
export const DEFAULT_FORGE_SLOTS: ForgeSlotState[] = [
  { category: 'attr', defaultTokenId: 'tk_attr_0', currentTokenId: 'tk_attr_0' },
  { category: 'skill', defaultTokenId: 'tk_skill_0', currentTokenId: 'tk_skill_0' },
  { category: 'state', defaultTokenId: 'tk_state_0', currentTokenId: 'tk_state_0' },
  { category: 'defense', defaultTokenId: 'tk_defense_0', currentTokenId: 'tk_defense_0' },
  { category: 'mobility', defaultTokenId: null, currentTokenId: null },
]

/** 默认基体素材（复用素材库拥有素材；接线后来自 materialDetail(baseId)） */
export const DEFAULT_FORGE_BASE = 'locker_7f3a'

/** 一个槽相对默认是否被改动（决定是否显示保存/派生） */
export function forgeIsModified(slots: ForgeSlotState[]): boolean {
  return slots.some((s) => s.currentTokenId !== s.defaultTokenId)
}

/* -------------------------------------------------------- 合成任务（异步） ---- */

/**
 * 合成任务：真实异步耗时——对齐后端 LLM 生成任务的真实时长（60–120s），前端只按
 * 「开始时间 + 时长」两个时间戳纯派生状态，从不用一次性播放完就结束的「加载动画」
 * 表达等待。玩家提交后即可离开研究台去做别的事，任务在后台持续；回来时状态已经
 * 由时间自然推导为「进行中 / 已完成 / 已失败」，不依赖任何本地播放阶段机。
 *
 * 结果（成功/失败/品质）在**提交时**就已确定（占位期用规则派生，接线后由后端在
 * 任务创建时返回），计时结束才向玩家揭示——这样揭示動畫只是「读出已经算好的答案」，
 * 不会因为玩家中途离开又回来而改变结果。
 */
export type JobPhase = 'brewing' | 'done' | 'failed'

export interface SynthesisJob {
  id: string
  baseMaterialId: string
  baseName: string
  tokenNames: string[]
  tokenAccents: ElementAccent[]
  startedAt: number
  durationMs: number
  willFail: boolean
  resultName: string
  resultQuality: Quality
  failReason: string
}

/** 60–120s，对齐真实 LLM 侧任务时长（接线后此区间由后端任务估时返回）。 */
export function randomSynthesisDuration(): number {
  return 60_000 + Math.random() * 60_000
}

export function jobElapsedMs(job: SynthesisJob, now = Date.now()): number {
  return Math.min(Math.max(0, now - job.startedAt), job.durationMs)
}
export function jobProgress(job: SynthesisJob, now = Date.now()): number {
  return jobElapsedMs(job, now) / job.durationMs
}
export function jobRemainingMs(job: SynthesisJob, now = Date.now()): number {
  return Math.max(0, job.durationMs - (now - job.startedAt))
}
export function jobIsFinished(job: SynthesisJob, now = Date.now()): boolean {
  return now - job.startedAt >= job.durationMs
}
export function jobPhase(job: SynthesisJob, now = Date.now()): JobPhase {
  if (!jobIsFinished(job, now)) return 'brewing'
  return job.willFail ? 'failed' : 'done'
}

/** mm:ss 秒表格式（正计时，不用于任何 UI 之外的用途）。 */
export function formatStopwatch(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const JOB_SEED_NOW = Date.now()

/** 演出期占位种子：分别落在「进行中 22%」「已完成待领取」「已失败待查看」三态，
 *  便于界面首屏即可看到三种真实结算态，不必等待完整 60–120s。 */
export const DEMO_JOBS: SynthesisJob[] = [
  {
    id: 'job_demo_brewing',
    baseMaterialId: 'locker_7f3a',
    baseName: '储物柜',
    tokenNames: ['烈焰', '快拔'],
    tokenAccents: ['fire', 'neutral'],
    startedAt: JOB_SEED_NOW - 21_000,
    durationMs: 96_000,
    willFail: false,
    resultName: '强化·储物柜',
    resultQuality: 4,
    failReason: '',
  },
  {
    id: 'job_demo_done',
    baseMaterialId: 'signal_lamp',
    baseName: '信号灯',
    tokenNames: ['电击', '中毒'],
    tokenAccents: ['volt', 'poison'],
    startedAt: JOB_SEED_NOW - 150_000,
    durationMs: 88_000,
    willFail: false,
    resultName: '雅致·信号灯',
    resultQuality: 5,
    failReason: '',
  },
  {
    id: 'job_demo_failed',
    baseMaterialId: 'echo_altar',
    baseName: '回响祭坛',
    tokenNames: ['烈焰', '寒霜'],
    tokenAccents: ['fire', 'ice'],
    startedAt: JOB_SEED_NOW - 108_000,
    durationMs: 80_000,
    willFail: true,
    resultName: '',
    resultQuality: 2,
    failReason: '烈焰与寒霜相互抵消，这次没能成型——材料之间不太合，换个搭配再试试。',
  },
]

/* -------------------------------------------------------- 塑形栏 ---- */

/** 塑形备选栏：5 格，部分随主线/套餐解锁（§4.5） */
export interface MoldingBarState {
  slots: (string | null)[]
  unlocked: boolean[]
}

export const DEFAULT_MOLDING: MoldingBarState = {
  slots: ['dream_beacon', 'signal_lamp', 'echo_altar', null, null],
  unlocked: [true, true, true, false, false],
}

/* ----------------------------------------------- 提取白名单（技术债1）---- */

/** 可提取属性白名单占位：接线前恒为空 → 提取按钮禁用并标注「待白名单」。 */
export const EXTRACT_WHITELIST: string[] = []
