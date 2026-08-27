'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, Home, Loader2, Play, RotateCcw, Settings2, X } from 'lucide-react'
import { BattleHud } from './battle-hud'
import { SettingsPanel } from './settings-panel'
import { playSfx } from '@/lib/audio-slot'
import { createIntent, submitIntent, type IntentStatus } from '@/lib/b1-contract'

type EntryId = 'resume' | 'settings' | 'restart' | 'title'
type ConfirmId = 'restart' | 'title'
// 与 result-rendered 对应：intent 已发出但还没有被接受/拒绝/超时之前，
// 一切确认演出都不能播放——这是 mock 投影的最小生命周期。
type RequestPhase = { status: 'pending' } | { status: IntentStatus; reason?: string }

const ICONS: Record<EntryId, typeof Play> = {
  resume: Play,
  settings: Settings2,
  restart: RotateCcw,
  title: Home,
}

const LABELS: Record<EntryId, string> = {
  resume: '继续',
  settings: '设置',
  restart: '重新开始',
  title: '返回标题',
}

const CONFIRM_COPY: Record<ConfirmId, { label: string; intentRequest: 'pause.request-restart' | 'pause.request-return-title'; intentConfirm: 'pause.confirm-restart' | 'pause.confirm-return-title' }> = {
  restart: { label: '确认重新开始？进度将丢失。', intentRequest: 'pause.request-restart', intentConfirm: 'pause.confirm-restart' },
  title: { label: '确认返回标题？', intentRequest: 'pause.request-return-title', intentConfirm: 'pause.confirm-return-title' },
}

const ENTRIES: EntryId[] = ['resume', 'settings', 'restart', 'title']

/**
 * Self-contained demo: mounts a non-interactive, desaturated BattleHud as the
 * "frozen world" behind the pause panel. Zero coupling to battle-hud.tsx — no
 * new props, no shared state — the freeze is purely a CSS class toggled on
 * this wrapper.
 *
 * Restart / return-to-title both go through a real two-step mock intent
 * lifecycle (request-confirm → confirm → pending → accepted/rejected/timeout)
 * instead of resolving locally on click, per B4-01 §4/§7/§12.
 */
export function MenuPause({ onClose }: { onClose?: () => void } = {}) {
  const [paused, setPaused] = useState(true)
  const [confirm, setConfirm] = useState<ConfirmId | null>(null)
  const [phase, setPhase] = useState<RequestPhase | null>(null)
  const [activeEntry, setActiveEntry] = useState<EntryId>('resume')
  const [showSettings, setShowSettings] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [routed, setRouted] = useState<ConfirmId | null>(null)
  const entryRefs = useRef<Record<EntryId, HTMLButtonElement | null>>({
    resume: null,
    settings: null,
    restart: null,
    title: null,
  })
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const resume = useCallback(async () => {
    setResuming(true)
    const result = await submitIntent(createIntent('pause.continue', {}, 'menu-pause'))
    setResuming(false)
    // resuming 只在 pause.continue 被 accepted 后才真正进入 world-active；
    // 本地取消动画不能代表世界已恢复。
    if (result.status !== 'accepted') return
    playSfx('menu-close')
    setPaused(false)
    onClose?.()
  }, [onClose])

  const closeConfirm = useCallback(() => {
    setConfirm(null)
    setPhase(null)
    playSfx('ui-cancel')
  }, [])

  // Esc toggles pause; when a confirm row is open, Esc backs out of it first.
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showSettings) return
      if (confirm) {
        closeConfirm()
        return
      }
      if (paused) void resume()
      else {
        setPaused(true)
        playSfx('menu-open')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paused, confirm, showSettings, resume, closeConfirm])

  useEffect(() => {
    if (confirm) confirmBtnRef.current?.focus()
  }, [confirm])

  const focusEntry = (id: EntryId) => entryRefs.current[id]?.focus()

  const handleNav = (e: KeyboardEvent<HTMLButtonElement>, id: EntryId) => {
    const idx = ENTRIES.indexOf(id)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusEntry(ENTRIES[(idx + 1) % ENTRIES.length])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusEntry(ENTRIES[(idx - 1 + ENTRIES.length) % ENTRIES.length])
    }
  }

  const closeSettings = () => {
    setShowSettings(false)
    settingsTriggerRef.current?.focus()
  }

  const requestConfirm = async (id: ConfirmId) => {
    // 打开确认态本身也是一次 intent（"我想看到确认框"），不是本地弹窗。
    await submitIntent(createIntent(CONFIRM_COPY[id].intentRequest, {}, 'menu-pause'))
    setConfirm(id)
    setPhase(null)
  }

  const submitConfirm = async (id: ConfirmId, demoFailure?: 'rejected' | 'timeout') => {
    setPhase({ status: 'pending' })
    const result = await submitIntent(createIntent(CONFIRM_COPY[id].intentConfirm, { demoFailure: demoFailure ?? '' }, 'menu-title'))
    if (result.status === 'accepted') {
      setPhase({ status: 'accepted' })
      playSfx('ui-confirm')
      // 只有 accepted 之后才播放"路由已发生"的最终演出；这里用短暂延迟
      // 模拟投影切场景，随后交回上层（宿主）处理真正的场景切换。
      window.setTimeout(() => setRouted(id), 420)
      return
    }
    setPhase({ status: result.status, reason: result.reason })
    playSfx('ui-cancel')
  }

  const routedCopy = routed === 'restart' ? '已确认重新开始（mock projection）' : '已确认返回标题（mock projection）'

  return (
    <div className="mp-demo-stage">
      <div className={`mp-world ${paused ? 'mp-world-frozen' : ''}`} aria-hidden={paused}>
        <BattleHud variant="Default" />
      </div>

      <AnimatePresence>
        {paused && (
          <motion.div
            className="mp-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              className="mp-panel"
              role="dialog"
              aria-modal="true"
              aria-label="暂停菜单"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <svg className="mp-panel-frame" aria-hidden="true">
                <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" className="mp-panel-frame-rect" />
              </svg>

              <div className="mp-panel-head">
                <span className="mp-panel-kicker">SYS://PAUSE.PROTOCOL <span className="mock-tag">MOCK</span></span>
                <h2 className="mp-panel-title">{routed ? routedCopy : '已暂停'}</h2>
              </div>

              {routed ? (
                <div className="mp-routed-region" role="status" aria-live="polite">
                  <Loader2 size={16} className="mp-routed-spin" />
                  <span>正在切换场景（演示环境不会真正重启或跳转）…</span>
                </div>
              ) : (
                <nav className="mp-entries" aria-label="Pause menu">
                  <span
                    className="mp-entry-indicator"
                    style={{ transform: `translateY(${ENTRIES.indexOf(activeEntry) * 100}%)` }}
                    aria-hidden="true"
                  />
                  {ENTRIES.map((id, i) => {
                    const Icon = ICONS[id]

                    if ((id === 'restart' || id === 'title') && confirm === id) {
                      const busy = phase?.status === 'pending'
                      const failed = phase && phase.status !== 'pending' && phase.status !== 'accepted'
                      return (
                        <motion.div
                          key={`${id}-confirm`}
                          className="mp-quit-confirm"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <span className="mp-quit-confirm-label">{CONFIRM_COPY[id].label}</span>
                          {failed && (
                            <span className="mp-quit-confirm-error" role="alert">
                              <AlertTriangle size={12} />
                              {phase.status === 'rejected' && `已拒绝：${phase.reason ?? 'MOCK_REJECTED'}`}
                              {phase.status === 'timeout' && `请求超时：${phase.reason ?? 'MOCK_TIMEOUT'}`}
                              {phase.status === 'cancelled' && '已取消'}
                              {phase.status === 'stale' && '版本已过期，请重试'}
                            </span>
                          )}
                          <div className="mp-quit-confirm-actions">
                            <button
                              ref={confirmBtnRef}
                              className="mp-quit-confirm-btn is-confirm"
                              disabled={busy}
                              onClick={() => void submitConfirm(id, failed ? undefined : undefined)}
                            >
                              {busy ? <Loader2 size={13} className="mp-routed-spin" /> : <Check size={13} />}
                              {busy ? '提交中…' : failed ? '重试' : '确认'}
                            </button>
                            <button
                              className="mp-quit-confirm-btn"
                              disabled={busy}
                              onClick={closeConfirm}
                            >
                              <X size={13} /> 取消
                            </button>
                          </div>
                        </motion.div>
                      )
                    }

                    return (
                      <motion.button
                        key={id}
                        ref={(el) => {
                          entryRefs.current[id] = el
                          if (id === 'settings') settingsTriggerRef.current = el
                        }}
                        className={`mp-entry ${activeEntry === id ? 'is-active' : ''}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + i * 0.05, duration: 0.25 }}
                        disabled={resuming}
                        onKeyDown={(e) => handleNav(e, id)}
                        onMouseEnter={() => {
                          setActiveEntry(id)
                          playSfx('ui-hover')
                        }}
                        onFocus={() => {
                          setActiveEntry(id)
                          playSfx('ui-focus')
                        }}
                        onClick={() => {
                          playSfx('ui-confirm')
                          if (id === 'resume') void resume()
                          else if (id === 'settings') setShowSettings(true)
                          else void requestConfirm(id)
                        }}
                      >
                        {id === 'resume' && resuming ? <Loader2 size={16} className="mp-entry-icon mp-routed-spin" /> : <Icon size={16} className="mp-entry-icon" />}
                        <span className="mp-entry-label">{id === 'resume' && resuming ? '提交中…' : LABELS[id]}</span>
                      </motion.button>
                    )
                  })}
                </nav>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!paused && (
        <button
          className="mp-reopen"
          onClick={() => {
            setPaused(true)
            setRouted(null)
            setConfirm(null)
            setPhase(null)
            playSfx('menu-open')
          }}
        >
          <Play size={13} /> 重新暂停（演示）
        </button>
      )}

      {showSettings && <SettingsPanel onClose={closeSettings} />}
    </div>
  )
}
