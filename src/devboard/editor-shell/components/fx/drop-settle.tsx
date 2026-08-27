'use client'

import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * 「东西被放下」的落地反馈：内容随 `settleKey` 变化时，从上方带一点缩放的
 * 弹簧下落 + 短促径向光闪，模拟往槎位/格子里塞入实体物件时的重量冲击，
 * 而不是网页常见的淡入淡出。settleKey 通常传入素材/词条的 id，为 null/undefined
 * 时代表格子为空，此时不播放落地特效（避免清空动作也触发「落下」的语义矛盾）。
 */
export function DropSettle({
  settleKey,
  children,
  glowColor = 'var(--gold)',
  className = '',
}: {
  settleKey: string | number | null | undefined
  children: ReactNode
  glowColor?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={settleKey ?? '__empty__'}
          initial={settleKey != null ? { y: -14, scale: 1.08, opacity: 0 } : false}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', stiffness: 480, damping: 20, mass: 0.9 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
      {settleKey != null && (
        <motion.span
          key={`glow_${settleKey}`}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          initial={{ opacity: 0.9, scale: 0.6 }}
          animate={{ opacity: 0, scale: 1.5 }}
          transition={{ duration: 0.42, ease: 'easeOut' }}
          style={{ boxShadow: `0 0 26px 6px ${glowColor}`, borderRadius: 'inherit' }}
        />
      )}
    </div>
  )
}
