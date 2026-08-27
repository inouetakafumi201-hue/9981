'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MATERIALS_META,
  CATEGORY_ITEMS,
  QUALITY_COLOR,
  badgeStateOf,
  type MaterialMeta,
  type CategoryFilter,
} from '@/lib/library-data'
import { useBench, setForgeBase } from '@/lib/bench-store'
import { LibTile } from '@/components/library/library-tile'
import { playSfx } from '@/lib/sound'

const PAGE = 20 // 5 列 × 4 行，对齐参考图右栏

/**
 * 右栏「素材库」：与素材库共享同一份 MaterialMeta（§4.6 三界面共享）。此处作为
 * 锻造的「基体来源」——点击=设为基础素材；也可拖入基体槽/塑形栏。类别筛选 + 分页。
 */
export function BenchTokenLibrary() {
  const forgeBase = useBench((s) => s.forgeBase)
  const [cat, setCat] = useState<CategoryFilter>('全部')
  const [page, setPage] = useState(0)

  const list = useMemo(
    () => (cat === '全部' ? MATERIALS_META : MATERIALS_META.filter((m) => m.category === cat)),
    [cat],
  )
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const items = list.slice(safePage * PAGE, safePage * PAGE + PAGE)

  return (
    <aside className="chamfer-lg hud-b lib-glass lib-frame flex w-[288px] shrink-0 flex-col p-3">
      <div className="text-center font-sans text-[16px] font-bold tracking-wide text-[color:var(--lib-text)]">素材库</div>

      {/* 类别筛选 */}
      <div className="mt-2 flex flex-wrap gap-1">
        {CATEGORY_ITEMS.map((c) => {
          const on = c === cat
          return (
            <button
              key={c}
              onClick={() => {
                if (!on) {
                  playSfx('click')
                  setCat(c)
                  setPage(0)
                }
              }}
              aria-pressed={on}
              className={`chamfer px-2 py-0.5 font-sans text-[11px] font-bold transition-colors ${
                on ? 'lib-btn-cyan' : 'lib-btn text-[color:var(--lib-dim)] hover:text-[color:var(--lib-text)]'
              }`}
              style={on ? undefined : { ['--hud-bc' as string]: 'var(--lib-line)' }}
            >
              {c}
            </button>
          )
        })}
      </div>

      {/* 图标网格 */}
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${cat}-${safePage}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-5 gap-1.5"
          >
            {items.map((m) => (
              <MatCell key={m.id} m={m} active={m.id === forgeBase} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 分页 */}
      <div className="mt-2 flex items-center justify-center gap-4">
        <PagerBtn dir="prev" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} />
        <span className="font-sans text-[12px] font-bold tabular-nums text-[color:var(--lib-dim)]">
          {safePage + 1} / {pageCount}
        </span>
        <PagerBtn dir="next" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} />
      </div>
    </aside>
  )
}

function MatCell({ m, active }: { m: MaterialMeta; active: boolean }) {
  const q = QUALITY_COLOR[m.quality]
  const badges = badgeStateOf(m)
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.95 }}
      draggable
      onDragStart={(e) => (e as unknown as React.DragEvent).dataTransfer?.setData('text/plain', m.id)}
      onClick={() => {
        playSfx('select')
        setForgeBase(m.id)
      }}
      aria-pressed={active}
      title={m.name}
      className={`chamfer relative grid aspect-square place-items-center p-1 ${active ? 'lib-selected' : ''}`}
    >
      <span
        className="pointer-events-none absolute inset-0 lib-quality-ring"
        style={{ ['--q' as string]: active ? 'var(--cyan)' : q }}
      />
      <LibTile tile={m.tile} glow={m.glow} className="h-9 w-9" />
      {badges.free && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full" style={{ background: 'var(--free)', boxShadow: '0 0 6px var(--free)' }} />}
      {badges.ugc && <span className="absolute left-0.5 top-0.5 h-2 w-2 rounded-full" style={{ background: 'var(--cyan)', boxShadow: '0 0 6px var(--cyan)' }} />}
    </motion.button>
  )
}

function PagerBtn({ dir, disabled, onClick }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        if (disabled) return
        playSfx('click')
        onClick()
      }}
      disabled={disabled}
      className={`chamfer lib-btn hud-b grid h-7 w-7 place-items-center ${disabled ? 'opacity-30' : 'text-[color:var(--cyan)]'}`}
      aria-label={dir === 'prev' ? '上一页' : '下一页'}
      style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        {dir === 'prev' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  )
}
