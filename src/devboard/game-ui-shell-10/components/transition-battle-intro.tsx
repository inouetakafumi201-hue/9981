'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, ShieldAlert, Swords, Users } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

// Full-screen ceremony that stands between residence and the live HUD — mock
// map name + a couple of ruleset callouts staged as floating cards over the
// same holographic light language as the title screen, not a boxy loading
// grid. Auto-advances after a beat, or the player can skip straight through.
const CALLOUTS = [
  { icon: MapPin, label: '地图', value: '断潮矿脊 · 第 7 区' },
  { icon: Users, label: '编队', value: '3v3 · 竞技' },
  { icon: ShieldAlert, label: '规则', value: '标准回合 · 无重开' },
]

export function TransitionBattleIntro({ onComplete }: { onComplete: () => void }) {
  const [skipped, setSkipped] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    playSfx('battle-intro')
    timer.current = setTimeout(onComplete, 2600)
    return () => clearTimeout(timer.current)
  }, [onComplete])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'Enter') && !skipped) {
        setSkipped(true)
        clearTimeout(timer.current)
        onComplete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onComplete, skipped])

  return (
    <div className="tbi-scene">
      <div className="tbi-backdrop" aria-hidden="true" />
      <div className="tbi-rays" aria-hidden="true" />

      <motion.div
        className="tbi-emblem"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <Swords size={26} strokeWidth={1.3} />
      </motion.div>

      <motion.h2
        className="tbi-title"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        对局即将开始
      </motion.h2>

      <div className="tbi-callouts">
        {CALLOUTS.map(({ icon: Icon, label, value }, i) => (
          <motion.div
            key={label}
            className="tbi-callout"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.12, duration: 0.45 }}
          >
            <Icon size={14} />
            <div>
              <span className="tbi-callout-label">{label}</span>
              <span className="tbi-callout-value">{value}</span>
            </div>
          </motion.div>
        ))}
      </div>

      <span className="mock-tag tbi-mock">MOCK</span>

      <button
        className="tbi-skip"
        onClick={() => {
          setSkipped(true)
          clearTimeout(timer.current)
          onComplete()
        }}
      >
        跳过
      </button>
    </div>
  )
}
