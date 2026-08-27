'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Play, SkipForward, X } from 'lucide-react'
import { SettingsPanel } from './settings-panel'
import { MenuSpriteField } from './menu-sprite-field'
import { MenuSignalRift } from './menu-signal-rift'
import { MenuDreamField } from './menu-dream-field'
import { playSfx } from '@/lib/audio-slot'
import { useShellIntent } from '@/lib/shell-intent'
import { usePerfTier } from '@/hooks/use-perf-tier'
import { MenuSignalBus, MenuSignalContext, type RiftPhase } from '@/lib/menu-signal-bus'

// ---------------------------------------------------------------------------
// TITLE — "最后一束信号正在撕开梦境"
//
// Layer contract (z-index order, all inside .mt-scene):
//   0  dark field, low-frequency grain, distant comms reverb
//   1  far scan arcs and incomplete orbits
//   2  dream fragments, roaming cast, pulse-only echoes
//   3  the signal rift (centre-right) — the main visual event
//   4  title block and the command rail (left positioning line)
//   5  system diagnostics, input hints, status feedback
//   6  overlays: settings, quit protocol, launch wipe
//
// The three rhythms (macro rift / immediate rail / occasional roaming gag)
// talk to each other through MenuSignalBus rather than through render state,
// so moving the focus lights the rail *and* kicks the rift *and* makes the
// cast flinch, at the cost of one render for the rail only.
// ---------------------------------------------------------------------------

type EntryId = 'new-game' | 'continue' | 'options' | 'quit'

const LABELS: Record<EntryId, string> = {
  'new-game': '开始新游戏',
  continue: '继续',
  options: '设置',
  quit: '退出',
}

const HINTS: Record<EntryId, string> = {
  'new-game': '锁定信号并进入梦境节点',
  continue: '回到上一次中断的信号记录',
  options: '调整接收参数，不改变信号',
  quit: '关闭接收终端，信号保留一颗核心',
}

// 1800–2600ms budget. Each step is a rift phase, so the title, the rail and
// the cast can all key off the same single source of truth.
const TIMELINE: { at: number; phase: RiftPhase }[] = [
  { at: 0, phase: 'dark' },
  { at: 160, phase: 'thread' },
  { at: 620, phase: 'tear' },
  { at: 1080, phase: 'lock' },
  { at: 1340, phase: 'pulse' },
  { at: 1820, phase: 'decay' },
  { at: 2180, phase: 'residual' },
]

const DIAG_LINES = ['CHANNEL_SEEK', 'FRAGMENT_SCAN', 'DREAM_LOCK', 'CARRIER_HOLD', 'BURN_RATE', 'RESIDUAL_OK']

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
  const tier = usePerfTier()
  const bus = useMemo(() => new MenuSignalBus(), [])
  const [phase, setPhase] = useState<RiftPhase>('dark')
  const [introDone, setIntroDone] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [quitConfirm, setQuitConfirm] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [activeEntry, setActiveEntry] = useState<EntryId>('new-game')
  const [diagIndex, setDiagIndex] = useState(0)
  const [burnPct, setBurnPct] = useState(64)

  const quitIntent = useShellIntent('menu-title', 'menu-title')
  const optionsTriggerRef = useRef<HTMLButtonElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const navBurst = useRef<number[]>([])
  const entryRefs = useRef<Record<EntryId, HTMLButtonElement | null>>({
    'new-game': null,
    continue: null,
    options: null,
    quit: null,
  })

  const entries: EntryId[] = ['new-game', ...(hasMockSave ? (['continue'] as const) : []), 'options', 'quit']

  // ---- intro sequence --------------------------------------------------
  const finishIntro = useCallback(
    (skipped: boolean) => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
      setPhase('residual')
      setIntroDone(true)
      bus.emit('phase', 'residual')
      bus.emit('suppress', false)
      // A skip lands on the complete static end state. It never advances the
      // journey and never pretends an intent was accepted.
      if (!skipped) bus.emit('pulse', { origin: 'intro', strength: 0.45, dir: 0 })
    },
    [bus],
  )

  useEffect(() => {
    if (tier === 'reduced') {
      finishIntro(true)
      return
    }
    // A watchdog guarantees the end state even if a step is starved.
    const all = [
      ...TIMELINE.map(({ at, phase: p }) =>
        window.setTimeout(() => {
          setPhase(p)
          bus.emit('phase', p)
          if (p === 'pulse') bus.emit('pulse', { origin: 'intro', strength: 1, dir: 0 })
        }, at),
      ),
      window.setTimeout(() => finishIntro(false), 2400),
      window.setTimeout(() => {
        if (!introDone) finishIntro(true)
      }, 4200),
    ]
    timers.current = all
    return () => {
      all.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier])

  useEffect(() => {
    if (introDone) entryRefs.current['new-game']?.focus()
  }, [introDone])

  useEffect(() => () => bus.dispose(), [bus])

  useEffect(() => {
    const id = window.setInterval(() => {
      setDiagIndex((i) => (i + 1) % DIAG_LINES.length)
      setBurnPct((p) => (p >= 96 ? 43 : p + 3))
    }, 1500)
    return () => window.clearInterval(id)
  }, [])

  // ---- focus -----------------------------------------------------------
  // One entry point for every focus change so the whole cover responds
  // exactly once, with a direction, and a burst of fast input collapses into
  // a single topped-up kick instead of stacking animations.
  const moveFocus = useCallback(
    (id: EntryId, dir: -1 | 0 | 1) => {
      setActiveEntry(id)
      const now = performance.now()
      navBurst.current = [...navBurst.current.filter((t) => now - t < 700), now]
      const bursting = navBurst.current.length >= 3
      bus.emit('pulse', { origin: 'nav', strength: bursting ? 0.18 : 0.3, dir })
      if (bursting) {
        bus.emit('suppress', true)
        window.setTimeout(() => {
          if (!showSettings && !quitConfirm && !launching) bus.emit('suppress', false)
        }, 1100)
      }
    },
    [bus, showSettings, quitConfirm, launching],
  )

  const handleNav = (e: KeyboardEvent<HTMLButtonElement>, id: EntryId) => {
    const idx = entries.indexOf(id)
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      const next = entries[(idx + 1) % entries.length]
      moveFocus(next, 1)
      entryRefs.current[next]?.focus()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = entries[(idx - 1 + entries.length) % entries.length]
      moveFocus(next, -1)
      entryRefs.current[next]?.focus()
    } else if (e.key === 'Escape' && quitConfirm) {
      cancelQuit()
    }
  }

  // ---- commit paths ----------------------------------------------------
  const launch = (run: () => void) => {
    if (launching) return
    setLaunching(true)
    bus.emit('suppress', true)
    setPhase('overexposed')
    bus.emit('phase', 'overexposed')
    bus.emit('pulse', { origin: 'confirm', strength: 1, dir: 0 })
    const t = window.setTimeout(run, tier === 'reduced' ? 40 : 620)
    timers.current.push(t)
  }

  const openSettings = () => {
    setShowSettings(true)
    bus.emit('suppress', true)
    bus.emit('pulse', { origin: 'overlay', strength: 0.5, dir: 0 })
  }

  const closeSettings = () => {
    setShowSettings(false)
    bus.emit('suppress', false)
    optionsTriggerRef.current?.focus()
  }

  const cancelQuit = () => {
    setQuitConfirm(false)
    bus.emit('suppress', false)
    // signal spreads back out
    bus.emit('pulse', { origin: 'confirm', strength: 0.55, dir: 0 })
    playSfx('ui-cancel')
    entryRefs.current['quit']?.focus()
  }

  // ---- parallax --------------------------------------------------------
  const raf = useRef<number | null>(null)
  const onSceneMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = sceneRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    if (raf.current !== null) return
    raf.current = requestAnimationFrame(() => {
      raf.current = null
      const el = sceneRef.current
      if (!el) return
      el.style.setProperty('--mt-px', px.toFixed(3))
      el.style.setProperty('--mt-py', py.toFixed(3))
    })
  }, [])
  const onSceneMouseLeave = useCallback(() => {
    sceneRef.current?.style.setProperty('--mt-px', '0')
    sceneRef.current?.style.setProperty('--mt-py', '0')
  }, [])

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    },
    [],
  )

  const activeIndex = entries.indexOf(activeEntry)

  return (
    <MenuSignalContext.Provider value={bus}>
      <div
        className={`mt-scene ${introDone ? 'is-live' : 'is-intro'} ${showSettings ? 'is-dimmed' : ''} ${quitConfirm ? 'is-quitting' : ''} ${launching ? 'is-launching' : ''}`}
        data-phase={phase}
        ref={sceneRef}
        onMouseMove={onSceneMouseMove}
        onMouseLeave={onSceneMouseLeave}
      >
        {/* L0 / L1 — dark field, distant reverb, incomplete far orbits */}
        <div className="mt-field" aria-hidden="true">
          <span className="mt-field-grain" />
          <span className="mt-far-orbit mt-far-orbit-a" />
          <span className="mt-far-orbit mt-far-orbit-b" />
          <span className="mt-far-arc" />
          <span className="mt-reverb" />
        </div>

        {/* L1.5 — full-page investigation material and preserved radial guide */}
        <MenuDreamField />

        {/* L2 — roaming cast (pointer-events: none except each actor's own
            small hit target, so it can never steal a menu click or Tab) */}
        <MenuSpriteField containerRef={sceneRef} />

        {/* L3 — the main event */}
        <MenuSignalRift phase={phase} tier={tier} />

        {onPlayFullRun && (
          <div className="mt-toolbar">
            <button className="mt-toolbar-btn" onClick={onPlayFullRun}>
              <Play size={12} />
              <span>播放完整入局流程</span>
            </button>
          </div>
        )}

        {/* L4 — title + command rail on the left positioning line */}
        <div className="mt-content">
          <div className="mt-signature">
            <span className="mt-sig-tick" aria-hidden="true" />
            <span>CHANNEL 07 // 梦境接收</span>
          </div>

          <div className="mt-title-kicker" aria-label="2036 / dreamless sleep">
            <span className="mt-title-year">2036</span>
            <span className="mt-title-kicker-line" aria-hidden="true" />
            <span className="mt-title-kicker-copy">DREAMLESS SLEEP // ARCHIVE 07</span>
          </div>

          <h1 className="mt-title">
            <span className="mt-title-cn" lang="zh-CN">
              <span className="mt-title-cn-ghost" aria-hidden="true">起床</span>
              <span className="mt-title-cn-solid">起床</span>
              <span className="mt-title-exclaim" aria-hidden="true">！</span>
            </span>
            <span className="mt-title-en" lang="en">
              <span>Wake Up</span><span className="mt-title-en-exclaim" aria-hidden="true">!</span>
            </span>
          </h1>

          <p className="mt-title-memory">
            <span>请务必记住，您一夜无梦。</span>
            <span>Remember, you had a dreamless sleep.</span>
          </p>

          <nav className="mt-rail" aria-label="主菜单" style={{ '--mt-active': activeIndex } as React.CSSProperties}>
            <span className="mt-rail-line" aria-hidden="true" />
            <span className="mt-rail-marker" aria-hidden="true" />

            {entries.map((id, i) => {
              const disabled = id === 'continue' && !hasMockSave
              if (id === 'quit' && quitConfirm) {
                return (
                  <motion.div
                    key="quit-confirm"
                    className="mt-protocol"
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: 0.22 }}
                  >
                    <span className="mt-protocol-label">确认关闭接收终端？</span>
                    {quitIntent.state.phase !== 'idle' && (
                      <span
                        className={`mt-protocol-feedback is-${quitIntent.state.phase}`}
                        role={quitIntent.state.phase === 'pending' || quitIntent.state.phase === 'rejected' ? 'status' : undefined}
                        aria-live="polite"
                      >
                        {quitIntent.state.message}
                      </span>
                    )}
                    <div className="mt-protocol-actions">
                      <button
                        className="mt-protocol-btn is-confirm"
                        disabled={quitIntent.isPending}
                        onClick={async () => {
                          playSfx('ui-confirm')
                          const result = await quitIntent.dispatch('menu.quit.confirm', 'control-panel-main')
                          if (result.outcome === 'accepted') {
                            setQuitConfirm(false)
                            bus.emit('suppress', false)
                          }
                        }}
                      >
                        {quitIntent.isPending ? '提交中…' : <><Check size={13} /> 确认</>}
                      </button>
                      <button className="mt-protocol-btn" onClick={cancelQuit} autoFocus>
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
                  className={`mt-cmd ${disabled ? 'is-disabled' : ''} ${activeEntry === id ? 'is-active' : ''}`}
                  disabled={disabled}
                  style={{ '--mt-i': i } as React.CSSProperties}
                  onKeyDown={(e) => handleNav(e, id)}
                  onMouseEnter={() => {
                    if (disabled) return
                    moveFocus(id, 0)
                    playSfx('ui-hover')
                  }}
                  onFocus={() => {
                    if (disabled) return
                    moveFocus(id, 0)
                    playSfx('ui-focus')
                  }}
                  onClick={() => {
                    if (disabled) return
                    playSfx('ui-confirm')
                    if (id === 'new-game') launch(onNewGame)
                    else if (id === 'continue') launch(onContinue)
                    else if (id === 'options') openSettings()
                    else if (id === 'quit') {
                      setQuitConfirm(true)
                      bus.emit('suppress', true)
                    }
                  }}
                >
                  <span className="mt-cmd-idx" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <span className="mt-cmd-cursor" aria-hidden="true" />
                  <span className="mt-cmd-label">{LABELS[id]}</span>
                  <span className="mt-cmd-line" aria-hidden="true" />
                </button>
              )
            })}
          </nav>
        </div>

        {/* L5 — diagnostics and input feedback */}
        <div className="mt-readout" aria-hidden="true">
          <span className="mt-readout-cmd">{DIAG_LINES[diagIndex]}</span>
          <span className="mt-readout-bar"><i style={{ width: `${burnPct}%` }} /></span>
          <span className="mt-readout-val">{burnPct}%</span>
        </div>
        <p className="mt-hintline" aria-live="polite">
          <span className="mt-hint-key">↑ ↓</span>
          <span className="mt-hint-copy">{HINTS[activeEntry]}</span>
        </p>

        {/* L6 — intro skip, launch wipe, overlays */}
        <AnimatePresence>
          {!introDone && tier !== 'reduced' && (
            <motion.button
              className="mt-skip"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => finishIntro(true)}
            >
              <SkipForward size={12} /> 跳过进入序列
            </motion.button>
          )}
        </AnimatePresence>

        {launching && <span className="mt-wipe" aria-hidden="true" />}

        <AnimatePresence>{showSettings && <SettingsPanel onClose={closeSettings} />}</AnimatePresence>
      </div>
    </MenuSignalContext.Provider>
  )
}
