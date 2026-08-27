'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Crosshair,
  Dices,
  FastForward,
  Footprints,
  GitCommitVertical,
  Layers,
  Radio,
  ShieldAlert,
  Sparkles,
  Gauge,
  Swords,
  VolumeX,
  Volume2,
} from 'lucide-react'
import { B7CeremonyPanel, B7ParticlePanel } from '@/components/b7-showcase'
import { B7CoherencePanel } from '@/components/b7-coherence-panel'
import {
  allowsDecorLayer,
  B7_CATALOG_ACTIONS,
  B7_RECIPES,
  type B7CatalogAction,
  catalogSpriteFrames,
  catalogSpriteFrameSrc,
  CATALOG_ACTION_DURATION_MS,
  CATALOG_META,
  CATALOG_REACTOR_FRAMES,
  CATALOG_SFX,
  DICE_SPRITE_BY_TIER,
  type B7FallbackLevel,
  type B7Phase,
  type B7Profile,
  type B7Recipe,
  type B7Trigger,
  type Facing,
  facingScaleX,
  MOTION_RECIPE,
  CATALOG_FACING,
  diceResultTier,
  MOTIF_META,
  particleBudget,
  PROFILE_DURATION_MS,
  recipeEnterSfx,
  resolveFallback,
} from '@/lib/b7-motion'
import { playSfx } from '@/lib/audio-slot'
import { useKeyedSpriteFrames } from '@/hooks/use-keyed-sprite-frames'

// 动作目录的精灵挂载：预热「目录里每一个动作在 standard 档实际会切到的帧」的并集，而不是
// 只挑 jump/melee/ranged 三个位移类动作的帧表。之前这里只收了 JUMP/MELEE/RANGED_SPRITE_FRAMES
// + 骰子反应帧，遗漏了 catalogSpriteFrames() 里为其它二十多个动作（重心前移/蹲伏/爬行/倒地/
// 睡眠/起身/换弹/开门……）映射到的 f03/f04/f05/f06/f10~f16 各姿态帧——这些帧从未被 chroma-key
// 抠图缓存收录，所以时间轴切到它们时 keyedFrames[src] 是 undefined，<img> 直接不渲染，看起来
// 就是角色在动画中途凭空消失（闪烁）。只有 heavy-hop/light-hop 全程只用 f02/f07/f08，正好都在
// 旧的预热集合里，所以之前只有它们表现正常。这里改成从全部动作枚举里收集真实会用到的帧集合，
// 保证任何一个动作切到的每一帧都已经被抠好图，不会中途丢帧。chroma-key 结果仍按 src 模块级
// 缓存，与角色标题屏幕的侦探精灵共享同一份缓存，不会重复抠图。
const CATALOG_SPRITE_IDS = Array.from(
  new Set([
    ...B7_CATALOG_ACTIONS.flatMap((action) => catalogSpriteFrames(action, 'standard')),
    ...Object.values(DICE_SPRITE_BY_TIER),
  ]),
)
const CATALOG_SPRITE_SRCS = CATALOG_SPRITE_IDS.map(catalogSpriteFrameSrc)

// 人类可读的相位播报文案 —— aria-live 只念这个，不念相位枚举
const PHASE_ANNOUNCE: Record<B7Phase, string> = {
  idle: '待命',
  triggered: '已触发',
  playing: '播放中',
  completed: '已完成',
  skipped: '已跳过',
  failed: '未通过',
  settled: '已收束',
}

export type { B7Phase, B7Profile, B7Recipe, B7Trigger }
export { B7_RECIPES }

export type B7MotionEvent = {
  id: string
  semanticId: string
  recipe: B7Recipe
  trigger: B7Trigger
  revision: number
  fallbackLevel: B7FallbackLevel
  failed?: boolean
}

// ---------------------------------------------------------------------------
// 每个母题各自独立的真实结构，不再共用同一套通用 mask/contour/grain 三层 div
// ---------------------------------------------------------------------------

function MotifNodes({ recipe, profile }: { recipe: B7Recipe; profile: B7Profile }) {
  switch (recipe) {
    case 'slow-white-curtain':
      return (
        <div className="b7m-curtain">
          <span className="b7m-curtain-panel" />
        </div>
      )
    case 'flash-white':
      return (
        <div className="b7m-flash">
          <span className="b7m-flash-core" />
        </div>
      )
    case 'black-fold':
      return (
        <div className="b7m-fold">
          <span className="b7m-fold-l" />
          <span className="b7m-fold-r" />
        </div>
      )
    case 'afterglow-fade':
      return (
        <div className="b7m-afterglow">
          <span className="b7m-afterglow-ring" />
          {allowsDecorLayer(profile) && <span className="b7m-afterglow-spark" />}
        </div>
      )
    case 'contour-reveal':
      return (
        <div className="b7m-contour">
          <span className="b7m-contour-edge" />
          <span className="b7m-contour-fill" />
        </div>
      )
    case 'semantic-highlight':
      return (
        <div className="b7m-semantic">
          <span className="b7m-semantic-border" />
          <span className="b7m-semantic-scan" />
        </div>
      )
    case 'shake-bounce':
      return (
        <div className="b7m-note">
          <GitCommitVertical size={12} />
          <span>目标本体直接回弹，见场景内 ANCHOR PILOT（不新增图层）</span>
        </div>
      )
    case 'list-reflow':
      return (
        <div className="b7m-note">
          <Layers size={12} />
          <span>真实队列已在场景内重排，见下方 QUEUE 条目</span>
        </div>
      )
    case 'grain-vanish': {
      const count = particleBudget(profile)
      return (
        <div className="b7m-grain">
          <span className="b7m-grain-core" />
          {allowsDecorLayer(profile) &&
            Array.from({ length: count }).map((_, i) => (
              <i key={i} className="b7m-grain-bit" style={{ '--gi': i, '--gn': count } as React.CSSProperties} />
            ))}
        </div>
      )
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// 阶段二：实体动作目录 —— 每个动作各自的真实舞台结构（跨步/后坐/横条生长）
// ---------------------------------------------------------------------------

export type B7CatalogEvent = {
  id: string
  action: B7CatalogAction
  trigger: B7Trigger
  revision: number
  diceValue: number
}

const JUMP_DIST_PX = 88
const MELEE_APPROACH_PX = 96
const RANGED_DIST_PX = 168

// 三个位移类动作各自的关键帧时间轴。步行(jump-move)的手感——位移/旋转/压缩曲线本身
// ——本轮明确保持不变，这里只是把姿态帧的切换点跟已有的 rotate 曲线重新核对了一遍：
// rotate 曲线在 times%=[0,8,30,42,58,72,78,86,100] 上取值 [0,15,30,15,-15,-30,0,0,0]，
// 越过 ±15° 阈值的四个真实节点是 8%（+15° 起）/ 46%（回落到 <15°）/ 54%（跌破 -15°）/
// 78%（回正落地），对应 idle→jump_forward→idle→jump_backward→idle 这 5 个姿态帧——
// 之前这里只有 4 个断点却要配 5 帧，帧号 3/4 永远播不到，是纯粹的帧表尺寸错配，现在补上。
const JUMP_SPRITE_BREAKPOINTS = [0, 8, 46, 54, 78] as const
// 近战冲刺：0~200ms 倾斜波形+位移，切 jump_forward；200ms 起收尾回 idle（B7.6 Ⅲ）。
// 200/600=33%。
const MELEE_SPRITE_BREAKPOINTS = [0, 33] as const
// 后坐幅度全程 <15° 阈值（squash-only 配方），射手自身不换帧，维持单帧 idle。
const RANGED_SPRITE_BREAKPOINTS = [0] as const

// 受击反馈（承受方/被命中目标）是独立于攻击者的一条时间轴：命中瞬间硬切 hit_recoil，
// 弹簧回位（elasticEase.out(0.2s)）完成后收尾回 idle。不看阈值角度，只看事件（Ⅳ）。
// melee：350ms 命中 = 350/600 ≈ 58%；ranged：100ms 命中 = 100/500 = 20%。
const MELEE_REACTOR_BREAKPOINTS = [0, 58, 95] as const
const RANGED_REACTOR_BREAKPOINTS = [0, 20, 92] as const

/** frames 数量与预设时间轴长度不一致时（reduced/low 收窄了帧表），退化为首尾两拍或单帧定格 */
function resolveSpriteBreakpoints(frameCount: number, full: readonly number[]): readonly number[] {
  if (frameCount === full.length) return full
  if (frameCount <= 1) return [0]
  return [0, 100]
}

/**
 * 按时间轴百分比把一段关键帧序列在真实播放时长内排开，随 event 重��而重置。
 * 无条件调用一次（���在 CatalogNodes 顶层，而不是各个 switch 分支里），避免不同动作之间
 * 因为分支不同而改变 Hook 调用次序/次数。
 */
function useSpriteTimeline(ids: readonly string[], breakpointsPct: readonly number[], durationMs: number, revisionKey: string) {
  const [frameIndex, setFrameIndex] = useState(0)
  const key = `${ids.join('|')}::${breakpointsPct.join('|')}::${durationMs}::${revisionKey}`
  useEffect(() => {
    setFrameIndex(0)
    const timers: number[] = []
    breakpointsPct.forEach((pct, i) => {
      if (i === 0) return
      const t = window.setTimeout(() => setFrameIndex(i), Math.round((pct / 100) * durationMs))
      timers.push(t)
    })
    return () => timers.forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return ids[frameIndex] ?? ids[0]
}

/** 动作目录的精灵本体：真实挂上 16 帧侦探角色表里截取的帧，chroma-key 抠图前用剪影占位 */
function CatalogSpriteActor({
  frameId,
  keyedFrames,
  framesReady,
  className = '',
  facing = 'left',
}: {
  frameId: string
  keyedFrames: Record<string, string>
  framesReady: boolean
  className?: string
  /** 精灵原画朝左；facing='right' 时整体水平镜像，让角色真正面向前进/攻击方向 */
  facing?: Facing
}) {
  const src = keyedFrames[catalogSpriteFrameSrc(frameId)]
  // 镜像只落在精灵像素本体这一层，与外层 motion 容器的位移/旋转/挤压互不干扰。
  const flipped = facingScaleX(facing) === -1
  return (
    <span
      className={`b7c-sprite ${className}`}
      aria-hidden="true"
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      {!framesReady && <span className="b7c-sprite-silhouette" />}
      {src && (
        // No `key={frameId}` here: keying by frame forces an unmount/remount
        // of the <img> on every step of the timeline (see useSpriteTimeline),
        // which is what caused the visible flicker across the catalog's
        // move/melee/ranged/dice sprites — swapping `src` in place is instant.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="b7c-sprite-frame" draggable={false} />
      )}
    </span>
  )
}

function CatalogNodes({
  action,
  profile,
  event,
  durationMs,
  keyedFrames,
  framesReady,
}: {
  action: B7CatalogAction
  profile: B7Profile
  event: B7CatalogEvent
  durationMs: number
  keyedFrames: Record<string, string>
  framesReady: boolean
}) {
  const decor = allowsDecorLayer(profile)
  const revisionKey = `${event.id}:${event.revision}`

  // 无条件在顶层为「位移类」三个动作解出各自的帧表/时间轴并调用一次 Hook —— 哪怕当前
  // action 是 dice-grow 也照常调用（用 jump 的帧表占位、时间轴给单帧 [0]，不产生任何定时
  // 器），这样切��动作标签时 Hook 的调用次序/次数永远一致，不触发 Rules of Hooks 问题。
  const directionalFrames = catalogSpriteFrames(action, profile)
  const directionalFull =
    action === 'jump-move' ? JUMP_SPRITE_BREAKPOINTS
      : action === 'melee-triple' ? MELEE_SPRITE_BREAKPOINTS
        : action === 'ranged-shot' ? RANGED_SPRITE_BREAKPOINTS
          : Array.from({ length: directionalFrames.length }, (_, index) => directionalFrames.length === 1 ? 0 : Math.round((index / (directionalFrames.length - 1)) * 100))
  const directionalBreakpoints = resolveSpriteBreakpoints(directionalFrames.length, directionalFull)
  const directionalFrameId = useSpriteTimeline(directionalFrames, directionalBreakpoints, durationMs, revisionKey)

  // 承受方/被命中目标是另一个演员，姿态意图和攻击者完全不同（攻击者切 jump_forward，
  // 承受方切 hit_recoil），不能共用 directionalFrameId。同样无条件在顶层调用一次：
  // 非 melee-triple/ranged-shot 时用单帧兜底时间轴占位，不产生定时器，保持 Hook 调用
  // 次序恒定。
  const reactorFrames = action === 'melee-triple' || action === 'ranged-shot' ? CATALOG_REACTOR_FRAMES : [CATALOG_REACTOR_FRAMES[0]]
  const reactorFull = action === 'melee-triple' ? MELEE_REACTOR_BREAKPOINTS : action === 'ranged-shot' ? RANGED_REACTOR_BREAKPOINTS : [0]
  const reactorBreakpoints = profile !== 'standard' ? [0] : resolveSpriteBreakpoints(reactorFrames.length, reactorFull)
  const reactorFrameId = useSpriteTimeline(reactorFrames, reactorBreakpoints, durationMs, revisionKey)

  // 三个位移类动作不再用 CSS keyframes 猜物理曲线，改成 framer-motion 显式驱动每个
  // 属性各自的关键帧+时间点+缓动，才谈得上"真实的抛物线/回弹"而不是拍脑袋的百分比。
  // reducedCurve 档去掉弧高/挤压/旋转，只保留直线位移与最终落点——语义不丢，幅度归零。
  const reducedCurve = profile !== 'standard'
  const seconds = durationMs / 1000

  switch (action) {
    case 'jump-move': {
      const dustCount = decor ? Math.min(6, Math.max(3, particleBudget(profile))) : 0
      // 弧高严格按 E 表：角色高度(108px 精灵盒) × arcHeightRatio(25%)。
      const { arcHeightRatio, tiltForwardDeg: fwd, tiltBackDeg: back, landingSquashRatio: sq, overshootRatio: os } = MOTION_RECIPE.move
      const arcHeight = Math.round(108 * arcHeightRatio)
      // 单一 times 时间轴对齐动作1（标准步行 600ms）的节拍：抬起→前倾峰值→腾空最高点
      // →后仰下坠→落地压缩→回弹过冲→收脚归位。x / y / rotate / scale 全部踩这一条轴。
      const times = [0, 0.08, 0.3, 0.42, 0.58, 0.72, 0.78, 0.86, 1]
      return (
        <div className="b7c-jump-rail" style={{ '--jm-dist': `${JUMP_DIST_PX}px` } as React.CSSProperties}>
          <span className="b7c-jump-pad b7c-jump-pad-a" />
          <span className="b7c-jump-pad b7c-jump-pad-b" />
          <motion.div
            key={revisionKey}
            className="b7c-jump-mover"
            initial={{ x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 }}
            animate={
              reducedCurve
                ? { x: JUMP_DIST_PX, y: 0, rotate: 0, scaleX: 1, scaleY: 1, transition: { duration: seconds, ease: 'linear' } }
                : {
                    // 水平位移基本匀速（90% 匀速的手感），落地前(0.78)到位后定住。
                    x: [0, JUMP_DIST_PX * 0.06, JUMP_DIST_PX * 0.32, JUMP_DIST_PX * 0.5, JUMP_DIST_PX * 0.72, JUMP_DIST_PX * 0.92, JUMP_DIST_PX, JUMP_DIST_PX, JUMP_DIST_PX],
                    // 抛物线：最高点在 t≈0.42（对应 250ms 腾空），落地(0.78)归零。
                    y: [0, -arcHeight * 0.12, -arcHeight * 0.8, -arcHeight, -arcHeight * 0.4, -arcHeight * 0.05, 0, 0, 0],
                    // 累积旋转：前段先到 +30°，后段再相对当前姿态旋转 -60°，所以后仰终点是 -30°，
                    // 不是从待机 0° 直接跳到 -60°。曲线随后回到 0° 完成落地复位。
                    rotate: [0, fwd * 0.5, fwd, fwd * 0.5, -back * 0.25, -back * 0.5, 0, 0, 0],
                    // 落地压缩 35%(scaleY 0.65) → 回弹过冲 15%(1.15) → 归一；scaleX 反向守恒体积。
                    scaleX: [1, 0.99, 1, 1, 1, 1, 1 + sq * 0.6, 1 - os * 0.6, 1],
                    scaleY: [1, 1.02, 1, 1, 1, 1, 1 - sq, 1 + os, 1],
                    transition: {
                      x: { duration: seconds, times, ease: 'linear' },
                      y: { duration: seconds, times, ease: ['easeOut', 'easeOut', 'easeIn', 'easeIn', 'easeIn', 'easeOut', 'easeOut', 'easeInOut'] },
                      rotate: { duration: seconds, times, ease: 'easeInOut' },
                      scaleX: { duration: seconds, times, ease: 'easeOut' },
                      scaleY: { duration: seconds, times, ease: 'easeOut' },
                    },
                  }
            }
          >
            <CatalogSpriteActor frameId={directionalFrameId} keyedFrames={keyedFrames} framesReady={framesReady} facing={CATALOG_FACING['jump-move'].primary} />
          </motion.div>
          {decor &&
            Array.from({ length: dustCount }).map((_, i) => (
              <i key={i} className="b7c-jump-dust" style={{ '--di': i, '--dn': dustCount } as React.CSSProperties} />
            ))}
        </div>
      )
    }
    case 'melee-triple': {
      // B7.6 Ⅲ 时间轴（总时长 600ms，全部换算成时间轴百分比）：
      //   0~200ms  倾斜波形+位移，arcHeightRatio 0.35→0.40，切 07-jump_forward（light-hop）
      //   200~350ms 空中姿态 idle，倾角缓冲回落
      //   350ms     受击前沿滑入目标身前
      //   350~400ms attack-triggered：攻击者倾角波形收尾+落地压缩；目标 hit_recoil+aftermath
      //   400ms+    收尾前倾 → idle
      // 承受方的位移/压缩（Ⅳ����不经过倾角波形，只有直给的匀速后仰位移 + 弹簧回位，
      // 姿态本身靠 hit_recoil 那张画去表达"后仰"，不用再叠一层 rotate。
      const t1 = 200 / 600
      const t2 = 350 / 600
      const t3 = 400 / 600
      const times = [0, t1, t2, t3, 1]
      const { arcHeightRatio, rotationAmplitudeDeg: amp } = MOTION_RECIPE.lightHop
      const { aftermathDistPx: aftermath, squashOnImpactRatio: reactorSquash } = MOTION_RECIPE.hitRecoil
      const { impactSquashRatio: attackerSquash } = MOTION_RECIPE.melee
      const arcHeightRush = Math.round(108 * arcHeightRatio) // 108px 精灵盒 × 0.35
      const arcHeightFloat = Math.round(108 * (arcHeightRatio + 0.05)) // 浮空阶段抬到 0.40
      return (
        <div className="b7c-melee-rail" style={{ '--me-approach': `${MELEE_APPROACH_PX}px` } as React.CSSProperties}>
          <motion.div
            key={revisionKey}
            className="b7c-melee-attacker"
            initial={{ x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 }}
            animate={
              reducedCurve
                ? { x: [0, MELEE_APPROACH_PX, 0], y: 0, rotate: 0, scaleX: 1, scaleY: 1, transition: { duration: seconds, times: [0, 0.5, 1], ease: 'easeInOut' } }
                : {
                    // 0-200ms 冲近覆盖大半距离，200-350ms 空中飘进最后一小段贴上目标，
                    // 350-400ms 命中瞬间再顶进一点（打击感），400ms 起撤回复位。
                    x: [0, MELEE_APPROACH_PX * 0.92, MELEE_APPROACH_PX, MELEE_APPROACH_PX + 4, 0],
                    y: [0, -arcHeightRush, -arcHeightFloat, 0, 0],
                    // 前倾波形在冲刺+浮空阶段建起并保持，命中窗口"倾角波形收尾"回落，
                    // 400ms 后彻底归零（收尾前倾+弹簧收回已由 easeInOut 落点体现）。
                    rotate: [0, amp * 0.85, amp, amp * 0.3, 0],
                    // 落地压缩发生在命中窗口(t2→t3)，随后按 Ⅵ 的压缩公式回弹到 1，无过冲。
                    scaleY: [1, 1, 1, 1 - attackerSquash, 1],
                    scaleX: [1, 1, 1, 1 + attackerSquash * 0.35, 1],
                    transition: {
                      x: { duration: seconds, times, ease: ['easeOut', 'easeIn', 'easeOut', 'easeInOut'] },
                      y: { duration: seconds, times, ease: ['easeOut', 'easeIn', 'easeOut', 'easeInOut'] },
                      rotate: { duration: seconds, times, ease: ['easeOut', 'easeInOut', 'easeIn', 'easeInOut'] },
                      scaleX: { duration: seconds, times, ease: ['linear', 'linear', 'easeOut', 'easeOut'] },
                      scaleY: { duration: seconds, times, ease: ['linear', 'linear', 'easeOut', 'easeOut'] },
                    },
                  }
            }
          >
            <CatalogSpriteActor frameId={directionalFrameId} keyedFrames={keyedFrames} framesReady={framesReady} facing={CATALOG_FACING['melee-triple'].primary} />
          </motion.div>
          <motion.div
            key={`${revisionKey}-defender`}
            className="b7c-melee-defender"
            initial={{ x: 0, scaleX: 1, scaleY: 1 }}
            animate={
              reducedCurve
                ? { x: 0, scaleX: 1, scaleY: 1 }
                : {
                    // 命中窗口(t2→t3)才开始匀速后仰位移，随后 t3→1(=400~600ms，恰好 0.2s)
                    // 走弹簧回位——不叠加任何 rotate，姿态的"后仰感"完全交给 hit_recoil 帧。
                    x: [0, 0, 0, aftermath, 0],
                    scaleY: [1, 1, 1, 1 - reactorSquash, 1],
                    scaleX: [1, 1, 1, 1 + reactorSquash * 0.3, 1],
                    transition: {
                      x: { duration: seconds, times, ease: ['linear', 'linear', 'linear', 'easeOut'] },
                      scaleX: { duration: seconds, times, ease: ['linear', 'linear', 'linear', 'easeOut'] },
                      scaleY: { duration: seconds, times, ease: ['linear', 'linear', 'linear', 'easeOut'] },
                    },
                  }
            }
          >
            <span className="b7c-melee-flash" />
            <CatalogSpriteActor frameId={reactorFrameId} keyedFrames={keyedFrames} framesReady={framesReady} facing={CATALOG_FACING['melee-triple'].secondary ?? 'left'} />
          </motion.div>
        </div>
      )
    }
    case 'ranged-shot': {
      // B7.6 时间轴（总时长 500ms）：0~100ms 弹体飞行 → 100ms 命中 → 100~500ms 目标走
      // motion.hit-recoil 全程 400ms；射手自身只走 motion.squash-only(150ms) 的自反馈
      // 弹跳，幅度全程 <15° 阈值所以不换帧，姿态维持 idle。射手朝右开火 → 镜像面向右，
      // 后坐把身体往「射击反方向」（朝左）推 recoilPx，同时身体后仰 leanBackDeg（朝右站
      // 姿下后仰=逆时针=负角），squash-only 的压缩→回弹叠在同一段时间窗口内。
      const { recoilPx: recoil, leanBackDeg: lean } = MOTION_RECIPE.ranged
      const { squashRatio, returnRatio } = MOTION_RECIPE.squashOnly
      const shooterTimes = [0, 0.1, 0.22, 0.3, 1]
      const tHit = 100 / 500 // 20%
      const targetTimes = [0, tHit, 0.5, 1]
      const { aftermathDistPx: aftermath, squashOnImpactRatio: reactorSquash } = MOTION_RECIPE.hitRecoil
      return (
        <div className="b7c-ranged-rail" style={{ '--rs-dist': `${RANGED_DIST_PX}px` } as React.CSSProperties}>
          <motion.div
            key={revisionKey}
            className="b7c-ranged-attacker"
            initial={{ x: 0, rotate: 0, scaleX: 1, scaleY: 1 }}
            animate={
              reducedCurve
                ? { x: 0, rotate: 0, scaleX: 1, scaleY: 1 }
                : {
                    x: [0, -recoil, -recoil * 0.3, 0, 0],
                    rotate: [0, -lean, -lean * 0.3, 0, 0],
                    // squash-only：压缩到 1-0.6=0.4，回弹过冲到 1+0.35=1.35，再落回 1——
                    // 一次机械感的自身反馈，150ms 内完成，不隶属于倾角波形。
                    scaleY: [1, 1 - squashRatio, 1 + returnRatio, 1, 1],
                    scaleX: [1, 1 + squashRatio * 0.3, 1 - returnRatio * 0.25, 1, 1],
                    transition: {
                      x: { duration: seconds, times: shooterTimes, ease: ['easeOut', 'easeOut', 'easeInOut', 'linear'] },
                      rotate: { duration: seconds, times: shooterTimes, ease: ['easeOut', 'easeOut', 'easeInOut', 'linear'] },
                      scaleX: { duration: seconds, times: shooterTimes, ease: ['easeOut', 'easeOut', 'easeInOut', 'linear'] },
                      scaleY: { duration: seconds, times: shooterTimes, ease: ['easeOut', 'easeOut', 'easeInOut', 'linear'] },
                    },
                  }
            }
          >
            <CatalogSpriteActor frameId={directionalFrameId} keyedFrames={keyedFrames} framesReady={framesReady} facing={CATALOG_FACING['ranged-shot'].primary} />
            {decor && <span className="b7c-ranged-muzzle" />}
          </motion.div>
          <span className="b7c-ranged-bullet" />
          <div className="b7c-ranged-target">
            <span className="b7c-ranged-hit" />
            <motion.div
              key={`${revisionKey}-target`}
              className="b7c-ranged-target-actor"
              initial={{ x: 0, scaleX: 1, scaleY: 1 }}
              animate={
                reducedCurve
                  ? { x: 0, scaleX: 1, scaleY: 1 }
                  : {
                      // 100ms 命中前保持不动，命中后匀速后仰位移到 350ms(0.5)，再走 200ms
                      // 弹簧回位（0.5→1，恰好 0.2s）——同样不叠加 rotate，交给 hit_recoil 帧。
                      x: [0, 0, aftermath, 0],
                      scaleY: [1, 1, 1 - reactorSquash, 1],
                      scaleX: [1, 1, 1 + reactorSquash * 0.3, 1],
                      transition: {
                        x: { duration: seconds, times: targetTimes, ease: ['linear', 'linear', 'easeOut'] },
                        scaleX: { duration: seconds, times: targetTimes, ease: ['linear', 'linear', 'easeOut'] },
                        scaleY: { duration: seconds, times: targetTimes, ease: ['linear', 'linear', 'easeOut'] },
                      },
                    }
              }
            >
              <CatalogSpriteActor frameId={reactorFrameId} keyedFrames={keyedFrames} framesReady={framesReady} facing={CATALOG_FACING['ranged-shot'].secondary ?? 'left'} />
            </motion.div>
          </div>
        </div>
      )
    }
    case 'dice-grow': {
      const tier = diceResultTier(event.diceValue)
      const pct = `${(event.diceValue / 6) * 100}%`
      const diceFrameId = DICE_SPRITE_BY_TIER[tier]
      return (
        <div
          className={`b7c-dice-rail tier-${tier}`}
          style={{ '--dg-final-pct': pct } as React.CSSProperties}
        >
          <div className="b7c-dice-track">
            <span className="b7c-dice-base" />
            <span className="b7c-dice-fill" />
          </div>
          {decor && (
            <span className="b7c-dice-icon">
              <CatalogSpriteActor frameId={diceFrameId} keyedFrames={keyedFrames} framesReady={framesReady} className="b7c-sprite-dice" />
              <Dices size={12} />
            </span>
          )}
          <b className="b7c-dice-value">{event.diceValue}</b>
        </div>
      )
    }
    default: {
      const actionMeta = CATALOG_META[action]
      const isPose = action.startsWith('pose-') || action === 'crouch-toggle'
      const isCombat = action.startsWith('melee-') || action.startsWith('ranged-') || action.startsWith('recoil-') || action === 'scattergun'
      return (
        <div className={`b7c-action-stage b7c-action-${action}`} data-action={action} data-path={actionMeta.path}>
          <motion.div
            key={revisionKey}
            className={`b7c-action-actor ${isPose ? 'is-pose' : ''}`}
            initial={{ x: 0, y: 0, rotate: 0, scale: 1 }}
            animate={reducedCurve ? { x: 0, y: 0, rotate: 0, scale: 1 } : {
              x: action === 'throw' || action === 'open-door' ? [0, 18, 0] : action === 'hit-recoil' || action === 'hit-stagger' ? [0, 12, 0] : [0, action === 'crawl' ? 28 : 8, 0],
              y: action === 'fall-down' ? [0, 28, 36] : action === 'light-hop' ? [0, -28, 0] : 0,
              rotate: isCombat ? [0, action.startsWith('ranged') ? -5 : 18, 0] : isPose ? 0 : [0, -8, 0],
              scale: action === 'squash-only' || action === 'hit-feedback' ? [1, .7, 1.12, 1] : [1, 1, 1],
              transition: { duration: seconds, times: [0, .45, 1], ease: 'easeInOut' },
            }}
          >
            <CatalogSpriteActor frameId={directionalFrameId} keyedFrames={keyedFrames} framesReady={framesReady} facing={CATALOG_FACING['jump-move'].primary} />
            {isCombat && decor && <span className="b7c-action-trail" />}
          </motion.div>
          {action === 'pickup' && <span className="b7c-action-object" aria-hidden="true" />}
          {action === 'lock-pick' && <span className="b7c-action-lock" aria-hidden="true" />}
          {action === 'open-door' && <span className="b7c-action-door" aria-hidden="true" />}
          {action === 'reload' && <span className="b7c-action-magazine" aria-hidden="true" />}
        </div>
      )
    }
  }
}

/** 近战/远程共用的一个极简护盾态图标，避免额外引入依赖 */
function Shield16() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 13.5 3.6V7.4C13.5 11 11.2 13.4 8 14.5 4.8 13.4 2.5 11 2.5 7.4V3.6L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function B7CatalogLayer({
  event,
  profile = 'standard',
  muted = false,
  onSettled,
  onPhase,
}: {
  event: B7CatalogEvent | null
  profile?: B7Profile
  muted?: boolean
  onSettled?: (phase: B7Phase) => void
  onPhase?: (phase: B7Phase) => void
}) {
  const systemReduced = useReducedMotion()
  const effective: B7Profile = systemReduced ? 'reduced' : profile
  const [phase, setPhaseState] = useState<B7Phase>('idle')
  const done = useRef(false)
  const timer = useRef<number | null>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  // 四个动作合计要用到的精灵帧只抠一次图，挂在这一层统一预热，往下透传给 CatalogNodes
  const { frames: keyedFrames, ready: framesReady } = useKeyedSpriteFrames(CATALOG_SPRITE_SRCS)

  const setPhase = useCallback(
    (next: B7Phase) => {
      setPhaseState(next)
      onPhase?.(next)
    },
    [onPhase],
  )

  useEffect(() => {
    if (!event) return
    done.current = false
    setPhase('triggered')
    const start = window.setTimeout(() => {
      setPhase('playing')
      if (!mutedRef.current) playSfx(CATALOG_SFX[event.action])
    }, 32)
    const duration = CATALOG_ACTION_DURATION_MS[event.action]
    timer.current = window.setTimeout(() => {
      if (done.current) return
      done.current = true
      setPhase('completed')
      if (!mutedRef.current) playSfx('b7-settle')
      window.setTimeout(() => {
        setPhase('settled')
        onSettled?.('completed')
      }, 140)
    }, duration)
    return () => {
      window.clearTimeout(start)
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, event?.revision, effective])

  if (!event || phase === 'settled' || phase === 'idle') return null

  const duration = CATALOG_ACTION_DURATION_MS[event.action]

  return (
    <div
      key={event.id}
      className={`b7-catalog-layer action-${event.action} phase-${phase} profile-${effective}`}
      style={{ '--b7c-dur': `${duration}ms` } as React.CSSProperties}
      aria-hidden="true"
    >
      <CatalogNodes
        action={event.action}
        profile={effective}
        event={event}
        durationMs={duration}
        keyedFrames={keyedFrames}
        framesReady={framesReady}
      />
    </div>
  )
}

export function B7MotionLayer({
  event,
  profile = 'standard',
  muted = false,
  onSettled,
  onPhase,
}: {
  event: B7MotionEvent | null
  profile?: B7Profile
  muted?: boolean
  onSettled?: (phase: B7Phase) => void
  onPhase?: (phase: B7Phase) => void
}) {
  const systemReduced = useReducedMotion()
  const effective: B7Profile = systemReduced ? 'reduced' : profile
  const [phase, setPhaseState] = useState<B7Phase>('idle')
  const done = useRef(false)
  const timer = useRef<number | null>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const setPhase = useCallback(
    (next: B7Phase) => {
      setPhaseState(next)
      onPhase?.(next)
    },
    [onPhase],
  )

  const settle = useCallback(
    (result: B7Phase) => {
      if (done.current) return
      done.current = true
      if (timer.current) clearTimeout(timer.current)
      if (!mutedRef.current) playSfx(result === 'failed' ? 'b7-fail' : result === 'skipped' ? 'b7-skip' : 'b7-settle')
      setPhase(result)
      window.setTimeout(() => {
        setPhase('settled')
        onSettled?.(result)
      }, 120)
    },
    [onSettled, setPhase],
  )

  useEffect(() => {
    if (!event) return
    done.current = false
    setPhase('triggered')
    const start = window.setTimeout(() => {
      setPhase('playing')
      if (!mutedRef.current) {
        const r = resolveFallback(event.recipe, event.fallbackLevel)
        playSfx(r.mode === 'recipe' ? recipeEnterSfx(r.recipe) : 'b7-channel-open')
      }
    }, 32)
    const duration = PROFILE_DURATION_MS[effective]
    timer.current = window.setTimeout(() => settle(event.failed ? 'failed' : 'completed'), duration)
    return () => {
      window.clearTimeout(start)
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, event?.revision, effective, settle])

  if (!event || phase === 'settled' || phase === 'idle') return null

  const resolved = resolveFallback(event.recipe, event.fallbackLevel)

  return (
    <div className={`b7-motion-layer phase-${phase} profile-${effective}`} aria-hidden="true">
      {resolved.mode === 'recipe' && (
        <div className={`b7m recipe-${resolved.recipe}`}>
          <MotifNodes recipe={resolved.recipe} profile={effective} />
        </div>
      )}
      {resolved.mode === 'procedural' && (
        <div className="b7m-procedural">
          <span className={`b7-proc-ring ${event.failed ? 'is-fail' : ''}`} />
        </div>
      )}
      {resolved.mode === 'icon-text' && (
        <div className="b7m-icontext">
          {event.failed ? <ShieldAlert size={22} /> : <CheckCircle2 size={22} />}
          <span>{event.failed ? '操作未通过' : '已确认'}</span>
        </div>
      )}
      {!muted && <span className="b7-channel-pulse" />}
      <button className="b7-skip" onClick={() => settle('skipped')} aria-label="跳过当前表现">
        <FastForward size={13} />
        SKIP
      </button>
    </div>
  )
}

type LogItem = { id: string; text: string }
const QUEUE_SEED = [
  { id: 'q-alpha', label: 'ALPHA' },
  { id: 'q-bravo', label: 'BRAVO' },
  { id: 'q-charlie', label: 'CHARLIE' },
  { id: 'q-delta', label: 'DELTA' },
]

const CATALOG_TAB_ICON: Record<B7CatalogAction, typeof Footprints> = {
  'jump-move': Footprints, 'heavy-hop': Activity, 'light-hop': Sparkles, 'stumble-hop': Activity,
  'crouch-toggle': ChevronRight, 'hit-recoil': ShieldAlert, 'squash-only': Activity, 'crawl': Footprints,
  'fall-down': ChevronRight, 'hit-feedback': ShieldAlert, 'hit-stagger': ShieldAlert, 'pose-crouch': Activity,
  'pose-get-up': ChevronRight, 'pose-sleep': Activity, 'melee-triple': Swords, 'melee-attack': Swords,
  'melee-puncture': Crosshair, 'melee-sweep': Swords, 'ranged-shot': Crosshair, 'recoil-handgun': Crosshair,
  'recoil-rifle': Crosshair, 'scattergun': Crosshair, 'ranged-burst': Crosshair, 'pickup': Sparkles,
  'throw': Activity, 'use-consumable': Sparkles, 'reload': Activity, 'lock-pick': Activity,
  'open-door': ChevronRight, 'dice-grow': Dices,
}

export function B7MotionWorkbench() {
  const [demoTab, setDemoTab] = useState<'motif' | 'catalog' | 'ceremony' | 'particle' | 'coherence'>('motif')
  const [profile, setProfile] = useState<B7Profile>('standard')
  const [recipe, setRecipe] = useState<B7Recipe>('slow-white-curtain')
  const [muted, setMuted] = useState(false)
  const [fallbackLevel, setFallbackLevel] = useState<B7FallbackLevel>(0)
  const [level, setLevel] = useState(1)
  const [event, setEvent] = useState<B7MotionEvent | null>(null)
  const [scenePhase, setScenePhase] = useState<B7Phase>('idle')
  const [stLog, setStLog] = useState<LogItem[]>([{ id: 'st-ready', text: '等待下一次已确认 revision' }])
  const [cpLog, setCpLog] = useState<LogItem[]>([{ id: 'cp-ready', text: '等待用户点击 / 键盘触发' }])
  const [queue, setQueue] = useState(QUEUE_SEED)
  const cpPending = useRef<number | null>(null)

  // A11y（阶段三）：两个通道各自的 aria-live 播报文案 + 焦点回归目标
  const [motifLive, setMotifLive] = useState('演示台待命')
  const [catLive, setCatLive] = useState('演示台待命')
  const motifReturnRef = useRef<HTMLElement | null>(null)
  const catReturnRef = useRef<HTMLElement | null>(null)
  const motifLabelRef = useRef('慢白帷幕')
  const catLabelRef = useRef('跳跃式移动')

  // 动作目录（阶段二）：独立于母题的一套状态与双通道
  const [catAction, setCatAction] = useState<B7CatalogAction>('jump-move')
  const [catEvent, setCatEvent] = useState<B7CatalogEvent | null>(null)
  const [catPhase, setCatPhase] = useState<B7Phase>('idle')
  const [catStLog, setCatStLog] = useState<LogItem[]>([{ id: 'cst-ready', text: '等待下一次已确认 revision' }])
  const [catCpLog, setCatCpLog] = useState<LogItem[]>([{ id: 'ccp-ready', text: '等待用户点击 / 键盘触发' }])
  const catCpPending = useRef<number | null>(null)
  // 待机预览用的精灵帧：与 B7CatalogLayer 内部各自调用一次，模块级 src 缓存会把两边的抠图
  // 工作去重，不会真的抠两遍图。
  const { frames: previewKeyedFrames, ready: previewFramesReady } = useKeyedSpriteFrames(CATALOG_SPRITE_SRCS)

  const catMeta = CATALOG_META[catAction]

  const playCatalogStateTransition = (origin?: HTMLElement | null) => {
    catReturnRef.current = origin ?? (document.activeElement as HTMLElement | null)
    catLabelRef.current = catMeta.label
    const id = `CST-${Date.now().toString(36).toUpperCase()}`
    const diceValue = 1 + Math.floor(Math.random() * 6)
    const next: B7CatalogEvent = { id, action: catAction, trigger: 'state-transition', revision: Date.now(), diceValue }
    setCatEvent(next)
    const suffix = catAction === 'dice-grow' ? ` → 骰值 ${diceValue}` : ''
    setCatLive(`${catMeta.label}：已确认 revision，即将播放${suffix}`)
    setCatStLog((items) => [{ id, text: `revision confirmed → ${catMeta.label}${suffix}` }, ...items].slice(0, 4))
  }

  const requestCatalogClickPlay = (origin?: HTMLElement | null) => {
    catReturnRef.current = origin ?? (document.activeElement as HTMLElement | null)
    catLabelRef.current = catMeta.label
    const introId = `CCP-${Date.now().toString(36).toUpperCase()}`
    setCatLive(`${catMeta.label}：已派发意图，等待宿主确认`)
    setCatCpLog((items) => [{ id: introId, text: 'intent dispatched · 等待宿主确认' }, ...items].slice(0, 4))
    if (catCpPending.current) window.clearTimeout(catCpPending.current)
    catCpPending.current = window.setTimeout(() => {
      const diceValue = 1 + Math.floor(Math.random() * 6)
      const next: B7CatalogEvent = {
        id: introId,
        action: catAction,
        trigger: 'click-play',
        revision: Date.now(),
        diceValue,
      }
      setCatEvent(next)
      const suffix = catAction === 'dice-grow' ? ` → 骰值 ${diceValue}` : ''
      setCatCpLog((items) => [{ id: `${introId}-c`, text: `host confirmed → ${catMeta.label}${suffix}` }, ...items].slice(0, 4))
    }, 260)
  }

  const handleCatSettled = useCallback(() => {
    setCatPhase('settled')
    setCatLive(`${catLabelRef.current}：已完成，回到落点`)
    const target = catReturnRef.current
    if (target && document.contains(target)) {
      window.setTimeout(() => target.focus(), 0)
    }
  }, [])

  const handleCatPhase = useCallback((p: B7Phase) => {
    setCatPhase(p)
    if (p === 'playing') setCatLive(`${catLabelRef.current}：播放中`)
  }, [])

  const resolved = resolveFallback(recipe, fallbackLevel)
  const effectiveRecipe = resolved.mode === 'recipe' ? resolved.recipe : null
  const avatarShaking = effectiveRecipe === 'shake-bounce' && (scenePhase === 'playing' || scenePhase === 'triggered')

  const handleSettled = useCallback((result: B7Phase) => {
    setScenePhase('settled')
    setMotifLive(`${motifLabelRef.current}：${PHASE_ANNOUNCE[result]}，已收束回落点`)
    // 焦点回归：动效层（含 SKIP）卸载后，把焦点交还给发起演示的按钮
    const target = motifReturnRef.current
    if (target && document.contains(target)) {
      window.setTimeout(() => target.focus(), 0)
    }
  }, [])

  const reflowQueue = useCallback(() => {
    setQueue((prev) => {
      const shuffled = [...prev]
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled
    })
  }, [])

  const handlePhase = useCallback(
    (phase: B7Phase) => {
      setScenePhase(phase)
      if (phase === 'playing') setMotifLive(`${motifLabelRef.current}：播放中`)
      if (phase === 'playing' && effectiveRecipe === 'list-reflow') reflowQueue()
    },
    [effectiveRecipe, reflowQueue],
  )

  // 通道一：state-transition —— 模拟"协调器已经拿到确认的 revision"，不经过用户点击
  const playStateTransition = (origin?: HTMLElement | null) => {
    motifReturnRef.current = origin ?? (document.activeElement as HTMLElement | null)
    motifLabelRef.current = MOTIF_META[recipe].label
    const id = `ST-${Date.now().toString(36).toUpperCase()}`
    const next: B7MotionEvent = {
      id,
      semanticId: 'route.confirmed',
      recipe,
      trigger: 'state-transition',
      revision: Date.now(),
      fallbackLevel,
    }
    setEvent(next)
    setMotifLive(`${MOTIF_META[recipe].label}：已确认 revision，即将播放`)
    setStLog((items) => [{ id, text: `revision confirmed → ${MOTIF_META[recipe].label}` }, ...items].slice(0, 4))
  }

  // 通道二：click-play —— 先派发 intent，等待"宿主确认"后才真正播放，不允许点击直接出结果
  const requestClickPlay = (failed = false, origin?: HTMLElement | null) => {
    motifReturnRef.current = origin ?? (document.activeElement as HTMLElement | null)
    motifLabelRef.current = failed ? '失败降级' : MOTIF_META[recipe].label
    const introId = `CP-${Date.now().toString(36).toUpperCase()}`
    setMotifLive(`${failed ? '失败降级' : MOTIF_META[recipe].label}：已派发意图，等待宿主确认`)
    setCpLog((items) => [{ id: introId, text: 'intent dispatched · 等待宿主确认' }, ...items].slice(0, 4))
    if (cpPending.current) window.clearTimeout(cpPending.current)
    cpPending.current = window.setTimeout(() => {
      const next: B7MotionEvent = {
        id: introId,
        semanticId: 'input.confirmed',
        recipe,
        trigger: 'click-play',
        revision: Date.now(),
        fallbackLevel,
        failed,
      }
      setEvent(next)
      setCpLog((items) =>
        [{ id: `${introId}-c`, text: `host confirmed → ${failed ? 'FAILED' : MOTIF_META[recipe].label}` }, ...items].slice(0, 4),
      )
    }, 260)
  }

  const meta = MOTIF_META[recipe]

  return (
    <div className="b7-shell">
      <div className="b7-tabs" role="tablist" aria-label="B7 演示区块">
        <button role="tab" aria-selected={demoTab === 'motif'} className={demoTab === 'motif' ? 'is-on' : ''} onClick={() => setDemoTab('motif')}>
          <GitCommitVertical size={13} /> 母题演示
        </button>
        <button role="tab" aria-selected={demoTab === 'catalog'} className={demoTab === 'catalog' ? 'is-on' : ''} onClick={() => setDemoTab('catalog')}>
          <Swords size={13} /> 动作目录
        </button>
        <button role="tab" aria-selected={demoTab === 'ceremony'} className={demoTab === 'ceremony' ? 'is-on' : ''} onClick={() => setDemoTab('ceremony')}>
          <Clapperboard size={13} /> 全屏仪式
        </button>
        <button role="tab" aria-selected={demoTab === 'particle'} className={demoTab === 'particle' ? 'is-on' : ''} onClick={() => setDemoTab('particle')}>
          <Sparkles size={13} /> 粒子令牌
        </button>
        <button role="tab" aria-selected={demoTab === 'coherence'} className={demoTab === 'coherence' ? 'is-on' : ''} onClick={() => setDemoTab('coherence')}>
          <Gauge size={13} /> 连贯与性能
        </button>
      </div>

      {demoTab === 'motif' ? (
        <div className="b7-workbench">
          <div className="b7-scene" data-profile={profile}>
            <div className="b7-horizon" />
            <div className="b7-bed">
              <i />
              <span>BED // A</span>
            </div>
            <div className={`b7-avatar ${avatarShaking ? 'is-shaking' : ''}`}>
              <i />
              <span>ANCHOR PILOT</span>
            </div>
            <div className="b7-queue" aria-label="演示队列，随 list-reflow 母题真实重排">
              <small>QUEUE</small>
              <LayoutGroup id="b7-queue">
                <div className="b7-queue-row">
                  {queue.map((q) => (
                    <motion.span key={q.id} layout transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
                      {q.label}
                    </motion.span>
                  ))}
                </div>
              </LayoutGroup>
            </div>
            <div className="b7-scene-copy">
              <small>B7 MOTION COORDINATOR</small>
              <h2>动作有来源，结果有落点。</h2>
              <p>表现层只读取已确认 revision；跳过、降级或资源失败都不会改写旅程事实。</p>
            </div>
            <div className="b7-scene-status">
              <span>
                <Activity size={13} /> {scenePhase.toUpperCase()}
              </span>
              <span>+{level} EFFECT SLOT</span>
            </div>
            <B7MotionLayer event={event} profile={profile} muted={muted} onSettled={handleSettled} onPhase={handlePhase} />
          </div>
          <aside className="b7-console">
            <header>
              <div>
                <small>DEV://PRESENTATION.PORT</small>
                <b>动效演���台</b>
              </div>
              <span className="b7-live">LIVE</span>
            </header>

            <label>
              RECIPE
              <select value={recipe} onChange={(e) => setRecipe(e.target.value as B7Recipe)}>
                {B7_RECIPES.map((v) => (
                  <option key={v} value={v}>
                    {MOTIF_META[v].label} · {v}
                  </option>
                ))}
              </select>
            </label>
            <p className="b7-motif-desc">
              object：{meta.object}｜source：{meta.source}
              <br />
              path：{meta.path}
              <br />
              landing：{meta.landing}
            </p>

            <div className="b7-segment">
              {(['standard', 'reduced', 'low'] as B7Profile[]).map((v) => (
                <button key={v} className={profile === v ? 'is-on' : ''} onClick={() => setProfile(v)}>
                  {v}
                </button>
              ))}
            </div>

            <label>
              FALLBACK LADDER · {resolved.levelLabel}
              <div className="b7-fallback-slider">
                {[0, 1, 2, 3].map((v) => (
                  <button
                    key={v}
                    className={fallbackLevel === v ? 'is-on' : ''}
                    onClick={() => setFallbackLevel(v as B7FallbackLevel)}
                  >
                    L{v}
                  </button>
                ))}
              </div>
            </label>

            <div className="b7-switches">
              <button aria-pressed={muted} onClick={() => setMuted((v) => !v)}>
                {muted ? <VolumeX /> : <Volume2 />} CHANNEL {muted ? 'MUTED' : 'ON'}
              </button>
            </div>

            <div className="b7-levels">
              {[0, 1, 2, 3].map((v) => (
                <button key={v} disabled={v === 3} className={level === v ? 'is-on' : ''} onClick={() => setLevel(v)}>
                  +{v}
                  <small>{v === 3 ? 'DEFERRED' : 'READY'}</small>
                </button>
              ))}
            </div>

            <div className="b7-channel-block">
              <div className="b7-channel-head">
                <GitCommitVertical size={12} />
                <span>State-Transition 通道</span>
              </div>
              <div className="b7-actions">
                <button onClick={(e) => playStateTransition(e.currentTarget)}>
                  <Sparkles />
                  模拟 revision 确认
                  <ChevronRight />
                </button>
              </div>
              <LayoutGroup id="st-log">
                <div className="b7-log">
                  {stLog.map((item) => (
                    <motion.div layout key={item.id} initial={{ x: 12, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                      <Radio />
                      <span>{item.text}</span>
                    </motion.div>
                  ))}
                </div>
              </LayoutGroup>
            </div>

            <div className="b7-channel-block">
              <div className="b7-channel-head">
                <Layers size={12} />
                <span>Click-Play 通道</span>
              </div>
              <div className="b7-actions">
                <button onClick={(e) => requestClickPlay(false, e.currentTarget)}>
                  <Sparkles />
                  点击触发
                  <ChevronRight />
                </button>
                <button onClick={(e) => requestClickPlay(true, e.currentTarget)}>
                  <ShieldAlert />
                  失败降级
                </button>
              </div>
              <LayoutGroup id="cp-log">
                <div className="b7-log">
                  {cpLog.map((item) => (
                    <motion.div layout key={item.id} initial={{ x: 12, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                      <Radio />
                      <span>{item.text}</span>
                    </motion.div>
                  ))}
                </div>
              </LayoutGroup>
            </div>

            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {motifLive}
            </div>
          </aside>
        </div>
      ) : demoTab === 'ceremony' ? (
        <B7CeremonyPanel profile={profile === 'standard' ? 'standard' : profile === 'reduced' ? 'reduced' : 'low'} />
      ) : demoTab === 'particle' ? (
        <B7ParticlePanel profile={profile === 'standard' ? 'standard' : profile === 'reduced' ? 'reduced' : 'low'} />
      ) : demoTab === 'coherence' ? (
        <B7CoherencePanel profile={profile === 'standard' ? 'standard' : profile === 'reduced' ? 'reduced' : 'low'} />
      ) : (
        <div className="b7-workbench">
          <div className="b7-scene b7-scene-catalog" data-profile={profile}>
            <div className="b7-horizon" />
            <div className="b7-catalog-stage-wrap">
              <div className="b7-catalog-stage-head">
                <small>ACTIVE ACTION</small>
                <b>{catMeta.label}</b>
              </div>
              <div className="b7-catalog-stage">
                {/* 静态待机预览只在 B7CatalogLayer 不会渲染任何内容时才出现（无事件 / 已归位 / 尚未触发），
                    避免和播放中的真实图层叠成两份重影。 */}
                {(!catEvent || catPhase === 'idle' || catPhase === 'settled') && (
                  <CatalogNodes
                    action={catAction}
                    profile={profile}
                    event={catEvent ?? { id: 'preview', action: catAction, trigger: 'state-transition', revision: 0, diceValue: 4 }}
                    durationMs={CATALOG_ACTION_DURATION_MS[catAction]}
                    keyedFrames={previewKeyedFrames}
                    framesReady={previewFramesReady}
                  />
                )}
                <B7CatalogLayer
                  event={catEvent}
                  profile={profile}
                  muted={muted}
                  onSettled={() => setCatPhase('settled')}
                  onPhase={(p) => setCatPhase(p)}
                />
              </div>
            </div>
            <div className="b7-scene-copy">
              <small>ENTITY ACTION CATALOG</small>
              <h2>移动、打击、射击、判定，各自有一条真实路径。</h2>
              <p>{catMeta.object} · {catMeta.path}</p>
            </div>
            <div className="b7-scene-status">
              <span>
                <Activity size={13} /> {catPhase.toUpperCase()}
              </span>
              <span>P0 × 4</span>
            </div>
          </div>
          <aside className="b7-console">
            <header>
              <div>
                <small>DEV://CATALOG.PORT</small>
                <b>动作目录演示台</b>
              </div>
              <span className="b7-live">LIVE</span>
            </header>

            <label>
              ACTION
              <select value={catAction} onChange={(e) => setCatAction(e.target.value as B7CatalogAction)}>
                {B7_CATALOG_ACTIONS.map((v) => (
                  <option key={v} value={v}>
                    {CATALOG_META[v].label} · {v}
                  </option>
                ))}
              </select>
            </label>
            <p className="b7-motif-desc">
              object：{catMeta.object}｜source：{catMeta.source}
              <br />
              path：{catMeta.path}
              <br />
              landing：{catMeta.landing}
            </p>

            <div className="b7-segment">
              {(['standard', 'reduced', 'low'] as B7Profile[]).map((v) => (
                <button key={v} className={profile === v ? 'is-on' : ''} onClick={() => setProfile(v)}>
                  {v}
                </button>
              ))}
            </div>

            <div className="b7-catalog-icons" aria-hidden="true">
              {B7_CATALOG_ACTIONS.map((v) => {
                const Icon = CATALOG_TAB_ICON[v]
                return (
                  <button key={v} className={catAction === v ? 'is-on' : ''} onClick={() => setCatAction(v)} title={CATALOG_META[v].label}>
                    <Icon size={15} />
                  </button>
                )
              })}
            </div>

            <div className="b7-channel-block">
              <div className="b7-channel-head">
                <GitCommitVertical size={12} />
                <span>State-Transition 通道</span>
              </div>
              <div className="b7-actions">
                <button onClick={(e) => playCatalogStateTransition(e.currentTarget)}>
                  <Sparkles />
                  模拟 revision 确认
                  <ChevronRight />
                </button>
              </div>
              <LayoutGroup id="cst-log">
                <div className="b7-log">
                  {catStLog.map((item) => (
                    <motion.div layout key={item.id} initial={{ x: 12, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                      <Radio />
                      <span>{item.text}</span>
                    </motion.div>
                  ))}
                </div>
              </LayoutGroup>
            </div>

            <div className="b7-channel-block">
              <div className="b7-channel-head">
                <Layers size={12} />
                <span>Click-Play 通道</span>
              </div>
              <div className="b7-actions">
                <button onClick={(e) => requestCatalogClickPlay(e.currentTarget)}>
                  <Sparkles />
                  点击触发
                  <ChevronRight />
                </button>
              </div>
              <LayoutGroup id="ccp-log">
                <div className="b7-log">
                  {catCpLog.map((item) => (
                    <motion.div layout key={item.id} initial={{ x: 12, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                      <Radio />
                      <span>{item.text}</span>
                    </motion.div>
                  ))}
                </div>
              </LayoutGroup>
            </div>

            <div className="sr-only" aria-live="polite">
              B7 动作目录状态：{catPhase}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
