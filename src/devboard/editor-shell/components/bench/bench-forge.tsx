'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  TOKEN_CATEGORIES,
  tokenById,
  forgeIsModified,
  ACCENT_COLOR,
  QUALITY_COLOR,
  EXTRACT_WHITELIST,
  type ForgeSlotState,
} from '@editor/lib/bench-data'
import { materialMetaById } from '@editor/lib/library-data'
import {
  useBench,
  forgeSetToken,
  startExtract,
  forgeSave,
  forgeDerive,
  startSynthesis,
} from '@editor/lib/bench-store'
import { LibTile } from '@editor/components/library/library-tile'
import { TokenEmblem } from './token-emblem'
import { BenchExtract } from './bench-extract'
import { TiltCard } from '@editor/components/fx/tilt-card'
import { WeightedButton } from '@editor/components/fx/weighted-button'
import { DropSettle } from '@editor/components/fx/drop-settle'
import { playSfx } from '@editor/lib/sound'

/**
 * 中央「锻造台」：暖光全息舞台。上=基础素材(基体) + 组合预览；中=五槽塑形（底图感，
 * 只替换不删除，拖回恢复默认）；下=提取 / 储存·派生 / 合成 三动作。合成/提取演出
 * 作为覆盖层叠在舞台上（全 Framer Motion）。
 */
export function BenchForge() {
  const base = useBench((s) => s.forgeBase)
  const slots = useBench((s) => s.forgeSlots)
  const rejectSlot = useBench((s) => s.forgeRejectSlot)
  const extract = useBench((s) => s.extractStage)

  const baseMeta = materialMetaById(base)
  const mounted = slots
    .map((s) => tokenById(s.currentTokenId))
    .filter((token): token is NonNullable<typeof token> => token !== null)
  const modified = forgeIsModified(slots)
  const extractDisabled = EXTRACT_WHITELIST.length === 0
  // 合成不再阻塞锻造台——提交后是后台任务，玩家可以立刻继续摆放/提取下一件。
  const busy = extract !== 'idle'

  return (
    <section className="forge-stage chamfer-lg hud-b relative flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      {/* 舞台氛围光层 */}
      <div className="forge-stage-grain pointer-events-none absolute inset-0" />
      <div className="lib-glow-warm pointer-events-none absolute inset-x-0 top-0 h-1/2" />

      {/* 上区：基体 + 组合预览 */}
      <div className="relative z-10 flex min-h-0 gap-4">
        {/* 基础素材 */}
        <div className="flex flex-1 flex-col items-center">
          <span className="font-sans text-[13px] font-bold tracking-wide text-[color:var(--gold)]">基础素材</span>
          <TiltCard max={9} lift={3} className="mt-2 h-[150px] w-[150px]">
            <div
              className="chamfer relative flex h-full w-full items-center justify-center"
              style={{ ['--hud-bc' as string]: 'var(--gold)' }}
            >
              <span className="lib-pedestal absolute bottom-3 h-3 w-24 rounded-[50%] bg-[color:var(--gold)]/40 blur-md" />
              {baseMeta && <LibTile tile={baseMeta.tile} glow={baseMeta.glow} className="lib-hero-float h-[112px] w-[112px]" />}
            </div>
          </TiltCard>
          <div className="mt-1 text-center">
            <div className="font-sans text-[15px] font-bold text-[color:var(--lib-text)]">{baseMeta?.name ?? '—'}</div>
            <div className="font-sans text-[11px] text-[color:var(--lib-dim)]">
              {baseMeta ? `${baseMeta.category} · 普通品质` : ''}
            </div>
          </div>
        </div>

        {/* 组合预览 */}
        <div className="chamfer hud-b lib-glass w-[196px] shrink-0 self-start p-3" style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}>
          <div className="font-sans text-[13px] font-bold text-[color:var(--gold)]">组合预览</div>
          <ul className="mt-2 flex flex-col gap-2">
            {mounted.length === 0 && (
              <li className="font-sans text-[12px] text-[color:var(--lib-dim)]">尚未装配词条</li>
            )}
            {mounted.map((t) => {
              const c = ACCENT_COLOR[t.accent]
              return (
                <li key={t.id} className="flex items-start gap-2">
                  <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                  <span className="min-w-0">
                    <span className="block font-sans text-[13px] font-bold leading-tight" style={{ color: c }}>{t.name}</span>
                    <span className="block font-sans text-[11px] leading-tight text-[color:var(--lib-dim)]">{t.description}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* 中区：五槽 */}
      <div className="relative z-10 mt-3 grid grid-cols-5 gap-2">
        {slots.map((slot, i) => {
          const category = TOKEN_CATEGORIES[i]
          if (!category) return null
          return <ForgeSlot key={slot.category} slot={slot} index={i} reject={rejectSlot === i} category={category} />
        })}
      </div>

      {/* 下区：动作行 */}
      <div className="relative z-10 mt-3 grid grid-cols-3 gap-2">
        <ActionButton
          title="提取"
          sub={extractDisabled ? '待白名单' : '将素材提取为词条'}
          disabled={busy || extractDisabled}
          onClick={() => {
            playSfx('select')
            startExtract()
          }}
          icon={
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3h6M10 3v5l-4 9a2 2 0 002 3h8a2 2 0 002-3l-4-9V3" />
            </svg>
          }
        />
        <ActionButton
          title="储存·派生"
          sub={modified ? '储存覆盖或派生新品' : '改动后可用'}
          disabled={busy || !modified}
          onClick={() => {
            playSfx('select')
            forgeDerive()
          }}
          onSecondary={() => {
            playSfx('click')
            forgeSave()
          }}
          icon={
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10" />
            </svg>
          }
        />
        <ActionButton
          title="合成"
          sub="提交研究 · 可随时离开"
          primary
          disabled={busy}
          onClick={() => {
            playSfx('success')
            startSynthesis()
          }}
          icon={
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7" />
            </svg>
          }
        />
      </div>

      {/* 提取演出覆盖层；合成不再阻塞式演出——见 BenchJobFocusOverlay（异步研究舱） */}
      <BenchExtract />
    </section>
  )
}

function ForgeSlot({
  slot,
  index,
  reject,
  category,
}: {
  slot: ForgeSlotState
  index: number
  reject: boolean
  category: { label: string; tint: string }
}) {
  const tok = tokenById(slot.currentTokenId)
  const [over, setOver] = useState(false)

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-sans text-[11px] font-bold" style={{ color: category.tint }}>
        {category.label}
      </span>
      <TiltCard max={12} lift={over ? 8 : 4} disabled={!tok} className="aspect-square w-full">
        <motion.div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const id = e.dataTransfer.getData('text/plain')
            if (id) forgeSetToken(index, id)
          }}
          animate={over ? { scale: 1.06 } : { scale: 1 }}
          transition={{ type: 'spring', stiffness: 460, damping: 26 }}
          className={`chamfer relative grid h-full w-full place-items-center ${
            tok ? 'forge-slot-filled' : 'forge-slot-empty'
          } ${reject ? 'lib-reject' : ''}`}
        >
          <DropSettle settleKey={tok?.id ?? null} glowColor="var(--gold)" className="grid h-full w-full place-items-center">
            {tok ? (
              <div className="grid place-items-center gap-1 p-1">
                <TokenEmblem token={tok} className="h-9 w-9" />
                <span className="font-sans text-[10px] font-bold text-[color:var(--lib-text)]">{tok.name}</span>
              </div>
            ) : (
              <span className="font-mono text-2xl font-black text-[color:var(--lib-dim)]">+</span>
            )}
          </DropSettle>
        </motion.div>
      </TiltCard>
    </div>
  )
}

function ActionButton({
  title,
  sub,
  icon,
  onClick,
  onSecondary,
  primary,
  disabled,
}: {
  title: string
  sub: string
  icon: React.ReactNode
  onClick: () => void
  onSecondary?: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <WeightedButton
      onClick={disabled ? undefined : onClick}
      onContextMenu={
        onSecondary
          ? (e) => {
              e.preventDefault()
              if (!disabled) onSecondary()
            }
          : undefined
      }
      disabled={disabled}
      className={`chamfer hud-b flex flex-col items-center justify-center gap-1 px-3 py-3 ${
        primary ? 'lib-btn-cyan' : 'lib-btn'
      }`}
      style={primary ? undefined : { ['--hud-bc' as string]: 'var(--lib-line)' }}
    >
      <span className="flex items-center gap-1.5 font-sans text-[15px] font-bold text-[color:var(--lib-text)]">
        <span style={{ color: primary ? undefined : 'var(--cyan)' }}>{icon}</span>
        {title}
      </span>
      <span className="font-sans text-[11px] text-[color:var(--lib-dim)]">{sub}</span>
    </WeightedButton>
  )
}
