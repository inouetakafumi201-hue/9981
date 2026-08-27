// B7 动效收束 —— 数据层：母题元数据、fallback 阶梯解析、Profile 行为矩阵、动作目录预留结构
// 表现层只读取这里定义的语义，不允许在组件里临时编造描述文案。

import type { SfxId } from './audio-slot'

export const B7_RECIPES = [
  'slow-white-curtain',
  'flash-white',
  'black-fold',
  'afterglow-fade',
  'contour-reveal',
  'semantic-highlight',
  'shake-bounce',
  'list-reflow',
  'grain-vanish',
] as const
export type B7Recipe = (typeof B7_RECIPES)[number]

export type B7Profile = 'standard' | 'reduced' | 'low'
export type B7Trigger = 'state-transition' | 'click-play'
export type B7Phase = 'idle' | 'triggered' | 'playing' | 'completed' | 'skipped' | 'failed' | 'settled'

export type B7Category = 'mask' | 'glow' | 'kinetic' | 'dissolve'

export const RECIPE_CATEGORY: Record<B7Recipe, B7Category> = {
  'slow-white-curtain': 'mask',
  'flash-white': 'mask',
  'black-fold': 'mask',
  'afterglow-fade': 'glow',
  'contour-reveal': 'glow',
  'semantic-highlight': 'glow',
  'shake-bounce': 'kinetic',
  'list-reflow': 'kinetic',
  'grain-vanish': 'dissolve',
}

/** 每个类别在降级到「同语义类别默认」时落到的配方 */
export const CATEGORY_DEFAULT: Record<B7Category, B7Recipe> = {
  mask: 'flash-white',
  glow: 'contour-reveal',
  kinetic: 'shake-bounce',
  dissolve: 'grain-vanish',
}

/** 音频端口：每个语义类别对应一个进场声；收尾/跳过/失败使用通用声（见组件调用点） */
export const CATEGORY_SFX: Record<B7Category, SfxId> = {
  mask: 'b7-mask-sweep',
  glow: 'b7-glow-bloom',
  kinetic: 'b7-kinetic-hit',
  dissolve: 'b7-dissolve-scatter',
}
export function recipeEnterSfx(recipe: B7Recipe): SfxId {
  return CATEGORY_SFX[RECIPE_CATEGORY[recipe]]
}

export type B7MotifMeta = {
  label: string
  /** 参与运动的对象是什么 */
  object: string
  /** 运动从哪里发起 */
  source: string
  /** 运动经过的路径/过程 */
  path: string
  /** 运动最终停留的落点 */
  landing: string
  /** 播放完成后必须保持不变的事实（表现层不得改写它） */
  resultInvariant: string
}

export const MOTIF_META: Record<B7Recipe, B7MotifMeta> = {
  'slow-white-curtain': {
    label: '慢白帷幕',
    object: '一整幅白色帷幕布',
    source: '从场景左边缘卷起点展开',
    path: '以分步（steps）横扫整个场景，短暂完全遮蔽后再从同一侧收回',
    landing: '帷幕完全退回左边缘之外，场景恢复可见',
    resultInvariant: '遮蔽期间发生的状态切换在帷幕收回前必须已经确认，不因帷幕本身产生新事实',
  },
  'flash-white': {
    label: '闪白确认',
    object: '一个居中的白色闪光框',
    source: '从透明瞬间跳到满亮度',
    path: '维持一帧高亮后以分段阶跃快速回落',
    landing: '完全透明，只留下极短的余像',
    resultInvariant: '闪白仅提示「事件已发生」，不携带具体结果内容',
  },
  'black-fold': {
    label: '黑幕折页',
    object: '左右两片黑色三角幕',
    source: '分别从场景左右两条边缘',
    path: '像折页一样向中轴线对折收拢，在中线汇合成一条竖缝',
    landing: '两片幕重新展开退回各自边缘之外',
    resultInvariant: '折页汇合的瞬间对应的是「已确认」的那一次 revision，不是待确认的草稿状态',
  },
  'afterglow-fade': {
    label: '余晖淡出',
    object: '目标轮廓外侧的一层暖色光晕',
    source: '紧贴目标边缘生成',
    path: '向外扩张的同时不透明度线性衰减',
    landing: '完全透明，光晕半径超出可见范围',
    resultInvariant: '余晖只是「刚刚发生过」的视觉痕迹，目标本体的位置/数值不随之变化',
  },
  'contour-reveal': {
    label: '轮廓显影',
    object: '目标外框的描边路径',
    source: '从描边起点（左上角）',
    path: '按分段步进先点亮完整描边，再整体填充半透明底色',
    landing: '保持一条稳定的高亮描边，底色填充维持极低不透明度',
    resultInvariant: '显影表示「这就是当前确认的边界」，不会在描边完成后继续变形',
  },
  'semantic-highlight': {
    label: '语义高亮扫描',
    object: '锚定在语义区域上的高亮扫描条',
    source: '从语义区域上边缘',
    path: '向下扫过整个语义区域一次，同时描边颜色脉冲',
    landing: '扫描条停在区域下边缘并淡出，描边保持强调色常亮',
    resultInvariant: '高亮只强调「这是被引用的语义节点」，不改变该节点本身携带的数值',
  },
  'shake-bounce': {
    label: '弹性回弹',
    object: '目标本体（不新增额外图层）',
    source: '目标当前静止位置',
    path: '沿水平方向做衰减弹性震荡（弹簧回弹），振幅逐步收敛',
    landing: '精确回到震荡前的原始位置，无残留位移',
    resultInvariant: '震荡表现的是「刚接收到一次反馈」，目标的逻辑坐标全程未改变',
  },
  'list-reflow': {
    label: '列表重排',
    object: '一组真实的列表条目（非装饰层）',
    source: '条目当前在列表中的原始顺序/位置',
    path: '使用 FLIP 位移过渡到新顺序，条目之间互相让位而不是瞬移',
    landing: '条目停在新顺序对应的最终位置，不再抖动',
    resultInvariant: '重排前后列表包含的条目集合不变，只有顺序变化，不允许在这个动效里增删条目',
  },
  'grain-vanish': {
    label: '颗粒消散',
    object: '目标形状拆解出的一组独立像素颗粒',
    source: '颗粒各自从目标原形状内的分布位置出发',
    path: '每颗颗粒沿各自随机方向飘散并逐步缩小、淡出',
    landing: '所有颗粒完全消散，原目标形状不再占据画面空间',
    resultInvariant: '消散只发生在表现层，目标在数据层的存在与否由已确认的状态决定，不由这段动效决定',
  },
}

/** 四级 fallback 阶梯：0 指定配方 → 1 同语义类别默认 → 2 程序化反馈 → 3 图标文字 */
export type B7FallbackLevel = 0 | 1 | 2 | 3
export type B7ResolvedFallback =
  | { mode: 'recipe'; recipe: B7Recipe; levelLabel: string }
  | { mode: 'procedural'; levelLabel: string }
  | { mode: 'icon-text'; levelLabel: string }

export function resolveFallback(recipe: B7Recipe, level: B7FallbackLevel): B7ResolvedFallback {
  if (level === 0) return { mode: 'recipe', recipe, levelLabel: '指定配方' }
  if (level === 1) return { mode: 'recipe', recipe: CATEGORY_DEFAULT[RECIPE_CATEGORY[recipe]], levelLabel: '同语义类别默认' }
  if (level === 2) return { mode: 'procedural', levelLabel: '程序化反馈' }
  return { mode: 'icon-text', levelLabel: '图标文字' }
}

/** Profile 行为矩阵：不仅是时长，还决定装饰层/位移是否真的存在 */
export const PROFILE_DURATION_MS: Record<B7Profile, number> = {
  standard: 760,
  reduced: 420,
  low: 260,
}

export const PROFILE_PARTICLE_BUDGET: Record<B7Profile, number> = {
  standard: 16,
  reduced: 6,
  low: 0,
}

/** low 档彻底关闭装饰层 DOM；reduced 档保留主体但去掉位移/震动，只做颜色态变化 */
export function allowsDecorLayer(profile: B7Profile): boolean {
  return profile !== 'low'
}
export function allowsDisplacement(profile: B7Profile): boolean {
  return profile === 'standard'
}
export function particleBudget(profile: B7Profile): number {
  return PROFILE_PARTICLE_BUDGET[profile]
}

// ---------------------------------------------------------------------------
// 阶段二预留：实体动作目录的数据结构（本阶段先落数据契约，组件在阶段二消费）
// ---------------------------------------------------------------------------
export const B7_CATALOG_ACTIONS = [
  'jump-move', 'heavy-hop', 'light-hop', 'stumble-hop', 'crouch-toggle', 'hit-recoil', 'squash-only',
  'crawl', 'fall-down', 'hit-feedback', 'hit-stagger', 'pose-crouch', 'pose-get-up', 'pose-sleep',
  'melee-triple', 'melee-attack', 'melee-puncture', 'melee-sweep', 'ranged-shot', 'recoil-handgun',
  'recoil-rifle', 'scattergun', 'ranged-burst', 'pickup', 'throw', 'use-consumable', 'reload',
  'lock-pick', 'open-door', 'dice-grow',
] as const
export type B7CatalogAction = (typeof B7_CATALOG_ACTIONS)[number]

export type B7CatalogMeta = {
  label: string
  object: string
  source: string
  path: string
  landing: string
  resultInvariant: string
}

  /**
   * 动作目录播放器的确定时长契约，按 B7.6 各配方在时间轴上的实际累加值给出：
   * - jump-move：走 motion.standard-hop 原样，严格 600ms（用户明确要求维持这份手感，
   *   本次调整不改这一行）。
   * - melee-triple：0-200ms 冲近(light-hop 前摆) → 200-350ms 空中缓冲 → 350-400ms
   *   命中/落地压缩 → 400-600ms 受击方 elasticEase.out(0.2s) 弹簧回位，合计 600ms。
   * - ranged-shot：0-100ms 弹体飞行(命中前) → 100-500ms 目标走 motion.hit-recoil
   *   全程 400ms；射手自身的 motion.squash-only(150ms) 与之并行、不额外占用时长。
   * - dice-grow：横条生长的三段节奏未变，仍是 600ms。
   */
export const CATALOG_ACTION_DURATION_MS: Record<B7CatalogAction, number> = {
  'jump-move': 600, 'heavy-hop': 960, 'light-hop': 420, 'stumble-hop': 520,
  'crouch-toggle': 300, 'hit-recoil': 400, 'squash-only': 150, 'crawl': 720,
  'fall-down': 680, 'hit-feedback': 400, 'hit-stagger': 520, 'pose-crouch': 300,
  'pose-get-up': 720, 'pose-sleep': 900, 'melee-triple': 600, 'melee-attack': 560,
  'melee-puncture': 480, 'melee-sweep': 640, 'ranged-shot': 500, 'recoil-handgun': 260,
  'recoil-rifle': 320, 'scattergun': 620, 'ranged-burst': 760, 'pickup': 420,
  'throw': 560, 'use-consumable': 680, 'reload': 880, 'lock-pick': 960,
  'open-door': 760, 'dice-grow': 600,
} as const

/** 兼容旧调用方；新播放器按 action 读取 CATALOG_ACTION_DURATION_MS。 */
export const CATALOG_DURATION_SCALE = 1

export type B7DiceTier = 'bad' | 'mid' | 'good' | 'critical'

/** 骰值 1-6 归类为四档，critical 触发「强力骰加速」阶段 */
export function diceResultTier(value: number): B7DiceTier {
  if (value >= 6) return 'critical'
  if (value >= 5) return 'good'
  if (value <= 2) return 'bad'
  return 'mid'
}

export const CATALOG_META: Record<B7CatalogAction, B7CatalogMeta> = {
  'jump-move': {
    label: '跳跃式移动',
    object: '移动中的角色图标',
    source: '起点格',
    path: '沿抛物线弧线跃向终点格，顶点处有轻微悬停',
    landing: '落地瞬间压扁形变 + 尘土粒子扩散，随后回弹到标准比例',
    resultInvariant: '移动前后角色的逻辑坐标以已确认的终点格为准，动效不决定终点',
  },
  'melee-triple': {
    label: '近战三段攻击',
    object: '发起方与承受方两个图标',
    source: '发起方当前位置',
    path: '跨步冲近 → 前倾突刺（承受方红闪后退）→ 向心回拢至原位',
    landing: '双方都回到各自原始位置，只有承受方保留一次短暂受击色态',
    resultInvariant: '伤害数值/结果由已确认的战斗结算给出，三段动效只是对该结算的可视化',
  },
  'ranged-shot': {
    label: '远程射击',
    object: '发起方图标 + 一枚弹体',
    source: '发起方枪口位置',
    path: '发起方后坐位移的同时枪口闪光，弹体沿直线飞向目标',
    landing: '命中点闪白一次，弹体消失，发起方位置回弹复位',
    resultInvariant: '命中与否由已确认的判定给出，动效不得先于判定播放命中反馈',
  },
  'dice-grow': {
    label: '骰子横条生长', object: '一条横向生长的结果条', source: '条形起点（左侧零刻度）',
    path: '灰白色条先伸出到位，强力骰阶段加速生长并叠加图标，最终左侧按结果刷色', landing: '横条停在对应结果长度，左侧色块与数值同时保持稳定', resultInvariant: '横条最终长度必须与已确认的骰值完全一致',
  },
  'heavy-hop': { label: '重跳', object: '负重角色', source: '起点格', path: '低弧度抬升后沉重落地', landing: '45%落地压缩后回弹', resultInvariant: '终点坐标不变' },
  'light-hop': { label: '轻跳', object: '轻装角色', source: '起点格', path: '高弧度快速跃迁', landing: '轻触地面无余震', resultInvariant: '终点坐标不变' },
  'stumble-hop': { label: '踉跄移动', object: '失衡角色', source: '起点格', path: '短步抖动后前倾迈步', landing: '脚步错位后恢复', resultInvariant: '只改变视觉，不改变坐标' },
  'crouch-toggle': { label: '蹲伏切换', object: '角色', source: '站立姿态', path: '站立到蹲伏的高度压缩', landing: '保持蹲伏姿态', resultInvariant: '逻辑状态与姿态同步' },
  'hit-recoil': { label: '受击回弹', object: '受击角色', source: '当前姿态', path: '命中瞬间后仰并向后滑移', landing: '弹簧回位', resultInvariant: '受击事件先于反馈' },
  'squash-only': { label: '压缩回弹', object: '角色本体', source: '当前姿态', path: '只改变体积比例', landing: '回到标准比例', resultInvariant: '位置与朝向不变' },
  'crawl': { label: '爬行', object: '倒地角色', source: '倒地姿态', path: '伸展与压缩交替向前', landing: '停在下一格', resultInvariant: '路径由指令提供' },
  'fall-down': { label: '倒下过程', object: '角色', source: '站立姿态', path: '重心前移后落地', landing: '进入倒地姿态', resultInvariant: '只播放已确认的倒地结果' },
  'hit-feedback': { label: '受击闪回', object: '受击目标', source: '当前姿态', path: '闪白、蜷缩、回弹', landing: '恢复目标姿态', resultInvariant: '命中结果不可由动画决定' },
  'hit-stagger': { label: '受击硬直', object: '受击角色', source: '当前姿态', path: '短暂停顿后失衡后退', landing: '恢复可行动状态', resultInvariant: '硬直时长由指令确定' },
  'pose-crouch': { label: '蹲下姿态', object: '角色精灵', source: '中性站姿', path: '切换到 crouch 帧', landing: '保持 f10', resultInvariant: '姿态帧与状态一致' },
  'pose-get-up': { label: '起身姿态', object: '倒地角色', source: 'prone 帧', path: 'f11→f16→idle', landing: '恢复站立', resultInvariant: '起身完成才解除倒地' },
  'pose-sleep': { label: '睡眠姿态', object: '角色精灵', source: '当前姿态', path: '闭眼并进入呼吸循环', landing: '保持 sleep', resultInvariant: '不会改变逻辑位置' },
  'melee-attack': { label: '近战攻击', object: '攻击者与目标', source: '攻击者位置', path: '前倾、命中、回收', landing: '双方复位', resultInvariant: '伤害由结算提供' },
  'melee-puncture': { label: '近战刺击', object: '攻击者与目标', source: '攻击者位置', path: '短促直刺与命中停顿', landing: '快速收回', resultInvariant: '命中结果已确认' },
  'melee-sweep': { label: '近战横扫', object: '攻击者与目标', source: '攻击者位置', path: '横向摆动覆盖目标', landing: '回到起始姿态', resultInvariant: '范围由战斗指令提供' },
  'recoil-handgun': { label: '手枪后坐', object: '射手与弹体', source: '枪口', path: '单发、短后坐、闪光', landing: '立即复位', resultInvariant: '弹体命中由判定提供' },
  'recoil-rifle': { label: '步枪后坐', object: '射手与弹体', source: '枪口', path: '长后坐、枪口抬升、回位', landing: '回到瞄准线', resultInvariant: '射击结果由判定提供' },
  'scattergun': { label: '散弹射击', object: '射手与散射弹体', source: '枪口', path: '扇形弹道与强后坐', landing: '烟尘消散', resultInvariant: '散射范围由指令提供' },
  'ranged-burst': { label: '连发射击', object: '射手与连续弹体', source: '枪口', path: '三次节奏一致的发射反馈', landing: '枪口回稳', resultInvariant: '弹数由指令提供' },
  'pickup': { label: '拾取', object: '角色与道具', source: '道具位置', path: '伸手、吸附、收回', landing: '道具进入持有状态', resultInvariant: '库存由后端更新' },
  'throw': { label: '投掷', object: '角色与投掷物', source: '持有位置', path: '蓄力、释放、抛物线', landing: '投掷物进入飞行', resultInvariant: '目标位置由指令提供' },
  'use-consumable': { label: '使用消耗品', object: '角色与道具', source: '持有位置', path: '举起、使用、反馈闪光', landing: '道具消耗状态稳定', resultInvariant: '消耗由后端确认' },
  'reload': { label: '换弹', object: '角色与武器', source: '当前瞄准姿态', path: '卸下、装填、拉栓', landing: '武器回到待机', resultInvariant: '弹药数由后端确认' },
  'lock-pick': { label: '撬锁', object: '角色与锁', source: '锁具位置', path: '插入、微调、解锁反馈', landing: '锁状态改变', resultInvariant: '解锁结果由指令提供' },
  'open-door': { label: '开门', object: '角色与门', source: '门前位置', path: '接近、推开、门缝扩张', landing: '门保持打开', resultInvariant: '门状态由后端确认' },
}

/** 音频端口：动作目录四个实体动作各自的进场声 */
export const CATALOG_SFX: Record<B7CatalogAction, SfxId> = Object.fromEntries(
  B7_CATALOG_ACTIONS.map((action) => [
    action,
    action.startsWith('melee') ? 'b7-catalog-melee' : action.startsWith('ranged') || action.startsWith('recoil') || action === 'scattergun' ? 'b7-catalog-ranged' : action === 'dice-grow' ? 'b7-catalog-dice' : 'b7-catalog-jump',
  ])
) as Record<B7CatalogAction, SfxId>

// ---------------------------------------------------------------------------
// 精灵挂载：动作目录的四个动作各自挂真实精灵对象，而不是拿 lucide 图标当本体。
// 复用已跑通链路的 16 帧侦探角色表（public/games/menu/detective/f01..f16.png，
// 经 lib/chroma-key.ts 抠掉洋红底板），按各动作语义各截取一段不同的关键帧子集：
// 起跳/近战/远程三个位移类动作各是一条"跨拍关键帧"序列，骰子则是按结果分档
// 直接选一张反应帧，不新增美术资源、不与其它页面共用同一套帧含义。
// ---------------------------------------------------------------------------
export const CATALOG_SPRITE_SHEET = '/games/menu/detective'
export function catalogSpriteFrameSrc(id: string): string {
  return `${CATALOG_SPRITE_SHEET}/${id}.png`
}
export const CATALOG_SPRITE_ALL_IDS = Array.from({ length: 16 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`)

// B7.6 版动作指令已经把这张 16 帧表逐帧核对成一份确定的姿态字典（不再是"待机呼吸/
// 困倦/入睡/醒来"的模糊分组）：f07/f08 真的是跳跃前倾/后仰腾空姿，f09 真的是受击后仰，
// f10~f12 真的是蹲下/倒地/坠落。下面 B7_POSE 就是这份姿态字典本身，其余帧序列常量只
// 从这里取值，不再各自散落字面量 'f04'/'f05' 之类的裸字符串。
export const B7_POSE = {
  front: 'f01',
  idle: 'f02',
  leanForwardTired: 'f03',
  leanBackRest: 'f04',
  weakLeanForward: 'f05',
  weakBreathe: 'f06',
  jumpForward: 'f07',
  jumpBackward: 'f08',
  hitRecoil: 'f09',
  crouch: 'f10',
  prone: 'f11',
  falling: 'f12',
  crawlExtend: 'f13',
  crawlCompress: 'f14',
  sleep: 'f15',
  getUpMid: 'f16',
} as const

/**
 * 帧阈值切换规则（B7.6 Ⅰ.2）：倾角 |θ| ≥ 15° 才算「真的有前倾/后仰感」，此时切姿态帧；
 * |θ| < 15° 全部留在 idle，只让曲线本身去表达轻微的缓冲。这是移动类动作换帧的唯一判据，
 * 受击类换帧不受这条阈值约束——它是事件触发（见下面 CATALOG_REACTOR_FRAMES 的说明）。
 */
export const FRAME_THRESHOLD_DEG = 15

// 步行/跳跃式移动：倾角越过 ±15° 时切 jump-forward / jump-backward，其余时间都是 idle。
export const JUMP_SPRITE_FRAMES = [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.idle, B7_POSE.jumpBackward, B7_POSE.idle] as const
// 近战冲刺：前摆冲近的整段都顶着 jump-forward（B7.6 Ⅲ 把冲刺前摆和移动共用同一条阈值
// 帧），冲到位转入空中缓冲/收尾就回 idle，姿态层不再需要额外的突刺专属帧。
export const MELEE_SPRITE_FRAMES = [B7_POSE.jumpForward, B7_POSE.idle] as const
// 远程后坐：recoilPx/leanBackDeg 幅度都在 15° 阈值以内（squash-only 配方，见 MOTION_RECIPE），
// 射手全程都不该越过换帧线，只留 idle。
export const RANGED_SPRITE_FRAMES = [B7_POSE.idle] as const
// 受击反馈是事件触发（"受击事件" 一栏），不看角度阈值：命中瞬间硬切 hit_recoil，弹簧回位
// 完成后切回 idle。近战承受方与远程被命中的目标共用这同一条反应序列。
export const CATALOG_REACTOR_FRAMES = [B7_POSE.idle, B7_POSE.hitRecoil, B7_POSE.idle] as const

type DirectionalCatalogAction = 'jump-move' | 'melee-triple' | 'ranged-shot'

const CATALOG_DIRECTIONAL_FRAMES: Record<DirectionalCatalogAction, readonly string[]> = {
  'jump-move': JUMP_SPRITE_FRAMES,
  'melee-triple': MELEE_SPRITE_FRAMES,
  'ranged-shot': RANGED_SPRITE_FRAMES,
}

/**
 * 非 standard 档（reduced/low）里，CatalogNodes 会把位移曲线的旋转幅度直接归零
 * （见 reducedCurve），倾角永远停在 0°，天然低于 15° 阈值——所以这些档位应该整段
 * 只显示 idle，而不是仍然照单播放一遍阈值帧序列（那会变成"没有倾斜却切了前倾姿"的
 * 姿势/曲线错位）。只有 standard 档的曲线真的越过阈值，才播放完整姿态序列。
 */
export function catalogSpriteFrames(action: B7CatalogAction, profile: B7Profile): readonly string[] {
  if (profile !== 'standard') return [B7_POSE.idle]
  if (action in CATALOG_DIRECTIONAL_FRAMES) return CATALOG_DIRECTIONAL_FRAMES[action as DirectionalCatalogAction]
  const poseFrames: Partial<Record<B7CatalogAction, readonly string[]>> = {
    'heavy-hop': [B7_POSE.idle, B7_POSE.jumpBackward, B7_POSE.idle],
    'light-hop': [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.idle],
    'stumble-hop': [B7_POSE.idle, B7_POSE.leanForwardTired, B7_POSE.weakLeanForward, B7_POSE.idle],
    'crouch-toggle': [B7_POSE.idle, B7_POSE.crouch], 'pose-crouch': [B7_POSE.idle, B7_POSE.crouch],
    'hit-recoil': [B7_POSE.idle, B7_POSE.hitRecoil, B7_POSE.idle], 'hit-feedback': [B7_POSE.idle, B7_POSE.hitRecoil, B7_POSE.idle],
    'hit-stagger': [B7_POSE.idle, B7_POSE.hitRecoil, B7_POSE.leanBackRest, B7_POSE.idle],
    'crawl': [B7_POSE.prone, B7_POSE.crawlExtend, B7_POSE.crawlCompress, B7_POSE.prone],
    'fall-down': [B7_POSE.idle, B7_POSE.falling, B7_POSE.prone], 'pose-get-up': [B7_POSE.prone, B7_POSE.getUpMid, B7_POSE.idle],
    'pose-sleep': [B7_POSE.idle, B7_POSE.sleep, B7_POSE.sleep],
    'melee-attack': [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.hitRecoil, B7_POSE.idle],
    'melee-puncture': [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.idle], 'melee-sweep': [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.idle],
    'recoil-handgun': [B7_POSE.idle, B7_POSE.weakBreathe, B7_POSE.idle], 'recoil-rifle': [B7_POSE.idle, B7_POSE.leanBackRest, B7_POSE.idle],
    'scattergun': [B7_POSE.idle, B7_POSE.hitRecoil, B7_POSE.idle], 'ranged-burst': [B7_POSE.idle, B7_POSE.weakBreathe, B7_POSE.idle],
    'pickup': [B7_POSE.idle, B7_POSE.crouch, B7_POSE.idle], 'throw': [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.idle],
    'use-consumable': [B7_POSE.idle, B7_POSE.crouch, B7_POSE.idle], 'reload': [B7_POSE.idle, B7_POSE.weakBreathe, B7_POSE.idle],
    'lock-pick': [B7_POSE.crouch, B7_POSE.weakBreathe, B7_POSE.crouch], 'open-door': [B7_POSE.idle, B7_POSE.jumpForward, B7_POSE.idle],
  }
  return poseFrames[action] ?? [B7_POSE.idle]
}

/** 骰值结果分档对应的角色反应帧：越差越蔫（爬行/挣扎），暴击最精神（起身帧） */
export const DICE_SPRITE_BY_TIER: Record<B7DiceTier, string> = {
  bad: B7_POSE.crawlExtend,
  mid: B7_POSE.idle,
  good: B7_POSE.jumpForward,
  critical: B7_POSE.getUpMid,
}

// ---------------------------------------------------------------------------
// 朝向契约 + B7-调参手册（E 表）
//
// 朝向：这张 16 帧侦探表里的角色原画一律「朝左站立」。任何一个动作只要它的前进/攻击
// 方向是朝右，就必须把精灵本体整体水平镜像（scaleX 取 -1），否则会出现「面朝左却往右
// 走」的倒滑（moonwalk）。镜像只作用在精灵像素本体这一层，不作用在承载位移/旋转/挤压
// 的 motion 容器上——位移曲线仍在屏幕空间里正常计算，两者互不污染。这条规则对所有会
// 产生朝向的动作一视同仁：跳跃/近战冲刺/远程射手朝右→镜像；被击方/靶子面向来袭方向
// （朝左）→保持原画不镜像。
//
// 手感：角色动作的所有幅度参数集中在 MOTION_RECIPE 里，组件只读取、不再各自散落魔法
// 数字。数值严格对齐 B7.5「E — 调参表格」：倾角 +30°→-60°、落地压缩 35%、回弹 15%、
// 弧高 = 角色高度 × 25%。
// ---------------------------------------------------------------------------
export type Facing = 'left' | 'right'

/** 精灵原画一律朝左；朝右时水平镜像。返回作用在精灵本体上的 scaleX。 */
export function facingScaleX(facing: Facing): number {
  return facing === 'right' ? -1 : 1
}

export const MOTION_RECIPE = {
  /** motion.standard-hop：标准移动 / 跳跃式移动。这条手感是用户明确要求原样保留的
   * 基准，除了这里以外任何其它动作都不得再拿它当默认值抄一遍。 */
  move: {
    durationMs: 600,
    arcHeightRatio: 0.25, // 弧高 = 角色高度 × 25%
    tiltForwardDeg: 30, // 前倾峰值 +30°
    tiltBackDeg: 60, // 后仰峰值 -60°
    landingSquashRatio: 0.35, // 落地压缩 35%
    overshootRatio: 0.15, // 回弹过冲 15%
  },
  /** motion.light-hop：冲刺/rush 专属曲线，幅度比标准移动更"轻快突进"。近战三段的
   * 冲近前摆借这条曲线的倾角/弧度参数，而不是复用 move 的数值。 */
  lightHop: {
    durationMs: 420,
    arcHeightRatio: 0.35,
    rotationAmplitudeDeg: 35,
    squashOnImpactRatio: 0.3,
  },
  /** motion.heavy-hop：重击/负重类位移的曲线基准，本轮四个目录动作暂未直接使用，
   * 先落数据契约，留给后续"重击跳"一类动作复用。 */
  heavyHop: {
    durationMs: 960,
    arcHeightRatio: 0.15,
    rotationAmplitudeDeg: 20,
    squashOnImpactRatio: 0.45,
  },
  /** motion.hit-recoil：受击反馈的唯一参数来源——近战承受方、远程被命中目标都读这
   * 一份数值，不再各自定义一份 knockbackPx。 */
  hitRecoil: {
    durationMs: 400,
    aftermathDistPx: 12,
    squashOnImpactRatio: 0.35,
  },
  /** motion.squash-only：不换帧、只做一次压缩→回弹的轻量反馈，用在幅度小到不足以
   * 越过 15° 换帧阈值的场合（远程射手自身的后坐）。 */
  squashOnly: {
    durationMs: 150,
    squashRatio: 0.6, // 压缩到 1 - 0.6 = 0.4
    returnRatio: 0.35, // 回弹过冲到 1 + 0.35 = 1.35，再落回 1
  },
  /** 近战三段：跨步冲刺（借 lightHop 的倾角）→ hit-stop → 前倾突刺 → 落地压缩收拢 */
  melee: {
    lungeTiltDeg: 18, // 突刺前倾幅度（朝右为顺时针正角）
    impactSquashRatio: 0.35, // 攻击者自身"落地"式的收势压缩，与 hitRecoil 的量保持一致
    overshootRatio: 0.15,
  },
  /** 远程后坐：小幅后坐位移 + 后仰，全程停在 15° 阈值以内，走 squash-only 曲线 */
  ranged: {
    recoilPx: 5, // 后坐位移 5px（规范收得很小）
    leanBackDeg: 5, // 身体后仰 5°
  },
} as const

/**
 * 每个动作里各个「演员」的朝向，是动作定义本身的一部分（谁在前进/攻击 → 朝右镜像；
 * 谁在承受/面向来袭 → 保持原画朝左），不是控制面板的可调状态、也不该散落成组件里的
 * 字面量。控制面板/未来后端只决定"播放哪个 action"，一旦 action 确定，这里就是唯一
 * 的朝向真相来源——组件只读取，不重新决策。
 */
export const CATALOG_FACING: Record<DirectionalCatalogAction, { primary: Facing; secondary?: Facing }> = {
  'jump-move': { primary: 'right' },
  'melee-triple': { primary: 'right', secondary: 'left' }, // 攻击者朝右冲刺；承受方面向来袭方向，朝左
  'ranged-shot': { primary: 'right' },
}
