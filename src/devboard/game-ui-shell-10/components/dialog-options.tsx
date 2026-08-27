'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Ban, Check, Loader2, RotateCcw, Shield, X } from 'lucide-react'
import { DialogueBox, DialoguePortrait } from './dialogue-shared'
import { playSfx } from '@/lib/audio-slot'
import { useIntentChannel, type IntentPhase } from '@/lib/use-intent'
import { B5_CHOICE_COPY, type B5Choice } from '@/lib/b5-session'

const QUESTION = '你要相信她说的话吗？还是先自己确认一遍？'
const OPTION_IDS: B5Choice[] = ['trust', 'verify', 'observe', 'confront']
const OPTIONS = OPTION_IDS.map((id) => B5_CHOICE_COPY[id].label)

const INTENT_LABEL: Record<IntentPhase, string> = {
  idle: '待提交', pending: '等待宿主确认', accepted: '宿主已确认',
  rejected: '宿主拒绝了这个选择', stale: '版本过期', timeout: '请求超时', cancelled: '已取消',
}

/**
 * Self-contained demo: a mock question grows up to 4 option buttons beneath
 * the shared dialogue box, staggered spring entrance. Choosing one flashes a
 * white highlight, slides the chosen option out to the right while the rest
 * fade together, then shows a placeholder "resolved" banner before looping.
 */
export function DialogOptions({ onResolved }: { onResolved?: (choice: B5Choice) => void }) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [resolved, setResolved] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const { state: intent, dispatch, retry, cancel, reset } = useIntentChannel('dialog-options')

  const choose = useCallback(async (i: number) => {
    if (chosen !== null || intent.phase === 'pending') return
    playSfx('option-select')
    setChosen(i)
    const choice = OPTION_IDS[i]
    const result = await dispatch('dialog.option.select', { dialogId: 'b5-signal', optionId: choice })
    if (result.status !== 'accepted') {
      setChosen(null)
      return
    }
    resetTimerRef.current = setTimeout(() => {
      setResolved(true)
      onResolved?.(choice)
    }, 380)
  }, [chosen, dispatch, intent.phase, onResolved])

  const safeReturn = useCallback(() => {
    reset()
    setChosen(null)
  }, [reset])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (chosen !== null) return
      const num = Number(e.key)
      if (num >= 1 && num <= OPTIONS.length) {
        choose(num - 1)
        return
      }
      const focusedIdx = optionRefs.current.findIndex((el) => el === document.activeElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = focusedIdx < 0 ? 0 : (focusedIdx + 1) % OPTIONS.length
        optionRefs.current[next]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = focusedIdx < 0 ? OPTIONS.length - 1 : (focusedIdx - 1 + OPTIONS.length) % OPTIONS.length
        optionRefs.current[prev]?.focus()
      } else if (e.key === 'Enter' && focusedIdx >= 0) {
        choose(focusedIdx)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [chosen, choose])

  return (
    <div className="dlg-stage">
      <DialoguePortrait speakerKey="asker" glyph="？" tone="cyan" imageSrc="/games/menu/detective/portrait-detective.png" imageAlt="侦探·墨立绘" />
      <div style={{ width: '100%', maxWidth: 720 }}>
        <DialogueBox speakerName="记录者" speakerRevision={0}>
          <div>{QUESTION}</div>
        </DialogueBox>

        <div className="dlg-options-list" role="listbox" aria-label="对话选项">
          <AnimatePresence>
            {!resolved &&
              OPTIONS.map((label, i) => {
                const isChosen = chosen === i
                const isOther = chosen !== null && !isChosen
                return (
                  <motion.button
                    key={label}
                    ref={(el) => {
                      optionRefs.current[i] = el
                    }}
                    className={`dlg-option-btn ${isChosen ? 'is-chosen' : ''}`}
                    role="option"
                    aria-selected={isChosen}
                    disabled={chosen !== null || intent.phase === 'pending'}
                    initial={{ opacity: 0, y: 16, scale: 0.96 }}
                    animate={
                      isChosen
                        ? { opacity: [1, 1], x: 24, backgroundColor: ['rgba(255,255,255,.95)', 'rgba(255,255,255,.9)'] }
                        : isOther
                          ? { opacity: 0 }
                          : { opacity: 1, y: 0, scale: 1 }
                    }
                    exit={{ opacity: 0 }}
                    transition={
                      isChosen
                        ? { duration: 0.35, ease: 'easeOut' }
                        : { type: 'spring', stiffness: 380, damping: 26, delay: 0.08 + i * 0.06 }
                    }
                    onClick={() => choose(i)}
                  >
                    <span className="dlg-option-index">{i + 1}</span>
                    {label}
                  </motion.button>
                )
              })}
          </AnimatePresence>
        </div>

        {intent.phase !== 'idle' && !resolved && (
          <div
            className={`sh-intent is-compact sh-intent-${intent.phase}`}
            role={intent.phase === 'rejected' || intent.phase === 'timeout' ? 'alert' : 'status'}
            aria-live={intent.phase === 'rejected' || intent.phase === 'timeout' ? 'assertive' : 'polite'}
          >
            {intent.phase === 'pending' ? <Loader2 size={13} className="is-spin" /> : intent.phase === 'accepted' ? <Check size={13} /> : intent.phase === 'cancelled' ? <Ban size={13} /> : <AlertTriangle size={13} />}
            <span className="sh-intent-main">
              <b>{INTENT_LABEL[intent.phase]}</b>
              {intent.reason && <small>{intent.reason}</small>}
            </span>
            <span className="sh-intent-actions">
              {intent.phase === 'pending' && <button onClick={cancel}><X size={11} />取消</button>}
              {(intent.phase === 'rejected' || intent.phase === 'timeout' || intent.phase === 'stale') && <button onClick={retry}><RotateCcw size={11} />重试</button>}
              {(intent.phase === 'rejected' || intent.phase === 'timeout' || intent.phase === 'stale' || intent.phase === 'cancelled') && (
                <button onClick={safeReturn}><Shield size={11} />安全返回</button>
              )}
            </span>
          </div>
        )}

        <AnimatePresence>
          {resolved && (
            <motion.div
              className="dlg-resolved-banner"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {chosen !== null ? B5_CHOICE_COPY[OPTION_IDS[chosen]].result : ''}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
