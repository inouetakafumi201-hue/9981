'use client'

import { AnimatePresence, motion, type Transition } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkipForward } from 'lucide-react'
import {
  ceremonyDurationFor,
  type CeremonyEnter,
  type CeremonyExit,
  type CeremonySpec,
  type KeyArtMotif,
} from '@/lib/b7-ceremony'
import { ParticleField } from '@/components/particle-field'
import { KeyedSpriteImage } from '@/components/keyed-sprite-image'

// B7-04 全屏仪式播放器 —— §10 的唯一播放实现。
//
// 为什么不是继续用 transition-battle-intro / transition-dream / transition-result：
// 那三个组件各自把「黑幕 + 淡入淡出」写死在自己的 JSX 里，进出场是匿名的 CSS 过渡，
// 换一个仪式就得复制一份组件。§10 有 14 个仪式、14 种进场动势、14 种出场动势，靠复制
// 会立刻退化成「都用 fade 代替」——也就是用户看到的「除了跳跃其他都不对」的同一类病根。
// 这里把动势做成**具名令牌 → 具名实现**的分发：enterMotion / exitMotion / Backdrop /
// KeyArt 四个纯函数各自 switch 全部令牌，任何一个令牌漏实现都会在类型层暴露。
//
// 纪律：
//   - 仪式不产生新事实：onDone 只回传「播完了」，胜负/落点/入账都由调用方在播放前定好。
//   - 必须可跳过（§11）：ESC / 点击 SKIP 立即结束并直接落到 resultInvariant 状态。
//   - reduced 档去掉位移与缩放，只保留不透明度收束；low 档进一步砍时长。
//   - 素材缺失走 fallbackContour（第三级程序化反馈），不借用语义错误的其他全屏。

type Phase = 'enter' | 'hold' | 'exit'

const SPRING: Transition = { type: 'spring', stiffness: 320, damping: 20 }

/** 进场动势 → 主画面的 initial/animate。reduced 档只留不透明度。 */
function enterMotion(enter: CeremonyEnter, flat: boolean) {
  if (flat) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.18 } }
  switch (enter.kind) {
    case 'flash-skew-slam':
      return {
        initial: { opacity: 0, x: '42%', skewX: enter.skewDeg, scale: 1.04 },
        animate: { opacity: 1, x: '0%', skewX: 0, scale: 1 },
        transition: SPRING,
      }
    case 'fall-scale':
      return {
        initial: { opacity: 0, scale: enter.from },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] as const },
      }
    case 'black-then-radial':
      return {
        initial: { opacity: 0, scale: 0.86 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.24, delay: enter.blackMs / 1000, ease: 'easeOut' as const },
      }
    case 'freeze-impact-flash':
      return {
        initial: { opacity: 1, scale: 1 },
        animate: { opacity: 1, scale: [1, 1, enter.peakScale, 1] },
        transition: {
          duration: (enter.freezeMs + enter.flashMs + 160) / 1000,
          times: [0, enter.freezeMs / (enter.freezeMs + enter.flashMs + 160), (enter.freezeMs + enter.flashMs) / (enter.freezeMs + enter.flashMs + 160), 1],
          ease: 'easeOut' as const,
        },
      }
    case 'slow-white-swallow':
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.5, ease: 'easeInOut' as const } }
    case 'directional-white-swallow':
      return {
        initial: { opacity: 0, x: '-10%' },
        animate: { opacity: 1, x: '0%' },
        transition: { duration: 0.44, ease: 'easeInOut' as const },
      }
    case 'white-converge':
      return { initial: { opacity: 0, scale: 1.12 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.4 } }
    case 'soft-white-veil':
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.6, ease: 'easeInOut' as const } }
    case 'standing-loop':
      return { initial: { opacity: 0.001 }, animate: { opacity: 1 }, transition: { duration: 0.3 } }
    case 'instant-white':
      return { initial: { opacity: 1 }, animate: { opacity: 1 }, transition: { duration: 0 } }
    case 'white-surge':
      return { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.3 } }
    case 'gold-board':
      return { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: SPRING }
    case 'black-close-in':
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.26 } }
    case 'view-push-out':
      return { initial: { opacity: 1, scale: 1 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.1 } }
  }
}

/** 出场动势 → 主画面的退场目标。 */
function exitMotion(exit: CeremonyExit, flat: boolean) {
  if (flat) return { animate: { opacity: 0 }, transition: { duration: 0.2 } }
  switch (exit.kind) {
    case 'sling-left-glass':
      return { animate: { opacity: 0, x: '-46%', skewX: 6 }, transition: { duration: 0.28, ease: 'easeIn' as const } }
    case 'land-flash-shake':
      return { animate: { opacity: 0, y: 22, scale: 0.96 }, transition: { duration: 0.22 } }
    case 'blue-collapse-green-fill':
      return { animate: { opacity: 0, scale: 0.2 }, transition: { duration: 0.26, ease: 'easeIn' as const } }
    case 'violet-constrict':
      return { animate: { opacity: 0, scale: 0.9 }, transition: { duration: 0.3 } }
    case 'color-roll-out':
      return { animate: { opacity: 0, y: 14 }, transition: { duration: 0.34 } }
    case 'contour-reveal-out':
      return { animate: { opacity: 0, scale: 1.08 }, transition: { duration: 0.3 } }
    case 'afterglow-handoff':
      return { animate: { opacity: 0 }, transition: { duration: 0.34, ease: 'easeOut' as const } }
    case 'merge-sleep':
      return { animate: { opacity: 0 }, transition: { duration: 0.4, ease: 'easeInOut' as const } }
    case 'loop-until-match':
      return { animate: { opacity: 0 }, transition: { duration: 0.3 } }
    case 'afterglow-sway':
      return { animate: { opacity: 0, rotate: [0, -1.6, 1.2, 0] }, transition: { duration: exit.ms / 1000 } }
    case 'board-skew-in':
      return {
        animate: { opacity: 0, skewX: -6, x: '8%' },
        transition: { type: 'spring' as const, stiffness: exit.stiffness, damping: exit.damping },
      }
    case 'gold-sweep':
      return { animate: { opacity: 0, y: -14 }, transition: { duration: 0.32 } }
    case 'reason-fade-in':
      return { animate: { opacity: 0 }, transition: { duration: 0.26 } }
    case 'cut-to-spectate':
      return { animate: { opacity: 0, scale: 1.14 }, transition: { duration: 0.24, ease: 'easeIn' as const } }
  }
}

/**
 * 幕布层：进/出场令牌里「白闪 / 纯黑 / 径向炸开 / 压黑收束」这些**画面之外**的分量。
 * 与主画面分开渲染，因为它们的时序独立于主画面（白闪 80ms 只覆盖开头，不跟随主画面淡入）。
 */
function Backdrop({ spec, phase, flat }: { spec: CeremonySpec; phase: Phase; flat: boolean }) {
  const { enter, exit } = spec
  const layers: React.ReactNode[] = []

  if (phase === 'enter') {
    if (enter.kind === 'flash-skew-slam' || enter.kind === 'instant-white') {
      const ms = enter.kind === 'flash-skew-slam' ? enter.flashMs : 300
      layers.push(
        <motion.div
          key="flash" className="b7cer-veil" style={{ background: '#FFFFFF' }}
          initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: ms / 1000, ease: 'easeOut' }}
        />,
      )
    }
    if (enter.kind === 'black-then-radial') {
      layers.push(
        <motion.div
          key="black" className="b7cer-veil" style={{ background: '#000000' }}
          initial={{ opacity: 1 }} animate={{ opacity: 0 }}
          transition={{ duration: 0.18, delay: enter.blackMs / 1000 }}
        />,
        <motion.div
          key="radial" className="b7cer-veil"
          style={{ background: `radial-gradient(circle at 50% 52%, ${spec.colors[0]}cc 0%, ${spec.colors[0]}22 45%, transparent 72%)` }}
          initial={{ opacity: 0, scale: 0.1 }}
          animate={flat ? { opacity: [0, 0.9, 0.3] } : { opacity: [0, 1, 0.35], scale: [0.1, 1, 1] }}
          transition={{ duration: 0.42, delay: enter.blackMs / 1000 }}
        />,
      )
    }
    if (enter.kind === 'freeze-impact-flash') {
      layers.push(
        <motion.div
          key="impact" className="b7cer-veil" style={{ background: spec.colors[0] }}
          initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 0.7, 0] }}
          transition={{ duration: (enter.freezeMs + enter.flashMs + 120) / 1000 }}
        />,
      )
    }
    if (enter.kind === 'slow-white-swallow' || enter.kind === 'white-converge' || enter.kind === 'white-surge') {
      layers.push(
        <motion.div
          key="white" className="b7cer-veil" style={{ background: spec.colors[0] ?? '#FFF8F0' }}
          initial={{ opacity: 1 }} animate={{ opacity: 0.88 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />,
      )
    }
    if (enter.kind === 'directional-white-swallow') {
      layers.push(
        <motion.div
          key="dir" className="b7cer-veil"
          style={{ background: `linear-gradient(100deg, ${spec.colors[0]} 0%, ${spec.colors[0]}ee 58%, ${spec.colors[0]}55 100%)` }}
          initial={{ opacity: 0, x: flat ? 0 : '-40%' }} animate={{ opacity: 0.92, x: '0%' }}
          transition={{ duration: 0.46, ease: 'easeInOut' }}
        />,
      )
    }
    if (enter.kind === 'soft-white-veil') {
      layers.push(
        <motion.div
          key="soft" className="b7cer-veil" style={{ background: spec.colors[0] }}
          initial={{ opacity: 0 }} animate={{ opacity: 0.34 }} transition={{ duration: 0.6 }}
        />,
      )
    }
    if (enter.kind === 'black-close-in') {
      layers.push(
        <motion.div
          key="close" className="b7cer-veil b7cer-veil-inset"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
        />,
      )
    }
    if (enter.kind === 'gold-board') {
      layers.push(
        <motion.div
          key="gold" className="b7cer-veil"
          style={{ background: `radial-gradient(ellipse at 50% 40%, ${spec.colors[0]}44 0%, transparent 68%)` }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.34 }}
        />,
      )
    }
  }

  if (phase === 'exit') {
    if (exit.kind === 'land-flash-shake') {
      layers.push(
        <motion.div
          key="land" className="b7cer-veil" style={{ background: '#FFFFFF' }}
          initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} transition={{ duration: exit.flashMs / 1000 }}
        />,
      )
    }
    if (exit.kind === 'blue-collapse-green-fill') {
      layers.push(
        <div key="green" className="b7cer-cure-bar" aria-hidden="true">
          <motion.i
            style={{ background: spec.colors[1] }}
            initial={{ width: '18%' }} animate={{ width: '76%' }} transition={{ duration: 0.34, ease: 'easeOut' }}
          />
        </div>,
      )
    }
    if (exit.kind === 'violet-constrict') {
      layers.push(
        <motion.div
          key="violet" className="b7cer-constrict" style={{ borderColor: spec.colors[1] }}
          initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 0.9 }} transition={{ duration: 0.3 }}
        />,
      )
    }
    if (exit.kind === 'color-roll-out') {
      layers.push(
        <motion.div
          key="roll" className="b7cer-veil" style={{ background: spec.colors[0] }}
          initial={{ clipPath: 'circle(120% at 50% 62%)' }} animate={{ clipPath: 'circle(0% at 50% 62%)' }}
          transition={{ duration: 0.42, ease: 'easeInOut' }}
        />,
      )
    }
    if (exit.kind === 'gold-sweep') {
      layers.push(
        <motion.div
          key="sweep" className="b7cer-veil"
          style={{ background: `linear-gradient(72deg, transparent 30%, ${spec.colors[0]}66 50%, transparent 70%)` }}
          initial={{ opacity: 0, x: '-60%' }} animate={{ opacity: 1, x: '60%' }} transition={{ duration: 0.42 }}
        />,
      )
    }
    if (exit.kind === 'reason-fade-in') {
      layers.push(
        <motion.div key="reason" className="b7cer-veil b7cer-veil-black" initial={{ opacity: 0.4 }} animate={{ opacity: 0.94 }} transition={{ duration: 0.26 }} />,
      )
    }
  }

  return <>{layers}</>
}

/**
 * 主画面母题：全部用真实精灵帧 + 程序化漫画构件合成。
 * 外部插画资源在本项目里不可用（图像生成只回占位图），所以窗框、速度线、力线、床、
 * 结果板都由几何构件画出——这也正是 §13 第三级 fallback 要求的形态，两者共用同一套实现，
 * 素材缺失时只是把精灵帧换成轮廓。
 */
function KeyArt({ spec, missing, flat }: { spec: CeremonySpec; missing: boolean; flat: boolean }) {
  const { motif, frame, facing, backdrop } = spec.keyArt
  // frame 是 B7_POSE 姿态字典里的帧 id（如 'f07'），不是可直接加载的 URL。
  // 全项目里侦探精灵表都落在 /games/menu/detective/<id>.png，KeyedSpriteImage 只吃真实
  // URL（它把 src 直接交给 chroma-key 的 new Image().src）。这里补上帧 id → 图源路径的
  // 解析——之前直接把 'f07' 塞进 src，导致每个仪式的漫画特写都是一张 naturalWidth=0 的
  // 破图，主画面里只剩程序化窗框/床/力线，人物本体整个丢失。
  const sprite =
    frame && !missing ? (
      <KeyedSpriteImage src={`/games/menu/detective/${frame}.png`} className={`b7cer-sprite ${facing === 'right' ? 'is-flip' : ''}`} />
    ) : frame ? (
      <span className="b7cer-sprite b7cer-sprite-contour" aria-hidden="true" />
    ) : null

  const furniture = (m: KeyArtMotif) => {
    switch (m) {
      case 'window-sill':
        return (
          <div className="b7cer-window" aria-hidden="true">
            <i /><i /><span className="b7cer-sill" />
            {!flat && <em className="b7cer-speed b7cer-speed-coral" />}
          </div>
        )
      case 'top-down-fall':
        return (
          <div className="b7cer-fall" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <em key={i} style={{ left: `${8 + i * 10.5}%`, animationDelay: `${i * 26}ms` }} />
            ))}
            <span className="b7cer-landing-ring" style={{ borderColor: spec.colors[1] }} />
          </div>
        )
      case 'conduit-palm':
        return (
          <div className="b7cer-conduit" aria-hidden="true">
            <span className="b7cer-conduit-line" style={{ background: spec.colors[0] }} />
            <span className="b7cer-conduit-palm" style={{ borderColor: spec.colors[0] }} />
          </div>
        )
      case 'grapple-lock':
        return (
          <div className="b7cer-grapple" aria-hidden="true">
            <span className="b7cer-force b7cer-force-l" style={{ background: spec.colors[0] }} />
            <span className="b7cer-force b7cer-force-r" style={{ background: spec.colors[0] }} />
            <span className="b7cer-lock-node" style={{ borderColor: spec.colors[1] }} />
          </div>
        )
      case 'bed-highkey':
      case 'bed-anchor':
      case 'bedside':
        return (
          <div className={`b7cer-bed ${m === 'bed-highkey' ? 'is-highkey' : ''}`} aria-hidden="true">
            <span className="b7cer-bed-frame" />
            <span className="b7cer-bed-pillow" />
            {m === 'bed-anchor' && <span className="b7cer-anchor-cross" />}
          </div>
        )
      case 'dream-converge':
        return (
          <div className="b7cer-converge" aria-hidden="true">
            <span className="b7cer-anchor-cross" />
          </div>
        )
      case 'shadow-hall':
        return (
          <div className="b7cer-hall" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={`b7cer-shadow-figure ${i === 2 ? 'is-ready' : ''}`} style={{ animationDelay: `${i * 320}ms` }} />
            ))}
          </div>
        )
      case 'white-blast':
        return <div className="b7cer-blast" aria-hidden="true" />
      case 'result-board':
        return null
    }
  }

  if (motif === 'result-board') {
    // 结果板是纯板式：胜负平大字 + 排名 + 摘要。数据由调用方给定，这里只做板面。
    return (
      <div className="b7cer-board" style={{ borderColor: spec.colors[0] }}>
        <small>{spec.id}</small>
        <strong style={{ color: spec.colors[0] === '#0A0A0A' ? 'var(--foreground)' : spec.colors[0] }}>{spec.label}</strong>
        <p>{missing ? spec.fallbackContour : spec.keyArtDesc}</p>
        <div className="b7cer-board-rows">
          <span>RANK<b>—</b></span>
          <span>SUMMARY<b>已确认结算</b></span>
        </div>
      </div>
    )
  }

  return (
    <div className="b7cer-art" style={backdrop && !missing ? { backdropFilter: backdrop } : undefined}>
      {furniture(motif)}
      {sprite}
    </div>
  )
}

export type CeremonyOverlayProps = {
  spec: CeremonySpec
  profile: 'standard' | 'reduced' | 'low'
  /** 主画面素材缺失 → 走 fallbackContour 的程序化反馈 */
  missing?: boolean
  onDone: (outcome: 'played' | 'skipped') => void
}

export function CeremonyOverlay({ spec, profile, missing = false, onDone }: CeremonyOverlayProps) {
  const [phase, setPhase] = useState<Phase>('enter')
  const timers = useRef<number[]>([])
  const settled = useRef(false)
  const flat = profile !== 'standard'
  const total = ceremonyDurationFor(spec, profile)

  const finish = useCallback(
    (outcome: 'played' | 'skipped') => {
      if (settled.current) return
      settled.current = true
      for (const t of timers.current) window.clearTimeout(t)
      timers.current = []
      onDone(outcome)
    },
    [onDone],
  )

  // 时间轴：进场 40% → 停留 25% → 出场 35%。出场结束即 finish('played')。
  useEffect(() => {
    settled.current = false
    setPhase('enter')
    const enterMs = Math.round(total * 0.4)
    const holdMs = Math.round(total * 0.25)
    timers.current = [
      window.setTimeout(() => setPhase('hold'), enterMs),
      window.setTimeout(() => setPhase('exit'), enterMs + holdMs),
      window.setTimeout(() => finish('played'), total),
    ]
    return () => {
      for (const t of timers.current) window.clearTimeout(t)
      timers.current = []
    }
  }, [spec.id, total, finish])

  // §11：全屏仪式必须可跳过。ESC 立即结束，直接落到 resultInvariant 状态。
  useEffect(() => {
    if (!spec.skippable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        finish('skipped')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [spec.skippable, finish])

  const enterAnim = useMemo(() => enterMotion(spec.enter, flat), [spec.enter, flat])
  const exitAnim = useMemo(() => exitMotion(spec.exit, flat), [spec.exit, flat])
  const shaking = !flat && phase === 'exit' && spec.exit.kind === 'land-flash-shake'

  return (
    <div className={`b7cer-root ${shaking ? 'is-shaking' : ''}`} role="dialog" aria-modal="true" aria-label={`${spec.id} ${spec.label}`}>
      <AnimatePresence>
        <Backdrop key={phase} spec={spec} phase={phase} flat={flat} />
      </AnimatePresence>

      <motion.div
        className="b7cer-stage"
        initial={enterAnim.initial}
        animate={phase === 'exit' ? exitAnim.animate : enterAnim.animate}
        transition={phase === 'exit' ? exitAnim.transition : enterAnim.transition}
      >
        <KeyArt spec={spec} missing={missing} flat={flat} />
      </motion.div>

      {/* 粒子层：reduced / low 档 ParticleField 内部会直接返回 0 粒子，结果由下方文字承担 */}
      {spec.particles.length > 0 && (
        <ParticleField
          specIds={spec.particles}
          playToken={`${spec.id}-${phase}`}
          profile={profile}
          loop={spec.durationMs === 'loop'}
          origin={spec.keyArt.motif === 'top-down-fall' ? { xPct: 50, yPct: 78 } : { xPct: 50, yPct: 54 }}
          className="b7cer-particles"
        />
      )}

      <div className="b7cer-caption">
        <div className="b7cer-caption-main">
          <b>{spec.label}</b>
          <span>{spec.id}</span>
          <em>{spec.durationMs === 'loop' ? '循环至匹配' : `${total}ms`}</em>
        </div>
        {/* 结果等价物：粒子/动效被关闭时由这行文字承担同一个结果（§3） */}
        <p>{missing ? spec.fallbackReason : spec.resultInvariant}</p>
      </div>

      {spec.skippable && (
        <button type="button" className="b7cer-skip" onClick={() => finish('skipped')}>
          <SkipForward size={12} /> SKIP · ESC
        </button>
      )}
    </div>
  )
}
