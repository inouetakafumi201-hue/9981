// B7-04 粒子令牌注册表 —— §9「彩色粒子全集」的唯一数据来源。
//
// 排查结论（见 lib/b7-audit.ts 的四态清单）：改造前整个前端只存在三处粒子——
// grain-vanish 的 `b7m-grain-bit`、jump-move 的 `b7c-jump-dust`、以及近战命中的一次
// `b7c-melee-flash`，全部是 CSS 伪元素、全部走 currentColor/淡白，没有任何一条挂着
// 语义色。也就是说 §9 的 35 个令牌里真正实现的是 0 个，「降级实现」3 个，其余 32 个
// 完全缺失。本文件把 35 个令牌逐条按规格落成数据：语义色 hex、形状、数量区间、寿命
// 区间、运动律、触发点、可见性。
//
// 纪律（§3）：
//   - 语义色来自视觉定律 1，不得发明新色：红=伤害、蓝=清醒/处决、金=贵重、珊瑚=近战。
//   - 淡白（#FFF8F0 / #F5F5F0）只属于梦境边界家族，不得当作通用粒子色。
//   - 粒子永不承载唯一结果信息：每个令牌都带 `resultEquivalent`，说明粒子被关闭时
//     由哪一段文字/图标承担同一个结果，供 reduced-motion / low 档和素材缺失时使用。

/** 渲染器认识的形状原语。每个形状在 canvas 上有独立的绘制过程，不是「都画成圆点再改颜色」。 */
export type ParticleShape =
  | 'dot' // 实心圆点
  | 'dot-shrink' // 圆点，寿命内半径线性收缩（火焰）
  | 'diamond' // 菱形碎片（冰晶）
  | 'fog' // 模糊雾团（径向渐变）
  | 'bolt' // 折线线段（电光）
  | 'star' // 四芒星（电火花）
  | 'ring' // 圆环描边（精神波纹 / 冲击波）
  | 'shard' // 不规则多边形碎片（玻璃 / 金属）
  | 'coin' // 椭圆硬币（随运动翻面）
  | 'chip' // 晶片矩形（记忆碎片）
  | 'flame' // 火苗（上窄下宽的水滴）
  | 'smoke' // 半透明烟团
  | 'streak' // 拖尾线段（导流光 / 招架光）
  | 'silhouette' // 半透明人形描边点（影子大厅）

/** 运动律。渲染器按这个枚举分发积分方式，不在组件里临时编造速度场。 */
export type ParticleMotion =
  | 'radial-gravity' // 放射溅出 + 重力下坠
  | 'rise' // 向上飘散
  | 'radial' // 纯放射，无重力
  | 'diffuse' // 缓慢扩散并消散
  | 'zigzag' // 折线跳闪
  | 'drift' // 无序漂移
  | 'sink' // 缓慢下沉
  | 'ring-expand' // 由内向外扩散的环
  | 'cone' // 定向扇形
  | 'muzzle-puff' // 极短的枪口火苗 + 少量烟
  | 'lift' // 柔和上升
  | 'press-down' // 压抑下沉
  | 'stream-to' // 沿直线流向一个界面锚点（清醒条）
  | 'bounce-to' // 弹跳飞向一个界面锚点（货币栏）
  | 'float-up' // 缓慢上浮飘散（金雨）
  | 'ground-puff' // 贴地扩散的尘
  | 'trail' // 身后留痕，原地淡出
  | 'haze' // 低密度弥散雾
  | 'hold-jitter' // 原地微幅浮动（影子剪影）
  | 'conduit' // 从中心沿臂导出并向外扩散的光（长眠蓝光）

export type ParticleGroup = 'damage' | 'combat' | 'status' | 'environment'

export type ParticleSpec = {
  readonly id: string
  readonly label: string
  readonly group: ParticleGroup
  /** 语义色。多个值表示寿命内按序插值（爆炸火球 橙→红→暗红），不是随机取色。 */
  readonly colors: readonly string[]
  readonly shape: ParticleShape
  /** 数量区间 [min, max]，standard 档的真实实例数 */
  readonly count: readonly [number, number]
  /** 寿命区间 [min, max] ms */
  readonly lifeMs: readonly [number, number]
  /** 直径区间 [min, max] px */
  readonly sizePx: readonly [number, number]
  readonly motion: ParticleMotion
  /** 触发点（规则语义事件），排查清单直接引用这一列 */
  readonly trigger: string
  /** 粒子被关闭时承担同一结果的可视等价物（§3 粒子不承载唯一结果） */
  readonly resultEquivalent: string
  /** related-only 的粒子只对相关者可见（克制解除），不得公开广播 */
  readonly visibility?: 'public' | 'related-only'
  /** 扇形/定向粒子的张角（度）；仅 cone 使用 */
  readonly coneDeg?: number
  /** 组合令牌：本令牌播放时一起播放的附属令牌（爆炸 = 火球 + 碎片 + 冲击波） */
  readonly composedWith?: readonly string[]
}

// ---------------------------------------------------------------------------
// §9.1 伤害类型粒子 —— 命中点短促爆发，按 semanticType 分发
// ---------------------------------------------------------------------------
const DAMAGE_PARTICLES: readonly ParticleSpec[] = [
  {
    id: 'P-BLOOD', label: '血液飞溅', group: 'damage',
    colors: ['#E23B3B'], shape: 'dot', count: [6, 10], lifeMs: [200, 400], sizePx: [3, 5],
    motion: 'radial-gravity',
    trigger: '物理/近战命中确认（semanticType=damage:physical）',
    resultEquivalent: '命中行文字「造成 N 点伤害」+ 目标 HP 条刷新',
  },
  {
    id: 'P-FIRE', label: '火焰', group: 'damage',
    colors: ['#FF6B35'], shape: 'dot-shrink', count: [8, 12], lifeMs: [300, 500], sizePx: [3, 6],
    motion: 'rise',
    trigger: '火属性命中（damage:fire）',
    resultEquivalent: '「燃烧」状态图标 + 伤害数字',
  },
  {
    id: 'P-ICE', label: '冰霜碎晶', group: 'damage',
    colors: ['#BFE3F2'], shape: 'diamond', count: [6, 8], lifeMs: [300, 500], sizePx: [3, 6],
    motion: 'radial-gravity',
    trigger: '冰属性命中（damage:ice）',
    resultEquivalent: '「冻结」状态图标 + 行动值变化文字',
  },
  {
    id: 'P-POISON', label: '毒雾', group: 'damage',
    colors: ['#4CAF50'], shape: 'fog', count: [3, 5], lifeMs: [800, 1200], sizePx: [14, 22],
    motion: 'diffuse',
    trigger: '毒属性命中（damage:poison）',
    resultEquivalent: '「中毒」状态图标 + 每回合扣血提示',
  },
  {
    id: 'P-ELECTRIC', label: '电光', group: 'damage',
    colors: ['#FFEE32'], shape: 'bolt', count: [4, 6], lifeMs: [100, 200], sizePx: [8, 14],
    motion: 'zigzag',
    trigger: '电属性命中（damage:electric）',
    resultEquivalent: '「麻痹」状态图标 + 跳过回合文字',
  },
  {
    id: 'P-RADIATION', label: '辐射绿眩', group: 'damage',
    colors: ['#7FA653'], shape: 'dot', count: [5, 8], lifeMs: [400, 600], sizePx: [3, 5],
    motion: 'drift',
    trigger: '辐射命中（damage:radiation）',
    resultEquivalent: '「辐射」层数徽标 + 上限下降文字',
  },
  {
    id: 'P-DECAY', label: '凋零灰粒', group: 'damage',
    colors: ['#8A8A8A'], shape: 'dot', count: [6, 8], lifeMs: [400, 600], sizePx: [2, 4],
    motion: 'sink',
    trigger: '凋零命中（damage:decay）',
    resultEquivalent: '「凋零」状态图标 + 治疗效率下降文字',
  },
  {
    id: 'P-CORRODE', label: '侵蚀白粒', group: 'damage',
    colors: ['#F0F0F0'], shape: 'dot', count: [6, 8], lifeMs: [300, 500], sizePx: [2, 4],
    motion: 'radial',
    trigger: '侵蚀命中（damage:corrode）',
    resultEquivalent: '护甲值下降数字 + 「护甲侵蚀」文字',
  },
  {
    id: 'P-MENTAL', label: '精神波纹', group: 'damage',
    colors: ['#8A2BE2'], shape: 'ring', count: [2, 3], lifeMs: [500, 800], sizePx: [16, 40],
    motion: 'ring-expand',
    trigger: '���神命中（damage:mental）',
    resultEquivalent: '「混乱」状态图标 + 指令失效提示',
  },
]

// ---------------------------------------------------------------------------
// §9.2 战斗通用粒子
// ---------------------------------------------------------------------------
const COMBAT_PARTICLES: readonly ParticleSpec[] = [
  {
    id: 'P-MUZZLE', label: '枪口火焰', group: 'combat',
    colors: ['#FFA500'], shape: 'flame', count: [1, 2], lifeMs: [80, 120], sizePx: [10, 12],
    motion: 'muzzle-puff',
    trigger: '每次射击（ranged-shot / recoil-handgun）',
    resultEquivalent: '弹药数 -1 + 射击行文字',
  },
  {
    id: 'P-MUZZLE-HEAVY', label: '步枪连焰', group: 'combat',
    colors: ['#FFB833'], shape: 'flame', count: [3, 5], lifeMs: [90, 150], sizePx: [10, 14],
    motion: 'muzzle-puff',
    trigger: '连发/扫射每一发（ranged-burst / recoil-rifle）',
    resultEquivalent: '弹药数按发数递减 + 连发命中行',
  },
  {
    id: 'P-SCATTER', label: '散弹扇形', group: 'combat',
    colors: ['#FFA500', '#FFD08A'], shape: 'dot', count: [12, 16], lifeMs: [180, 320], sizePx: [2, 4],
    motion: 'cone', coneDeg: 60,
    trigger: '霰弹枪开火（scattergun）',
    resultEquivalent: '「散射命中 N 个目标」文字',
  },
  {
    id: 'P-EXPLODE', label: '爆炸火球', group: 'combat',
    colors: ['#FFA500', '#FF4500', '#8B0000'], shape: 'dot-shrink', count: [30, 50], lifeMs: [1200, 1500], sizePx: [4, 10],
    motion: 'radial',
    trigger: '殉爆 / 爆炸物引爆',
    resultEquivalent: '范围伤害结算行 + 残骸帧',
    composedWith: ['P-EXPLODE-DEBRIS', 'P-SHOCKWAVE'],
  },
  {
    id: 'P-EXPLODE-DEBRIS', label: '爆炸碎片', group: 'combat',
    colors: ['#8B0000', '#C8C8C8'], shape: 'shard', count: [10, 15], lifeMs: [700, 1100], sizePx: [3, 7],
    motion: 'radial-gravity',
    trigger: '与 P-EXPLODE 同时（组合令牌的碎片分量）',
    resultEquivalent: '残骸帧 + 「已损毁」状态文字',
  },
  {
    id: 'P-SHOCKWAVE', label: '冲击波圈', group: 'combat',
    colors: ['#FFFFFF'], shape: 'ring', count: [1, 2], lifeMs: [320, 480], sizePx: [20, 120],
    motion: 'ring-expand',
    trigger: '爆炸 / 重击落地',
    resultEquivalent: '击退距离文字 + 位置刷新',
  },
  {
    id: 'P-PARRY-GLOW', label: '招架微光', group: 'combat',
    colors: ['#FF7F50'], shape: 'streak', count: [3, 4], lifeMs: [220, 340], sizePx: [16, 28],
    motion: 'radial',
    trigger: '招架成功触发（且仅在可招架命中上）',
    resultEquivalent: '「已招架」结果文字 + 珊瑚色焦点环',
  },
]

// ---------------------------------------------------------------------------
// §9.3 状态与资源粒子
// ---------------------------------------------------------------------------
const STATUS_PARTICLES: readonly ParticleSpec[] = [
  {
    id: 'P-BUFF', label: '正面附加', group: 'status',
    colors: ['#3ECC6E'], shape: 'dot', count: [4, 6], lifeMs: [600, 900], sizePx: [3, 5],
    motion: 'lift',
    trigger: '正面状态挂载',
    resultEquivalent: '状态栏新增绿色图标 + 名称/回合数文字',
  },
  {
    id: 'P-DEBUFF', label: '负面附加', group: 'status',
    colors: ['#E23B3B', '#8A2BE2'], shape: 'dot', count: [4, 6], lifeMs: [600, 900], sizePx: [3, 5],
    motion: 'press-down',
    trigger: '负面状态挂载',
    resultEquivalent: '状态栏新增红/紫图标 + 名称/回合数文字',
  },
  {
    id: 'P-OVERLOAD', label: '过载白爆', group: 'status',
    colors: ['#FFFFFF'], shape: 'dot', count: [14, 20], lifeMs: [260, 380], sizePx: [3, 6],
    motion: 'radial',
    trigger: '体力爆条（配合 FS-OVERLOAD 全屏白幕）',
    resultEquivalent: '「过载」大字 + 体力条归零',
  },
  {
    id: 'P-CURE-ICE', label: '冰解碎晶', group: 'status',
    colors: ['#BFE3F2'], shape: 'diamond', count: [5, 7], lifeMs: [400, 600], sizePx: [3, 5],
    motion: 'radial-gravity', visibility: 'related-only',
    trigger: '火解冰（克制解除，仅相关者可见）',
    resultEquivalent: '「冻结已解除」文字（同样只对相关者）',
  },
  {
    id: 'P-CURE-SMOKE', label: '火灭烟', group: 'status',
    colors: ['#BBBBBB'], shape: 'smoke', count: [2, 3], lifeMs: [700, 1000], sizePx: [12, 20],
    motion: 'rise', visibility: 'related-only',
    trigger: '灭火（克制解除，仅相关者可见）',
    resultEquivalent: '「燃烧已解除」文字（同样只对相关者）',
  },
  {
    id: 'P-CURE-POISON', label: '毒散绿雾', group: 'status',
    colors: ['#8FD19E'], shape: 'fog', count: [3, 4], lifeMs: [700, 1000], sizePx: [14, 22],
    motion: 'diffuse', visibility: 'related-only',
    trigger: '毒解除（克制解除，仅相关者可见）',
    resultEquivalent: '「中毒已解除」文字（同样只对相关者）',
  },
  {
    id: 'P-STAMINA', label: '清醒回填', group: 'status',
    colors: ['#4C9EE8'], shape: 'streak', count: [8, 12], lifeMs: [500, 720], sizePx: [10, 18],
    motion: 'stream-to',
    trigger: '令其长眠成立 → 蓝光流向攻击者清醒条',
    resultEquivalent: '攻击者清醒条数值上涨 + 「清醒 +N」文字',
  },
  {
    id: 'P-COIN', label: '美元佣金', group: 'status',
    colors: ['#FFD700'], shape: 'coin', count: [8, 12], lifeMs: [700, 1000], sizePx: [6, 10],
    motion: 'bounce-to',
    trigger: '结算入账（货币）',
    resultEquivalent: '货币栏数值增长 + 「+N 美元」文字',
  },
  {
    id: 'P-SHARD', label: '记忆碎片', group: 'status',
    colors: ['#5B9BD5'], shape: 'chip', count: [6, 9], lifeMs: [700, 1000], sizePx: [5, 9],
    motion: 'bounce-to',
    trigger: '结算入账（记忆碎片）',
    resultEquivalent: '碎片栏数值增长 + 「+N 碎片」文字',
  },
  {
    id: 'P-VICTORY', label: '胜利金雨', group: 'status',
    colors: ['#FFD700'], shape: 'dot', count: [15, 20], lifeMs: [1100, 1600], sizePx: [3, 6],
    motion: 'float-up',
    trigger: '胜利结算板（FS-WIN）',
    resultEquivalent: '「胜利」大字 + 排名/摘要',
  },
]

// ---------------------------------------------------------------------------
// §9.4 环境与移动粒子
// ---------------------------------------------------------------------------
const ENVIRONMENT_PARTICLES: readonly ParticleSpec[] = [
  {
    id: 'P-DUST-LAND', label: '落地灰尘', group: 'environment',
    colors: ['#8B7355'], shape: 'dot', count: [3, 5], lifeMs: [320, 500], sizePx: [3, 6],
    motion: 'ground-puff',
    trigger: '落地压缩瞬间（轻装 3-5 粒）',
    resultEquivalent: '落点格高亮 + 坐标刷新',
  },
  {
    id: 'P-DUST-LAND-HEAVY', label: '重物落地灰尘', group: 'environment',
    colors: ['#8B7355'], shape: 'dot', count: [8, 10], lifeMs: [380, 620], sizePx: [4, 8],
    motion: 'ground-puff',
    trigger: '重物/负重落地压缩瞬间（heavy-hop，8-10 粒）',
    resultEquivalent: '落点格高亮 + 坐标刷新',
  },
  {
    id: 'P-DUST-RUN', label: '奔跑扬尘', group: 'environment',
    colors: ['#8B7355'], shape: 'dot', count: [4, 6], lifeMs: [300, 460], sizePx: [2, 5],
    motion: 'trail',
    trigger: '奔跑状态持续（限频合并，不常驻）',
    resultEquivalent: '「奔跑」状态图标',
  },
  {
    id: 'P-DRAG-TRAIL', label: '爬行拖痕', group: 'environment',
    colors: ['#9E9E9E'], shape: 'streak', count: [3, 5], lifeMs: [420, 640], sizePx: [12, 20],
    motion: 'trail',
    trigger: '爬行（crawl）',
    resultEquivalent: '「倒地移动」状态文字 + 坐标刷新',
  },
  {
    id: 'P-WHEEL-DUST', label: '轮下扬尘', group: 'environment',
    colors: ['#8B7355'], shape: 'dot', count: [8, 12], lifeMs: [340, 520], sizePx: [3, 6],
    motion: 'trail',
    trigger: '载具行驶',
    resultEquivalent: '载具位置刷新 + 速度读数',
  },
  {
    id: 'P-BREAK-GLASS', label: '碎玻璃', group: 'environment',
    colors: ['#D6EDF5'], shape: 'shard', count: [12, 20], lifeMs: [520, 600], sizePx: [4, 9],
    motion: 'radial-gravity',
    trigger: '翻窗 / 跳窗 / 破窗（FS-CLIMB、FS-JUMP）',
    resultEquivalent: '「窗户已破」地形状态 + 通过性变化文字',
  },
  {
    id: 'P-BREAK-METAL', label: '破盾碎屑', group: 'environment',
    colors: ['#C8C8C8'], shape: 'shard', count: [8, 12], lifeMs: [420, 640], sizePx: [3, 7],
    motion: 'radial-gravity',
    trigger: '盾 / 防具破损',
    resultEquivalent: '装备栏「已损毁」���记 + 护甲值归零',
  },
  {
    id: 'P-DREAM-WHITE', label: '梦境弥散', group: 'environment',
    colors: ['#FFF8F0'], shape: 'fog', count: [4, 7], lifeMs: [900, 1400], sizePx: [18, 34],
    motion: 'haze',
    trigger: '���境侵蚀 / 传送（FS-ENTER、FS-RETURN、FS-SLEEPIN）',
    resultEquivalent: '「正在入梦 / 返回驻地」文字',
  },
  {
    id: 'P-SPAWN-RING', label: '出生白尘', group: 'environment',
    colors: ['#F5F5F0'], shape: 'dot', count: [10, 14], lifeMs: [520, 760], sizePx: [3, 6],
    motion: 'ground-puff',
    trigger: '起床 / 褪色完成（FS-SPAWN）',
    resultEquivalent: '「已就位」文字 + 原位置锚点可见',
  },
  {
    id: 'P-SHADOW', label: '影子轮廓', group: 'environment',
    colors: ['#AAAAAA'], shape: 'silhouette', count: [10, 14], lifeMs: [1600, 2400], sizePx: [3, 5],
    motion: 'hold-jitter',
    trigger: '影子大厅（FS-SHADOW，循环至匹配）',
    resultEquivalent: '玩家名条 + 「准备中 / 已就绪」文字',
  },
  {
    id: 'P-BLUE-PLUG', label: '长眠蓝光', group: 'environment',
    colors: ['#4C9EE8'], shape: 'streak', count: [14, 20], lifeMs: [420, 620], sizePx: [20, 46],
    motion: 'conduit',
    trigger: '令其长眠全屏内（FS-SLEEP），径向扩散至 500px',
    resultEquivalent: '「已令其长眠」结果文字 + 目标状态变更',
  },
]

export const PARTICLE_SPECS: readonly ParticleSpec[] = [
  ...DAMAGE_PARTICLES,
  ...COMBAT_PARTICLES,
  ...STATUS_PARTICLES,
  ...ENVIRONMENT_PARTICLES,
]

export const PARTICLE_BY_ID: Record<string, ParticleSpec> = Object.fromEntries(
  PARTICLE_SPECS.map((spec) => [spec.id, spec]),
)

export const PARTICLE_GROUP_LABEL: Record<ParticleGroup, string> = {
  damage: '§9.1 伤害类型',
  combat: '§9.2 战斗通用',
  status: '§9.3 状态与资源',
  environment: '§9.4 环境与移动',
}

// ---------------------------------------------------------------------------
// 预算与三档降级（B7-02 §10.1 / B7-04 §12）
// ---------------------------------------------------------------------------

/** 同屏硬上限，任何组合令牌展开后都不得越过（§12：同屏 ≤50 粒子实例）。 */
export const PARTICLE_HARD_CAP = 50

/**
 * 对象池预分配槽位数（B7-05 §9 particlePoolSize=128）。池比同屏激活上限大：预分配一次、
 * 运行期永不扩容（杜绝 GC 峰），激活数仍由 PARTICLE_HARD_CAP 卡在 ≤50。
 */
export const PARTICLE_POOL_SIZE = 128

/**
 * standard 播放全量；reduced-motion 按 §11「取消粒子，轮廓/透明度收束替代」→ 0；
 * low 档同样为 0（装饰层整体关闭）。这两档的结果由 `resultEquivalent` 的文字/图标承担。
 */
export function particleCountFor(spec: ParticleSpec, profile: 'standard' | 'reduced' | 'low', rand = Math.random): number {
  if (profile !== 'standard') return 0
  const [min, max] = spec.count
  return Math.round(min + rand() * (max - min))
}

/** 组合令牌展开：P-EXPLODE → 火球 + 碎片 + 冲击波。返回真正要生成的令牌序列。 */
export function expandParticleSpec(id: string): readonly ParticleSpec[] {
  const root = PARTICLE_BY_ID[id]
  if (!root) return []
  if (!root.composedWith?.length) return [root]
  return [root, ...root.composedWith.map((childId) => PARTICLE_BY_ID[childId]).filter(Boolean)]
}
