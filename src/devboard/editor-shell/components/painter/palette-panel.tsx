'use client'

import { Plus } from 'lucide-react'
import { MIDTONE_COLORS, SEMANTIC_COLORS } from '@/lib/painter-types'
import { ColorPickerStrip } from './color-picker-strip'
import { playSfx } from '@/lib/sound'

/**
 * 取色板（§4.4）：两排固定常用色 + 当前色展示 + 自定义格（8 格增删）+
 * 色相/饱和/明度调色。点击色块即设为当前色；自定义格右键移除。
 */
export function PalettePanel({
  currentColor,
  onPick,
  customColors,
  onAddCustom,
  onRemoveCustom,
}: {
  currentColor: string
  onPick: (hex: string) => void
  customColors: string[]
  onAddCustom: () => void
  onRemoveCustom: (index: number) => void
}) {
  return (
    <div className="chamfer hud-b flex flex-col gap-2.5 p-3" style={{ ['--hud-bc' as string]: 'var(--lib-line)', background: 'var(--lib-inset)' }}>
      <SwatchRow label="语义色" colors={SEMANTIC_COLORS} current={currentColor} onPick={onPick} />
      <SwatchRow label="中间色" colors={MIDTONE_COLORS} current={currentColor} onPick={onPick} />

      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 font-sans text-[11px] text-[color:var(--lib-dim)]">当前色</span>
        <span
          className="chamfer-sm h-6 w-6 shrink-0 ring-1 ring-inset ring-white/15"
          style={{ background: currentColor }}
        />
        <span className="font-mono text-[12px] uppercase tabular-nums text-[color:var(--lib-text)]">{currentColor}</span>
        <button
          onClick={() => {
            playSfx('click')
            onAddCustom()
          }}
          className="chamfer-sm hud-b ml-auto flex items-center gap-1 px-2.5 py-1 font-sans text-[11px] font-bold text-[color:var(--cyan)] transition-colors hover:brightness-110"
          style={{ ['--hud-bc' as string]: 'var(--cyan)' }}
        >
          <Plus width={12} height={12} />
          添加到常用
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 font-sans text-[11px] text-[color:var(--lib-dim)]">自定义</span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {customColors.length === 0 && (
            <span className="font-sans text-[11px] text-[color:var(--lib-dim)]/70">暂无 · 点「添加到常用」保存</span>
          )}
          {customColors.map((hex, i) => (
            <button
              key={`${hex}-${i}`}
              title={`${hex}（右键移除）`}
              onClick={() => {
                playSfx('click')
                onPick(hex)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onRemoveCustom(i)
              }}
              className={`chamfer-sm h-6 w-6 shrink-0 ring-1 ring-inset transition-transform hover:scale-110 ${
                currentColor === hex ? 'ring-2 ring-[color:var(--cyan)]' : 'ring-white/15'
              }`}
              style={{ background: hex }}
            />
          ))}
        </div>
      </div>

      <ColorPickerStrip color={currentColor} onChange={onPick} />
    </div>
  )
}

function SwatchRow({
  label,
  colors,
  current,
  onPick,
}: {
  label: string
  colors: string[]
  current: string
  onPick: (hex: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 font-sans text-[11px] text-[color:var(--lib-dim)]">{label}</span>
      <div className="flex flex-1 flex-wrap gap-1.5">
        {colors.map((hex) => (
          <button
            key={hex}
            title={hex}
            onClick={() => {
              playSfx('click')
              onPick(hex)
            }}
            className={`chamfer-sm h-6 w-6 shrink-0 ring-1 ring-inset transition-transform hover:scale-110 ${
              current === hex ? 'ring-2 ring-[color:var(--cyan)]' : 'ring-white/15'
            }`}
            style={{ background: hex }}
          />
        ))}
      </div>
    </div>
  )
}
