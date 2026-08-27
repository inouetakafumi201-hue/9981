'use client'

import { useEffect, useRef } from 'react'
import { useMenuSignal, type RiftPhase } from '@/lib/menu-signal-bus'
import type { PerfTier } from '@/hooks/use-perf-tier'

// ---------------------------------------------------------------------------
// The signal rift — the screen's one main visual event.
//
// Not a ring with rays: an *incomplete* tear made of broken orbits, severed
// scan arcs, dislocated neural filaments, a hard white-cyan core, a thin
// violet distortion smear and a handful of shards that get drawn in or flung
// out. It has real states (dark → thread → tear → lock → pulse → decay →
// residual) with a silent stretch and a waiting stretch — it never sits in a
// permanent glitch.
//
// Everything reads two CSS custom properties: `--rift-kick` (0..1, the short
// local response to player input, written from a decaying rAF loop) and the
// scene-wide parallax vars. No React state changes while it animates.
// ---------------------------------------------------------------------------

// Deterministic geometry — computed once at module scope so server and
// client markup are byte-identical and hydration never reconciles.
const ORBITS = [
  { r: 58, dash: '104 38 62 210', rot: 0, dur: 52, dir: 1, w: 0.9, o: 0.5 },
  { r: 44, dash: '58 26 128 90', rot: 40, dur: 38, dir: -1, w: 0.7, o: 0.38 },
  { r: 76, dash: '32 46 18 300', rot: 130, dur: 78, dir: 1, w: 0.6, o: 0.26 },
]

// Severed scan arcs: partial circles drawn as arcs, each missing most of its
// sweep so the eye reads "lock attempt failed" rather than "decorative ring".
const ARCS = [
  { r: 66, from: -58, to: 22, w: 1.5, o: 0.55 },
  { r: 66, from: 128, to: 166, w: 1.1, o: 0.4 },
  { r: 34, from: 196, to: 268, w: 1.3, o: 0.5 },
]

// Neural filaments with one dislocation each: they leave the core, jog
// sideways, and stop short of anything.
const FILAMENTS = Array.from({ length: 11 }, (_, i) => {
  const a = (i * 137.5 + 12) % 360
  const rad = (a * Math.PI) / 180
  const len = 26 + ((i * 17) % 46)
  const jog = ((i % 3) - 1) * 5
  const p = (m: number, off: number) => {
    const r2 = ((a + off) * Math.PI) / 180
    return `${(100 + len * m * Math.cos(r2)).toFixed(1)},${(100 + len * m * Math.sin(r2) * 0.92).toFixed(1)}`
  }
  return {
    points: `${(100 + 9 * Math.cos(rad)).toFixed(1)},${(100 + 9 * Math.sin(rad)).toFixed(1)} ${p(0.55, jog)} ${p(0.78, -jog)} ${p(1, 0)}`,
    delay: (i * 0.37) % 3.2,
    bright: i % 4 === 0,
  }
})

// Shards: half get pulled into the core, half are flung away from it.
const SHARDS = Array.from({ length: 14 }, (_, i) => {
  const a = (i * 51 + 9) % 360
  const rad = (a * Math.PI) / 180
  const r = 30 + ((i * 23) % 58)
  return {
    x: 100 + r * Math.cos(rad),
    y: 100 + r * Math.sin(rad) * 0.9,
    size: 1.2 + (i % 3) * 0.9,
    inward: i % 2 === 0,
    delay: (i * 0.23) % 1.6,
    dur: 1.5 + ((i * 0.31) % 1.4),
  }
})

function arcPath(r: number, from: number, to: number) {
  const p = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad) * 0.92]
  }
  const [x1, y1] = p(from)
  const [x2, y2] = p(to)
  const large = Math.abs(to - from) > 180 ? 1 : 0
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${(r * 0.92).toFixed(1)} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

export function MenuSignalRift({ phase, tier }: { phase: RiftPhase; tier: PerfTier }) {
  const bus = useMenuSignal()
  const rootRef = useRef<HTMLDivElement>(null)

  // Player input lands here as a short, decaying kick. It is a single scalar
  // so the core flare, the filament brightness, the arc sweep and the shard
  // jitter all respond in proportion instead of each animating separately —
  // and fast repeated input tops up one value rather than stacking effects.
  useEffect(() => {
    if (!bus) return
    let kick = 0
    let raf = 0
    let last = performance.now()
    let running = false
    const el = rootRef.current

    const loop = (now: number) => {
      const dt = Math.min(48, now - last) / 1000
      last = now
      kick *= Math.pow(0.012, dt)
      el?.style.setProperty('--rift-kick', kick.toFixed(4))
      if (kick > 0.002) {
        raf = requestAnimationFrame(loop)
      } else {
        el?.style.setProperty('--rift-kick', '0')
        running = false
      }
    }

    const off = bus.on('pulse', (p) => {
      kick = Math.min(1, kick * 0.5 + (p.origin === 'nav' ? 0.42 : 1) * p.strength)
      el?.style.setProperty('--rift-dir', String(p.dir))
      if (!running) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    })
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
  }, [bus])

  const heavy = tier === 'standard'

  return (
    <div className="rift" data-phase={phase} ref={rootRef} aria-hidden="true">
      {/* the hairline comms thread the whole sequence begins from */}
      <span className="rift-thread" />

      <svg className="rift-svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="rift-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#EFFFF7" stopOpacity="1" />
            <stop offset="26%" stopColor="#78E8D5" stopOpacity=".78" />
            <stop offset="62%" stopColor="#5CD6C5" stopOpacity=".16" />
            <stop offset="100%" stopColor="#5CD6C5" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rift-warp" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8F7CFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#8F7CFF" stopOpacity=".55" />
            <stop offset="100%" stopColor="#8F7CFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* broken orbits — deliberately unclosed */}
        <g className="rift-orbits">
          {ORBITS.map((o, i) => (
            <circle
              key={i}
              className="rift-orbit"
              cx="100"
              cy="100"
              r={o.r}
              strokeDasharray={o.dash}
              strokeWidth={o.w}
              style={{
                opacity: o.o,
                animationDuration: `${o.dur}s`,
                animationDirection: o.dir === 1 ? 'normal' : 'reverse',
                transformOrigin: '100px 100px',
                transform: `rotate(${o.rot}deg) scaleY(.92)`,
              }}
            />
          ))}
        </g>

        {/* severed scan arcs */}
        <g className="rift-arcs">
          {ARCS.map((a, i) => (
            <path
              key={i}
              className="rift-arc"
              d={arcPath(a.r, a.from, a.to)}
              strokeWidth={a.w}
              style={{ opacity: a.o, animationDelay: `${i * 1.4}s` }}
            />
          ))}
        </g>

        {/* violet dislocation smear — the only purple on screen */}
        <rect className="rift-warp" x="52" y="88" width="96" height="2.4" fill="url(#rift-warp)" />
        <rect className="rift-warp is-b" x="66" y="119" width="68" height="1.4" fill="url(#rift-warp)" />

        {/* neural filaments */}
        <g className="rift-filaments">
          {FILAMENTS.map((f, i) => (
            <polyline
              key={i}
              className={`rift-filament ${f.bright ? 'is-bright' : ''}`}
              points={f.points}
              fill="none"
              style={{ animationDelay: `${f.delay}s` }}
            />
          ))}
        </g>

        {/* the tear itself: a vertical slit that the core opens along */}
        <path className="rift-slit" d="M100 34 C 106 68, 104 128, 100 166 C 96 128, 94 68, 100 34 Z" />

        {/* core */}
        <circle className="rift-halo" cx="100" cy="100" r="52" fill="url(#rift-core)" />
        <ellipse className="rift-core" cx="100" cy="100" rx="4.4" ry="12" />
        <ellipse className="rift-core is-inner" cx="100" cy="100" rx="1.7" ry="6" />

        {heavy && (
          <g className="rift-shards">
            {SHARDS.map((s, i) => (
              <rect
                key={i}
                className={`rift-shard ${s.inward ? 'is-in' : 'is-out'}`}
                x={s.x.toFixed(1)}
                y={s.y.toFixed(1)}
                width={s.size}
                height={s.size}
                style={{ animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
              />
            ))}
          </g>
        )}
      </svg>

      {/* the pulse itself: one wavefront that crosses the frame, plus the
          bloom that briefly lights the cast and the shards */}
      <span className="rift-wave" />
      <span className="rift-bloom" />
    </div>
  )
}
