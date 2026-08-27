'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TiltCard } from '@editor/components/fx/tilt-card'
import { WeightedButton } from '@editor/components/fx/weighted-button'
import { DropSettle } from '@editor/components/fx/drop-settle'
import {
  MATERIALS_META,
  materialMetaById,
  CATEGORY_ITEMS,
  badgeStateOf,
  type CategoryFilter,
  type MaterialMeta,
} from '@editor/lib/library-data'
import {
  useLibApp,
  setQuickExpanded,
  quickBarSet,
  quickBarClear,
  setDrag,
  openDetail,
  showToast,
} from '@editor/lib/library-store'
import { LibTile } from './library-tile'
import { Chip } from './library-badges'
import { IconChevronUp, IconFilter } from './library-icons'
import { ChevronDown, Search, X } from 'lucide-react'
import { playSfx } from '@editor/lib/sound'

/**
 * 底部快捷栏（§4.5）。
 * 收起：7 个固定快捷格（drop 目标）+「快捷栏 ^」开合。
 * 展开：完整素材矩阵（分类下拉 + 搜索 + 7×10 量级滚动网格），矩阵格可**拖拽**进
 *       上方 7 格。
 *
 * 拖拽保护（数据/store 层已拒绝，交互层配合视觉反馈）：
 * - 限免素材拖入 → 落点红闪 (lib-reject) + Toast；
 * - UGC 素材在矩阵里**灰显且不可拖拽**，拖入也被 store 拒绝并提示去研究台。
 *
 * 快捷格 / 矩阵格单击都打开该素材详情；空格单击提示拖拽引导。
 */
export function LibraryQuickbar() {
  const quickSlots = useLibApp((s) => s.quickSlots)
  const expanded = useLibApp((s) => s.quickExpanded)
  const rejectSlot = useLibApp((s) => s.rejectSlot)
  const dragId = useLibApp((s) => s.dragId)

  const [cat, setCat] = useState<CategoryFilter>('全部')
  const [query, setQuery] = useState('')
  const [catOpen, setCatOpen] = useState(false)

  const matrix = useMemo(() => {
    const byCat = cat === '全部' ? MATERIALS_META : MATERIALS_META.filter((m) => m.category === cat)
    const q = query.trim()
    return (q ? byCat.filter((m) => m.name.includes(q)) : byCat).slice(0, 70)
  }, [cat, query])

  function onDropToSlot(index: number) {
    if (!dragId) return
    const ok = quickBarSet(index, dragId)
    if (ok) playSfx('success')
    setDrag(null)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 快捷栏行 */}
      <div className="flex items-stretch gap-3">
        <WeightedButton
          onClick={() => {
            playSfx('click')
            setQuickExpanded(!expanded)
          }}
          className="chamfer hud-b lib-glass flex w-[92px] shrink-0 flex-col items-center justify-center gap-1 text-[color:var(--lib-text)]"
          style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
        >
          <span className="font-sans text-[13px] font-bold tracking-wide">快捷栏</span>
          <motion.span
            animate={{ rotate: expanded ? 0 : 180 }}
            transition={{ type: 'spring', stiffness: 340, damping: 22 }}
            className="text-[color:var(--cyan)]"
          >
            <IconChevronUp width={18} height={18} />
          </motion.span>
        </WeightedButton>

        <div className="flex flex-1 gap-2 overflow-x-auto">
          {quickSlots.map((id, i) => (
            <QuickSlot
              key={i}
              index={i}
              material={id ? materialMetaById(id) : null}
              reject={rejectSlot === i}
              dragActive={!!dragId}
              onDrop={() => onDropToSlot(i)}
            />
          ))}
        </div>
      </div>

      {/* 展开的完整素材矩阵 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, scale: 0.98, filter: 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }}
            className="chamfer-lg hud-b lib-glass flex gap-3 p-3"
            style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
          >
          {/* 左：分类下拉 + 搜索 */}
          <div className="flex w-[160px] shrink-0 flex-col gap-2">
            <div className="relative">
              <WeightedButton
                onClick={() => {
                  playSfx('click')
                  setCatOpen((v) => !v)
                }}
                className="chamfer hud-b lib-btn flex w-full items-center gap-2 px-3 py-2 font-sans text-[13px] text-[color:var(--lib-text)]"
                style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
              >
                <IconFilter width={15} height={15} className="text-[color:var(--cyan)]" />
                {cat}
                <ChevronDown size={14} className={`ml-auto text-[color:var(--lib-dim)] transition-transform ${catOpen ? 'rotate-180' : ''}`} />
              </WeightedButton>
              <AnimatePresence>
                {catOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="chamfer hud-b lib-glass absolute bottom-full z-30 mb-1 max-h-[40vh] w-full overflow-y-auto p-1"
                    style={{ ['--hud-bc' as string]: 'var(--cyan)' }}
                  >
                    {CATEGORY_ITEMS.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          playSfx('select')
                          setCat(c)
                          setCatOpen(false)
                        }}
                        className={`block w-full px-3 py-1.5 text-left font-sans text-[13px] transition-colors hover:bg-[color:var(--cyan)]/15 ${
                          c === cat ? 'text-[color:var(--cyan)]' : 'text-[color:var(--lib-text)]'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div
              className="chamfer hud-b flex items-center gap-2 px-3 py-2"
              style={{ ['--hud-bc' as string]: 'var(--lib-line)', background: 'var(--lib-inset)' }}
            >
              <Search size={14} className="text-[color:var(--lib-dim)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索快捷栏素材..."
                className="w-full bg-transparent font-sans text-[13px] text-[color:var(--lib-text)] placeholder:text-[color:var(--lib-dim)]/70 focus:outline-none"
              />
            </div>

            <p className="mt-auto font-sans text-[11px] leading-relaxed text-[color:var(--lib-dim)]">
              拖拽素材到上方格子加入快捷栏。限免与 UGC 素材不可加入。
            </p>
          </div>

          {/* 右：完整素材矩阵（拖拽源） */}
          <div className="grid max-h-[26vh] flex-1 grid-cols-[repeat(auto-fill,minmax(50px,1fr))] gap-2 overflow-y-auto pr-1">
            {matrix.map((m) => (
              <MatrixCell key={m.id} material={m} />
            ))}
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------------------------------------------------------- 快捷格 -- */

function QuickSlot({
  index,
  material,
  reject,
  dragActive,
  onDrop,
}: {
  index: number
  material: MaterialMeta | null
  reject: boolean
  dragActive: boolean
  onDrop: () => void
}) {
  const [over, setOver] = useState(false)
  const active = useLibApp((s) => s.detailOpenId) === material?.id
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onDrop()
      }}
      className={`chamfer hud-b lib-tile relative aspect-square w-[72px] shrink-0 ${reject ? 'lib-reject' : ''} ${
        active ? 'lib-selected' : ''
      }`}
      style={{
        ['--hud-bc' as string]: reject
          ? 'var(--danger)'
          : over && dragActive
            ? 'var(--cyan)'
            : active
              ? 'var(--cyan)'
              : 'var(--lib-line)',
        boxShadow: over && dragActive ? '0 0 18px -4px var(--cyan)' : undefined,
      }}
    >
      <TiltCard max={14} lift={3} disabled={!material} className="h-full w-full">
        <DropSettle settleKey={material?.id ?? null} glowColor="var(--cyan)" className="h-full w-full">
          {material ? (
            // 外层不能是 <button>：内部还需要一个独立可点击的移出按钮，
            // HTML 不允许 button 嵌套 button（会导致水合错误）。改用带
            // role="button" 的 div 承担"打开详情"的整体点击/键盘语义。
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                playSfx('select')
                openDetail(material.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  playSfx('select')
                  openDetail(material.id)
                }
              }}
              title={material.name}
              className="group h-full w-full cursor-pointer"
            >
              <LibTile tile={material.tile} glow={material.glow} className="h-full w-full" />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  playSfx('click')
                  quickBarClear(index)
                }}
                className="absolute right-0.5 top-0.5 hidden rounded bg-black/60 p-0.5 text-[color:var(--lib-dim)] hover:text-[color:var(--danger)] group-hover:block"
                title="移出快捷栏"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[20px] text-[color:var(--lib-line)]">+</span>
          )}
        </DropSettle>
      </TiltCard>
    </div>
  )
}

/* ---------------------------------------------------------------- 矩阵格 -- */

function MatrixCell({ material }: { material: MaterialMeta }) {
  const b = badgeStateOf(material)
  const draggable = !b.ugc // UGC 灰显且不可拖拽
  return (
    <TiltCard max={12} lift={3} className="aspect-square">
      <button
        draggable={draggable}
        onDragStart={(e) => {
          if (!draggable) {
            e.preventDefault()
            return
          }
          setDrag(material.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onDragEnd={() => setDrag(null)}
        onClick={() => {
          playSfx('select')
          if (b.ugc) showToast('UGC 素材请到研究台处理')
          openDetail(material.id)
        }}
        title={material.name}
        className={`lib-tile chamfer relative h-full w-full ${b.ugc ? 'lib-disabled' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
      >
        <LibTile tile={material.tile} glow={material.glow} className="h-full w-full" />
        {/* 关键角标：限免绿点 / UGC 青点 */}
        {b.free && <span className="absolute right-0.5 top-0.5"><Chip label="限免" tone="free" compact /></span>}
        {b.ugc && <span className="absolute right-0.5 top-0.5"><Chip label="UGC" tone="ugc" compact /></span>}
      </button>
    </TiltCard>
  )
}
