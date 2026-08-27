'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, CheckCircle2, ChevronRight, CircleDot, FlaskConical, Gauge, Loader2, Plug, PlugZap, RotateCcw, ShieldCheck, Unplug, X } from 'lucide-react'
import { StartupLoading } from '@/components/startup-loading'
import { MenuTitle } from '@/components/menu-title'
import { ResidenceMain, type ResidencePosition } from '@/components/residence-main'
import { TransitionBattleIntro } from '@/components/transition-battle-intro'
import { TransitionDream } from '@/components/transition-dream'
import { HudMain } from '@/components/hud-main'
import { MenuPause } from '@/components/menu-pause'
import { SettingsPanel } from '@/components/settings-panel'
import { TransitionResult } from '@/components/transition-result'
import { CreationPage } from '@/components/creation-page'
import { useShellRouter, type ShellRouteTransition } from '@/lib/shell-route'
import { getJourneyEdge, getJourneyNode, JOURNEY_NODES } from '@/lib/shell-journey'
import { UiBackendProvider, useUiBackend } from '@/lib/ui-backend'
import { getIntentDisplayStage, getIntentFailureGuidance, getProjectionRevisionFn, inferWiringStatus, installWiringMode, parseWiringMode, type WiringMode } from '@/lib/wiring-mode'

const RESIDENCE_ACTIONS: Record<string, { label: string; transitionId: string; note: string }> = {
  'residence.arrival': { label: '开始漫游', transitionId: 'residence.start-roam', note: '进入房间后，移动仍由 WASD / 方向键控制。' },
  'residence.roaming': { label: '发起竞技匹配', transitionId: 'residence.open-anchor', note: '提交 mock 匹配请求；失败时留在当前节点。' },
  'residence.matching': { label: '接收匹配完成投影', transitionId: 'residence.match-accepted', note: '模拟宿主送达 accepted-result，不由计时器推进。' },
  'residence.shadow-lobby': { label: '前往床 A', transitionId: 'residence.bed-a-approach', note: '将空间接近投影为床前就绪里程碑。' },
  'residence.bed-front-ready': { label: '确认就绪', transitionId: 'residence.bed-a-confirm', note: '确认后进入对局前奏。' },
  'residence.original-position': { label: '完成闭环', transitionId: 'original-position.fallback', note: '原位置已恢复；也可验证缺失时的安全出生点。' },
}

function intentLabel(transition: ShellRouteTransition) {
  const edge = getJourneyEdge(transition.transitionId)
  return edge?.actionLabel ?? transition.intentId?.replaceAll('.', ' / ') ?? '暂无活动请求'
}

function WiringStatusBadge({ mode, hasUi, error, pending }: { mode: WiringMode; hasUi: boolean; error: string | null; pending: boolean }) {
  const status = inferWiringStatus({ mode, hasUi, error, transitionPending: pending })
  const Icon = status.connection === 'connected' ? PlugZap : status.connection === 'error' ? AlertTriangle : status.connection === 'pending' ? Loader2 : status.connection === 'disconnected' ? Unplug : Plug
  return <span className={`wiring-status-badge is-${status.connection}`} title={status.detail}><Icon className={status.connection === 'pending' ? 'spin' : ''} size={12} /><b>{status.label}</b><small>{status.connection}</small></span>
}

function IntentPendingBanner({ transition, cancelling, onCancel }: { transition: ShellRouteTransition; cancelling: boolean; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - transition.startedAt)
  useEffect(() => {
    setElapsed(Date.now() - transition.startedAt)
    const id = window.setInterval(() => setElapsed(Date.now() - transition.startedAt), 250)
    return () => window.clearInterval(id)
  }, [transition.startedAt])
  const stage = getIntentDisplayStage(elapsed, false)
  const active = stage === 'accepted' ? 0 : stage === 'projecting' ? 1 : 2
  return <div className="intent-pending-banner" role="status" aria-live="polite">
    <div className="intent-pending-heading"><Loader2 className="spin" size={15} /><div><strong>{intentLabel(transition)}</strong><span>{stage === 'accepted' ? '请求已接受' : stage === 'projecting' ? '正在同步投影' : '正在渲染界面'}</span></div><time>{(elapsed / 1000).toFixed(1)}s</time></div>
    <div className="intent-stage-track" aria-label="请求进度：接受、投影、渲染">{['已接受', '投影中', '渲染中'].map((label, index) => <span key={label} className={index <= active ? 'is-active' : ''}><i />{label}</span>)}</div>
    {elapsed >= 5000 && <p className="intent-delay-note"><AlertTriangle size={12} />响应时间较长。连接仍在等待，可取消并安全返回。</p>}
    {transition.requestId && <details><summary>请求 ID</summary><code>{transition.requestId}</code></details>}
    <button type="button" disabled={cancelling} onClick={onCancel}>{cancelling ? <Loader2 className="spin" size={12} /> : <X size={12} />}{cancelling ? '正在取消…' : '取消请求'}</button>
  </div>
}

function IntentFailureAlert({ transition, pending, onRetry, onSafeReturn }: { transition: ShellRouteTransition; pending: boolean; onRetry: () => void; onSafeReturn: () => void }) {
  const guidance = getIntentFailureGuidance(transition.reasonCode)
  const cancelled = transition.state === 'cancelled'
  return <div className={`journey-failure is-${transition.state}`} role="alert">
    <AlertTriangle size={18} /><div><strong>{transition.reasonCode ?? transition.state.toUpperCase()}</strong><p>{transition.message ?? guidance.message}</p><small>{guidance.suggestion}</small>
      <details><summary>查看诊断信息</summary><pre>{JSON.stringify(transition, null, 2)}</pre></details>
    </div>
    <button disabled={pending || cancelled} onClick={onRetry}><RotateCcw size={13} />{cancelled ? '已取消' : '重试'}</button>
    <button onClick={onSafeReturn}><ShieldCheck size={13} />安全返回</button>
  </div>
}

function ActiveIntentPanel({ transition, revision, bootReady }: { transition: ShellRouteTransition; revision: number; bootReady: boolean }) {
  const terminal = transition.state !== 'pending'
  const Icon = transition.state === 'pending' ? Loader2 : ['rejected', 'stale', 'timeout', 'cancelled'].includes(transition.state) ? AlertTriangle : transition.state === 'accepted' ? CheckCircle2 : CircleDot
  return <section className="active-intent-panel" aria-labelledby="active-intent-title">
    <div className="active-intent-title"><span><Icon className={transition.state === 'pending' ? 'spin' : ''} size={14} /></span><div><small>ACTIVE INTENT STATUS</small><h3 id="active-intent-title">{intentLabel(transition)}</h3></div></div>
    <dl><div><dt>状态</dt><dd className={`is-${transition.state}`}>{transition.state}</dd></div><div><dt>投影版本</dt><dd><motion.code key={revision} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }}>{revision}</motion.code></dd></div><div><dt>启动</dt><dd className={bootReady ? 'is-ready boot-flash' : ''}>{bootReady ? '已完成' : '等待中'}</dd></div></dl>
    {transition.transitionId !== 'idle' && <details><summary>请求详情</summary><pre>{JSON.stringify({ intentId: transition.intentId, requestId: transition.requestId, transitionId: transition.transitionId, source: transition.sourceNodeId, target: transition.targetNodeId, state: transition.state, terminal }, null, 2)}</pre></details>}
  </section>
}

export function ProductShell() { return <UiBackendProvider><ProductShellContent /></UiBackendProvider> }

function ProductShellContent() {
  const [wiringMode, setWiringMode] = useState<WiringMode>('mock')
  const [revision, setRevision] = useState(0)
  const [returnOrigin, setReturnOrigin] = useState<ResidencePosition | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const ui = useUiBackend()
  const router = useShellRouter()
  const currentNode = getJourneyNode(router.nodeId)
  const residenceAction = RESIDENCE_ACTIONS[router.nodeId]
  const currentNodeIndex = Math.max(0, JOURNEY_NODES.findIndex((node) => node.nodeId === router.nodeId))
  const progress = Math.round(((currentNodeIndex + 1) / JOURNEY_NODES.length) * 100)
  const pending = router.transition.state === 'pending'
  const failed = ['rejected', 'stale', 'timeout', 'cancelled'].includes(router.transition.state)

  useEffect(() => { const mode = parseWiringMode(); setWiringMode(mode); installWiringMode(mode, ui.ui ?? null, () => revision) }, [ui.ui, revision])
  useEffect(() => { const id = window.setInterval(() => setRevision(getProjectionRevisionFn()?.() ?? 0), 500); return () => window.clearInterval(id) }, [])
  useEffect(() => { const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const sync = () => setReducedMotion(query.matches); sync(); query.addEventListener('change', sync); return () => query.removeEventListener('change', sync) }, [])
  useEffect(() => () => router.cancel(), [router.cancel])
  useEffect(() => { if (router.transition.state !== 'pending') setCancelling(false) }, [router.transition.state])
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'F2' || (event.key === '`' && !event.metaKey && !event.ctrlKey && !event.altKey)) { event.preventDefault(); setPanelOpen((open) => !open) } else if (event.key === 'Escape' && panelOpen) { event.preventDefault(); setPanelOpen(false) } }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown) }, [panelOpen])

  const request = useCallback((transitionId: string, parameters?: Record<string, unknown>) => { void router.request(transitionId, parameters) }, [router])
  const retry = useCallback(() => { if (!pending && router.transition.transitionId !== 'idle') request(router.transition.transitionId) }, [pending, request, router.transition.transitionId])
  const cancel = useCallback(() => { if (!pending || cancelling) return; setCancelling(true); router.cancel() }, [cancelling, pending, router])

  const page = useMemo(() => {
    switch (router.pageId) {
      case 'startup-loading': return <StartupLoading onReady={() => request('boot.enter-title')} />
      case 'menu-title': return <MenuTitle hasMockSave onNewGame={() => request('menu.new-game')} onContinue={() => request('menu.continue')} />
      case 'residence-main': return <ResidenceMain spawnAt={router.nodeId === 'residence.original-position' ? returnOrigin : undefined} onEnterDream={(origin) => { setReturnOrigin(origin); request('residence.bed-a-confirm', { origin }) }} onExit={() => request('residence.exit-to-title')} />
      case 'transition-battle-intro': return <TransitionBattleIntro onAdvance={() => request('battle-intro.to-dream')} transition={router.transition} onRetry={retry} onSafeReturn={() => router.safeReturn()} reducedMotion={reducedMotion} />
      case 'transition-dream': { const returning = router.nodeId === 'transition.dream-return'; return <TransitionDream mode={returning ? 'return-home' : 'enter-dream'} advanceLabel={returning ? '回到原位置' : '接入 HUD'} onAdvance={() => request(returning ? 'return.to-original-position' : 'dream.to-hud', returning ? { origin: returnOrigin } : undefined)} transition={router.transition} onRetry={retry} onSafeReturn={() => router.safeReturn()} onSettled={router.notifyMotionSettled} reducedMotion={reducedMotion} /> }
      case 'hud-main': return <HudMain onPause={() => request('hud.pause')} onSettle={() => request('hud.to-result')} />
      case 'menu-pause': return <MenuPause onResume={() => request('pause.resume')} onSettings={() => request('pause.settings')} onTitle={() => request('pause.to-title')} onRestart={() => router.safeReturn('重新开始使用安全返回投影；真实重启需要宿主。')} />
      case 'utility-settings': return <div className="product-settings-stage"><SettingsPanel onClose={() => request('settings.back-to-pause')} /></div>
      case 'transition-result': return router.nodeId === 'transition.result' ? <TransitionResult actionLabel="查看奖励投影" onReturn={() => request('result.to-reward')} /> : <TransitionResult rewardMode actionLabel="返回驻地" onReturn={() => request('reward.to-return')} />
      case 'map-editor': return <CreationPage tool="map-editor" />
      case 'asset-library': return <CreationPage tool="asset-library" />
      case 'research-bench': return <CreationPage tool="research-bench" />
      default: return null
    }
  }, [reducedMotion, request, retry, returnOrigin, router])

  return <main className="game-shell product-shell" data-node-id={router.nodeId}>
    <div className="game-noise" aria-hidden="true" /><div className="game-vignette" aria-hidden="true" />
    <section className="viewport-stage" aria-label="游戏画面"><div className="game-viewport-frame">
      <AnimatePresence mode="wait"><motion.div key={router.pageId} className="presentation" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }}>{page}</motion.div></AnimatePresence>
      {router.pageId === 'residence-main' && residenceAction && <aside className="journey-dock" aria-label="旅程操作"><span><FlaskConical size={13} /> MOCK JOURNEY</span><strong>{currentNode?.label}</strong><p>{residenceAction.note}</p><button disabled={pending} onClick={() => { if (router.nodeId === 'residence.bed-front-ready') setReturnOrigin({ x: 18, y: 83 }); request(residenceAction.transitionId, returnOrigin ? { origin: returnOrigin } : undefined) }}>{pending ? <Loader2 className="spin" size={14} /> : <Check size={14} />}{pending ? '等待确认…' : residenceAction.label}</button></aside>}
      <div className="journey-status" role="status" aria-live="polite"><span>{currentNode?.label ?? router.nodeId}</span><code>{router.nodeId}</code><small>{wiringMode.toUpperCase()} · PROJECTION ONLY · NO HOST COMMIT</small></div>
      {pending && <IntentPendingBanner transition={router.transition} cancelling={cancelling} onCancel={cancel} />}
      {failed && <IntentFailureAlert transition={router.transition} pending={pending} onRetry={retry} onSafeReturn={() => router.safeReturn()} />}
      <button className="product-panel-trigger" type="button" aria-expanded={panelOpen} aria-controls="product-control-panel" onClick={() => setPanelOpen((open) => !open)}><Gauge size={16} /><span>控制面板</span><WiringStatusBadge mode={wiringMode} hasUi={Boolean(ui.ui)} error={ui.error} pending={pending} /><strong>{progress}%</strong></button>
      <AnimatePresence>{panelOpen && <motion.aside id="product-control-panel" className="product-control-panel" aria-label="旅程控制面板" initial={reducedMotion ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reducedMotion ? undefined : { opacity: 0, x: 24 }}>
        <header><div><span>PRODUCT JOURNEY / {wiringMode.toUpperCase()}</span><h2>完成进度</h2></div><button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭控制面板"><X size={17} /></button></header>
        <ActiveIntentPanel transition={router.transition} revision={revision} bootReady={Boolean(ui.ui)} />
        <div className="product-progress" aria-label={`旅程进度 ${progress}%`}><div style={{ width: `${progress}%` }} /></div><div className="product-progress-meta"><strong>{currentNodeIndex + 1} / {JOURNEY_NODES.length}</strong><span>{currentNode?.label}</span></div>
        <p className="product-panel-note">这里显示并可调试跳转全部旅程节点。调试跳转会明确标记，不计入完整流程验收。快捷键：F2 或 `。</p>
        <nav aria-label="旅程节点">{JOURNEY_NODES.map((node, index) => { const active = node.nodeId === router.nodeId; const visited = index <= currentNodeIndex; return <button type="button" key={node.nodeId} className={active ? 'is-active' : visited ? 'is-visited' : ''} aria-current={active ? 'step' : undefined} onClick={() => { router.demoJump(node.pageId, node.nodeId); setPanelOpen(false) }}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{node.label}</strong><code>{node.nodeId}</code></div><ChevronRight size={14} /></button> })}</nav>
        <footer><span>{router.usedDemoControl ? '当前流程包含调试跳转' : '当前流程未使用调试跳转'}</span><button type="button" onClick={() => { router.resetLog(); router.demoJump('startup-loading', 'boot.startup'); setPanelOpen(false) }}><RotateCcw size={13} /> 从头检查</button></footer>
      </motion.aside>}</AnimatePresence>
    </div></section>
  </main>
}
