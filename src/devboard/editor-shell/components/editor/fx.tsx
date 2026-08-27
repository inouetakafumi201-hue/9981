'use client'

/* Holographic projection overlay WITH a travelling scan band.
   Reserved for the currently-selected projection only. */
export function HoloScan({ strong = false }: { strong?: boolean }) {
  return (
    <span
      className="holo-flicker pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <span className="holo-lines absolute inset-0" />
      <span className="holo-tint absolute inset-0" style={{ opacity: strong ? 1 : 0.55 }} />
      <span className="holo-scan" style={{ opacity: strong ? 1 : 0.5 }} />
      {/* top edge bloom where the projection emits */}
      <span
        className="absolute inset-x-0 top-0 h-1/3 mix-blend-screen"
        style={{
          background:
            'linear-gradient(180deg, rgba(90,224,240,0.22), transparent)',
          opacity: strong ? 0.9 : 0.4,
        }}
      />
    </span>
  )
}

/* Static holographic tint (scanlines + tint + flicker) with NO scan band.
   Used for every non-selected projection so it reads as a hologram
   without the active scanning motion. */
export function HoloStatic({ intensity = 0.5 }: { intensity?: number }) {
  return (
    <span
      className="holo-flicker pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <span className="holo-lines absolute inset-0" style={{ opacity: 0.55 }} />
      <span className="holo-tint absolute inset-0" style={{ opacity: intensity }} />
      <span
        className="absolute inset-x-0 top-0 h-1/3 mix-blend-screen"
        style={{
          background:
            'linear-gradient(180deg, rgba(90,224,240,0.18), transparent)',
          opacity: 0.35,
        }}
      />
    </span>
  )
}

/* Angular HUD corner brackets that frame a panel like an instrument readout. */
export function HudCorners({
  color = 'var(--primary)',
  size = 10,
  inset = -1,
  opacity = 0.6,
}: {
  color?: string
  size?: number
  inset?: number
  opacity?: number
}) {
  const s = `${size}px`
  const p = `${inset}px`
  const corners = [
    { pos: { left: p, top: p }, b: { borderLeft: `2px solid`, borderTop: `2px solid` } },
    { pos: { right: p, top: p }, b: { borderRight: `2px solid`, borderTop: `2px solid` } },
    { pos: { left: p, bottom: p }, b: { borderLeft: `2px solid`, borderBottom: `2px solid` } },
    { pos: { right: p, bottom: p }, b: { borderRight: `2px solid`, borderBottom: `2px solid` } },
  ]
  return (
    <>
      {corners.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute z-30"
          style={{
            width: s,
            height: s,
            borderColor: color,
            opacity,
            ...c.pos,
            ...c.b,
          }}
        />
      ))}
    </>
  )
}

/* Fixed full-screen CRT / hologram atmosphere: faint cyan scanlines, a
   subtle edge vignette, one slow travelling scan band, and rare glitch
   flicker. Deliberately restrained — this used to also draw pulsing HUD
   corner brackets and glowing edge beams, but those read as visually
   mismatched clutter sitting on top of the real UI chrome, so they were
   removed. Everything here uses low-opacity `screen`/`overlay` blending
   so it never desaturates the panels underneath — see the `--holo-*`
   comment block in globals.css for the reasoning. */
export function ScreenFx() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden>
      <div className="crt-scanlines absolute inset-0" />
      <div className="crt-vignette absolute inset-0" />
      <div className="crt-roll absolute inset-x-0" />
      <div className="screen-flicker absolute inset-0" />
    </div>
  )
}

/* A field of slow-drifting dust motes for the projection volume. */
export function DustField({ count = 14 }: { count?: number }) {
  const motes = Array.from({ length: count }, (_, i) => {
    const size = 1 + ((i * 7) % 3)
    return {
      left: `${(i * 37 + 8) % 96}%`,
      top: `${(i * 53 + 12) % 92}%`,
      size,
      duration: `${6 + ((i * 3) % 7)}s`,
      delay: `${(i * 1.3) % 6}s`,
    }
  })
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {motes.map((m, i) => (
        <span
          key={i}
          className="dust absolute rounded-full bg-primary/70"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            boxShadow: '0 0 6px var(--primary)',
            animationDuration: m.duration,
            animationDelay: m.delay,
          }}
        />
      ))}
    </div>
  )
}
