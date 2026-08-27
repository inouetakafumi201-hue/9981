'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Gamepad2, Play, RotateCcw, Settings2, X } from 'lucide-react'
import { SettingsPanel } from './settings-panel'
import { MenuSpriteField } from './menu-sprite-field'
import { playSfx } from '@/lib/audio-slot'
import { useShellIntent } from '@/lib/shell-intent'

type EntryId = 'new-game' | 'continue' | 'options' | 'quit'

const ICONS: Record<EntryId, typeof Play> = {
  'new-game': Play,
  continue: RotateCcw,
  options: Settings2,
  quit: X,
}

// A handful of fixed, index-derived positions/durations for the drifting
// holographic motes — deterministic on purpose (no Math.random at render
// time) so server and client markup match exactly and hydration never has
// to reconcile a mismatch.
const MOTES = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 37 + 6) % 100,
  delay: (i * 0.71) % 6,
  duration: 5 + ((i * 1.3) % 4),
  size: 2 + (i % 3),
}))

// Deterministic jagged-crack ray angles for the neural-web starburst behind
// the title, and a small deterministic set of diagnostic scan lines that
// tick through a "running" state — both mirror the WakeUp reference's
// shattered-glass backdrop and top-right console without needing any
// random state that could mismatch between server and client renders.
const CRACK_ANGLES = Array.from({ length: 16 }, (_, i) => (i * 22.5 + 4) % 360)
const SCAN_LINES = ['SCAN_MEMORY()', 'REBUILD_STREAM', 'FRAGMENT_SCAN', 'NEURAL_MAP', 'CONSOLIDATE...', 'STATUS_CHECK']

export function MenuTitle({
  hasMockSave,
  onNewGame,
  onContinue,
  onPlayFullRun,
}: {
  hasMockSave: boolean
  onNewGame: () => void
  onContinue: () => void
  onPlayFullRun?: () => void
}) {
  const [showSettings, setShowSettings] = useState(false)
  const [quitConfirm, setQuitConfirm] = useState(false)
  const [activeEntry, setActiveEntry] = useState<EntryId>('new-game')
  const [scanIndex, setScanIndex] = useState(0)
  const [scanPercent, setScanPercent] = useState(64)
  const quitIntent = useShellIntent('menu-title', 'menu-title')
  const optionsTriggerRef = useRef<HTMLButtonElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const entryRefs = useRef<Record<EntryId, HTMLButtonElement | null>>({
    'new-game': null,
    continue: null,
    options: null,
    quit: null,
  })

  const enabledEntries: EntryId[] = ['new-game', ...(hasMockSave ? (['continue'] as const) : []), 'options', 'quit']

  const focusEntry = (id: EntryId) => entryRefs.current[id]?.focus()

  const handleNav = (e: KeyboardEvent<HTMLButtonElement>, id: EntryId) => {
    const idx = enabledEntries.indexOf(id)
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      focusEntry(enabledEntries[(idx + 1) % enabledEntries.length])
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      focusEntry(enabledEntries[(idx - 1 + enabledEntries.length) % enabledEntries.length])
    } else if (e.key === 'Escape' && id === 'quit' && quitConfirm) {
      setQuitConfirm(false)
    }
  }

  const closeSettings = () => {
    setShowSettings(false)
    optionsTriggerRef.current?.focus()
  }

  // Mouse-driven parallax: every layer (starburst, holo rings, the sprite,
  // the diagnostic panels) reads the same two CSS variables at a different
  // multiplier of its own, so the whole scene shifts together with subtly
  // different depths rather than one flat plane sliding as a unit. Applied
  // via a rAF-batched ref write, never React state, so mouse movement never
  // triggers a re-render.
  const raf = useRef<number | null>(null)
  const onSceneMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = sceneRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    if (raf.current !== null) return
    raf.current = requestAnimationFrame(() => {
      raf.current = null
      sceneRef.current?.style.setProperty('--mt-px', px.toFixed(3))
      sceneRef.current?.style.setProperty('--mt-py', py.toFixed(3))
    })
  }, [])
  const onSceneMouseLeave = useCallback(() => {
    sceneRef.current?.style.setProperty('--mt-px', '0')
    sceneRef.current?.style.setProperty('--mt-py', '0')
  }, [])

  // Diagnostic panel ticks through its scan-command list on a slow interval
  // and nudges its progress readout, purely as ambient "system is alive"
  // motion — matching the reference's DIAGNOSTIC INTERFACE console.
  useEffect(() => {
    const id = setInterval(() => {
      setScanIndex((i) => (i + 1) % SCAN_LINES.length)
      setScanPercent((p) => (p >= 97 ? 41 : p + 3))
    }, 1400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="mt-scene" ref={sceneRef} onMouseMove={onSceneMouseMove} onMouseLeave={onSceneMouseLeave}>
      <div className="mt-holo-backdrop" aria-hidden="true">
        <div className="mt-holo-beam mt-holo-beam-a" />
        <div className="mt-holo-beam mt-holo-beam-b" />
        <div className="mt-holo-rings" />
        <div className="mt-holo-scan" />
        <div className="mt-holo-motes">
          {MOTES.map((m, i) => (
            <span
              key={i}
              className="mt-mote"
              style={{
                left: `${m.left}%`,
                width: m.size,
                height: m.size,
                animationDelay: `${m.delay}s`,
                animationDuration: `${m.duration}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Shattered neural-web starburst behind the title — a field of jagged
          cracks radiating from one bright core, mirroring the reference's
          "glass breaking into a neural network" motif. Pure SVG, no image
          asset, so it can share the parallax variables with everything else. */}
      <svg className="mt-starburst" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="mt-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.9" />
            <stop offset="45%" stopColor="var(--acid)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--acid)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="30" cy="46" r="26" fill="url(#mt-core-glow)" />
        {CRACK_ANGLES.map((deg, i) => {
          const len = 18 + ((i * 13) % 30)
          const jitter = (i % 3) * 4 - 4
          const x2 = 30 + len * Math.cos((deg * Math.PI) / 180)
          const y2 = 46 + len * Math.sin((deg * Math.PI) / 180) * 0.6
          const midX = 30 + (len * 0.55 + jitter) * Math.cos(((deg + 6) * Math.PI) / 180)
          const midY = 46 + (len * 0.55 + jitter) * Math.sin(((deg + 6) * Math.PI) / 180) * 0.6
          return (
            <polyline
              key={i}
              className="mt-crack-line"
              points={`30,46 ${midX.toFixed(1)},${midY.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`}
              fill="none"
            />
          )
        })}
      </svg>

      {onPlayFullRun && (
        <div className="mt-toolbar">
          <button className="mt-toolbar-btn" onClick={onPlayFullRun}>
            <Play size={12} />
            <span>播放完整入局流程</span>
          </button>
        </div>
      )}

      {/* Ambient background layer: 1-3 drifting, self-rotating copies of the
          character sheet roaming their own home regions in the upper/right
          "sky" of the scene, well clear of the title/nav column below.
          Fully pointer-events: none except each critter's own small hit
          target, so it can never intercept clicks or Tab focus meant for
          the real menu — see menu-sprite-field.tsx for the full contract. */}
      <MenuSpriteField containerRef={sceneRef} />

      <div className="mt-content">
        <div className="mt-brandline">
          <Gamepad2 size={15} />
          <span>PROJECT // ECHO</span>
        </div>
        <h1 className="mt-title" data-text="最后的信号">
          <span>最后的信号</span>
          <span className="mt-title-sub">仍在燃烧</span>
        </h1>
        <span className="mt-title-rule" aria-hidden="true" />

        <nav className="mt-entries" aria-label="Main menu">
          <span
            className="mt-entry-indicator"
            style={{ transform: `translateY(${enabledEntries.indexOf(activeEntry) * 100}%)` }}
            aria-hidden="true"
          />
          {(['new-game', 'continue', 'options', 'quit'] as EntryId[]).map((id) => {
            const Icon = ICONS[id]
            const disabled = id === 'continue' && !hasMockSave
            const label = { 'new-game': '开始新游戏', continue: '继续', options: '设置', quit: '退出' }[id]

            if (id === 'quit' && quitConfirm) {
              return (
                <motion.div
                  key="quit-confirm"
                  className="mt-quit-confirm"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <span className="mt-quit-confirm-label">确认退出？</span>
                  {quitIntent.state.phase !== 'idle' && (
                    <span className={`mt-quit-confirm-feedback is-${quitIntent.state.phase}`} role={quitIntent.state.phase === 'pending' || quitIntent.state.phase === 'rejected' ? 'status' : undefined} aria-live="polite">
                      {quitIntent.state.message}
                    </span>
                  )}
                  <div className="mt-quit-confirm-actions">
                    <button className="mt-quit-confirm-btn is-confirm" disabled={quitIntent.isPending} onClick={async () => {
                      playSfx('ui-confirm')
                      const result = await quitIntent.dispatch('menu.quit.confirm', 'control-panel-main')
                      if (result.outcome === 'accepted') setQuitConfirm(false)
                    }}>
                      {quitIntent.isPending ? '提交中…' : <><Check size={13} /> 确认</>}
                    </button>
                    <button
                      className="mt-quit-confirm-btn"
                      onClick={() => {
                        setQuitConfirm(false)
                        playSfx('ui-cancel')
                      }}
                      autoFocus
                    >
                      <X size={13} /> 取消
                    </button>
                  </div>
                </motion.div>
              )
            }

            return (
              <button
                key={id}
                ref={(el) => {
                  entryRefs.current[id] = el
                  if (id === 'options') optionsTriggerRef.current = el
                }}
                className={`mt-entry ${disabled ? 'is-disabled' : ''} ${activeEntry === id ? 'is-active' : ''}`}
                disabled={disabled}
                onKeyDown={(e) => handleNav(e, id)}
                onMouseEnter={() => {
                  if (disabled) return
                  setActiveEntry(id)
                  playSfx('ui-hover')
                }}
                onFocus={() => {
                  if (disabled) return
                  setActiveEntry(id)
                  playSfx('ui-focus')
                }}
                onClick={() => {
                  if (disabled) return
                  playSfx('ui-confirm')
                  if (id === 'new-game') onNewGame()
                  else if (id === 'continue') onContinue()
                  else if (id === 'options') setShowSettings(true)
                  else if (id === 'quit') setQuitConfirm(true)
                }}
              >
                <Icon size={16} className="mt-entry-icon" />
                <span className="mt-entry-label">{label}</span>
              </button>
            )
          })}
        </nav>

      </div>

      <AnimatePresence>{showSettings && <SettingsPanel onClose={closeSettings} />}</AnimatePresence>
    </div>
  )
}
