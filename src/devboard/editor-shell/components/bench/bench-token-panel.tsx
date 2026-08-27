'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TOKEN_CATEGORIES,
  tokensOfCategory,
  collectProgress,
  TOKEN_PAGE_SIZE,
  QUALITY_COLOR,
  type BenchToken,
} from '@/lib/bench-data'
import {
  useBench,
  setCategory,
  selectToken,
  setHoveredToken,
  setTokenDrag,
  isTokenStarred,
} from '@/lib/bench-store'
import { TokenEmblem } from './token-emblem'
import { playSfx } from '@/lib/sound'
import { TiltCard } from '@/components/fx/tilt-card'
import { WeightedButton } from '@/components/fx/weighted-button'

/**
 * 左栏「词条库」：5 大类 tab + 「x / y 已收集」进度 + 词条卡网格（已收集可选中/
 * 可拖入锻造槽；未收集显示剪影 + 「？」）+ 分页。青色仍是唯一高饱和主操作色，
 * 品级用描边区分。
 */
export function BenchTokenPanel() {
  const category = useBench((s) => s.activeCategory)
  const selectedId = useBench((s) => s.selectedTokenId)
  const [page, setPage] = useState(0)

  const list = tokensOfCategory(category)
  const pageCount = Math.max(1, Math.ceil(list.length / TOKEN_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = list.slice(safePage * TOKEN_PAGE_SIZE, safePage * TOKEN_PAGE_SIZE + TOKEN_PAGE_SIZE)
  const prog = collectProgress(category)

  return (
    <aside className="chamfer-lg hud-b lib-glass lib-frame flex w-[276px] shrink-0 flex-col p-3">
      {/* 分类 tab：青色底块 layoutId 共享位移，随切换弹簧滑动到新位置 */}
      <div className="flex flex-wrap gap-1.5">
        {TOKEN_CATEGORIES.map((c) => {
          const on = c.key === category
          return (
            <WeightedButton
              key={c.key}
              onClick={() => {
                if (!on) {
                  playSfx('select')
                  setCategory(c.key)
                  setPage(0)
                }
              }}
              aria-pressed={on}
              className={`chamfer relative px-2.5 py-1 font-sans text-[13px] font-bold ${
                on ? 'text-[#04141a]' : 'lib-btn text-[color:var(--lib-dim)] hover:text-[color:var(--lib-text)]'
              }`}
            >
              {on && (
                <motion.span
                  layoutId="bench-token-category-pill"
                  className="chamfer absolute inset-0 -z-10"
                  style={{
                    background: 'linear-gradient(180deg, var(--cyan-bright), var(--cyan) 55%, var(--cyan-deep))',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -3px 8px rgba(0,40,50,0.5), 0 0 22px -6px var(--cyan)',
                  }}
                  transition={{ type: 'spring', stiffness: 480, damping: 32, mass: 0.8 }}
                />
              )}
              {c.label}
            </WeightedButton>
          )
        })}
      </div>

      {/* 收集进度 */}
      <div className="mt-3 flex items-center justify-between px-0.5">
        <span className="font-sans text-[12px] font-bold text-[color:var(--lib-dim)]">
          <span className="text-[color:var(--cyan)] tabular-nums">{prog.owned}</span>
          {' / '}
          <span className="tabular-nums">{prog.total}</span> 已收集
        </span>
      </div>

      {/* 词条网格 */}
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${category}-${safePage}`}
            initial={{ opacity: 0, y: 12, scale: 0.97, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, scale: 0.98, filter: 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.85 }}
            className="grid grid-cols-3 gap-2"
          >
            {pageItems.map((t) => (
              <TokenCard
                key={t.id}
                token={t}
                selected={t.id === selectedId}
              />
            ))}
            {/* 占位补齐到 9 格，保持网格稳定 */}
            {Array.from({ length: Math.max(0, TOKEN_PAGE_SIZE - pageItems.length) }).map((_, i) => (
              <span key={`pad-${i}`} className="lib-tile chamfer aspect-[3/4] opacity-30" />
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

function TokenCard({ token, selected }: { token: BenchToken; selected: boolean }) {
  const owned = token.owned
  const q = QUALITY_COLOR[token.quality]
  const starred = isTokenStarred(token.id)

  return (
    <TiltCard max={owned ? 14 : 0} lift={owned ? 6 : 0} disabled={!owned} className="aspect-[3/4]">
      <button
        draggable={owned}
        onDragStart={(e) => {
          if (!owned) return
          ;(e as unknown as React.DragEvent).dataTransfer?.setData('text/plain', token.id)
          setTokenDrag({ kind: 'token', id: token.id })
        }}
        onDragEnd={() => setTokenDrag(null)}
        onMouseEnter={() => owned && setHoveredToken(token.id)}
        onMouseLeave={() => setHoveredToken(null)}
        onClick={() => {
          if (!owned) return
          playSfx('select')
          selectToken(token.id)
        }}
        aria-pressed={selected}
        aria-disabled={!owned}
        className={`chamfer group relative flex h-full w-full flex-col items-center justify-center gap-1 p-1.5 text-left ${
          owned ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        } ${selected ? 'lib-selected' : ''}`}
      >
        {/* 品级描边（收集品才亮，剪影用暗线） */}
        <span
          className="pointer-events-none absolute inset-0 lib-quality-ring"
          style={{ ['--q' as string]: owned ? q : 'var(--lib-line)' }}
        />

        {owned ? (
          <>
            {/* 星标 */}
            {starred && (
              <span className="absolute left-1 top-1 text-[color:var(--star)]" style={{ filter: 'drop-shadow(0 0 4px var(--star))' }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 18.9 6.1 20.8l1.2-6.6L2.5 9.6l6.6-.9z" />
                </svg>
              </span>
            )}
            <TokenEmblem token={token} className="h-11 w-11" />
            <span className="w-full truncate text-center font-sans text-[11px] font-bold text-[color:var(--lib-text)]">
              {token.name}
            </span>
          </>
        ) : (
          <>
            <span className="token-silhouette grid h-11 w-11 place-items-center">
              <TokenEmblem token={token} className="h-11 w-11" />
            </span>
            <span className="absolute inset-0 grid place-items-center">
              <span className="font-mono text-[20px] font-black text-[color:var(--lib-dim)]">?</span>
            </span>
          </>
        )}
      </button>
    </TiltCard>
  )
}

function PagerBtn({ dir, disabled, onClick }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  return (
    <WeightedButton
      onClick={() => {
        if (disabled) return
        playSfx('click')
        onClick()
      }}
      disabled={disabled}
      className={`chamfer lib-btn hud-b grid h-7 w-7 place-items-center ${disabled ? '' : 'text-[color:var(--cyan)]'}`}
      aria-label={dir === 'prev' ? '上一页' : '下一页'}
      style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        {dir === 'prev' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </WeightedButton>
  )
}
