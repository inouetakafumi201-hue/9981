'use client'

import { useEffect, useRef, useState } from 'react'
import { hexToHsl, hslToHex } from '@/lib/painter-types'

/** 色相条 + 饱和度/明度滑条（§4.4）：拖动即时预览为当前色。 */
export function ColorPickerStrip({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [hsl, setHsl] = useState(() => hexToHsl(color))
  const lastEmitted = useRef(color)

  // 外部（点色板/取色器）改变了当前色时，重新同步 h/s/l；自身拖动产生的变化不回灌，避免抖动
  useEffect(() => {
    if (color !== lastEmitted.current) {
      setHsl(hexToHsl(color))
      lastEmitted.current = color
    }
  }, [color])

  function commit(next: { h: number; s: number; l: number }) {
    setHsl(next)
    const hex = hslToHex(next.h, next.s, next.l)
    lastEmitted.current = hex
    onChange(hex)
  }

  return (
    <div className="flex flex-col gap-2">
      <SliderRow
        label="色相"
        value={hsl.h}
        max={360}
        onChange={(v) => commit({ ...hsl, h: v })}
        track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
        thumbColor={hslToHex(hsl.h, 100, 50)}
      />
      <SliderRow
        label="饱和"
        value={hsl.s}
        max={100}
        onChange={(v) => commit({ ...hsl, s: v })}
        track={`linear-gradient(90deg, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`}
        thumbColor={hslToHex(hsl.h, hsl.s, hsl.l)}
      />
      <SliderRow
        label="明度"
        value={hsl.l}
        max={100}
        onChange={(v) => commit({ ...hsl, l: v })}
        track={`linear-gradient(90deg, #000, ${hslToHex(hsl.h, hsl.s, 50)}, #fff)`}
        thumbColor={hslToHex(hsl.h, hsl.s, hsl.l)}
      />
    </div>
  )
}

function SliderRow({
  label,
  value,
  max,
  onChange,
  track,
  thumbColor,
}: {
  label: string
  value: number
  max: number
  onChange: (v: number) => void
  track: string
  thumbColor: string
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-8 shrink-0 font-sans text-[11px] text-[color:var(--lib-dim)]">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="painter-range h-1.5 flex-1 cursor-pointer"
        style={{ ['--painter-track' as string]: track, ['--painter-thumb' as string]: thumbColor }}
      />
    </label>
  )
}
