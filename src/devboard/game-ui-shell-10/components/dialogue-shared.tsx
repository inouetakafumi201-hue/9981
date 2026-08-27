'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * Shared chrome for dialog-line and dialog-options: the portrait slot and the
 * name-plate + text-box shell. Both components render mock conversations
 * around this same shell so the two feel like one continuous dialogue system
 * rather than two independently-designed panels.
 */

export interface DialoguePortraitProps {
  /** A stable key identifying who is currently speaking — changing it triggers the swap transition. Null renders no portrait (dialogue continues full-width). */
  speakerKey: string | null
  /** Single-character or short glyph rendered inside the portrait frame as a stand-in for real art. */
  glyph: string
  tone: 'acid' | 'cyan' | 'coral' | 'purple'
  imageSrc?: string
  imageAlt?: string
}

export function DialoguePortrait({ speakerKey, glyph, tone, imageSrc, imageAlt = '' }: DialoguePortraitProps) {
  return (
    <div className="dlg-portrait-slot" aria-hidden="true">
      <AnimatePresence mode="wait">
        {speakerKey && (
          <motion.div
            key={speakerKey}
            className={`dlg-portrait dlg-portrait-${tone}`}
            initial={{ opacity: 0, x: -36, rotate: -2 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          >
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="dlg-portrait-image" src={imageSrc} alt={imageAlt} draggable={false} />
            ) : (
              <span className="dlg-portrait-glyph">{glyph}</span>
            )}
            <div className="dlg-portrait-scan" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export interface DialogueBoxProps {
  speakerName: string | null
  /** Bump this to re-trigger the nameplate's red-slash sweep-in, even if the name text repeats. */
  speakerRevision: number
  children: React.ReactNode
  className?: string
}

export function DialogueBox({ speakerName, speakerRevision, children, className }: DialogueBoxProps) {
  return (
    <div className={`dlg-box ${className ?? ''}`}>
      <AnimatePresence mode="wait">
        {speakerName && (
          <motion.div
            key={`${speakerName}-${speakerRevision}`}
            className="dlg-nameplate"
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.65, 0, 0.35, 1] }}
          >
            <span className="dlg-nameplate-slash" />
            {speakerName}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="dlg-body">{children}</div>
    </div>
  )
}

/**
 * Character-by-character reveal for dialogue text. Resets whenever `text`
 * changes; `skip()` fills the remainder immediately (used for click/Space
 * "advance" and for finishing a typing line before showing the auto-advance
 * countdown).
 */
export function useTypewriter(text: string, cps = 20) {
  const [shown, setShown] = useState('')
  const [done, setDone] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setShown('')
    setDone(text.length === 0)
    let i = 0
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      i += 1
      setShown(text.slice(0, i))
      if (i >= text.length) {
        setDone(true)
        if (timerRef.current) clearInterval(timerRef.current)
      }
    }, 1000 / cps)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [text, cps])

  const skip = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    setShown(text)
    setDone(true)
  }, [text])

  return { shown, done, skip }
}
