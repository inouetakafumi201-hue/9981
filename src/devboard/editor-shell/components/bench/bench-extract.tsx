'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useBench, finishExtract } from '@/lib/bench-store'
import { materialMetaById } from '@/lib/library-data'
import { LibTile } from '@/components/library/library-tile'

/**
 * 提取演出（§一「素材溶解 → 词条浮现」）：素材像素化溶解成青色粒子，一枚词条印章
 * 从粒子中浮现。全 Framer Motion。点击任意处收下。
 */
export function BenchExtract() {
  const stage = useBench((s) => s.extractStage)
  const matId = useBench((s) => s.extractMaterialId)
  const meta = matId ? materialMetaById(matId) : null

  return (
    <AnimatePresence>
      {stage !== 'idle' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => stage === 'emerge' && finishExtract()}
          className="absolute inset-0 z-30 grid place-items-center"
          style={{ background: 'radial-gradient(circle at 50% 45%, rgba(6,20,26,0.86), rgba(6,10,14,0.95))' }}
        >
          {/* 溶解阶段：素材抖动 + 粒子上浮 */}
          {stage === 'dissolve' && meta && (
            <motion.div
              initial={{ scale: 1, opacity: 1 }}
              animate={{ scale: [1, 1.04, 0.9], opacity: [1, 1, 0], filter: ['blur(0px)', 'blur(0px)', 'blur(6px)'] }}
              transition={{ duration: 1.05, ease: 'easeIn' }}
              className="relative"
            >
              <LibTile tile={meta.tile} glow={meta.glow} className="h-[128px] w-[128px]" />
              {/* 上浮粒子 */}
              {Array.from({ length: 14 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-sm"
                  style={{ background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }}
                  initial={{ x: 0, y: 0, opacity: 0 }}
                  animate={{
                    x: (Math.random() - 0.5) * 140,
                    y: -60 - Math.random() * 90,
                    opacity: [0, 1, 0],
                  }}
                  transition={{ duration: 1, delay: 0.1 + Math.random() * 0.3, ease: 'easeOut' }}
                />
              ))}
            </motion.div>
          )}

          {/* 浮现阶段：青色词条印章从光核升起 */}
          {stage === 'emerge' && (
            <motion.div
              initial={{ scale: 0.3, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              className="flex flex-col items-center gap-3"
            >
              <div
                className="chamfer lib-tile grid h-[120px] w-[120px] place-items-center"
                style={{ boxShadow: '0 0 40px -6px var(--cyan), inset 0 0 0 2px var(--cyan)' }}
              >
                <span className="font-mono text-5xl font-black text-[color:var(--cyan)]" style={{ textShadow: '0 0 16px var(--cyan)' }}>
                  ✦
                </span>
              </div>
              <div className="font-sans text-[15px] font-bold text-[color:var(--lib-text)]">已萃取新词条</div>
              <div className="font-sans text-[12px] text-[color:var(--lib-dim)]">点击任意处收下</div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
