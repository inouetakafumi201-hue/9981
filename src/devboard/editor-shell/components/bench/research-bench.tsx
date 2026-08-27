'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { PortalTransition } from '@editor/components/fx/portal-transition'
import {
  useBench,
  useBenchNav,
  closeBench,
  setSection,
} from '@editor/lib/bench-store'
import { BenchTokenPanel } from './bench-token-panel'
import { BenchForge } from './bench-forge'
import { BenchTokenLibrary } from './bench-token-library'
import { BenchMoldingBar } from './bench-molding-bar'
import { BenchJobFocusOverlay } from './bench-pod'
import { BenchToastLayer } from './bench-toast'
import { playSfx } from '@editor/lib/sound'
import { WeightedButton } from '@editor/components/fx/weighted-button'

/**
 * 研究台整屏覆盖层（BenchApp）。与素材库同构：模块级 store 驱动的相位机
 * (closed/entering/open/leaving)，反复开合保留全部工作状态。根节点带
 * `lib-root bench-root` 以继承素材库令牌 + 叠加研究台暖调。
 *
 * 三界面切换链（§一）：
 * - 素材库「去研究台锻造」→ openBench(origin) → 青色传送门 → 研究台；
 * - 研究台「回素材库」→ closeBench() → 暖色传送门 → 素材库（与编辑器→素材库同款）。
 */
export function ResearchBench() {
  const phase = useBenchNav((s) => s.phase)
  const origin = useBenchNav((s) => s.origin)
  const section = useBench((s) => s.activeSection)

  if (phase === 'closed') return null

  const active = phase === 'open'

  return (
    <div className="fixed inset-0 z-[920] font-sans">
      {/* 进入=青色门（研究台主色）；离开=暖色门（回素材库，与编辑器→素材库一致） */}
      <AnimatePresence>
        {phase === 'entering' && (
          <PortalTransition key="enter" origin={origin} theme="cyan" label="接入梦境研究台" />
        )}
        {phase === 'leaving' && (
          <PortalTransition key="leave" origin={origin} theme="warm" label="返回梦境素材库" />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 1.04 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="lib-root bench-root bench-bg relative flex h-full w-full flex-col overflow-hidden"
      >
        {/* 扫描线单独一层压到 20% 透明度，避免糊住底下的锻造工坊实景底图 */}
        <div className="crt-scanlines pointer-events-none absolute inset-0 z-0 opacity-20" />

        {/* ---- 顶栏 ---- */}
        <header className="relative z-10 flex shrink-0 items-center justify-between px-8 py-5">
          <div className="flex items-center gap-3">
            <div
              className="chamfer relative grid h-11 w-11 place-items-center shadow-[0_0_22px_-4px_var(--cyan)]"
              style={{ background: 'linear-gradient(135deg, var(--cyan-bright), var(--cyan-deep))' }}
            >
              <span className="font-mono text-2xl font-black leading-none text-[#04141a]">W</span>
              <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/25" />
            </div>
            <div className="font-sans text-[20px] font-bold tracking-wide text-[color:var(--lib-text)]">
              WakeUp <span className="text-[color:var(--cyan)]">·</span> 研究台
            </div>
          </div>

          {/* 中央分区切换：词条库 / 锻造台。共享 layoutId 的青色底块随选中项弹簧滑动，
              而不是靠 className 瞬切来"变色"——这是切换手感是否厚重的关键差异。 */}
          <nav className="flex items-center gap-2">
            {(['tokens', 'forge'] as const).map((t) => {
              const on = section === t
              return (
                <WeightedButton
                  key={t}
                  onClick={() => {
                    if (!on) playSfx('select')
                    setSection(t)
                  }}
                  aria-pressed={on}
                  className={`chamfer hud-b relative px-6 py-2 font-sans text-[15px] font-bold ${
                    on ? 'text-[#04141a]' : 'lib-btn text-[color:var(--lib-dim)] hover:text-[color:var(--lib-text)]'
                  }`}
                  style={on ? undefined : { ['--hud-bc' as string]: 'var(--lib-line)' }}
                >
                  {on && (
                    <motion.span
                      layoutId="bench-section-pill"
                      className="chamfer absolute inset-0 -z-10"
                      style={{
                        background: 'linear-gradient(180deg, var(--cyan-bright), var(--cyan) 55%, var(--cyan-deep))',
                        boxShadow:
                          'inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -3px 8px rgba(0,40,50,0.5), 0 0 22px -6px var(--cyan)',
                      }}
                      transition={{ type: 'spring', stiffness: 480, damping: 32, mass: 0.8 }}
                    />
                  )}
                  {t === 'tokens' ? '词条库' : '锻造台'}
                </WeightedButton>
              )
            })}
          </nav>

          <WeightedButton
            onClick={() => {
              playSfx('toggle')
              window.location.assign(`/asset-library?${new URLSearchParams({ entryTool: 'map-editor', returnTo: window.location.pathname, ...(new URLSearchParams(window.location.search).get('entryId') ? { entryId: new URLSearchParams(window.location.search).get('entryId')! } : {}) }).toString()}`)
            }}
            className="chamfer lib-btn hud-b flex items-center gap-1.5 px-4 py-2 font-sans text-[13px] font-bold text-[color:var(--cyan)]"
            style={{ ['--hud-bc' as string]: 'var(--cyan)' }}
          >
            回素材库
          </WeightedButton>
        </header>

        {/* ---- 主体：左词条库 / 中锻造台(上)+塑形备选栏(下) / 右素材库 ----
            与素材库同样加大栏间与四周留白，让锻造工坊底图能从缝隙里透出来 */}
        <div className="relative z-10 flex min-h-0 flex-1 gap-6 px-8 pb-8">
          <BenchTokenPanel />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
            <BenchForge />
            <BenchMoldingBar />
          </div>

          <BenchTokenLibrary />
        </div>

        <BenchToastLayer />
        <BenchJobFocusOverlay />
      </motion.div>
    </div>
  )
}
