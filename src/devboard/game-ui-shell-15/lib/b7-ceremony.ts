// B7-04 全屏仪式注册表 —— §10「全屏动画全集」的唯一数据来源。
//
// 排查结论：改造前 components/ 下只有 transition-battle-intro / transition-dream /
// transition-result 三个过场，且它们是「战斗前摇 / 入梦出梦 / 结算」三个自制语汇，
// 跟 §10 的 14 个仪式没有 id 级对应关系——没有 FS-CLIMB/FS-JUMP/FS-PARRY 这类战斗
// 仪式，没有 FS-SHADOW/FS-OVERLOAD/FS-SLEEPIN，结果类只有一个笼统的结算板而没有
// FS-WIN/FS-LOSE/FS-ELIMINATED 的分叉。也就是说 14 个仪式里对得上语义的是 3 个
// （降级实现），完全缺失 11 个。
//
// 本文件把 §10 三张表逐格落成数据：时长、主画面、进出场动势、语义色、粒子、音频与
// 触觉。所有数值直接抄规格，不做「差不多」的近似。
//
// 纪律：
//   - 进出场动势是**具名令牌**，播放器按令牌实现，不允许组件里临时写 transition 字符串。
//   - 每个仪式都带 resultInvariant：仪式播完后必须成立的事实，仪式本身不产生新事实。
//   - 每个仪式都带 fallbackContour：主画面素材缺失时的第三级「程序化反馈」形态
//     （§13：FS-CLIMB 缺图降级为窗框线稿 + 白闪），以及 fallbackReason 可读原因。
//   - 不得借用语义错误的其他全屏（黑幕不能代替梦醒）——所以每条 fallback 都写在自己这一行。

import type { SfxId } from './audio-slot'
import { B7_POSE } from './b7-motion'

export type CeremonyGroup = 'combat' | 'world' | 'result'

/** 进场动势令牌。播放器对每一种有独立实现，不是共用一个 fade。 */
export type CeremonyEnter =
  /** 白闪 N ms + 主画面从右侧斜切撞入（skewX，spring 过冲） */
  | { kind: 'flash-skew-slam'; flashMs: number; skewDeg: number }
  /** 下坠缩放 scale from→1.0 */
  | { kind: 'fall-scale'; from: number }
  /** 纯黑 N ms → 中心光炸开（径向到 radiusPx） */
  | { kind: 'black-then-radial'; blackMs: number; radiusPx: number }
  /** 凝滞 N ms → 冲击闪 N ms + scale 1.0→peak→1.0 */
  | { kind: 'freeze-impact-flash'; freezeMs: number; flashMs: number; peakScale: number }
  /** 慢白幕吞没 → 纯白停留 holdMs */
  | { kind: 'slow-white-swallow'; holdMs: number }
  /** 有方向的边缘吞没 → 纯白内载入 */
  | { kind: 'directional-white-swallow' }
  /** 梦境收束成纯白 */
  | { kind: 'white-converge' }
  /** 慢白幕轻覆（极低强度） */
  | { kind: 'soft-white-veil' }
  /** 驻地站桩，循环态无进场 */
  | { kind: 'standing-loop' }
  /** 瞬白（闪光弹式全幅） */
  | { kind: 'instant-white' }
  /** 纯白涌出 / 聚拢 */
  | { kind: 'white-surge' }
  /** 金色高光结果板 */
  | { kind: 'gold-board' }
  /** 黑幕从四周收束 */
  | { kind: 'black-close-in' }
  /** 视角淡出推离 */
  | { kind: 'view-push-out' }

/** 出场动势令牌。 */
export type CeremonyExit =
  /** 向左加速甩出 + 碎玻璃爆开 */
  | { kind: 'sling-left-glass' }
  /** 落地白闪 N ms + 震屏 N ms */
  | { kind: 'land-flash-shake'; flashMs: number; shakeMs: number }
  /** 蓝光收束成点 + 清醒条绿光刷入 */
  | { kind: 'blue-collapse-green-fill' }
  /** 紫约束边缘收拢退场 */
  | { kind: 'violet-constrict' }
  /** 颜色从床向外滚动恢复 → 起身跳下 */
  | { kind: 'color-roll-out'; getUpFrame: string }
  /** 轮廓显影吐出对局入口 */
  | { kind: 'contour-reveal-out' }
  /** 沿 returnOrigin 复原 → 余辉淡出交还控制 */
  | { kind: 'afterglow-handoff' }
  /** 融入睡眠态 */
  | { kind: 'merge-sleep' }
  /** 循环至匹配：就绪者由 60% 变实 100% */
  | { kind: 'loop-until-match' }
  /** 余辉 N ms 退回，之后站立摇晃 */
  | { kind: 'afterglow-sway'; ms: number }
  /** 结果板斜切滑入（skewX + spring(300,30)） */
  | { kind: 'board-skew-in'; stiffness: number; damping: number }
  /** 金粒上浮 + 边缘金光扫过 */
  | { kind: 'gold-sweep' }
  /** 压黑 → 原因文字淡入 */
  | { kind: 'reason-fade-in' }
  /** 镜头切观战；不做悲壮演出 */
  | { kind: 'cut-to-spectate' }

/** 主画面母题。全部由真实精灵帧 + 程序化漫画处理合成，不依赖外部插画资源。 */
export type KeyArtMotif =
  | 'window-sill' // 正对窗台、单手撑框、半身已越
  | 'top-down-fall' // 俯视镜头、下坠姿态、地面逼近速度线
  | 'conduit-palm' // 手掌抵住倒地目标、蓝光沿臂导出
  | 'grapple-lock' // 擒拿定格、双方力量对峙线
  | 'bed-highkey' // 床与人形整体纯白高调
  | 'bed-anchor' // 床锚点先可见
  | 'dream-converge' // 梦境收束成纯白
  | 'bedside' // 床侧安睡仪式
  | 'shadow-hall' // 驻地站桩 + 他方半透明剪影
  | 'white-blast' // 纯白闪光弹式全幅
  | 'result-board' // 结果板（胜负平大字 + 排名 + 摘要）

export type CeremonyKeyArt = {
  readonly motif: KeyArtMotif
  /** 母题里的主体精灵帧（来自 16 帧侦探表）；纯板式仪式为 null */
  readonly frame: string | null
  readonly facing: 'left' | 'right'
  /** 背景处理，直接抄规格（FS-CLIMB: backdrop-blur(4px)+brightness(0.6)） */
  readonly backdrop?: string
}

export type CeremonySpec = {
  readonly id: string
  readonly label: string
  readonly group: CeremonyGroup
  /** 时长 ms；'loop' 表示循环至外部事件（FS-SHADOW 循环至匹配） */
  readonly durationMs: number | 'loop'
  /** 规格里给区间的（FS-RESULT 800-1200ms）保留区间说明 */
  readonly durationNote?: string
  readonly keyArtDesc: string
  readonly keyArt: CeremonyKeyArt
  readonly enter: CeremonyEnter
  readonly enterDesc: string
  readonly exit: CeremonyExit
  readonly exitDesc: string
  /** 语义色，来自视觉定律 1；纯白仪式留空数组表示只用梦境边界白 */
  readonly colors: readonly string[]
  readonly colorDesc: string
  /** 挂载的 §9 粒子令牌 id */
  readonly particles: readonly string[]
  readonly particleDesc: string
  readonly audioDesc: string
  readonly sfx: SfxId
  readonly haptic: 'light' | 'medium' | 'heavy' | null
  /** 可跳过（§11：全屏仪式必须可跳过 / 可缩短） */
  readonly skippable: boolean
  /** 仪式播完后必须成立的事实 */
  readonly resultInvariant: string
  /** 第三级 fallback：主画面素材缺失时的程序化反馈形态 */
  readonly fallbackContour: string
  readonly fallbackReason: string
}

// ---------------------------------------------------------------------------
// §10.1 战斗内仪式（四个）
// ---------------------------------------------------------------------------
const COMBAT_CEREMONIES: readonly CeremonySpec[] = [
  {
    id: 'FS-CLIMB', label: '翻窗', group: 'combat', durationMs: 800,
    keyArtDesc: '角色正对窗台、单手撑框、半身已越的漫画特写；背景 backdrop-blur(4px)+brightness(0.6)',
    keyArt: { motif: 'window-sill', frame: B7_POSE.jumpForward, facing: 'right', backdrop: 'blur(4px) brightness(0.6)' },
    enter: { kind: 'flash-skew-slam', flashMs: 80, skewDeg: -8 },
    enterDesc: '白闪 80ms + 主画面右侧斜切撞入（skewX -8°，spring 过冲）',
    exit: { kind: 'sling-left-glass' },
    exitDesc: '向左加速甩出 + 碎玻璃爆开',
    colors: ['#E8E8E4', '#FF7F50'], colorDesc: '灰白窗框 + 珊瑚动势线',
    particles: ['P-BREAK-GLASS'], particleDesc: 'P-BREAK-GLASS',
    audioDesc: '玻璃碎音；中触觉', sfx: 'b7-kinetic-hit', haptic: 'medium', skippable: true,
    resultInvariant: '翻窗是否成功由已确认的判定给出；仪式只可视化该判定，窗户破损状态在仪式前已写入',
    fallbackContour: '窗框线稿（灰白描边矩形 + 台沿）+ 白闪，保留珊瑚动势线',
    fallbackReason: 'asset.fallback：翻窗主画面缺失，降级为窗框线稿 + 白闪',
  },
  {
    id: 'FS-JUMP', label: '跳窗', group: 'combat', durationMs: 600,
    keyArtDesc: '高处向下俯冲一格：俯视镜头、下坠姿态、地面逼近的速度线',
    keyArt: { motif: 'top-down-fall', frame: B7_POSE.falling, facing: 'left' },
    enter: { kind: 'fall-scale', from: 1.3 },
    enterDesc: '下坠缩放（scale 1.3→1.0）',
    exit: { kind: 'land-flash-shake', flashMs: 60, shakeMs: 200 },
    exitDesc: '落地白闪 60ms + 震屏 200ms',
    colors: ['#FFFFFF', '#FFA500'], colorDesc: '白速度线 + 落点橙光',
    particles: ['P-DUST-LAND', 'P-SHOCKWAVE'], particleDesc: 'P-DUST-LAND + P-SHOCKWAVE',
    audioDesc: '风声 + 闷响；重触觉', sfx: 'b7-kinetic-hit', haptic: 'heavy', skippable: true,
    resultInvariant: '落点格由已确认的移动指令给出，仪式不决定落到哪一格',
    fallbackContour: '俯视速度线场（白色纵向线束）+ 落点橙色圆环，无角色本体',
    fallbackReason: 'asset.fallback：跳窗俯视主画面缺失，降级为速度线 + 落点光环',
  },
  {
    id: 'FS-SLEEP', label: '令其长眠', group: 'combat', durationMs: 500,
    keyArtDesc: '蓝色「导流/插头」仪式图：手掌抵住倒地目标、蓝光沿臂导出的高对比特写',
    keyArt: { motif: 'conduit-palm', frame: B7_POSE.prone, facing: 'left' },
    enter: { kind: 'black-then-radial', blackMs: 100, radiusPx: 500 },
    enterDesc: '纯黑 100ms → 蓝光中心炸开（径向 500px）',
    exit: { kind: 'blue-collapse-green-fill' },
    exitDesc: '蓝光收束成点 + 清醒条绿光刷入',
    colors: ['#4C9EE8', '#3ECC6E'], colorDesc: '蓝 #4C9EE8 + 绿 #3ECC6E',
    particles: ['P-BLUE-PLUG', 'P-STAMINA'], particleDesc: 'P-BLUE-PLUG + P-STAMINA',
    audioDesc: '嗡鸣 → 清脆确认；轻触觉', sfx: 'b7-channel-open', haptic: 'light', skippable: true,
    resultInvariant: '长眠成立与清醒值回填都由已确认的结算给出；仪式不得先于结算播放',
    fallbackContour: '中心蓝色径向渐变 + 一条导流直线，配「已令其长眠」文字',
    fallbackReason: 'asset.fallback：长眠仪式图缺失，降级为蓝色导流径向光',
  },
  {
    id: 'FS-PARRY', label: '招架触发', group: 'combat', durationMs: 1000,
    keyArtDesc: '擒拿定格：武器被格挡瞬间剪影、双方力量对峙线',
    keyArt: { motif: 'grapple-lock', frame: B7_POSE.jumpForward, facing: 'right' },
    enter: { kind: 'freeze-impact-flash', freezeMs: 150, flashMs: 100, peakScale: 1.15 },
    enterDesc: '凝滞 150ms → 珊瑚冲击闪 100ms + scale 1.0→1.15→1.0',
    exit: { kind: 'violet-constrict' },
    exitDesc: '紫约束边缘收拢退场',
    colors: ['#FF7F50', '#8A2BE2'], colorDesc: '珊瑚 #FF7F50 + 紫 #8A2BE2',
    particles: ['P-PARRY-GLOW'], particleDesc: 'P-PARRY-GLOW',
    audioDesc: '金属交鸣；中触觉', sfx: 'b7-kinetic-hit', haptic: 'medium', skippable: true,
    resultInvariant: '招架成立由已确认的判定给出；仪式只在可招架命中上播放',
    fallbackContour: '双向对峙力线（左右两组珊瑚箭线在中轴顶住）+ 紫色约束边框',
    fallbackReason: 'asset.fallback：擒拿定格图缺失，降级为对峙力线 + 紫约束边',
  },
]

// ---------------------------------------------------------------------------
// §10.2 世界/驻地仪式（六个）
// ---------------------------------------------------------------------------
const WORLD_CEREMONIES: readonly CeremonySpec[] = [
  {
    id: 'FS-SPAWN', label: '出生/起床', group: 'world', durationMs: 1200,
    keyArtDesc: '床与人形整体纯白高调画面，轮廓清晰',
    keyArt: { motif: 'bed-highkey', frame: B7_POSE.sleep, facing: 'left' },
    enter: { kind: 'slow-white-swallow', holdMs: 200 },
    enterDesc: '慢白幕吞没 → 纯白停留 200ms',
    exit: { kind: 'color-roll-out', getUpFrame: B7_POSE.getUpMid },
    exitDesc: '颜色从床向外滚动恢复 → get_up_mid 起身跳下',
    colors: ['#FFF8F0', '#F5F5F0'], colorDesc: '梦境边界白（高调，仅轮廓可辨）',
    particles: ['P-SPAWN-RING'], particleDesc: 'P-SPAWN-RING',
    audioDesc: '低频白噪淡入 → 起身落地轻响', sfx: 'b7-mask-sweep', haptic: 'light', skippable: true,
    resultInvariant: '出生位置由已确认的驻地锚点给出；仪式播完角色必须站在该锚点上',
    fallbackContour: '纯白高调底 + 床与人形的双线轮廓描边',
    fallbackReason: 'asset.fallback：起床主画面缺失，降级为纯白底 + 轮廓线稿',
  },
  {
    id: 'FS-ENTER', label: '入梦', group: 'world', durationMs: 1000,
    keyArtDesc: '床锚点先可见 → 慢白幕将人形/床推入纯白 → 梦境显影',
    keyArt: { motif: 'bed-anchor', frame: B7_POSE.sleep, facing: 'left' },
    enter: { kind: 'directional-white-swallow' },
    enterDesc: '有方向的边缘吞没 → 纯白内载入',
    exit: { kind: 'contour-reveal-out' },
    exitDesc: '轮廓显影吐出对局入口',
    colors: ['#FFF8F0'], colorDesc: '梦境边界白（单向吞没）',
    particles: ['P-DREAM-WHITE'], particleDesc: 'P-DREAM-WHITE',
    audioDesc: '梦境进入音；轻触觉', sfx: 'b7-channel-open', haptic: 'light', skippable: true,
    resultInvariant: '入梦目标对局由已确认的匹配结果给出；白幕期间不产生新的匹配事实',
    fallbackContour: '单向白色边缘吞没渐变 + 床锚点十字标记',
    fallbackReason: 'asset.fallback：入梦主画面缺失，降级为方向性白幕 + 锚点标记',
  },
  {
    id: 'FS-RETURN', label: '返回', group: 'world', durationMs: 800,
    keyArtDesc: '梦境收束成纯白，returnOrigin 落回驻地原位',
    keyArt: { motif: 'dream-converge', frame: B7_POSE.idle, facing: 'left' },
    enter: { kind: 'white-converge' },
    enterDesc: '纯白收束',
    exit: { kind: 'afterglow-handoff' },
    exitDesc: '沿 returnOrigin 复原人形/床 → 余辉淡出交还控制',
    colors: ['#FFF8F0'], colorDesc: '梦境边界白（向内收束）',
    particles: ['P-DREAM-WHITE'], particleDesc: 'P-DREAM-WHITE',
    audioDesc: '梦境退出音；轻触觉', sfx: 'b7-settle', haptic: 'light', skippable: true,
    resultInvariant: 'returnOrigin 是进入梦境前记录的驻地原位，仪式必须落回该坐标而不是就近格',
    fallbackContour: '向心白色收束渐变 + returnOrigin 坐标十字',
    fallbackReason: 'asset.fallback：返回主画面缺失，降级为向心白幕 + 原位标记',
  },
  {
    id: 'FS-SLEEPIN', label: '入睡就绪', group: 'world', durationMs: 800,
    keyArtDesc: '床侧安睡仪式图（锚定导流仪就绪后才播）',
    keyArt: { motif: 'bedside', frame: B7_POSE.sleep, facing: 'left' },
    enter: { kind: 'soft-white-veil' },
    enterDesc: '慢白幕轻覆',
    exit: { kind: 'merge-sleep' },
    exitDesc: '融入睡眠态',
    colors: ['#FFF8F0'], colorDesc: '梦境边界白（极低强度）',
    particles: ['P-DREAM-WHITE'], particleDesc: 'P-DREAM-WHITE 极低密度',
    audioDesc: '呼吸式低频；无触觉', sfx: 'b7-settle', haptic: null, skippable: true,
    resultInvariant: '必须在导流仪锚定就绪之后才播；仪式本身不代表就绪',
    fallbackContour: '低强度白色覆盖 + 床侧轮廓线',
    fallbackReason: 'asset.fallback：入睡仪式图缺失，降级为低强度白覆盖',
  },
  {
    id: 'FS-SHADOW', label: '影子大厅', group: 'world', durationMs: 'loop',
    durationNote: '循环至匹配',
    keyArtDesc: '驻地站桩 + 他方玩家半透明剪影（60%）',
    keyArt: { motif: 'shadow-hall', frame: B7_POSE.idle, facing: 'left' },
    enter: { kind: 'standing-loop' },
    enterDesc: '驻地站桩，无独立进场',
    exit: { kind: 'loop-until-match' },
    exitDesc: '剪影 ±2px 浮动（2s 周期）；就绪者变实（100%）',
    colors: ['#AAAAAA'], colorDesc: '中性灰剪影（60% → 就绪 100%）',
    particles: ['P-SHADOW'], particleDesc: 'P-SHADOW',
    audioDesc: '环境低频循环；无触觉', sfx: 'b7-channel-open', haptic: null, skippable: false,
    resultInvariant: '剪影的实/虚只反映已上报的就绪状态，循环本身不推进匹配',
    fallbackContour: '半透明人形轮廓阵列 + 就绪者实心描边',
    fallbackReason: 'asset.fallback：影子大厅主画面缺失，降级为轮廓阵列',
  },
  {
    id: 'FS-OVERLOAD', label: '过载白爆', group: 'world', durationMs: 300,
    keyArtDesc: '纯白闪光弹式全幅过载',
    keyArt: { motif: 'white-blast', frame: B7_POSE.hitRecoil, facing: 'left' },
    enter: { kind: 'instant-white' },
    enterDesc: '瞬白',
    exit: { kind: 'afterglow-sway', ms: 200 },
    exitDesc: '余辉 200ms 退回；之后站立摇晃',
    colors: ['#FFFFFF'], colorDesc: '纯白（闪光弹式，非梦境白）',
    particles: ['P-OVERLOAD'], particleDesc: 'P-OVERLOAD',
    audioDesc: '爆闪高频；重触觉', sfx: 'b7-kinetic-hit', haptic: 'heavy', skippable: true,
    resultInvariant: '体力归零由已确认的结算给出；白爆只提示过载已发生',
    fallbackContour: '全幅纯白不透明度脉冲，无轮廓',
    fallbackReason: 'asset.fallback：过载主画面缺失，降级为全幅白脉冲',
  },
]

// ---------------------------------------------------------------------------
// §10.3 结果仪式（四个）
// ---------------------------------------------------------------------------
const RESULT_CEREMONIES: readonly CeremonySpec[] = [
  {
    id: 'FS-RESULT', label: '梦醒结算', group: 'result', durationMs: 1000,
    durationNote: '800-1200ms',
    keyArtDesc: '纯白涌出/聚拢 → 结果板（胜负平大字 + 排名 + 摘要）',
    keyArt: { motif: 'result-board', frame: null, facing: 'left' },
    enter: { kind: 'white-surge' },
    enterDesc: '纯白梦醒语汇（涌出/聚拢）',
    exit: { kind: 'board-skew-in', stiffness: 300, damping: 30 },
    exitDesc: '结果板斜切滑入（skewX + spring(300,30)）',
    colors: ['#FFF8F0', '#E8E8E4'], colorDesc: '梦醒纯白 + 板面灰白',
    particles: [], particleDesc: '无（克制）',
    audioDesc: '梦醒长音 → 板面落定；轻触觉', sfx: 'b7-settle', haptic: 'light', skippable: true,
    resultInvariant: '结果板上的胜负/排名/摘要全部来自已确认的结算数据，斜切滑入不改写任何一格',
    fallbackContour: '纯白底 + 纯文字结果板（大字 + 排名列表），不借用黑幕语汇',
    fallbackReason: 'asset.fallback：结算板背景缺失，降级为纯白底文字板',
  },
  {
    id: 'FS-WIN', label: '胜利', group: 'result', durationMs: 900,
    durationNote: '板后（接在 FS-RESULT 之后）',
    keyArtDesc: '金色高光结果板',
    keyArt: { motif: 'result-board', frame: null, facing: 'left' },
    enter: { kind: 'gold-board' },
    enterDesc: '金色高光结果板浮出',
    exit: { kind: 'gold-sweep' },
    exitDesc: '金粒上浮 + 边缘金光扫过',
    colors: ['#FFD700'], colorDesc: '贵重金 #FFD700',
    particles: ['P-VICTORY'], particleDesc: 'P-VICTORY',
    audioDesc: '胜利上行音；中触觉', sfx: 'b7-glow-bloom', haptic: 'medium', skippable: true,
    resultInvariant: '胜利判定先于仪式确认；金光只是对该判定的强调',
    fallbackContour: '金色描边板 + 「胜利」大字，无粒子',
    fallbackReason: 'asset.fallback：胜利板缺失，降级为金色描边 + 大字',
  },
  {
    id: 'FS-LOSE', label: '失败', group: 'result', durationMs: 600,
    keyArtDesc: '黑幕从四周收束',
    keyArt: { motif: 'result-board', frame: null, facing: 'left' },
    enter: { kind: 'black-close-in' },
    enterDesc: '黑幕从四周向内收束（压黑）',
    exit: { kind: 'reason-fade-in' },
    exitDesc: '压黑 → 原因文字淡入',
    colors: ['#0A0A0A'], colorDesc: '压黑（失败专属，不得用于梦醒）',
    particles: [], particleDesc: '无',
    audioDesc: '下行闷音；轻触觉', sfx: 'b7-fail', haptic: 'light', skippable: true,
    resultInvariant: '失败原因文字来自已确认的结算，黑幕不决定原因',
    fallbackContour: '四周向内的黑色 inset 阴影 + 原因文字',
    fallbackReason: 'asset.fallback：失败板缺失，降级为四周压黑 + 原因文字',
  },
  {
    id: 'FS-ELIMINATED', label: '淘汰转观战', group: 'result', durationMs: 500,
    keyArtDesc: '被淘汰者视角淡出推离梦境',
    keyArt: { motif: 'result-board', frame: null, facing: 'left' },
    enter: { kind: 'view-push-out' },
    enterDesc: '视角淡出 + 向后推离（不做悲壮演出）',
    exit: { kind: 'cut-to-spectate' },
    exitDesc: '镜头切观战；轮次栏条目缩出淡出',
    colors: ['#8A8A8A'], colorDesc: '中性灰（克制，不加悲壮色）',
    particles: [], particleDesc: '轮次栏条目缩出淡出（非粒子）',
    audioDesc: '短促切换音；无触觉', sfx: 'b7-skip', haptic: null, skippable: true,
    resultInvariant: '淘汰由已确认的结算给出；仪式只做视角交接，不追加情绪演出',
    fallbackContour: '整幅缩放淡出 + 「已淘汰 · 转入观战」文字',
    fallbackReason: 'asset.fallback：淘汰视角缺失，降级为缩放淡出 + 文字',
  },
]

export const CEREMONY_SPECS: readonly CeremonySpec[] = [
  ...COMBAT_CEREMONIES,
  ...WORLD_CEREMONIES,
  ...RESULT_CEREMONIES,
]

export const CEREMONY_BY_ID: Record<string, CeremonySpec> = Object.fromEntries(
  CEREMONY_SPECS.map((spec) => [spec.id, spec]),
)

export const CEREMONY_GROUP_LABEL: Record<CeremonyGroup, string> = {
  combat: '§10.1 战斗内仪式',
  world: '§10.2 世界/驻地仪式',
  result: '§10.3 结果仪式',
}

/**
 * Profile 缩放（§11：全屏仪式必须可跳过/可缩短）。
 * reduced 砍到 45% 并去掉位移类动势；low 砍到 25% 且只保留不透明度收束。
 */
export function ceremonyDurationFor(spec: CeremonySpec, profile: 'standard' | 'reduced' | 'low'): number {
  if (spec.durationMs === 'loop') return profile === 'standard' ? 2000 : 1200
  if (profile === 'standard') return spec.durationMs
  if (profile === 'reduced') return Math.round(spec.durationMs * 0.45)
  return Math.round(spec.durationMs * 0.25)
}
