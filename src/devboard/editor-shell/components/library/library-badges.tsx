'use client'

import { Star } from 'lucide-react'
import { badgeStateOf, type MaterialMeta } from '@/lib/library-data'

/**
 * 卡片角标组（§4.1）：一个素材可同时具多个角标，主色取最显眼者，其余做小徽章。
 * 布局约定：星标（黄）钉左上角，限免/UGC/合成 chip 靠右上，已改动橙点紧随其后。
 * 纯展示，角标集合由 badgeStateOf 纯函数派生（只读，不推断）。
 */
export function BadgeGroup({ asset, compact = false }: { asset: MaterialMeta; compact?: boolean }) {
  const b = badgeStateOf(asset)
  return (
    <>
      {b.starred && (
        <span className="pointer-events-none absolute left-1 top-1 z-10">
          <Star size={compact ? 11 : 14} className="fill-[var(--star)] text-[var(--star)] drop-shadow-[0_0_5px_var(--star)]" />
        </span>
      )}
      <span className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-1">
        {b.free && <Chip label="限免" tone="free" compact={compact} />}
        {b.ugc && <Chip label="UGC" tone="ugc" compact={compact} />}
        {b.craft && <Chip label="合成" tone="craft" compact={compact} />}
        {b.modified && (
          <span
            className="inline-block rounded-full bg-[var(--orange)]"
            style={{ width: compact ? 5 : 6, height: compact ? 5 : 6, boxShadow: '0 0 6px var(--orange)' }}
            aria-label="已改动"
          />
        )}
      </span>
    </>
  )
}

const TONE: Record<'free' | 'ugc' | 'craft', { bg: string; fg: string; glow: string }> = {
  free: { bg: 'var(--free)', fg: '#052012', glow: 'var(--free)' },
  ugc: { bg: 'var(--cyan)', fg: '#04141a', glow: 'var(--cyan)' },
  craft: { bg: 'var(--gold)', fg: '#241a03', glow: 'var(--gold)' },
}

export function Chip({ label, tone, compact = false }: { label: string; tone: 'free' | 'ugc' | 'craft'; compact?: boolean }) {
  const t = TONE[tone]
  return (
    <span
      className={`rounded font-sans font-bold ${compact ? 'px-1 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} ${
        tone === 'free' ? 'lib-badge-free' : ''
      }`}
      style={{ background: t.bg, color: t.fg, boxShadow: `0 0 8px -2px ${t.glow}` }}
    >
      {label}
    </span>
  )
}
