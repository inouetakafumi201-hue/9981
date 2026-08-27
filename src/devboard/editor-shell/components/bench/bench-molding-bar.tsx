'use client'

import { materialMetaById, QUALITY_COLOR } from '@/lib/library-data'
import { useBench, moldingSet, setForgeBase } from '@/lib/bench-store'
import { LibTile } from '@/components/library/library-tile'
import { isTokenStarred } from '@/lib/bench-store'
import { TiltCard } from '@/components/fx/tilt-card'
import { DropSettle } from '@/components/fx/drop-settle'
import { BenchJobStrip } from './bench-pod'
import { playSfx } from '@/lib/sound'

/**
 * 底部「塑形备选栏」：5 格常用/解锁塑形（作为基体来源，点击=设为基础素材，拖入=替换）。
 * 右侧挂研究任务队列条（BenchJobStrip）——真实异步计时，不是行内假进度条。
 * 锁定格显示锁图标与解锁条件占位。
 */
export function BenchMoldingBar() {
  const molding = useBench((s) => s.molding)
  const rejectSlot = useBench((s) => s.moldingRejectSlot)
  const forgeBase = useBench((s) => s.forgeBase)

  return (
    <section className="chamfer-lg hud-b lib-glass lib-frame flex shrink-0 items-stretch gap-4 p-3">
      {/* 塑形备选栏 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 text-center font-sans text-[14px] font-bold tracking-wide text-[color:var(--gold)]">
          塑形备选栏
        </div>
        <div className="flex flex-1 items-stretch justify-center gap-3">
          {molding.slots.map((id, i) => (
            <MoldingSlot
              key={i}
              index={i}
              materialId={id}
              unlocked={molding.unlocked[i] ?? false}
              reject={rejectSlot === i}
              active={id != null && id === forgeBase}
            />
          ))}
        </div>
      </div>

      <BenchJobStrip />
    </section>
  )
}

function MoldingSlot({
  index,
  materialId,
  unlocked,
  reject,
  active,
}: {
  index: number
  materialId: string | null
  unlocked: boolean
  reject: boolean
  active: boolean
}) {
  const meta = materialId ? materialMetaById(materialId) : null
  const q = meta ? QUALITY_COLOR[meta.quality] : 'var(--lib-line)'
  // 复用词条星标集合中不存在的键 → 恒 false；此处仅示意角标位（塑形星标接线后再挂）
  void isTokenStarred

  if (!unlocked) {
    return (
      <div className="chamfer forge-slot-empty grid h-[92px] w-[110px] place-items-center gap-1 opacity-70">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--lib-dim)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="9" rx="1.5" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
        <span className="font-sans text-[10px] text-[color:var(--lib-dim)]">未解锁</span>
        <span className="font-sans text-[9px] text-[color:var(--lib-dim)]/70">达成条件后解锁</span>
      </div>
    )
  }

  return (
    <TiltCard max={11} lift={4} className="h-[92px] w-[110px]">
      <button
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData('text/plain')
          if (id) moldingSet(index, id)
        }}
        onClick={() => {
          if (!meta) return
          playSfx('select')
          setForgeBase(meta.id)
        }}
        aria-pressed={active}
        className={`chamfer relative grid h-full w-full place-items-center gap-1 p-1 ${reject ? 'lib-reject' : ''} ${
          active ? 'lib-selected' : ''
        }`}
      >
        <span className="pointer-events-none absolute inset-0 lib-quality-ring" style={{ ['--q' as string]: active ? 'var(--cyan)' : q }} />
        <DropSettle settleKey={meta?.id ?? null} glowColor="var(--gold)" className="grid h-full w-full place-items-center gap-1">
          {meta ? (
            <>
              <LibTile tile={meta.tile} glow={meta.glow} className="h-11 w-11" />
              <span className="max-w-full truncate font-sans text-[11px] font-bold text-[color:var(--lib-text)]">{meta.name}</span>
            </>
          ) : (
            <span className="font-mono text-2xl font-black text-[color:var(--lib-dim)]">+</span>
          )}
        </DropSettle>
      </button>
    </TiltCard>
  )
}
