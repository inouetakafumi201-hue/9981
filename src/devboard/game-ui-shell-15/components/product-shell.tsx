'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, ChevronRight, FlaskConical, Gauge, Loader2, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { StartupLoading } from '@/components/startup-loading'
import { MenuTitle } from '@/components/menu-title'
import { ResidenceMain, type ResidencePosition } from '@/components/residence-main'
import { TransitionBattleIntro } from '@/components/transition-battle-intro'
import { TransitionDream } from '@/components/transition-dream'
import { HudMain } from '@/components/hud-main'
import { MenuPause } from '@/components/menu-pause'
import { SettingsPanel } from '@/components/settings-panel'
import { TransitionResult } from '@/components/transition-result'
import { useShellRouter } from '@/lib/shell-route'
import { getJourneyNode, JOURNEY_NODES } from '@/lib/shell-journey'
import { UiBackendProvider, useUiBackend } from '@/lib/ui-backend'
import { getWiringMode, installWiringMode, parseWiringMode, getRealUiSystem, getProjectionRevisionFn, wiringModeColor, wiringModeLabel, type WiringMode } from '@/lib/wiring-mode'

const RESIDENCE_ACTIONS: Record<string, { label: string; transitionId: string; note: string }> = {
  'residence.arrival': { label: '开始漫游', transitionId: 'residence.start-roam', note: '进入房间后，移动仍由 WASD / 方向键控制。' },
  'residence.roaming': { label: '发起竞技匹配', transitionId: 'residence.open-anchor', note: '提交 mock 匹配请求；失败时留在当前节点。' },
  'residence.matching': { label: '接收匹配完成投影', transitionId: 'residence.match-accepted', note: '模拟宿主送达 accepted-result，不由计时器推进。' },
  'residence.shadow-lobby': { label: '前往床 A', transitionId: 'residence.bed-a-approach', note: '将空间接近投影为床前就绪里程碑。' },
  'residence.bed-front-ready': { label: '确认就绪', transitionId: 'residence.bed-a-confirm', note: '确认后进入对局前奏。' },
  'residence.original-position': { label: '完成闭环', transitionId: 'original-position.fallback', note: '原位置已恢复；也可验证缺失时的安全出生点。' },
}

export function ProductShell() {
  const [wiringMode, setWiringMode] = useState<WiringMode>('mock')
  const [revision, setRevision] = useState(0)
  const ui = useUiBackend()
  const router = useShellRouter()
  const [returnOrigin, setReturnOrigin] = useState<ResidencePosition | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const currentNode = getJourneyNode(router.nodeId)
  const residenceAction = RESIDENCE_ACTIONS[router.nodeId]
  const currentNodeIndex = Math.max(0, JOURNEY_NODES.findIndex((node) => node.nodeId === router.nodeId))
  const progress = Math.round(((currentNodeIndex + 1) / JOURNEY_NODES.length) * 100)

  // H-G-16: install wiring mode at boot (reads ?wiring= param; prod forces real)
  useEffect(() => {
    const mode = parseWiringMode()
    setWiringMode(mode)
    installWiringMode(mode, ui.ui ?? null, () => revision)
  }, [ui.ui, revision])

  // H-G-2: WiringMode badge shown in panel header (rendered below)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => () => router.cancel(), [router.cancel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2' || (event.key === '`' && !event.metaKey && !event.ctrlKey && !event.altKey)) {
        event.preventDefault()
        setPanelOpen((open) => !open)
      } else if (event.key === 'Escape' && panelOpen) {
        event.preventDefault()
        setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelOpen])

  const request = useCallback((transitionId: string, parameters?: Record<string, unknown>) => {
    void router.request(transitionId, parameters)
  }, [router])

  const retry = useCallback(() => {
    if (router.transition.transitionId !== 'idle') request(router.transition.transitionId)
  }, [request, router.transition.transitionId])

  const page = useMemo(() => {
    switch (router.pageId) {
      case 'startup-loading':
        return <StartupLoading onReady={() => request('boot.enter-title')} />
      case 'menu-title':
        return <MenuTitle hasMockSave onNewGame={() => request('menu.new-game')} onContinue={() => request('menu.continue')} />
      case 'residence-main':
        return (
          <ResidenceMain
            spawnAt={router.nodeId === 'residence.original-position' ? returnOrigin : undefined}
            onEnterDream={(origin) => {
              setReturnOrigin(origin)
              request('residence.bed-a-confirm', { origin })
            }}
            onExit={() => request('residence.exit-to-title')}
          />
        )
      case 'transition-battle-intro':
        return <TransitionBattleIntro onAdvance={() => request('battle-intro.to-dream')} transition={router.transition} onRetry={retry} onSafeReturn={() => router.safeReturn()} reducedMotion={reducedMotion} />
      case 'transition-dream': {
        const returning = router.nodeId === 'transition.dream-return'
        return (
          <TransitionDream
            mode={returning ? 'return-home' : 'enter-dream'}
            advanceLabel={returning ? '回到原位置' : '接入 HUD'}
            onAdvance={() => request(returning ? 'return.to-original-position' : 'dream.to-hud', returning ? { origin: returnOrigin } : undefined)}
            transition={router.transition}
            onRetry={retry}
            onSafeReturn={() => router.safeReturn()}
            onSettled={router.notifyMotionSettled}
            reducedMotion={reducedMotion}
          />
        )
      }
      case 'hud-main':
        return <HudMain onPause={() => request('hud.pause')} onSettle={() => request('hud.to-result')} />
      case 'menu-pause':
        return <MenuPause onResume={() => request('pause.resume')} onSettings={() => request('pause.settings')} onTitle={() => request('pause.to-title')} onRestart={() => router.safeReturn('重新开始使用安全返回投影；真实重启需要宿主。')} />
      case 'utility-settings':
        return <div className="product-settings-stage"><SettingsPanel onClose={() => request('settings.back-to-pause')} /></div>
      case 'transition-result':
        return router.nodeId === 'transition.result'
          ? <TransitionResult actionLabel="查看奖励投影" onReturn={() => request('result.to-reward')} />
          : <TransitionResult rewardMode actionLabel="返回驻地" onReturn={() => request('reward.to-return')} />
      default:
        return null
    }
  }, [reducedMotion, request, retry, returnOrigin, router])

  const failed = ['rejected', 'stale', 'timeout', 'cancelled'].includes(router.transition.state)

  return (
    <UiBackendProvider>
      <main className="game-shell product-shell" data-node-id={router.nodeId}>
      <div className="game-noise" aria-hidden="true" />
      <div className="game-vignette" aria-hidden="true" />
      <section className="viewport-stage" aria-label="游戏画面">
        <div className="game-viewport-frame">
          <AnimatePresence mode="wait">
            <motion.div key={router.pageId} className="presentation" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }}>
              {page}
            </motion.div>
          </AnimatePresence>

          {router.pageId === 'residence-main' && residenceAction && (
            <aside className="journey-dock" aria-label="旅程操作">
              <span><FlaskConical size={13} /> MOCK JOURNEY</span>
              <strong>{currentNode?.label}</strong>
              <p>{residenceAction.note}</p>
              <button disabled={router.transition.state === 'pending'} onClick={() => {
                if (router.nodeId === 'residence.bed-front-ready') setReturnOrigin({ x: 18, y: 83 })
                request(residenceAction.transitionId, returnOrigin ? { origin: returnOrigin } : undefined)
              }}>
                {router.transition.state === 'pending' ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                {router.transition.state === 'pending' ? '等待确认…' : residenceAction.label}
              </button>
            </aside>
          )}

          <div className="journey-status" role="status" aria-live="polite">
            <span>{currentNode?.label ?? router.nodeId}</span>
            <code>{router.nodeId}</code>
            <small>MOCK · PROJECTION ONLY · NO HOST COMMIT</small>
            {router.transition.state === 'pending' && (
              <span className="journey-pending">
                <Loader2 className="spin" size={12} /> 请求已接受，等待投影提交
                <button type="button" onClick={router.cancel}><X size={11} />取消</button>
              </span>
            )}
          </div>

          {failed && (
            <div className="journey-failure" role="alert">
              <AlertTriangle size={18} />
              <div><strong>{router.transition.reasonCode ?? 'ROUTE_HELD'}</strong><p>{router.transition.message}</p></div>
              <button onClick={retry}><RotateCcw size={13} />重试</button>
              {router.transition.state === 'pending' ? <button onClick={router.cancel}><X size={13} />取消</button> : null}
              <button onClick={() => router.safeReturn()}><ShieldCheck size={13} />安全返回</button>
            </div>
          )}

          <button
            className="product-panel-trigger"
            type="button"
            aria-expanded={panelOpen}
            aria-controls="product-control-panel"
            onClick={() => setPanelOpen((open) => !open)}
          >
            <Gauge size={16} />
            <span>控制面板</span>
            <strong>{progress}%</strong>
          </button>

          <AnimatePresence>
            {panelOpen && (
              <motion.aside
                id="product-control-panel"
                className="product-control-panel"
                aria-label="旅程控制面板"
                initial={reducedMotion ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, x: 24 }}
              >
                <header>
                  <div>
                    <span>PRODUCT JOURNEY / MOCK</span>
                    <h2>完成进度</h2>
                  </div>
                  <button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭控制面板"><X size={17} /></button>
                </header>

                <div className="product-progress" aria-label={`旅程进度 ${progress}%`}>
                  <div style={{ width: `${progress}%` }} />
                </div>
                <div className="product-progress-meta">
                  <strong>{currentNodeIndex + 1} / {JOURNEY_NODES.length}</strong>
                  <span>{currentNode?.label}</span>
                </div>

                <p className="product-panel-note">这里显示并可调试跳转全部旅程节点。调试跳转会明确标记，不计入完整流程验收。快捷键：F2 或 `。</p>

                <nav aria-label="旅程节点">
                  {JOURNEY_NODES.map((node, index) => {
                    const active = node.nodeId === router.nodeId
                    const visited = index <= currentNodeIndex
                    return (
                      <button
                        type="button"
                        key={node.nodeId}
                        className={active ? 'is-active' : visited ? 'is-visited' : ''}
                        aria-current={active ? 'step' : undefined}
                        onClick={() => {
                          router.demoJump(node.pageId, node.nodeId)
                          setPanelOpen(false)
                        }}
                      >
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div><strong>{node.label}</strong><code>{node.nodeId}</code></div>
                        <ChevronRight size={14} />
                      </button>
                    )
                  })}
                </nav>

                <footer>
                  <span>{router.usedDemoControl ? '当前流程包含调试跳转' : '当前流程未使用调试跳转'}</span>
                  <button type="button" onClick={() => {
                    router.resetLog()
                    router.demoJump('startup-loading', 'boot.startup')
                    setPanelOpen(false)
                  }}><RotateCcw size={13} /> 从头检查</button>
                </footer>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </section>
    </main>
    </UiBackendProvider>
  )
}
