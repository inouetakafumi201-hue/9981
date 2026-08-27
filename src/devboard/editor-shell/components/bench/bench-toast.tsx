'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useBench } from '@editor/lib/bench-store'

/** 研究台底部居中的轻提示（限免拒绝/待接线动作反馈）。 */
export function BenchToastLayer() {
  const toast = useBench((s) => s.toast)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[70] flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="chamfer hud-b lib-glass px-4 py-2 font-sans text-[13px] font-bold"
            style={{
              ['--hud-bc' as string]: toast.tone === 'reject' ? 'var(--danger)' : 'var(--cyan)',
              color: toast.tone === 'reject' ? 'var(--danger)' : 'var(--lib-text)',
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
