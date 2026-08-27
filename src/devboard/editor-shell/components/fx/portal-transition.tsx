'use client'

import { motion } from 'framer-motion'

/* =========================================================================
   统一「传送门」过场 —— 全 Framer Motion 实现（取代旧的 CSS 关键帧 lib-portal）。

   三处复用、两种主题：
   - 编辑器 → 素材库：warm（暖金）
   - 素材详情「去研究台锻造」→ 研究台：cyan（青）
   - 研究台「回素材库」→ 素材库：warm（与编辑器→素材库一致，需求明确要求同款特效）

   光晕从 origin（视口归一化 0–1，触发按钮中心）绽开：中心强光球放大淡出 + 两道
   扩张能量环 + 一层全屏白闪扫描 + 一行接入提示。时长 ~0.76s，与 store 的 ENTER_MS
   对齐（store 计时卸载本层）。纯装饰、pointer-events-none、不承载任何结算。
   ========================================================================= */

export type PortalTheme = 'warm' | 'cyan'

const THEME: Record<
  PortalTheme,
  { veil: string; bloom: string; ring: string; flash: string; label: string; labelColor: string; labelShadow: string }
> = {
  warm: {
    veil: 'rgba(11,9,6,0.55)',
    bloom:
      'radial-gradient(circle, rgba(255,232,180,0.98) 0%, rgba(245,182,66,0.72) 32%, rgba(214,120,40,0.28) 55%, transparent 70%)',
    ring: 'rgba(255,214,130,0.95)',
    flash: 'rgba(255,240,205,0.9)',
    label: '接入梦境素材库',
    labelColor: '#3a2606',
    labelShadow: '0 0 14px rgba(255,224,150,0.95)',
  },
  cyan: {
    veil: 'rgba(6,18,26,0.6)',
    bloom:
      'radial-gradient(circle, rgba(206,248,255,0.98) 0%, rgba(56,220,240,0.72) 32%, rgba(6,182,212,0.3) 55%, transparent 70%)',
    ring: 'rgba(140,236,250,0.95)',
    flash: 'rgba(214,250,255,0.9)',
    label: '接入研究台 · 材料工作台',
    labelColor: '#04222a',
    labelShadow: '0 0 14px rgba(140,236,250,0.95)',
  },
}

const DURATION = 0.76

export function PortalTransition({
  theme,
  origin,
  label,
}: {
  theme: PortalTheme
  origin: { x: number; y: number }
  /** 覆盖默认接入提示文案 */
  label?: string
}) {
  const t = THEME[theme]
  const pos = { left: `${origin.x * 100}%`, top: `${origin.y * 100}%` }
  const labelText = label ?? t.label

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-[900] overflow-hidden"
      style={{ background: t.veil }}
      initial={{ opacity: 1 }}
      animate={{ opacity: [1, 1, 0] }}
      transition={{ duration: DURATION, times: [0, 0.7, 1] }}
      aria-hidden
    >
      {/* 中心强光球：从触发点放大铺满再淡出 */}
      <motion.span
        className="absolute h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ ...pos, background: t.bloom }}
        initial={{ scale: 0, opacity: 0.95 }}
        animate={{ scale: [0, 44, 120], opacity: [0.95, 0.95, 0] }}
        transition={{ duration: DURATION, times: [0, 0.55, 1], ease: [0.5, 0, 0.3, 1] }}
      />

      {/* 两道扩张能量环 */}
      {[0, 0.09].map((delay, i) => (
        <motion.span
          key={i}
          className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ ...pos, border: `2px solid ${t.ring}`, boxShadow: `0 0 24px ${t.ring}` }}
          initial={{ scale: 0, opacity: 0.9 }}
          animate={{ scale: [0, 30], opacity: [0.9, 0] }}
          transition={{ duration: DURATION - delay, delay, ease: [0.4, 0, 0.2, 1] }}
        />
      ))}

      {/* 全屏白闪扫描 */}
      <motion.span
        className="absolute inset-0"
        style={{ background: t.flash, mixBlendMode: 'screen' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 0.55, 0] }}
        transition={{ duration: DURATION, times: [0, 0.42, 0.52, 0.72] }}
      />

      {/* 接入提示 */}
      <motion.div
        className="absolute left-1/2 top-[58%] -translate-x-1/2 whitespace-nowrap text-center font-sans text-[13px] font-bold tracking-[0.32em]"
        style={{ color: t.labelColor, textShadow: t.labelShadow }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, -4] }}
        transition={{ duration: DURATION, times: [0, 0.4, 0.72, 1] }}
      >
        {labelText}
      </motion.div>
    </motion.div>
  )
}
