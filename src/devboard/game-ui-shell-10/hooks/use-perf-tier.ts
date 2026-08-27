'use client'

import { useEffect, useState } from 'react'

// Three-tier quality ladder for ambient/decorative motion (menu sprite
// field, background particles, etc.). This is intentionally coarse — it
// only exists to answer "how many floating instances, and which effects
// layers, can this device afford" — not a general perf-monitoring system.
//
//   standard — full instance count, parallax, glow/bloom, motion trails.
//   reduced  — prefers-reduced-motion is on: no rotation/parallax/trail,
//              only a slow vertical drift remains, frame animation stays.
//   low      — a weak/unknown device (few cores or a data-saver hint):
//              a single instance, no glow/trail, frames step at 8fps.
//
// Reduced-motion always wins over the device heuristic — an explicit
// accessibility preference outranks a capability guess.
export type PerfTier = 'standard' | 'reduced' | 'low'

function detectTier(): PerfTier {
  if (typeof window === 'undefined') return 'standard'
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduced'

  const cores = navigator.hardwareConcurrency ?? 8
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ?? false

  // Only step down for genuinely weak/constrained devices — a common
  // 4-core/4GB laptop should still get the full ambient treatment.
  if (saveData || cores <= 2 || mem <= 2) return 'low'
  return 'standard'
}

export function usePerfTier(): PerfTier {
  const [tier, setTier] = useState<PerfTier>('standard')

  useEffect(() => {
    setTier(detectTier())
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setTier(detectTier())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return tier
}
