'use client'

import { Minus, Plus } from 'lucide-react'
import { ZOOM_MAX, ZOOM_MIN } from '@/lib/painter-types'
import { playSfx } from '@/lib/sound'

/** 画布下方缩放滑条（§4.3）：2x–16x，默认 8x，两端 −/+ 按钮步进 1x。 */
export function ZoomSlider({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

  return (
    <div className="chamfer hud-b flex shrink-0 items-center gap-3 px-3 py-2" style={{ ['--hud-bc' as string]: 'var(--lib-line)', background: 'var(--lib-inset)' }}>
      <button
        aria-label="缩小"
        onClick={() => {
          playSfx('click')
          onZoom(clamp(zoom - 1))
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[color:var(--lib-dim)] transition-colors hover:text-[color:var(--lib-text)]"
      >
        <Minus width={14} height={14} />
      </button>
      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={1}
        value={zoom}
        onChange={(e) => onZoom(clamp(Number(e.target.value)))}
        aria-label="画布缩放"
        aria-valuetext={`${zoom} 倍`}
        className="painter-range h-1.5 flex-1 cursor-pointer"
      />
      <button
        aria-label="放大"
        onClick={() => {
          playSfx('click')
          onZoom(clamp(zoom + 1))
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[color:var(--lib-dim)] transition-colors hover:text-[color:var(--lib-text)]"
      >
        <Plus width={14} height={14} />
      </button>
      <span className="w-8 shrink-0 text-right font-mono text-[12px] font-bold tabular-nums text-[color:var(--cyan)]">
        {zoom}x
      </span>
    </div>
  )
}
