'use client'

import { createContext, useContext } from 'react'

// ---------------------------------------------------------------------------
// One tiny pub/sub channel shared by the three rhythms of the title screen:
//
//   the signal rift  — macro, slow, solemn; owns the first-glance impact
//   the command rail — immediate, weighted; proves the player's input landed
//   the roaming cast — occasional, absurd; rewards idle attention
//
// Everything that must react to input *outside* the focused row (the rift's
// local pulse, the actors' flinch, the hint line) subscribes here instead of
// being re-rendered from menu state. Focus movement therefore costs one
// React render for the rail and zero for the scene: the rift and the actors
// read the event inside their own rAF loops and write straight to style.
// ---------------------------------------------------------------------------

export type RiftPhase =
  | 'dark' // black frame, nothing established yet
  | 'thread' // the single hairline comms thread
  | 'tear' // thread distorts, rift geometry builds
  | 'lock' // core locks onto the channel
  | 'pulse' // white-cyan pulse crosses the frame
  | 'decay' // signal falls back
  | 'residual' // steady low-frequency breathing; waiting for input
  | 'overexposed' // new-game confirm: core blows out before the wipe

/** Where a pulse came from — actors suspend comic beats for everything
 *  except `nav`, which is small enough to flinch at and carry on. */
export type PulseOrigin = 'intro' | 'nav' | 'confirm' | 'overlay' | 'error'

export type PulseEvent = {
  origin: PulseOrigin
  /** 0..1. `nav` pulses sit near .25, `confirm` at 1. */
  strength: number
  /** -1 up / +1 down / 0 undirected — lets the rift skew its kick. */
  dir: -1 | 0 | 1
}

type EventMap = {
  pulse: PulseEvent
  phase: RiftPhase
  /** true while comic beats must stand down (strong pulse, overlay, error,
   *  or a burst of fast input). */
  suppress: boolean
}

type Listener<K extends keyof EventMap> = (value: EventMap[K]) => void

export class MenuSignalBus {
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>()
  private _phase: RiftPhase = 'dark'
  private _suppressed = true // suppressed until the intro hands over

  get phase() {
    return this._phase
  }

  get suppressed() {
    return this._suppressed
  }

  on<K extends keyof EventMap>(key: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(fn as Listener<never>)
    return () => {
      set?.delete(fn as Listener<never>)
    }
  }

  emit<K extends keyof EventMap>(key: K, value: EventMap[K]) {
    if (key === 'phase') this._phase = value as RiftPhase
    if (key === 'suppress') this._suppressed = value as boolean
    const set = this.listeners.get(key)
    if (!set) return
    for (const fn of set) (fn as Listener<K>)(value)
  }

  /** Called on unmount: drops every subscriber so no stray closure can keep
   *  a detached element (or its rAF loop) alive across a page swap. */
  dispose() {
    this.listeners.clear()
  }
}

export const MenuSignalContext = createContext<MenuSignalBus | null>(null)

export function useMenuSignal(): MenuSignalBus | null {
  return useContext(MenuSignalContext)
}

// ---------------------------------------------------------------------------
// Comic-beat floor control. Only ever one actor may be mid-gag, so the
// screen never turns into a cartoon. The token is module-level rather than
// context state because it is claimed and released from inside rAF loops,
// where a React setState round-trip would be both wasteful and too late.
// ---------------------------------------------------------------------------
const beatFloor = { owner: null as string | null, until: 0 }

export function claimComicBeat(actorId: string, nowMs: number, durationMs: number): boolean {
  if (beatFloor.owner !== null && beatFloor.owner !== actorId && nowMs < beatFloor.until) return false
  beatFloor.owner = actorId
  beatFloor.until = nowMs + durationMs
  return true
}

export function releaseComicBeat(actorId: string) {
  if (beatFloor.owner === actorId) {
    beatFloor.owner = null
    beatFloor.until = 0
  }
}
