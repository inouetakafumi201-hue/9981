'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, Users, Check, X as XIcon } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

type MatchState = 'idle' | 'searching' | 'found' | 'confirmed' | 'declined'

const ROLE_LABELS = ['先锋', '策应', '支援']

/**
 * Gallery page for the full matchmaking queue panel: search → found (with a
 * confirm/decline choice and countdown) → resolved. This is a standalone,
 * more elaborate flow than residence-main's inline three-state anchor bar —
 * the plan keeps that bar as-is and does not replace it with this component.
 */
export function UtilityMatch() {
  const [state, setState] = useState<MatchState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [countdown, setCountdown] = useState(8)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (state === 'searching') {
      setElapsed(0)
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
      const found = setTimeout(() => {
        setState('found')
        setCountdown(8)
        playSfx('match-ready')
      }, 2600)
      return () => { clearInterval(tickRef.current!); clearTimeout(found) }
    }
    return undefined
  }, [state])

  useEffect(() => {
    if (state === 'found') {
      countdownRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            setState('declined')
            playSfx('match-cancel')
            return 0
          }
          return c - 1
        })
      }, 1000)
      return () => clearInterval(countdownRef.current!)
    }
    return undefined
  }, [state])

  const startSearch = () => { setState('searching'); playSfx('ui-hover') }
  const cancelSearch = () => { setState('idle'); playSfx('match-cancel') }
  const confirm = () => { setState('confirmed'); playSfx('match-ready') }
  const decline = () => { setState('declined'); playSfx('match-cancel') }
  const reset = () => setState('idle')

  return (
    <div className="um-stage">
      <div className="um-panel">
        <div className="um-panel-head">
          <span className="um-kicker">匹配队列 · MOCK</span>
          <h3 className="um-title">深潜编组</h3>
        </div>

        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.div key="idle" className="um-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="um-copy">加入队列以匹配三人编组，占位数据，不接入真实后端。</p>
              <button className="um-cta" onClick={startSearch}><Search size={14} /> 开始匹配</button>
            </motion.div>
          )}

          {state === 'searching' && (
            <motion.div key="searching" className="um-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="um-searching-row">
                <span className="um-searching-spinner" />
                <span className="um-searching-label">正在搜索编组</span>
                <span className="um-searching-time">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
              </div>
              <div className="um-role-slots">
                {ROLE_LABELS.map((role) => (
                  <div key={role} className="um-role-slot">
                    <Users size={13} />
                    <span>{role}</span>
                  </div>
                ))}
              </div>
              <button className="um-cta is-ghost" onClick={cancelSearch}>取消匹配</button>
            </motion.div>
          )}

          {state === 'found' && (
            <motion.div key="found" className="um-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="um-found-label">编组已就位</p>
              <div className="um-role-slots">
                {ROLE_LABELS.map((role) => (
                  <div key={role} className="um-role-slot is-filled">
                    <Users size={13} />
                    <span>{role}</span>
                  </div>
                ))}
              </div>
              <div className="um-countdown-track">
                <div className="um-countdown-fill" style={{ width: `${(countdown / 8) * 100}%` }} />
              </div>
              <div className="um-confirm-actions">
                <button className="um-confirm-btn is-decline" onClick={decline}><XIcon size={14} /> 拒绝</button>
                <button className="um-confirm-btn is-accept" onClick={confirm}><Check size={14} /> 确认（{countdown}s）</button>
              </div>
            </motion.div>
          )}

          {(state === 'confirmed' || state === 'declined') && (
            <motion.div key="resolved" className="um-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className={`um-resolved-banner${state === 'confirmed' ? ' is-confirmed' : ' is-declined'}`}>
                {state === 'confirmed' ? '编组已确认，等待传送。' : '已放弃本次匹配。'}
              </p>
              <button className="um-cta" onClick={reset}>重新匹配</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
