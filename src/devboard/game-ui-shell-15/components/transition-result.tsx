'use client'

import { motion } from 'framer-motion'
import { Coins, Gem, Trophy } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

// Result ceremony — a restrained close to the loop, not a popup dialog. One
// result line, one reward line, then a single explicit return action back to
// residence-main, which is where the whole entry-flow closes.
const REWARDS = [
  { icon: Coins, label: '信用点', value: '+240' },
  { icon: Gem, label: '共鸣结晶', value: '+3' },
]

export function TransitionResult({
  onReturn,
  actionLabel = '返回驻地',
  rewardMode = false,
}: {
  onReturn: () => void
  actionLabel?: string
  rewardMode?: boolean
}) {
  return (
    <div className="tr-scene">
      <div className="tr-backdrop" aria-hidden="true" />

      <motion.div
        className="tr-seal"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <Trophy size={26} strokeWidth={1.3} />
      </motion.div>

      <motion.h2
        className="tr-title"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.45 }}
      >
        {rewardMode ? '奖励投影已确认' : '对局结束 — 胜利'}
      </motion.h2>

      <motion.div
        className="tr-rewards"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.4 }}
      >
        {REWARDS.map(({ icon: Icon, label, value }) => (
          <div key={label} className="tr-reward">
            <Icon size={14} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </motion.div>

      <motion.button
        className="tr-return"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        onClick={() => {
          playSfx('battle-result')
          onReturn()
        }}
      >
        {actionLabel}
      </motion.button>
    </div>
  )
}
