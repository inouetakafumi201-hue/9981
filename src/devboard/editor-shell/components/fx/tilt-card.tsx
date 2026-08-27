'use client'

import { useRef, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

/**
 * 通用「重量感」容器：鼠标位置驱动 3D 透视倾斜 + 联动阴影偏移，弹簧回弹到位而不是
 * 线性/固定曲线复位——这是让卡片摸起来像「有质量的实体道具」而不是「一张网页贴图」
 * 的关键差异点。悬停时轻微抬升+放大，离开时弹簧回正，按下时轻微下压（模拟真实
 * 按压重物的反馈延迟感）。
 *
 * 用于素材/词条/产出等所有需要「拿在手上」质感的卡片外层；内部内容不受影响。
 */
export function TiltCard({
  children,
  className = '',
  max = 10,
  lift = 6,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  className?: string
  /** 最大倾斜角度（度） */
  max?: number
  /** 悬停抬升像素 */
  lift?: number
  disabled?: boolean
  onClick?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  // 弹簧参数偏「重」：较低 stiffness + 适度 damping，回弹带一点点过冲，像真的有惯性。
  const springCfg = { stiffness: 220, damping: 18, mass: 1.1 }
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), springCfg)
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), springCfg)
  const shadowX = useTransform(ry, (v) => -v * 1.4)
  const shadowY = useTransform(rx, (v) => v * 1.4)
  const filterShadow = useTransform(
    [shadowX, shadowY],
    (values: number[]) => {
      const [x = 0, y = 0] = values
      return `drop-shadow(${x}px ${y + 3}px 10px rgba(0,0,0,0.55))`
    },
  )

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width)
    py.set((e.clientY - r.top) / r.height)
  }
  function handleLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onClick={onClick}
      style={{ perspective: 800 }}
      className={className}
    >
      <motion.div
        style={{
          rotateX: disabled ? 0 : rx,
          rotateY: disabled ? 0 : ry,
          transformStyle: 'preserve-3d',
          filter: disabled ? undefined : filterShadow,
        }}
        whileHover={disabled ? undefined : { y: -lift, scale: 1.035 }}
        whileTap={disabled ? undefined : { y: -lift * 0.3, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, mass: 1 }}
        className="h-full w-full"
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
