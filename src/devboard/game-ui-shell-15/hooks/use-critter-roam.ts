'use client'

import { useEffect, useRef, useState } from 'react'
import type { PerfTier } from './use-perf-tier'
import { claimComicBeat, releaseComicBeat, type MenuSignalBus, type PulseEvent } from '@/lib/menu-signal-bus'

// ---------------------------------------------------------------------------
// Deterministic aerial roaming for the title screen's second narrative layer.
//
// The cast keeps flying — it is not demoted to static silhouettes — but it is
// steered, not jittered: a heading-based cruiser with lane attraction, soft
// yaw away from the title/menu column and away from the signal core, and a
// small library of reproducible comic beats. No `Math.random()` runs per
// frame (or per render); every choice is drawn from the actor's own seeded
// generator in a fixed order, so a given actor behaves identically every
// time the title screen is entered.
// ---------------------------------------------------------------------------

export type RoamState =
  | 'cruise'
  | 'orbit-signal'
  | 'avoid-title'
  | 'avoid-menu'
  | 'pause-midair'
  | 'comic-beat'
  | 'exit-frame'
  | 'reenter-frame'

export type ComicBeat =
  | 'brake-and-swerve' // slams the brakes near the rift, then arcs around it
  | 'bounced-by-scan' // nudged by a scan arc, then acts like nothing happened
  | 'reverse-cruise' // flies backwards a while, then abruptly corrects
  | 'yield-to-peer' // sidesteps another actor coming the other way
  | 'peek-at-menu' // leans in at the menu, retreats once a row lights up
  | 'forgot-direction' // stalls midair, apparently having lost the plot
  | 'drop-and-chase' // drops a pixel shard, doubles back for it
  | 'wrong-orbit-relock' // takes the wrong orbit, pauses, re-locks

export type RoamLane = 'upper-right' | 'right-edge' | 'lower-far' | 'outer-ring'

export type RoamActorSpec = {
  actorId: string
  spriteId: string
  lane: RoamLane
  seed: number
  /** percent-of-width per second at cruise */
  speed: number
  direction: 1 | -1
  scale: number
  opacity: number
  /** how much a signal pulse lifts this actor out of the dark. Echo actors
   *  use a large gain and a near-zero base so they only exist mid-pulse. */
  glowGain?: number
  comicBeats: ComicBeat[]
  role: 'primary' | 'secondary' | 'echo'
}

// The title block and the command rail both live in the lower-left quadrant;
// the rift core sits centre-right. Actors may approach, orbit or be nudged
// off either, but never cross them.
const TITLE_ZONE = { x0: -6, y0: 30, x1: 46, y1: 106 }
const CORE = { cx: 63, cy: 44, r: 12 }
const LANES: Record<RoamLane, { x0: number; y0: number; x1: number; y1: number }> = {
  'upper-right': { x0: 54, y0: 5, x1: 97, y1: 27 },
  'right-edge': { x0: 76, y0: 28, x1: 103, y1: 70 },
  'lower-far': { x0: 46, y0: 72, x1: 92, y1: 96 },
  'outer-ring': { x0: 40, y0: 8, x1: 100, y1: 92 },
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type BeatRuntime = {
  kind: ComicBeat
  startedAt: number
  duration: number
  /** scratch space so a beat can stash its own one-off numbers */
  a: number
  b: number
}

export type RoamHandle<T extends HTMLElement> = {
  ref: React.RefObject<T | null>
  /** currently running gag, surfaced so the sprite can change pose */
  beat: ComicBeat | null
  state: RoamState
  near: boolean
  /** click feedback: quick elastic pop, never touches the flight path */
  pop: () => void
  /** dropped shard for `drop-and-chase`, in container percent */
  shard: { x: number; y: number } | null
  trailAt: (msAgo: number) => { x: number; y: number } | null
}

export function useCritterRoam<T extends HTMLElement>({
  spec,
  tier,
  containerEl,
  bus,
}: {
  spec: RoamActorSpec
  tier: PerfTier
  containerEl: HTMLElement | null
  bus: MenuSignalBus | null
}): RoamHandle<T> {
  const ref = useRef<T | null>(null)
  const [beat, setBeat] = useState<ComicBeat | null>(null)
  const [state, setState] = useState<RoamState>('cruise')
  const [near, setNear] = useState(false)
  const [shard, setShard] = useState<{ x: number; y: number } | null>(null)

  // Mirrored into a ref so the flight loop can read the dropped shard
  // without re-subscribing to React state on every frame.
  const shardRef = useRef<{ x: number; y: number } | null>(null)
  shardRef.current = shard

  const popAt = useRef<number | null>(null)
  const pointer = useRef({ x: -1, y: -1, active: false })
  const trail = useRef<{ t: number; x: number; y: number }[]>([])
  const flinch = useRef({ x: 0, y: 0, glow: 0 })
  const suppressed = useRef(true)

  // -- pointer tracking (lean + proximity only; never steers the path) -----
  useEffect(() => {
    if (!containerEl) return
    const onMove = (e: MouseEvent) => {
      const r = containerEl.getBoundingClientRect()
      pointer.current = {
        x: ((e.clientX - r.left) / r.width) * 100,
        y: ((e.clientY - r.top) / r.height) * 100,
        active: true,
      }
    }
    const onLeave = () => {
      pointer.current.active = false
    }
    containerEl.addEventListener('mousemove', onMove)
    containerEl.addEventListener('mouseleave', onLeave)
    return () => {
      containerEl.removeEventListener('mousemove', onMove)
      containerEl.removeEventListener('mouseleave', onLeave)
    }
  }, [containerEl])

  // -- signal reactions ---------------------------------------------------
  useEffect(() => {
    if (!bus) return
    suppressed.current = bus.suppressed
    const offSuppress = bus.on('suppress', (v) => {
      suppressed.current = v
    })
    const offPulse = bus.on('pulse', (p: PulseEvent) => {
      // A navigation pulse is a flick of the wrist: actors twitch away from
      // the rail and brighten for a beat. A confirm-strength pulse shoves
      // them outward and cancels any gag in progress.
      const push = p.origin === 'nav' ? 1.1 : 4.4 * p.strength
      flinch.current.x += push
      flinch.current.y += push * 0.4 * (p.dir || 1)
      flinch.current.glow = Math.min(1, flinch.current.glow + (p.origin === 'nav' ? 0.35 : 1))
    })
    return () => {
      offSuppress()
      offPulse()
    }
  }, [bus])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const rng = mulberry32(spec.seed)
    const lane = LANES[spec.lane]
    const laneCx = (lane.x0 + lane.x1) / 2
    const laneCy = (lane.y0 + lane.y1) / 2

    // ---- reduced motion: hold a readable final pose, no flight loop -----
    if (tier === 'reduced') {
      el.style.left = `${laneCx.toFixed(2)}%`
      el.style.top = `${laneCy.toFixed(2)}%`
      el.style.transform = `translate(-50%, -50%) scale(${spec.scale})`
      el.style.opacity = String(spec.opacity)
      setState('pause-midair')
      // Low-frequency static pose changes stand in for the gags, so the
      // layer still reads as inhabited without any sustained animation.
      const poseTimer = window.setInterval(() => {
        setBeat((b) => (b ? null : 'forgot-direction'))
      }, 9000 + Math.floor(rng() * 6000))
      return () => {
        window.clearInterval(poseTimer)
        setBeat(null)
      }
    }

    let x = laneCx + (rng() - 0.5) * (lane.x1 - lane.x0) * 0.6
    let y = laneCy + (rng() - 0.5) * (lane.y1 - lane.y0) * 0.6
    let heading = rng() * Math.PI * 2
    let speed = spec.speed
    // Roll is a *bank*, not a tumble: these are characters drifting in a
    // dream, so the sprite stays readable and upright and only leans a few
    // degrees either side of vertical. `rotPhase` advances forever and the
    // angle is derived as a sine of it, which keeps the lean continuous and
    // bounded instead of accumulating into full rotations.
    let rotPhase = rng() * Math.PI * 2
    const rotSwing = 5 + rng() * 5
    const rotDir = spec.direction
    const wobbleA = 0.6 + rng() * 0.8
    const wobbleB = 0.4 + rng() * 0.9
    const wobblePhase = rng() * Math.PI * 2
    const orbitDir: 1 | -1 = rng() < 0.5 ? 1 : -1

    let nextBeatAt = 6000 + rng() * 9000
    let current: BeatRuntime | null = null
    let stateNow: RoamState = 'cruise'
    let beatNow: ComicBeat | null = null
    let nearNow = false
    let lateral = 0

    const setStateOnce = (s: RoamState) => {
      if (s !== stateNow) {
        stateNow = s
        setState(s)
      }
    }
    const setBeatOnce = (b: ComicBeat | null) => {
      if (b !== beatNow) {
        beatNow = b
        setBeat(b)
      }
    }

    const start = performance.now()
    let last = start
    let raf = 0

    const beginBeat = (now: number, t: number) => {
      const kind = spec.comicBeats[Math.floor(rng() * spec.comicBeats.length)]
      const duration =
        kind === 'reverse-cruise' ? 1900 : kind === 'drop-and-chase' ? 2600 : kind === 'peek-at-menu' ? 2100 : 1500
      if (!claimComicBeat(spec.actorId, now, duration)) {
        nextBeatAt = t + 2500 + rng() * 3000 // floor is busy; try again shortly
        return
      }
      current = { kind, startedAt: t, duration, a: rng(), b: rng() }
      setStateOnce('comic-beat')
      setBeatOnce(kind)
      if (kind === 'drop-and-chase') setShard({ x, y })
      if (kind === 'reverse-cruise' || kind === 'wrong-orbit-relock') heading += Math.PI
    }

    const endBeat = (t: number) => {
      const kind = current?.kind
      current = null
      releaseComicBeat(spec.actorId)
      setBeatOnce(null)
      setStateOnce('cruise')
      if (kind === 'drop-and-chase') setShard(null)
      if (kind === 'reverse-cruise') heading += Math.PI
      nextBeatAt = t + 8000 + rng() * 10000
    }

    const tick = (now: number) => {
      const t = now - start
      const dtMs = Math.min(48, now - last)
      last = now
      const dt = dtMs / 1000

      // ---------------- steering -----------------------------------------
      // Desired heading is assembled from a few soft influences and then
      // *eased into*, so every course change reads as a turn rather than a
      // teleport or a per-frame jitter.
      let desiredX = Math.cos(heading)
      let desiredY = Math.sin(heading)
      let speedTarget = spec.speed
      let scaleBoost = 1

      // lane return
      const laneDx = laneCx - x
      const laneDy = laneCy - y
      const laneOut =
        x < lane.x0 || x > lane.x1 || y < lane.y0 || y > lane.y1 ? 1 : 0.12
      desiredX += (laneDx / 40) * laneOut * 1.6
      desiredY += (laneDy / 40) * laneOut * 1.6

      // deterministic wander (sum of two incommensurate sines, not noise)
      desiredX += Math.sin(t / (2600 * wobbleA) + wobblePhase) * 0.5
      desiredY += Math.cos(t / (3100 * wobbleB) + wobblePhase) * 0.42

      // soft yaw off the title / rail column
      if (x > TITLE_ZONE.x0 - 12 && x < TITLE_ZONE.x1 + 12 && y > TITLE_ZONE.y0 - 10) {
        const pushX = (TITLE_ZONE.x1 + 12 - x) / 22
        const pushY = -(y - (TITLE_ZONE.y0 - 10)) / 26
        desiredX += Math.max(0, pushX) * 2.4
        desiredY += pushY * 1.5
        setStateOnce(y > 62 ? 'avoid-menu' : 'avoid-title')
      }

      // rift core: never occlude it — orbit or peel away
      const cdx = x - CORE.cx
      const cdy = (y - CORE.cy) * 0.85
      const cdist = Math.hypot(cdx, cdy)
      if (cdist < CORE.r + 10) {
        const tangentX = -cdy * orbitDir
        const tangentY = cdx * orbitDir
        const tl = Math.hypot(tangentX, tangentY) || 1
        const urgency = (CORE.r + 10 - cdist) / (CORE.r + 10)
        desiredX += (tangentX / tl) * 1.6 + (cdx / (cdist || 1)) * urgency * 2.6
        desiredY += (tangentY / tl) * 1.6 + (cdy / (cdist || 1)) * urgency * 2.6
        if (stateNow !== 'comic-beat') setStateOnce('orbit-signal')
      } else if (stateNow === 'orbit-signal') {
        setStateOnce('cruise')
      }

      // frame edges: allow a clipped exit, then come back in
      if (x < -8 || x > 108 || y < -8 || y > 108) {
        setStateOnce('reenter-frame')
        desiredX += (laneCx - x) / 18
        desiredY += (laneCy - y) / 18
      } else if (x > 99 || x < 2) {
        setStateOnce('exit-frame')
      }

      // ---------------- comic beats ---------------------------------------
      if (current) {
        const u = (t - current.startedAt) / current.duration
        const k = current.kind
        if (k === 'brake-and-swerve') {
          speedTarget = u < 0.35 ? spec.speed * 0.08 : spec.speed * 1.35
          if (u > 0.35) {
            const swerve = (current.a < 0.5 ? -1 : 1) * 1.2
            desiredX += -Math.sin(heading) * swerve
            desiredY += Math.cos(heading) * swerve
          }
        } else if (k === 'bounced-by-scan') {
          if (u < 0.25) {
            desiredY -= 2.6
            speedTarget = spec.speed * 1.6
          } else {
            speedTarget = spec.speed * 0.9 // "nothing happened"
          }
        } else if (k === 'reverse-cruise') {
          speedTarget = spec.speed * 0.55
        } else if (k === 'yield-to-peer') {
          lateral = Math.sin(u * Math.PI) * (current.a < 0.5 ? -3.4 : 3.4)
          speedTarget = spec.speed * 0.75
        } else if (k === 'peek-at-menu') {
          // leans toward the rail's outer margin, then bolts back out
          const targetX = TITLE_ZONE.x1 + 9
          if (u < 0.55) {
            desiredX += (targetX - x) / 9
            speedTarget = spec.speed * 0.85
            scaleBoost = 1.04
          } else {
            desiredX += (laneCx - x) / 7
            speedTarget = spec.speed * 2.1
          }
        } else if (k === 'forgot-direction') {
          speedTarget = spec.speed * (u < 0.7 ? 0.03 : 1.1)
          if (u < 0.7) desiredY += Math.sin(t / 260) * 0.5
        } else if (k === 'drop-and-chase') {
          if (u < 0.45) {
            speedTarget = spec.speed * 1.2
          } else if (shardRef.current) {
            const sdx = shardRef.current.x - x
            const sdy = shardRef.current.y - y
            desiredX += sdx / 7
            desiredY += sdy / 7
            speedTarget = spec.speed * 1.5
          }
        } else if (k === 'wrong-orbit-relock') {
          speedTarget = u < 0.5 ? spec.speed * 1.25 : u < 0.72 ? spec.speed * 0.05 : spec.speed
        }
        if (u >= 1) endBeat(t)
      } else if (t > nextBeatAt) {
        if (suppressed.current) nextBeatAt = t + 2200
        else beginBeat(now, t)
      }

      // ---------------- integrate ----------------------------------------
      const desiredHeading = Math.atan2(desiredY, desiredX)
      let diff = ((desiredHeading - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      const turnRate = current?.kind === 'peek-at-menu' ? 4.2 : 2.4
      heading += diff * Math.min(1, dt * turnRate)
      speed += (speedTarget - speed) * Math.min(1, dt * 3.2)

      // signal flinch decays out; it displaces, it does not steer
      flinch.current.x *= Math.pow(0.0025, dt)
      flinch.current.y *= Math.pow(0.0025, dt)
      flinch.current.glow *= Math.pow(0.02, dt)

      x += Math.cos(heading) * speed * dt + flinch.current.x * dt * 6
      y += Math.sin(heading) * speed * dt * 0.72 + flinch.current.y * dt * 6
      lateral *= Math.pow(0.05, dt)
      rotPhase += rotDir * 0.55 * dt
      const rot = Math.sin(rotPhase) * rotSwing

      // pointer proximity: notice, lift, brighten — no path change
      let leanX = 0
      let leanY = 0
      const rect = containerEl?.getBoundingClientRect()
      if (rect && pointer.current.active && tier === 'standard') {
        const dxPx = ((pointer.current.x - x) / 100) * rect.width
        const dyPx = ((pointer.current.y - y) / 100) * rect.height
        const dist = Math.hypot(dxPx, dyPx)
        const isNear = dist < (nearNow ? 155 : 122)
        if (isNear !== nearNow) {
          nearNow = isNear
          setNear(isNear)
        }
        leanX = Math.max(-20, Math.min(20, dxPx * 0.06))
        leanY = Math.max(-14, Math.min(14, dyPx * 0.05))
      } else if (nearNow) {
        nearNow = false
        setNear(false)
      }

      let pop = 1
      if (popAt.current !== null) {
        const e = now - popAt.current
        if (e >= 380) popAt.current = null
        else {
          const u = e / 380
          pop = u < 0.35 ? 1 + (0.26 * u) / 0.35 : u < 0.7 ? 1.26 - (0.34 * (u - 0.35)) / 0.35 : 0.92 + (0.08 * (u - 0.7)) / 0.3
        }
      }

      el.style.left = `${x.toFixed(2)}%`
      el.style.top = `${y.toFixed(2)}%`
      el.style.transform = `translate(-50%, -50%) translate(${(leanX + lateral).toFixed(1)}px, ${leanY.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${(spec.scale * pop * scaleBoost * (1 + (nearNow ? 0.07 : 0))).toFixed(3)})`
      el.style.opacity = String(
        Math.min(1, spec.opacity + flinch.current.glow * (spec.glowGain ?? 0.3) + (nearNow ? 0.12 : 0)),
      )
      el.style.setProperty('--roam-glow', flinch.current.glow.toFixed(3))

      trail.current.push({ t: now, x, y })
      if (trail.current.length > 90) trail.current.shift()

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      releaseComicBeat(spec.actorId)
      trail.current = []
      setShard(null)
      setBeat(null)
    }
    // The spec is a frozen descriptor and the container is stable for the
    // component's lifetime; only a tier change needs a fresh flight loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, containerEl])

  return {
    ref,
    beat,
    state,
    near,
    shard,
    pop: () => {
      popAt.current = performance.now()
      // Poking an actor is not a local effect: these creatures only exist
      // because the rift is lit, so disturbing one sends a ripple back to
      // the source and every other actor flinches at it. `nav` strength is
      // deliberate — small enough that comic beats keep running.
      bus?.emit('pulse', { origin: 'nav', strength: 0.34, dir: 0 })
    },
    trailAt: (msAgo: number) => {
      const target = performance.now() - msAgo
      const buf = trail.current
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= target) return { x: buf[i].x, y: buf[i].y }
      return buf[0] ? { x: buf[0].x, y: buf[0].y } : null
    },
  }
}
