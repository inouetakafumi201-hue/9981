'use client'

import { useEffect, useRef, useState } from 'react'
import { playSfx } from '@editor/lib/sound'

const LINES = [
  'SYS://WAKEUP_DREAMTABLE  v2.7.1',
  '正在初始化梦境引擎...',
  '加载场景蓝图缓存 [卧铺车厢]...',
  '校验节点连通性与语义锚点...',
  '全息投影模块 · 在线',
]

/**
 * One-shot "device power-on" overlay shown on first mount: black screen,
 * a burst of scanline flicker, a terminal boot log typed out character
 * by character, then an iris-wipe reveal into the app. Everything here
 * is driven by a handful of timeouts/intervals that all get cleared on
 * unmount — nothing lingers once the sequence finishes.
 */
const BOOT_FLAG = 'wakeup-booted'

export function BootSequence() {
  // Server always renders the 'flicker' phase (no access to sessionStorage
  // during SSR). The client's FIRST render must match that exactly, or React
  // throws a hydration mismatch. So we always start at 'flicker' here and
  // only branch to 'done' inside an effect — that runs after hydration, as a
  // normal post-mount state update, which is safe.
  const [phase, setPhase] = useState<'flicker' | 'type' | 'reveal' | 'done'>('flicker')
  const [lineIdx, setLineIdx] = useState(0)
  const [charIdx, setCharIdx] = useState(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    // Only play once per browser session — subsequent remounts (HMR, client
    // navigation) skip straight to done so the app doesn't re-boot on you.
    if (sessionStorage.getItem(BOOT_FLAG)) {
      setPhase('done')
      return
    }
    try {
      sessionStorage.setItem(BOOT_FLAG, '1')
    } catch {
      /* private mode — fine, boot just plays again */
    }
    const push = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      timers.current.push(id)
      return id
    }

    playSfx('boot')
    push(() => setPhase('type'), 420)

    return () => {
      timers.current.forEach((id) => clearTimeout(id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 壳层按 V0 原样；根配置未装 react-hooks 插件（规则已置 off 占位，此注释仅为 V0 原文保留）
  }, [])

  // typewriter — advances one character at a time, then one line at a time
  useEffect(() => {
    if (phase !== 'type') return
    if (lineIdx >= LINES.length) {
      const id = window.setTimeout(() => setPhase('reveal'), 260)
      timers.current.push(id)
      return
    }
    const current = LINES[lineIdx]
    if (!current) return
    if (charIdx < current.length) {
      const id = window.setTimeout(() => setCharIdx((c) => c + 1), 12)
      timers.current.push(id)
    } else {
      const id = window.setTimeout(
        () => {
          setLineIdx((l) => l + 1)
          setCharIdx(0)
        },
        lineIdx === LINES.length - 1 ? 180 : 90,
      )
      timers.current.push(id)
    }
  }, [phase, lineIdx, charIdx])

  useEffect(() => {
    if (phase !== 'reveal') return
    playSfx('success')
    const id = window.setTimeout(() => setPhase('done'), 620)
    timers.current.push(id)
  }, [phase])

  if (phase === 'done') return null

  return (
    <div
      className={`fixed inset-0 z-[1000] bg-background transition-opacity duration-500 ${
        phase === 'reveal' ? 'boot-iris-out' : ''
      }`}
      aria-hidden
    >
      {/* scanline flicker burst */}
      <div className="boot-flicker-burst absolute inset-0 bg-primary/10" />
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(90,224,240,0.14) 0px, rgba(90,224,240,0.14) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* terminal boot log — font-sans so CJK glyphs render (mono lacks them),
          but keep the terminal cadence with tracking + a mono cursor */}
      <div className="absolute left-1/2 top-1/2 w-[min(90vw,560px)] -translate-x-1/2 -translate-y-1/2 font-sans text-[13px] leading-relaxed tracking-wide text-primary/90">
        {LINES.slice(0, lineIdx).map((l, i) => (
          <div key={i} className="flex items-center gap-2 opacity-70">
            <span className="font-mono text-[11px] font-bold text-success">OK</span>
            <span>{l}</span>
          </div>
        ))}
        {phase === 'type' && lineIdx < LINES.length && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-primary">›</span>
            <span>
              {LINES[lineIdx]?.slice(0, charIdx) ?? ''}
              <span className="boot-cursor font-mono">_</span>
            </span>
          </div>
        )}
      </div>

      {/* corner readout for atmosphere */}
      <div className="absolute bottom-6 left-6 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        DREAM ENGINE BOOTSTRAP
      </div>
    </div>
  )
}
