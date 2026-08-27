'use client'

import { useEffect, useState } from 'react'

/**
 * Lightweight real-time synthesized SFX engine for the research-table UI.
 * No audio files — every sound is generated on the fly with the Web Audio
 * API (oscillators + a shaped gain envelope), so it stays tiny and never
 * fights browser autoplay policies (it only ever starts on a user gesture).
 */

type SfxName = 'hover' | 'click' | 'select' | 'success' | 'warning' | 'error' | 'toggle' | 'boot'

let ctx: AudioContext | null = null
let muted = false
const listeners = new Set<(muted: boolean) => void>()

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  return ctx
}

function envGain(
  audio: AudioContext,
  destination: AudioNode,
  attack: number,
  hold: number,
  release: number,
  peak: number,
) {
  const g = audio.createGain()
  const t0 = audio.currentTime
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
  g.gain.setValueAtTime(peak, t0 + attack + hold)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release)
  g.connect(destination)
  return { gain: g, t0, end: t0 + attack + hold + release }
}

function tone(
  audio: AudioContext,
  freq: number,
  type: OscillatorType,
  attack: number,
  hold: number,
  release: number,
  peak: number,
  glideTo?: number,
) {
  const osc = audio.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, audio.currentTime)
  if (glideTo) {
    osc.frequency.exponentialRampToValueAtTime(glideTo, audio.currentTime + attack + hold)
  }
  const { gain, t0, end } = envGain(audio, audio.destination, attack, hold, release, peak)
  osc.connect(gain)
  osc.start(t0)
  osc.stop(end + 0.02)
}

function playImpl(name: SfxName) {
  const audio = getCtx()
  if (!audio) return
  switch (name) {
    case 'hover':
      tone(audio, 1400, 'sine', 0.002, 0.02, 0.05, 0.03)
      break
    case 'click':
      tone(audio, 620, 'square', 0.001, 0.01, 0.07, 0.05, 340)
      break
    case 'select':
      tone(audio, 900, 'triangle', 0.002, 0.03, 0.09, 0.06, 1200)
      break
    case 'toggle':
      tone(audio, 500, 'square', 0.001, 0.015, 0.06, 0.045, 720)
      break
    case 'success': {
      tone(audio, 660, 'triangle', 0.002, 0.05, 0.12, 0.07, 990)
      setTimeout(() => {
        const a = getCtx()
        if (a) tone(a, 990, 'triangle', 0.002, 0.05, 0.14, 0.07, 1320)
      }, 70)
      break
    }
    case 'warning':
      tone(audio, 260, 'sawtooth', 0.001, 0.06, 0.12, 0.05, 190)
      break
    case 'error': {
      tone(audio, 220, 'sawtooth', 0.001, 0.05, 0.1, 0.06, 140)
      setTimeout(() => {
        const a = getCtx()
        if (a) tone(a, 160, 'sawtooth', 0.001, 0.06, 0.14, 0.06, 100)
      }, 90)
      break
    }
    case 'boot':
      tone(audio, 120, 'sawtooth', 0.02, 0.3, 0.5, 0.08, 480)
      break
  }
}

export function playSfx(name: SfxName) {
  if (muted) return
  try {
    playImpl(name)
  } catch {
    /* audio not available — fail silently, this is pure decoration */
  }
}

export function isSfxMuted() {
  return muted
}

export function setSfxMuted(next: boolean) {
  muted = next
  listeners.forEach((l) => l(muted))
}

export function toggleSfxMuted() {
  setSfxMuted(!muted)
  return muted
}

export function subscribeSfxMuted(listener: (muted: boolean) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook mirroring the global mute flag for UI toggles. */
export function useSfxMuted() {
  const [m, setM] = useState(muted)
  useEffect(() => {
    const unsubscribe = subscribeSfxMuted(setM)
    return () => {
      unsubscribe()
    }
  }, [])
  return m
}

/** Spread onto any interactive element for a consistent hover+click blip. */
export function sfxHandlers(onClick?: SfxName | false, onHover: SfxName | false = 'hover') {
  return {
    onMouseEnter: onHover ? () => playSfx(onHover) : undefined,
    onClick: onClick ? () => playSfx(onClick) : undefined,
  }
}
