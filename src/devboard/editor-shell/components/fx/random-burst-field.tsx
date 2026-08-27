'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * 随机特效爆发场：在「大量等待时间」里，用**不定期、随机挑选类型**的一次性特效
 * 取代「循环播放同一段动画」——这正是安全箱/研究舱类等待反馈的核心手感：你不知道
 * 下一次爆发什么时候来、会是哪种效果，所以不会有「这是在放 loop」的网页感。
 *
 * 每次爆发都是独立挂载/卸载的一次性 Framer 动画（AnimatePresence 管理），绝不
 * 使用 `repeat: Infinity` 的固定循环。
 */
type BurstKind = 'spark-ring' | 'particle-swarm' | 'scan-sweep' | 'surge'
const KINDS: BurstKind[] = ['spark-ring', 'particle-swarm', 'scan-sweep', 'surge']
const DURATION: Record<BurstKind, number> = {
  'spark-ring': 1.1,
  'particle-swarm': 1.5,
  'scan-sweep': 1.3,
  surge: 0.9,
}

interface BurstInstance {
  id: number
  kind: BurstKind
  color: string
}

export function RandomBurstField({
  active,
  colors,
  size = 260,
  minDelay = 2600,
  maxDelay = 6800,
}: {
  active: boolean
  colors: string[]
  size?: number
  minDelay?: number
  maxDelay?: number
}) {
  const [bursts, setBursts] = useState<BurstInstance[]>([])
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) return
    const schedule = () => {
      const delay = minDelay + Math.random() * (maxDelay - minDelay)
      timer.current = setTimeout(() => {
        const kind = KINDS[Math.floor(Math.random() * KINDS.length)] ?? 'spark-ring'
        const color = colors[Math.floor(Math.random() * colors.length)] ?? 'var(--cyan)'
        setBursts((b) => [...b, { id: ++seq.current, kind, color }])
        schedule()
      }, delay)
    }
    // 首次爆发也随机延后（避免每次打开研究舱都立刻炸一次，显得又是个固定脚本）
    schedule()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 壳层按 V0 原样；根配置未装 react-hooks 插件（规则已置 off 占位，此注释仅为 V0 原文保留）
  }, [active])

  function remove(id: number) {
    setBursts((b) => b.filter((x) => x.id !== id))
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden">
      <AnimatePresence>
        {bursts.map((b) => (
          <BurstEffect key={b.id} kind={b.kind} color={b.color} size={size} onDone={() => remove(b.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

/**
 * 单发特效：给星标点亮、词条解锁等「一次性反馈」复用同一套爆发视觉词汇，
 * 而不是另起一套 CSS transition。挂载即播放，播放完调用 onDone 让调用方卸载它。
 */
export function SingleBurst({
  kind,
  color = 'var(--gold)',
  size = 90,
  onDone,
}: {
  kind?: BurstKind
  color?: string
  size?: number
  onDone: () => void
}) {
  const resolved = kind ?? KINDS[Math.floor(Math.random() * KINDS.length)] ?? 'spark-ring'
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden">
      <BurstEffect kind={resolved} color={color} size={size} onDone={onDone} />
    </div>
  )
}

function BurstEffect({
  kind,
  color,
  size,
  onDone,
}: {
  kind: BurstKind
  color: string
  size: number
  onDone: () => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    timerRef.current = setTimeout(onDone, DURATION[kind] * 1000 + 60)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 壳层按 V0 原样；根配置未装 react-hooks 插件（规则已置 off 占位，此注释仅为 V0 原文保留）
  }, [])

  if (kind === 'spark-ring') {
    return (
      <motion.span
        className="absolute rounded-full"
        style={{ border: `2px solid ${color}`, boxShadow: `0 0 26px ${color}` }}
        initial={{ width: size * 0.28, height: size * 0.28, opacity: 0.95 }}
        animate={{ width: size * 1.2, height: size * 1.2, opacity: 0 }}
        transition={{ duration: DURATION[kind], ease: 'easeOut' }}
      />
    )
  }
  if (kind === 'particle-swarm') {
    const n = 12 + Math.floor(Math.random() * 8)
    return (
      <>
        {Array.from({ length: n }).map((_, i) => {
          const angle = (i / n) * Math.PI * 2 + Math.random() * 0.6
          const dist = size * (0.32 + Math.random() * 0.38)
          return (
            <motion.span
              key={i}
              className="absolute h-1.5 w-1.5 rounded-sm"
              style={{ background: color, boxShadow: `0 0 8px ${color}` }}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
              animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: [0, 1, 0], scale: [0.6, 1, 0.4] }}
              transition={{ duration: DURATION[kind] * (0.7 + Math.random() * 0.3), ease: 'easeOut' }}
            />
          )
        })}
      </>
    )
  }
  if (kind === 'scan-sweep') {
    return (
      <motion.span
        className="absolute left-0 right-0 h-12"
        style={{
          background: `linear-gradient(180deg, transparent, ${color}66, transparent)`,
          filter: 'blur(3px)',
        }}
        initial={{ top: '-14%' }}
        animate={{ top: '112%' }}
        transition={{ duration: DURATION[kind], ease: 'easeInOut' }}
      />
    )
  }
  // surge：整体能量陡增又回落，模拟「研究出现波动」
  return (
    <motion.span
      className="absolute rounded-full"
      style={{
        width: size * 1.35,
        height: size * 1.35,
        background: `radial-gradient(circle, ${color}44, transparent 68%)`,
      }}
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: [0, 0.9, 0], scale: [0.86, 1.05, 1.12] }}
      transition={{ duration: DURATION[kind], ease: 'easeOut' }}
    />
  )
}
