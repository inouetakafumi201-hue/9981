'use client'

/**
 * V0-01 — `control-panel-main`: the shell's ONLY navigation centre.
 *
 * Everything reachable in this build is reachable from here, and every surface
 * mounted here is a leaf: leaves never navigate to other pages, they only
 * report intents back up. The panel owns page selection, kind/family filters,
 * variant, the state driver (loading / empty / error / timeout / retrying /
 * cancelled / safe-return / unimplemented), the forced intent outcome, the
 * reduced-motion override and the asset-failure override.
 *
 * Extraction contract: replace the mount registry's fixtures and
 * `submitShellIntent`. Do not rename pageId / variantId / stateId keys.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Boxes,
  Gamepad2,
  GitBranch,
  ImageOff,
  Layers,
  Menu,
  MonitorPlay,
  Play,
  RotateCcw,
  ScanLine,
  Shield,
  Sparkles,
  X,
} from 'lucide-react'
import {
  BASELINE_LABELS,
  FAMILY_LABELS,
  PAGE_CATALOG,
  PAGE_KIND_LABELS,
  PRODUCT_PAGE_IDS,
  SHELL_STATE_LABELS,
  VARIANT_LABELS,
  findDuplicatePageIds,
  getPage,
  type PageDescriptor,
  type PageFamily,
  type PageKind,
  type ShellStateId,
  type VariantId,
} from '@/lib/shell-catalog'
import { getForcedIntentOutcome, setForcedIntentOutcome, type ForcedOutcome } from '@/lib/shell-intent'
import { parseWiringMode, getProjectionRevisionFn, wiringModeColor, wiringModeLabel, type WiringMode } from '@/lib/wiring-mode'
import { assetsForPage, ASSET_STATUS_LABELS } from '@/lib/asset-manifest'
import { motionForPage, motionCoverageGaps, MOTION_OUTCOME_LABELS, MOTION_REGISTRY } from '@/lib/motion-registry'
import { useOverlayStack } from '@/lib/shell-a11y'
import { PageStateFrame, MockBoundary } from '@/components/shell-primitives'
import { HudMain } from '@/components/hud-main'
import { DialogLine } from '@/components/dialog-line'
import { ObjectiveTracker } from '@/components/objective-tracker'
import { LocationTitle } from '@/components/location-title'
import { AchievementsSurface, CodexSurface, RecapSurface, StatsSurface } from '@/components/progress-surfaces'
import { StartupLoading } from '@/components/startup-loading'
import { MenuTitle } from '@/components/menu-title'
import { MenuPause } from '@/components/menu-pause'
import { ResidenceMain } from '@/components/residence-main'
import { TransitionDream } from '@/components/transition-dream'
import { TransitionBattleIntro } from '@/components/transition-battle-intro'
import { TransitionResult } from '@/components/transition-result'
import { DialogOptions } from '@/components/dialog-options'
import { DialogPortrait } from '@/components/dialog-portrait'
import { QuestLog } from '@/components/quest-log'
import { TutorialHelp } from '@/components/tutorial-help'
import { NoticeBroadcast } from '@/components/notice-broadcast'
import { NoticeToast } from '@/components/notice-toast'
import { NotificationHistory } from '@/components/notification-history'
import { SubtitleOverlay } from '@/components/subtitle-overlay'
import { ConnectionErrorOverlay } from '@/components/connection-error-overlay'
import { SettingsPanel } from '@/components/settings-panel'
import { UtilityInventory } from '@/components/utility-inventory'
import { UtilitySafe } from '@/components/utility-safe'
import { UtilityMatch } from '@/components/utility-match'
import { ArchiveSurface } from '@/components/archive-surface'
import { B6Journey } from '@/components/b6-journey'
import { JourneyRunner } from '@/components/journey-runner'
import { B7MotionWorkbench } from '@/components/b7-motion'
import { ClickPlayScene, CombatFeedbackScene, MapScene, VictoryScene } from '@/components/standalone-scene-demos'
import { B5_STAGES, INITIAL_B5_SESSION, type B5Session, type B5Stage } from '@/lib/b5-session'
import { type PortScenario } from '@/lib/b6-journey'
import { ProductShell } from '@/components/product-shell'
import { creationHref } from '@/lib/creation-navigation'
import { CreationPage } from '@/components/creation-page'

export default function Page() {
  return <ProductShell />
}

const KIND_FILTERS: (PageKind | 'all')[] = ['all', 'product', 'development-demo', 'heritage-only', 'visual-reference']
const FAMILY_FILTERS: (PageFamily | 'all')[] = [
  'all', 'control', 'boot', 'menu', 'world', 'hud', 'narrative', 'transition', 'notice', 'utility', 'progress', 'workbench',
]
const FORCED_OUTCOMES: ForcedOutcome[] = ['auto', 'accepted', 'rejected', 'stale', 'timeout', 'cancelled', 'degraded']
const FORCED_LABELS: Record<ForcedOutcome, string> = {
  auto: 'AUTO（默认确认）', accepted: 'ACCEPTED', rejected: 'REJECTED', stale: 'STALE', timeout: 'TIMEOUT', cancelled: 'CANCELLED', degraded: 'DEGRADED',
}

interface MountContext {
  variant: VariantId
  reducedMotion: boolean
  assetFailure: boolean
  playToken: number
  navigate: (pageId: string) => void
  safeReturn: () => void
}

/**
 * The mount registry. A page missing from here renders the honest
 * `unimplemented` state instead of an approximate stand-in.
 */
function mountSurface(pageId: string, ctx: MountContext, extras: {
  b5: B5Session
  advanceB5: (stage: B5Stage, patch?: Partial<B5Session>) => void
  resetB5: () => void
  b6Scenario: PortScenario
}): React.ReactNode | null {
  switch (pageId) {
    case 'control-panel-main':
      return <ControlPanelSelfSurface />
    case 'map-editor':
      return <CreationPage tool="map-editor" />
    case 'asset-library':
      return <CreationPage tool="asset-library" />
    case 'research-bench':
      return <CreationPage tool="research-bench" />
    case 'startup-loading':
      return <StartupLoading onReady={() => ctx.navigate('menu-title')} />
    case 'menu-title':
      return (
        <MenuTitle
          hasMockSave
          onNewGame={() => ctx.navigate('residence-main')}
          onContinue={() => ctx.navigate('residence-main')}
        />
      )
    case 'menu-pause':
      return <MenuPause onClose={() => ctx.navigate('residence-main')} />
    case 'residence-main':
      return <ResidenceMain onEnterDream={() => ctx.navigate('transition-dream')} onExit={() => ctx.navigate('menu-title')} />
    case 'hud-main':
      return <HudMain variant={ctx.variant} />
    case 'dialog-line':
      return <DialogLine />
    case 'dialog-options':
      return <DialogOptions />
    case 'transition-dream':
      return (
        <TransitionDream
          mode="enter-dream"
          advanceLabel="确认进入战斗前奏"
          onAdvance={() => ctx.navigate('transition-battle-intro')}
          onSafeReturn={ctx.safeReturn}
          reducedMotion={ctx.reducedMotion}
        />
      )
    case 'transition-battle-intro':
      return (
        <TransitionBattleIntro
          advanceLabel="确认进入对局"
          onAdvance={() => ctx.navigate('hud-main')}
          onSafeReturn={ctx.safeReturn}
          reducedMotion={ctx.reducedMotion}
        />
      )
    case 'transition-result':
      return <TransitionResult onReturn={() => ctx.navigate('residence-main')} />
    case 'notice-broadcast':
      return <div className="ov-inline-stage"><NoticeBroadcast variant="event" /></div>
    case 'notice-toast':
      return <NoticeToast />
    case 'notification-history':
      return <NotificationHistory />
    case 'utility-settings':
      return <SettingsPanel onClose={ctx.safeReturn} />
    case 'utility-inventory':
      return <UtilityInventory />
    case 'utility-safe':
      return <div className="ov-inline-stage ov-inline-centered"><UtilitySafe onClose={ctx.safeReturn} /></div>
    case 'utility-match':
      return <UtilityMatch />
    case 'quest-log':
      return <QuestLog />
    case 'objective-tracker':
      return <ObjectiveTracker />
    case 'tutorial-help':
      return <TutorialHelp />
    case 'location-title':
      return <LocationTitle key={ctx.playToken} reducedMotionOverride={ctx.reducedMotion} assetFailure={ctx.assetFailure} />
    case 'stats':
      return <StatsSurface />
    case 'achievements':
      return <AchievementsSurface />
    case 'codex':
      return <CodexSurface />
    case 'recap':
      return <RecapSurface />
    case 'subtitle-overlay':
      return <SubtitleOverlay />
    case 'connection-error':
      return <ConnectionErrorOverlay />
    /* Non-product surfaces, clearly labelled by the catalog. */
    case 'b6-journey':
      return <JourneyRunner />
    case 'b7-motion':
      return <B7MotionWorkbench />
    case 'b5-flow':
      return <B5FlowDemo session={extras.b5} advance={extras.advanceB5} reset={extras.resetB5} />
    case 'dialog-portrait-legacy':
      return <DialogPortrait />
    case 'map':
      return <MapScene playing={false} />
    case 'click-play':
      return <ClickPlayScene playing={false} onPlayingChange={() => {}} />
    case 'combat-feedback':
      return <CombatFeedbackScene playing={false} onPlayingChange={() => {}} />
    case 'victory':
      return <VictoryScene playing={false} onPlayingChange={() => {}} />
    default:
      return null
  }
}

function ControlPanelMain() {
  const [pageId, setPageId] = useState('menu-title')
  const [kindFilter, setKindFilter] = useState<PageKind | 'all'>('all')
  const [familyFilter, setFamilyFilter] = useState<PageFamily | 'all'>('all')
  const [variant, setVariant] = useState<VariantId>('default')
  const [stateId, setStateId] = useState<ShellStateId>('ready')
  const [forced, setForced] = useState<ForcedOutcome>(getForcedIntentOutcome())
  const [reducedMotion, setReducedMotion] = useState(false)
  const [assetFailure, setAssetFailure] = useState(false)
  const [playToken, setPlayToken] = useState(1)
  const [panelOpen, setPanelOpen] = useState(false)
  const [b5, setB5] = useState<B5Session>(INITIAL_B5_SESSION)
  const [b6Scenario, setB6Scenario] = useState<PortScenario>('accepted')
  const [wiringMode, setWiringModeState] = useState<WiringMode>('mock')
  const [revision, setRevision] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const overlayStack = useOverlayStack()

  // H-G-16: read URL ?wiring= at mount; production forces real
  useEffect(() => {
    setWiringModeState(parseWiringMode())
  }, [])

  // H-G-2: poll revision every 500ms while panel is open
  useEffect(() => {
    if (!panelOpen) return
    const id = window.setInterval(() => {
      const fn = getProjectionRevisionFn()
      setRevision(fn ? fn() : 0)
    }, 500)
    return () => window.clearInterval(id)
  }, [panelOpen])

  const page = getPage(pageId) ?? PAGE_CATALOG[0]

  useEffect(() => {
    const duplicates = findDuplicatePageIds()
    if (duplicates.length) console.log('[v0] duplicate pageIds in catalog:', duplicates)
    // V0-08: any outcome that is neither implemented nor explicitly declared
    // not-applicable is a silent gap, not an honest one. Fail loudly in dev.
    for (const record of MOTION_REGISTRY) {
      const gaps = motionCoverageGaps(record)
      if (gaps.length) console.log('[v0] motion registry coverage gap:', record.semanticId, gaps)
    }
  }, [])

  useEffect(() => {
    setForcedIntentOutcome(forced)
  }, [forced])

  // The panel is the lowest-priority Escape target: any overlay a surface owns
  // consumes Escape first, and only an empty stack lets it close the panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !panelOpen) return
      if (overlayStack.entries.length > 0) return
      setPanelOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayStack.entries.length, panelOpen])

  const visiblePages = useMemo(
    () => PAGE_CATALOG.filter((item) =>
      (kindFilter === 'all' || item.kind === kindFilter) && (familyFilter === 'all' || item.family === familyFilter)),
    [familyFilter, kindFilter],
  )

  const navigate = useCallback((nextId: string) => {
    const next = getPage(nextId)
    setPageId(nextId)
    setStateId(next && next.stateIds.includes('ready') ? 'ready' : (next?.fallbackState ?? 'safe-return'))
    setVariant('default')
    setPlayToken((token) => token + 1)
  }, [])

  const safeReturn = useCallback(() => {
    setPageId('control-panel-main')
    setStateId('ready')
  }, [])

  const advanceB5 = useCallback((stage: B5Stage, patch: Partial<B5Session> = {}) => {
    setB5((current) => ({ ...current, ...patch, stage, revision: current.revision + 1 }))
  }, [])
  const resetB5 = useCallback(() => setB5({ ...INITIAL_B5_SESSION }), [])

  const surface = mountSurface(
    page.pageId,
    { variant, reducedMotion, assetFailure, playToken, navigate, safeReturn },
    { b5, advanceB5, resetB5, b6Scenario },
  )
  // Honesty rule: an unmounted page reports `unimplemented`, never a stand-in.
  const effectiveState: ShellStateId = surface === null ? 'unimplemented' : stateId
  const assets = assetsForPage(page.pageId)
  const motions = motionForPage(page.pageId)
  const catalogIndex = PAGE_CATALOG.indexOf(page) + 1

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.page-button') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <main className="game-shell">
      <div className="game-noise" aria-hidden="true" />
      <div className="game-vignette" aria-hidden="true" />

      <section className="viewport-stage" aria-label="游戏画面">
        <div className="game-viewport-frame">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${page.pageId}-${variant}-${effectiveState}-${playToken}`}
              className={`presentation presentation-${variant}`}
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -10 }}
              transition={{ duration: reducedMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
            >
              <PageStateFrame
                state={effectiveState}
                onRetry={effectiveState === 'unimplemented' ? undefined : () => { setStateId('retrying'); window.setTimeout(() => setStateId('ready'), 700) }}
                onSafeReturn={safeReturn}
              >
                {surface}
              </PageStateFrame>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <aside className={`control-panel ${panelOpen ? '' : 'panel-hidden'}`} aria-label="壳层控制面板" aria-hidden={!panelOpen}>
        <div className="panel-header">
          <div>
            <span className="panel-label">CONTROL PANEL</span>
            <h2>唯一导航中心</h2>
            <span className="panel-source"><span className="mock-tag">MOCK</span> UI PORT / READ ONLY</span>
          </div>
          <button className="icon-button" onClick={() => setPanelOpen(false)} aria-label="关闭控制面板"><X size={17} /></button>
        </div>

        <div className="panel-scroll">
          <div className="control-block">
            <div className="block-heading"><span>PAGE SELECT</span><span className="count">{visiblePages.length} ITEMS</span></div>
            <div className="page-list" role="listbox" aria-label="页面选择" ref={listRef} onKeyDown={onListKeyDown}>
              {visiblePages.map((item) => (
                <button
                  key={item.pageId}
                  role="option"
                  aria-selected={item.pageId === page.pageId}
                  className={`page-button ${item.pageId === page.pageId ? 'is-selected' : ''} is-kind-${item.kind}`}
                  onClick={() => navigate(item.pageId)}
                >
                  <span className="page-index">{String(PAGE_CATALOG.indexOf(item) + 1).padStart(2, '0')}</span>
                  <span className="page-name">{item.label}</span>
                  <span className="page-tags">
                    <span className="page-batch">{item.batchId}</span>
                    {item.kind !== 'product' && <span className="page-nonproduct">非产品</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-block">
            <div className="block-heading"><span>CREATION SUITE</span><span className="count">3 页面</span></div>
            <div className="cp-creation-grid">
              <a className="cp-creation-link is-map" href={creationHref('map-editor', { returnTo: '/' })}>
                <Layers size={15} /><span>地图编辑器</span><small>/map-editor</small>
              </a>
              <a className="cp-creation-link is-lib" href={creationHref('asset-library', { returnTo: '/' })}>
                <Boxes size={15} /><span>素材库</span><small>/asset-library</small>
              </a>
              <a className="cp-creation-link is-bench" href={creationHref('research-bench', { returnTo: '/' })}>
                <ScanLine size={15} /><span>研究台</span><small>/research-bench</small>
              </a>
            </div>
            <p className="cp-note">三个独立入口进入创作页面；进入后可互相切换���退出仅归因最初入口。</p>
          </div>

          <div className="control-block">
            <div className="block-heading"><span>KIND FILTER</span></div>
            <div className="category-list">
              {KIND_FILTERS.map((kind) => (
                <button key={kind} className={`category-button ${kindFilter === kind ? 'is-active' : ''}`} onClick={() => setKindFilter(kind)}>
                  {kind === 'all' ? '全部' : PAGE_KIND_LABELS[kind]}
                </button>
              ))}
            </div>
            <div className="block-heading"><span>FAMILY FILTER</span></div>
            <div className="category-list">
              {FAMILY_FILTERS.map((family) => (
                <button key={family} className={`category-button ${familyFilter === family ? 'is-active' : ''}`} onClick={() => setFamilyFilter(family)}>
                  {family === 'all' ? '全部' : FAMILY_LABELS[family]}
                </button>
              ))}
            </div>
          </div>

          <div className="control-block">
            <div className="block-heading"><span>STATE DRIVER</span><span className="count">{page.stateIds.length} 状态</span></div>
            <div className="cp-state-grid">
              {page.stateIds.map((id) => (
                <button
                  key={id}
                  className={`cp-state-button ${stateId === id ? 'is-active' : ''}`}
                  onClick={() => setStateId(id)}
                  disabled={surface === null}
                >
                  {SHELL_STATE_LABELS[id]}
                </button>
              ))}
            </div>
            {surface === null && <p className="cp-note">该页面未挂载实现，状态驱动器不可用：壳层固定显示「未实现」。</p>}
          </div>

          <div className="control-block">
            <div className="block-heading">
              <span>WIRING MODE</span>
              <span className="wiring-badge" style={{ background: wiringModeColor(wiringMode) }}>{wiringModeLabel(wiringMode)} · {wiringMode === 'real' ? '待机' : '未连接'}</span>
            </div>
            <div className="cp-info-row">
              <span>Revision</span><motion.code key={revision} className="cp-revision" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }}>{revision}</motion.code>
              <span>Boot</span><code>{wiringMode === 'real' ? '等待宿主' : '演示就绪'}</code>
              <span>Current</span><code>{wiringModeLabel(wiringMode)}</code>
            </div>
            <p className="cp-note">生产环境强制 Real；开发期通过 <code>?wiring=mock|iter-V0|real</code> 切换。</p>
          </div>

          <div className="control-block">
            <div className="block-heading"><span>VARIANT</span><span className="count">{page.variantIds.length} PRESETS</span></div>
            <div className="variant-list">
              {page.variantIds.map((id) => (
                <button key={id} className={`variant-button ${variant === id ? 'is-active' : ''}`} onClick={() => setVariant(id)}>
                  <span className="variant-dot" />{VARIANT_LABELS[id]}
                </button>
              ))}
            </div>
            {page.variantIds.length === 1 && <p className="cp-note">这个页面只声明了 default 变体，面板不会伪造 B / C。</p>}
          </div>

          <div className="control-block">
            <div className="block-heading"><span>INTENT OUTCOME</span></div>
            <div className="cp-select-row">
              <label>
                <span>强制结果</span>
                <select value={forced} onChange={(event) => setForced(event.target.value as ForcedOutcome)}>
                  {FORCED_OUTCOMES.map((item) => <option key={item} value={item}>{FORCED_LABELS[item]}</option>)}
                </select>
              </label>
              <label>
                <span>B6 端口场景</span>
                <select value={b6Scenario} onChange={(event) => setB6Scenario(event.target.value as PortScenario)}>
                  <option value="accepted">ACCEPTED</option>
                  <option value="rejected">REJECTED</option>
                  <option value="stale">STALE</option>
                  <option value="timeout">TIMEOUT</option>
                </select>
              </label>
            </div>
            <p className="cp-note">所有页面共用同一个 mock intent 适配器，任何失败分支都可在此复现。</p>
          </div>

          <div className="control-block">
            <div className="block-heading"><span>GLOBAL OVERRIDES</span></div>
            <div className="cp-toggle-row">
              <button className={`cp-toggle ${reducedMotion ? 'is-on' : ''}`} onClick={() => setReducedMotion((value) => !value)} aria-pressed={reducedMotion}>
                <Sparkles size={13} /> 减少动效
              </button>
              <button className={`cp-toggle ${assetFailure ? 'is-on' : ''}`} onClick={() => setAssetFailure((value) => !value)} aria-pressed={assetFailure}>
                <ImageOff size={13} /> 素材载入失败
              </button>
              <button className="cp-toggle" onClick={() => setPlayToken((token) => token + 1)}>
                <Play size={13} /> 重播演出
              </button>
            </div>
          </div>

          <div className="control-block">
            <div className="block-heading"><span>EXTRACTION META</span></div>
            <dl className="cp-meta">
              <div><dt>pageId</dt><dd><code>{page.pageId}</code></dd></div>
              <div><dt>entryId</dt><dd><code>{page.entryId}</code></dd></div>
              <div><dt>批次</dt><dd>{page.batchId}</dd></div>
              <div><dt>实现状态</dt><dd>{BASELINE_LABELS[page.baselineStatus]}</dd></div>
              <div><dt>失败回退</dt><dd>{SHELL_STATE_LABELS[page.fallbackState]}</dd></div>
            </dl>
            <MockBoundary>{page.mockBoundary}</MockBoundary>
            {page.retentionReason && (
              <p className="cp-retention"><Boxes size={12} /> 保留理由：{page.retentionReason}</p>
            )}
          </div>

          <div className="control-block">
            <div className="block-heading"><span>ASSET MANIFEST</span><span className="count">{assets.length}</span></div>
            {assets.length === 0
              ? <p className="cp-note">该页面没有登记素材依赖。</p>
              : <ul className="cp-asset-list">
                  {assets.map((asset) => (
                    <li key={asset.assetId}>
                      <code>{asset.assetId}</code>
                      <span className={`cp-asset-status is-${asset.status}`}>{ASSET_STATUS_LABELS[asset.status]}</span>
                      <small>{asset.fallback.label}</small>
                    </li>
                  ))}
                </ul>}
          </div>

          <div className="control-block">
            <div className="block-heading"><span>MOTION REGISTRY</span><span className="count">{motions.length}</span></div>
            {motions.length === 0
              ? <p className="cp-note">该页面没有登记动效母题。</p>
              : <ul className="cp-motion-list">
                  {motions.map((record) => {
                    const gaps = motionCoverageGaps(record)
                    return (
                      <li key={record.semanticId}>
                        <code>{record.semanticId}</code>
                        <small>{record.trigger === 'click-play' ? '点击播放' : '状态迁移'} · 降级至 {MOTION_OUTCOME_LABELS[reducedMotion ? 'reduced-motion' : assetFailure ? 'load-failed' : 'normal']} · {record.outcomes.length}/6 分支已实现</small>
                        {record.notApplicableOutcomes && (
                          <small className="cp-motion-na">
                            {Object.entries(record.notApplicableOutcomes).map(([outcome, reason]) => (
                              <span key={outcome} title={reason}>{MOTION_OUTCOME_LABELS[outcome as keyof typeof MOTION_OUTCOME_LABELS]} 不适用</span>
                            ))}
                          </small>
                        )}
                        {gaps.length > 0 && (
                          <small className="cp-motion-gap">未登记分支：{gaps.map((g) => MOTION_OUTCOME_LABELS[g]).join('、')}</small>
                        )}
                      </li>
                    )
                  })}
                </ul>}
            <p className="cp-note">
              全部 {MOTION_REGISTRY.length} 条动效中，{MOTION_REGISTRY.filter((r) => motionCoverageGaps(r).length === 0).length} 条已完成六档覆盖审计（实现或明确标注不适用）。
            </p>
          </div>
        </div>

        <div className="panel-footer"><GitBranch size={14} /><span>BRANCH: GAME-UI-SHELL-11</span></div>
      </aside>

      {!panelOpen && (
        <button className="reopen-panel" onClick={() => setPanelOpen(true)} aria-label="打开控制面板"><Menu size={19} /></button>
      )}

    </main>
  )
}

/* ------------------------------------------------------------------ */
/* control-panel-main's own viewport surface                           */
/* ------------------------------------------------------------------ */

function ControlPanelSelfSurface() {
  const byKind = useMemo(() => {
    const counts = new Map<PageKind, PageDescriptor[]>()
    for (const item of PAGE_CATALOG) counts.set(item.kind, [...(counts.get(item.kind) ?? []), item])
    return counts
  }, [])

  return (
    <div className="cp-self">
      <span className="cp-self-kicker"><Layers size={13} /> SHELL AUTHORITY</span>
      <h1>这里是唯一的导航中心。</h1>
      <p>
        目录里的每个页面都是叶子：它们只提交 intent，不自行跳转。任何一个页面的载入、空投影、错误、超时、重试、取消与安全返回，
        都能在左侧状态驱动器里独立复现。
      </p>
      <div className="cp-self-grid">
        {[...byKind.entries()].map(([kind, items]) => (
          <section key={kind}>
            <h2>{PAGE_KIND_LABELS[kind]}<b>{items.length}</b></h2>
            <ul>{items.map((item) => <li key={item.pageId}><code>{item.pageId}</code><span>{item.label}</span></li>)}</ul>
          </section>
        ))}
      </div>
      <MockBoundary>
        页面目录、状态驱动器与 intent 结果均为壳层 mock。没有任何宿主事实被读取或写入。
      </MockBoundary>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* B5 development demo — explicitly a demo, never a page contract      */
/* ------------------------------------------------------------------ */

function B5FlowDemo({
  session,
  advance,
  reset,
}: {
  session: B5Session
  advance: (stage: B5Stage, patch?: Partial<B5Session>) => void
  reset: () => void
}) {
  const activeIndex = B5_STAGES.findIndex((step) => step.id === session.stage)
  return (
    <div className="b5-flow-stage" data-revision={session.revision}>
      <div className="b5-flow-rail" aria-label="B5 叙事进度">
        {B5_STAGES.map((step, index) => (
          <span key={step.id} className={`${index === activeIndex ? 'is-active' : ''} ${index < activeIndex ? 'is-complete' : ''}`}>
            <i />{step.label}
          </span>
        ))}
        <button onClick={reset}><RotateCcw size={11} /> 重置章节</button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={session.stage} className="b5-flow-surface" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.26 }}>
          {session.stage === 'dialogue' && <DialogLine connected onComplete={() => advance('choice')} />}
          {session.stage === 'choice' && <DialogOptions onResolved={(choice) => advance('quest', { choice })} />}
          {session.stage === 'quest' && <QuestLog initialTrackedId={session.trackedQuestId} onContinue={() => advance('guidance')} />}
          {session.stage === 'guidance' && <TutorialHelp initialSeen={session.tutorialSeen} onLocationComplete={() => advance('archive', { archiveUnlocked: true })} />}
          {session.stage === 'archive' && <ArchiveSurface />}
        </motion.div>
      </AnimatePresence>
      <div className="sr-only" aria-live="polite">当前阶段：{B5_STAGES[activeIndex]?.label}</div>
      <div className="cp-demo-flag"><Shield size={12} /> 开发演示：串联验证台，不替代任何单页契约。</div>
    </div>
  )
}
