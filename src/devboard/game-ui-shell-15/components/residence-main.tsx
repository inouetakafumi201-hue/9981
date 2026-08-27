'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive,
  BedDouble,
  BookOpen,
  Cpu,
  LogOut,
  Radar,
  Settings2,
  StickyNote,
  Swords,
  Tv,
  X,
} from 'lucide-react'
import { SettingsPanel } from './settings-panel'
import { NoticeBroadcast } from './notice-broadcast'
import { UtilitySafe } from './utility-safe'
import { KeyedSpriteImage } from './keyed-sprite-image'
import { playSfx } from '@/lib/audio-slot'

type BedId = 'bed-a' | 'bed-b' | 'bed-c'
// anchor state machine: idle (not linked) -> ready (linked, no match) ->
// matching -> complete | timeout | failed, with matching remaining
// roam-compatible the whole time (it is a status ribbon, not a modal lock).
type AnchorState = 'idle' | 'ready' | 'matching' | 'complete' | 'timeout' | 'failed'
type OverlayId = 'anchor' | 'desk' | 'pod' | 'computer' | 'bookshelf' | 'safe' | 'note'

export type ResidencePosition = { x: number; y: number }

const DEFAULT_SPAWN: ResidencePosition = { x: 52, y: 82 }
const FLOOR_BOUNDS = { minX: 8, maxX: 94, minY: 40, maxY: 91 }
const MOVE_SPEED = 30 // percent of scene size per second

// Nodes are placed in the same percentage space the player moves through.
// Bed A is the only node that gates on proximity (front-ready has to be a
// spatial fact, not a click-from-anywhere action); everything else stays a
// click/tap hotspot per the port-only scope.
const BEDS: { id: BedId; label: string; tone: 'blue' | 'coral' | 'cyan'; left: number; top: number }[] = [
  { id: 'bed-c', label: '床 C · 自测', tone: 'cyan', left: 22.5, top: 40 },
  { id: 'bed-b', label: '床 B · 后置', tone: 'coral', left: 21, top: 58 },
  { id: 'bed-a', label: '床 A · 竞技', tone: 'blue', left: 18, top: 75 },
]
const BED_A_RADIUS = 11 // percent distance at which "front-ready" engages

const OVERLAY_COPY: Record<Exclude<OverlayId, 'anchor'>, { title: string; body: string }> = {
  desk: { title: '研究台', body: '堆满笔记与残页的工作台，占位入口——内部面板尚未展开。' },
  pod: { title: '造梦舱', body: '半开合的浮力座舱，用于长时间造梦准备，占位入口。' },
  computer: { title: '终端电脑', body: '接入残存网络节点的老式终端，占位入口——内部面板尚未展开。' },
  bookshelf: { title: '书架', body: '收集来的档案与图鉴散落其间，占位入口。' },
  safe: { title: '保险箱', body: '锁死的金属保险箱，内容未知，占位入口。' },
  note: { title: '门缝纸条', body: '"水电费已经交了——隔壁的敲门声最近变多了，小心点。"' },
}

function dist(a: ResidencePosition, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(q.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    q.addEventListener('change', onChange)
    return () => q.removeEventListener('change', onChange)
  }, [])
  return reduced
}

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

// Keyboard-driven roam controller. Runs a rAF loop while any movement key is
// held, independent of whatever overlay/panel state the rest of the scene is
// in — matching status, anchor panel, and notices must never freeze this.
function useRoamController(
  spawn: ResidencePosition,
  enabled: boolean,
  reducedMotion: boolean,
) {
  const [position, setPosition] = useState<ResidencePosition>(spawn)
  const [facing, setFacing] = useState<'left' | 'right'>('right')
  const [moving, setMoving] = useState(false)
  const pressed = useRef<Set<string>>(new Set())
  const raf = useRef<number | null>(null)
  const lastTs = useRef<number | null>(null)
  const positionRef = useRef(position)
  positionRef.current = position

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!MOVE_KEYS.has(k)) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      pressed.current.add(k)
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.current.delete(e.key.toLowerCase())
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      pressed.current.clear()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const tick = (ts: number) => {
      const dt = lastTs.current == null ? 0 : Math.min(0.05, (ts - lastTs.current) / 1000)
      lastTs.current = ts
      const keys = pressed.current
      let dx = 0
      let dy = 0
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1
      if (keys.has('d') || keys.has('arrowright')) dx += 1
      if (keys.has('w') || keys.has('arrowup')) dy -= 1
      if (keys.has('s') || keys.has('arrowdown')) dy += 1
      const isMoving = dx !== 0 || dy !== 0
      if (isMoving) {
        const len = Math.hypot(dx, dy) || 1
        const stepX = (dx / len) * MOVE_SPEED * dt
        const stepY = (dy / len) * MOVE_SPEED * dt * 0.62 // room reads in a shallow top-down perspective
        setPosition((p) => ({
          x: Math.min(FLOOR_BOUNDS.maxX, Math.max(FLOOR_BOUNDS.minX, p.x + stepX)),
          y: Math.min(FLOOR_BOUNDS.maxY, Math.max(FLOOR_BOUNDS.minY, p.y + stepY)),
        }))
        if (dx > 0) setFacing('right')
        else if (dx < 0) setFacing('left')
      }
      setMoving(isMoving)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      lastTs.current = null
    }
  }, [enabled])

  const nudgeTo = useCallback((next: ResidencePosition) => {
    setPosition({
      x: Math.min(FLOOR_BOUNDS.maxX, Math.max(FLOOR_BOUNDS.minX, next.x)),
      y: Math.min(FLOOR_BOUNDS.maxY, Math.max(FLOOR_BOUNDS.minY, next.y)),
    })
  }, [])

  return { position, facing, moving: moving && !reducedMotion, moving_raw: moving, nudgeTo }
}

export function ResidenceMain({
  spawnAt,
  onEnterDream,
  onExit,
}: {
  spawnAt?: ResidencePosition | null
  onEnterDream?: (origin: ResidencePosition) => void
  onExit?: () => void
}) {
  const reducedMotion = useReducedMotion()
  const { position: playerPos, facing, moving, nudgeTo } = useRoamController(
    spawnAt ?? DEFAULT_SPAWN,
    true,
    reducedMotion,
  )

  const [showSettings, setShowSettings] = useState(false)
  const [anchorState, setAnchorState] = useState<AnchorState>('idle')
  const [overlay, setOverlay] = useState<OverlayId | null>(null)
  const [showNotice, setShowNotice] = useState(false)
  const [bedAReadyPromptOpen, setBedAReadyPromptOpen] = useState(false)
  const [bedCSelfTest, setBedCSelfTest] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const matchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeoutGuard = useRef<ReturnType<typeof setTimeout> | null>(null)

  const bedALit = anchorState === 'complete'
  const bedAPos = BEDS.find((b) => b.id === 'bed-a')!
  const nearBedA = dist(playerPos, { x: bedAPos.left, y: bedAPos.top }) <= BED_A_RADIUS

  useEffect(() => {
    if (bedALit && nearBedA) setBedAReadyPromptOpen(true)
    else setBedAReadyPromptOpen(false)
  }, [bedALit, nearBedA])

  useEffect(() => {
    return () => {
      if (matchTimer.current) clearTimeout(matchTimer.current)
      if (timeoutGuard.current) clearTimeout(timeoutGuard.current)
    }
  }, [])

  const announce = useCallback((msg: string) => setLiveMessage(msg), [])

  const startCompetitiveMatch = () => {
    if (anchorState !== 'ready') return
    setAnchorState('matching')
    announce('竞技匹配已开始，可继续在房间内漫游。')
    playSfx('matchmaking-tick')
    matchTimer.current = setTimeout(() => {
      setAnchorState('complete')
      announce('匹配完成，床A已点亮。')
      playSfx('matchmaking-found')
    }, 2200)
    // defensive safety net so a stalled mock resolves to a legible timeout
    // state instead of hanging in "matching" forever.
    timeoutGuard.current = setTimeout(() => {
      setAnchorState((s) => {
        if (s !== 'matching') return s
        announce('匹配超时（mock），可重试或取消。')
        return 'timeout'
      })
    }, 12000)
  }

  const cancelMatch = () => {
    if (matchTimer.current) clearTimeout(matchTimer.current)
    if (timeoutGuard.current) clearTimeout(timeoutGuard.current)
    setAnchorState('ready')
    playSfx('match-cancel')
    announce('已取消匹配。')
  }

  const retryMatch = () => {
    setAnchorState('ready')
    announce('已返回锚定导流仪，可重新发起匹配。')
  }

  const closeSettings = () => {
    setShowSettings(false)
    settingsTriggerRef.current?.focus()
  }

  const confirmBedAReady = () => {
    playSfx('bed-select')
    announce('已在床A就绪，准备进入造梦。')
    onEnterDream?.(playerPos)
  }

  const cancelBedAReady = () => {
    playSfx('ui-cancel')
    nudgeTo({ x: playerPos.x, y: Math.min(FLOOR_BOUNDS.maxY, playerPos.y + 6) })
  }

  return (
    <div className="rm-scene">
      <img src="/games/residence/residence-room.png" alt="" className="rm-scene-img" crossOrigin="anonymous" />
      <div className="rm-scene-tint" aria-hidden="true" />

      <div aria-live="polite" className="sr-only">{liveMessage}</div>

      <div className="rm-corner-controls">
        <button className="rm-corner-btn" aria-label="离开出租屋" onClick={onExit}>
          <LogOut size={15} />
        </button>
        <button
          ref={settingsTriggerRef}
          className="rm-corner-btn"
          aria-label="打开设置"
          onClick={() => setShowSettings(true)}
        >
          <Settings2 size={15} />
        </button>
      </div>

      <div className="rm-topline">
        <span className="kicker">驻地</span>
        <span className="rm-hint">WASD / 方向键 漫游 · Enter 就绪</span>
      </div>

      {/* Bed A: locked until the anchor projection confirms the match, then
          lit; front-ready only engages once the player has actually walked
          into range, never from a bare click. */}
      {BEDS.map((bed) => {
        if (bed.id === 'bed-a') {
          return (
            <button
              key={bed.id}
              className={`rm-bed rm-bed-blue ${bedALit ? 'is-ready' : 'is-locked'}`}
              style={{ left: `${bed.left}%`, top: `${bed.top}%` }}
              disabled={!bedALit}
              aria-disabled={!bedALit}
              aria-describedby="bed-a-desc"
              onMouseEnter={() => bedALit && playSfx('ui-hover')}
              onClick={() => {
                if (!bedALit) {
                  playSfx('bed-locked')
                  announce('床A仍锁定，先在锚定导流仪完成竞技匹配。')
                  return
                }
                nudgeTo({ x: bed.left, y: bed.top + 8 })
              }}
            >
              <BedDouble size={16} />
              <span>{bed.label}</span>
              <span id="bed-a-desc" className="sr-only">
                {bedALit ? '竞技装载入口，已点亮，可前往就绪' : '竞技装载入口，锁定中，需先完成锚定导流仪的竞技匹配'}
              </span>
            </button>
          )
        }
        if (bed.id === 'bed-b') {
          return (
            <button
              key={bed.id}
              className="rm-bed rm-bed-coral is-deferred"
              style={{ left: `${bed.left}%`, top: `${bed.top}%` }}
              aria-disabled="true"
              tabIndex={-1}
              aria-describedby="bed-b-desc"
              onClick={() => {
                playSfx('bed-locked')
                announce('床B，联机副本内容，后置开发，目前不可用。')
              }}
            >
              <BedDouble size={16} />
              <span>{bed.label}</span>
              <span className="rm-bed-badge">后置</span>
              <span id="bed-b-desc" className="sr-only">床B，联机副本入口，后置开发，目前不可用</span>
            </button>
          )
        }
        return (
          <button
            key={bed.id}
            className="rm-bed rm-bed-cyan is-selftest"
            style={{ left: `${bed.left}%`, top: `${bed.top}%` }}
            aria-describedby="bed-c-desc"
            onMouseEnter={() => playSfx('ui-hover')}
            onClick={() => {
              setBedCSelfTest(true)
              playSfx('ui-confirm')
            }}
          >
            <BedDouble size={16} />
            <span>{bed.label}</span>
            <span id="bed-c-desc" className="sr-only">床C，自建梦自测入口，不可入局</span>
          </button>
        )
      })}

      <AnimatePresence>
        {bedAReadyPromptOpen && (
          <motion.div
            className="rm-ready-prompt"
            style={{ left: '18%', top: '68%' }}
            initial={{ opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.94 }}
            role="alertdialog"
            aria-label="床A竞技装载准备"
          >
            <p>竞技装载准备 · 场景：夜班走廊（mock）</p>
            <div className="rm-ready-actions">
              <button
                className="rm-ready-confirm"
                onClick={confirmBedAReady}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') confirmBedAReady()
                }}
                autoFocus
              >
                确认就绪
              </button>
              <button
                className="rm-ready-cancel"
                onClick={cancelBedAReady}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelBedAReady()
                }}
              >
                取消
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shadow lobby: ready participants from the match projection, rendered
          as translucent silhouettes layered into the same room — never a
          scene reload or a separate lobby screen. */}
      <AnimatePresence>
        {anchorState === 'complete' && (
          <motion.div
            className="rm-shadow-lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {[{ id: 's1', left: 12, top: 70 }, { id: 's2', left: 26, top: 71 }].map((s) => (
              <motion.div
                key={s.id}
                className="rm-shadow-figure"
                style={{ left: `${s.left}%`, top: `${s.top}%` }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <span className="rm-shadow-body" aria-hidden="true" />
                <span className="rm-shadow-label">就绪</span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player avatar — the same detective portrait frame used on the title
          screen, driven here as a roam figure instead of the sleep-cycle
          state machine: footing bob + directional flip stand in for a walk
          cycle since there is no dedicated walk sheet yet. */}
      <motion.div
        className={`rm-player ${moving ? 'is-moving' : 'is-idle'} ${facing === 'left' ? 'is-facing-left' : 'is-facing-right'}`}
        style={{ left: `${playerPos.x}%`, top: `${playerPos.y}%` }}
        transition={{ type: 'tween', duration: 0.05 }}
      >
        <span className="rm-player-shadow" aria-hidden="true" />
        {/* The source frame still ships on a magenta backing plate, so it is
            run through the same chroma-key pass the title screen uses
            (lib/chroma-key.ts) rather than painted onto the map as-is. */}
        <KeyedSpriteImage src="/games/menu/detective/f01.png" className="rm-player-frame" />
        {moving && !reducedMotion && <span className="rm-player-dust" aria-hidden="true" />}
      </motion.div>

      <button
        className={`rm-hotspot rm-hotspot-anchor ${anchorState === 'matching' ? 'is-matching' : ''}`}
        style={{ left: '73%', top: '33%' }}
        onClick={() => setOverlay('anchor')}
        onMouseEnter={() => playSfx('ui-hover')}
        aria-label="锚定导流仪"
      >
        <Radar size={14} />
      </button>
      <button className="rm-hotspot" style={{ left: '58%', top: '55%' }} onClick={() => setOverlay('desk')} onMouseEnter={() => playSfx('ui-hover')} aria-label="研究台">
        <BookOpen size={14} />
      </button>
      <button className="rm-hotspot" style={{ left: '77%', top: '59%' }} onClick={() => setOverlay('pod')} onMouseEnter={() => playSfx('ui-hover')} aria-label="造梦舱">
        <Archive size={14} />
      </button>
      <button className="rm-hotspot" style={{ left: '55%', top: '52%' }} onClick={() => setOverlay('computer')} onMouseEnter={() => playSfx('ui-hover')} aria-label="电脑">
        <Cpu size={14} />
      </button>
      <button className="rm-hotspot" style={{ left: '91%', top: '57%' }} onClick={() => setOverlay('bookshelf')} onMouseEnter={() => playSfx('ui-hover')} aria-label="书架">
        <BookOpen size={14} />
      </button>
      <button className="rm-hotspot" style={{ left: '88%', top: '77%' }} onClick={() => setOverlay('safe')} onMouseEnter={() => playSfx('ui-hover')} aria-label="保险箱">
        <Archive size={14} />
      </button>
      <button className="rm-hotspot" style={{ left: '60%', top: '21%' }} onClick={() => setOverlay('note')} onMouseEnter={() => playSfx('ui-hover')} aria-label="门缝纸条">
        <StickyNote size={14} />
      </button>
      <button
        className={`rm-hotspot rm-hotspot-tv ${showNotice ? 'is-active' : ''}`}
        style={{ left: '51%', top: '32%' }}
        onClick={() => setShowNotice((v) => !v)}
        onMouseEnter={() => playSfx('ui-hover')}
        aria-label={showNotice ? '关闭公告' : '查看电视公告'}
        aria-pressed={showNotice}
      >
        <Tv size={14} />
      </button>

      {anchorState === 'matching' && (
        <div className="rm-match-ribbon" role="status">
          <span className="rm-match-spinner" aria-hidden="true" />
          竞技匹配中… 可继续漫游
          <button className="rm-match-ribbon-cancel" onClick={cancelMatch}>取消</button>
        </div>
      )}
      {anchorState === 'timeout' && (
        <div className="rm-match-ribbon is-error" role="status">
          匹配超时（mock）
          <button className="rm-match-ribbon-cancel" onClick={retryMatch}>重试</button>
        </div>
      )}
      {anchorState === 'failed' && (
        <div className="rm-match-ribbon is-error" role="status">
          匹配失败（mock）
          <button className="rm-match-ribbon-cancel" onClick={retryMatch}>重试</button>
        </div>
      )}

      <div className="rm-notice-slot">
        <AnimatePresence>
          {showNotice && <NoticeBroadcast variant="announcement" onClose={() => setShowNotice(false)} />}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {overlay && overlay !== 'anchor' && overlay !== 'safe' && (
          <motion.div
            className="rm-overlay-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOverlay(null)}
          >
            <motion.div
              className="rm-overlay-card"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rm-overlay-head">
                <span>{OVERLAY_COPY[overlay].title}</span>
                <button aria-label="关闭" onClick={() => setOverlay(null)}><X size={14} /></button>
              </div>
              <p>{OVERLAY_COPY[overlay].body}</p>
            </motion.div>
          </motion.div>
        )}

        {overlay === 'safe' && (
          <motion.div
            className="rm-overlay-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOverlay(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
            >
              <UtilitySafe onClose={() => setOverlay(null)} />
            </motion.div>
          </motion.div>
        )}

        {overlay === 'anchor' && (
          <motion.div
            className="rm-overlay-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOverlay(null)}
          >
            <motion.div
              className="rm-overlay-card rm-anchor-card"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rm-overlay-head">
                <span>锚定导流仪</span>
                <button aria-label="关闭" onClick={() => setOverlay(null)}><X size={14} /></button>
              </div>

              {anchorState === 'idle' ? (
                <>
                  <p>建立连接以解锁本轮竞技匹配。</p>
                  <button
                    className="rm-anchor-link-btn"
                    onClick={() => {
                      setAnchorState('ready')
                      playSfx('ui-confirm')
                      announce('锚定导流仪已连接，竞技模式可用。')
                    }}
                  >
                    <Radar size={14} /> 建立连接
                  </button>
                </>
              ) : (
                <>
                  <div className="rm-mode-row">
                    <span className="rm-mode-chip is-active"><Swords size={12} /> 竞技</span>
                  </div>
                  <div className="rm-status-summary">
                    <span>信号稳定</span>
                    <span>·</span>
                    <span>延迟 42ms</span>
                  </div>
                  {anchorState === 'ready' && (
                    <button className="rm-anchor-link-btn" onClick={startCompetitiveMatch}>
                      发起匹配
                    </button>
                  )}
                  {anchorState === 'matching' && (
                    <div className="rm-matchmaking">
                      <span className="rm-matchmaking-spinner" />
                      匹配中，可关闭面板继续漫游…
                      <button className="rm-anchor-cancel-btn" onClick={cancelMatch}>取消匹配</button>
                    </div>
                  )}
                  {anchorState === 'complete' && (
                    <div className="rm-matchmaking is-found">
                      匹配完成 — 床A已点亮
                    </div>
                  )}
                  {(anchorState === 'timeout' || anchorState === 'failed') && (
                    <div className="rm-matchmaking is-error">
                      {anchorState === 'timeout' ? '匹配超时（mock）' : '匹配失败（mock）'}
                      <button className="rm-anchor-cancel-btn" onClick={retryMatch}>重试</button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bedCSelfTest && (
          <motion.div
            className="rm-overlay-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setBedCSelfTest(false)}
          >
            <motion.div
              className="rm-overlay-card"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rm-overlay-head">
                <span>床C · 自测</span>
                <button aria-label="关闭" onClick={() => setBedCSelfTest(false)}><X size={14} /></button>
              </div>
              <p>自建梦的开发期自测端口，仅用于校验自建内容——不可入局，也不会进入正式竞技装载流程。</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{showSettings && <SettingsPanel onClose={closeSettings} />}</AnimatePresence>
    </div>
  )
}
