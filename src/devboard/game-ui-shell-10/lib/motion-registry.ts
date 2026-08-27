/**
 * V0-08 — motion source registry and degradation matrix.
 *
 * Motion in this shell is never anonymous CSS decoration: every effect declares
 * where it came from, what page it belongs to, what triggers it, and what it
 * degrades into.
 *
 * Two trigger kinds, deliberately kept apart:
 *   state-transition  the surface changed state; the animation *reports* it
 *   click-play        the player asked for it directly; it reports the input
 *
 * Degradation rule: normal → reduced-motion → asset-missing → load-failed →
 * timeout → skip. Every level lands on the same **final semantic state**. A
 * failed, skipped or timed-out animation never advances the journey or玩法.
 */

export type MotionTrigger = 'state-transition' | 'click-play'

export type MotionOutcome = 'normal' | 'reduced-motion' | 'asset-missing' | 'load-failed' | 'timeout' | 'skip'

export const MOTION_OUTCOME_LABELS: Record<MotionOutcome, string> = {
  normal: '正常播放',
  'reduced-motion': '减少动效',
  'asset-missing': '素材缺失',
  'load-failed': '载入失败',
  timeout: '播放超时',
  skip: '玩家跳过',
}

/** 0 = full motion, 3 = static final state only. */
export type FallbackLevel = 0 | 1 | 2 | 3

export const OUTCOME_FALLBACK_LEVEL: Record<MotionOutcome, FallbackLevel> = {
  normal: 0,
  'reduced-motion': 1,
  'asset-missing': 2,
  'load-failed': 2,
  timeout: 3,
  skip: 3,
}

export interface MotionRecord {
  /** Stable semantic key. Extraction contract; never rename. */
  semanticId: string
  label: string
  /** Where the effect is defined (component or recipe file). */
  source: string
  targetPage: string
  trigger: MotionTrigger
  revision: number
  /** Degradations this effect actually implements. */
  outcomes: MotionOutcome[]
  /**
   * Outcomes deliberately not modelled, with an honest reason. A motion with
   * no loadable asset cannot have a real `asset-missing` / `load-failed`
   * branch — declaring one anyway would fabricate a failure that never
   * happens. This is the audit trail for why `outcomes` is shorter than the
   * full six-value set, so a missing entry is never mistaken for an
   * oversight.
   */
  notApplicableOutcomes?: Partial<Record<MotionOutcome, string>>
  /** The state that must be visible after any outcome, including failure. */
  finalState: string
  /** Explicitly restated: motion cannot advance the journey. */
  advancesJourney: false
}

/** `outcomes` ∪ `notApplicableOutcomes` keys must cover all six values — enforced in dev. */
export function motionCoverageGaps(record: MotionRecord): MotionOutcome[] {
  const all: MotionOutcome[] = ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip']
  const covered = new Set([...record.outcomes, ...Object.keys(record.notApplicableOutcomes ?? {})])
  return all.filter((outcome) => !covered.has(outcome))
}

export const MOTION_REGISTRY: MotionRecord[] = [
  {
    semanticId: 'boot.loading.progress', label: '启动进度显影', source: 'components/startup-loading.tsx',
    targetPage: 'startup-loading', trigger: 'state-transition', revision: 3,
    outcomes: ['normal', 'reduced-motion', 'timeout', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '进度显影是程序化进度条，不引用任何登记素材，没有「素材缺失」这个分支。',
      'load-failed': '同上：没有可加载失败的外部资源，failed 语义已由 startup-loading 页面自身的 error 状态覆盖。',
    },
    finalState: '停在最后一个已确认的启动阶段，附可读诊断。', advancesJourney: false,
  },
  {
    semanticId: 'title.enter.contour-reveal', label: '标题轮廓显影', source: 'components/menu-title.tsx',
    targetPage: 'menu-title', trigger: 'state-transition', revision: 4,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'skip'],
    notApplicableOutcomes: {
      'load-failed': '标题的 asset-missing / load-failed 分支由页面级 PageStateFrame 状态驱动器统一承担（见 STATE DRIVER），轮廓显影本身不重复实现独立的素材载入错误分支。',
      timeout: '同上：由页面级状态驱动器覆盖，轮廓显影不额外维护自己的等待期限。',
    },
    finalState: '标题、菜单与存档状态全部可读的静态版式。', advancesJourney: false,
  },
  {
    semanticId: 'title.quit.confirm-pulse', label: '退出确认脉冲', source: 'components/menu-title.tsx',
    targetPage: 'menu-title', trigger: 'click-play', revision: 2,
    outcomes: ['normal', 'reduced-motion', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '脉冲是纯 CSS/框架动效强调，不引用任何登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
      timeout: '脉冲本身不等待宿主：等待/超时属于其驱动的 menu.quit.confirm intent 生命周期（见 IntentFeedback），不是这个强调动效自己的分支。',
    },
    finalState: '确认对话保持打开，等待显式结果，不自动退出。', advancesJourney: false,
  },
  {
    semanticId: 'pause.world.freeze-scrim', label: '暂停世界冻结', source: 'components/menu-pause.tsx',
    targetPage: 'menu-pause', trigger: 'state-transition', revision: 3,
    outcomes: ['normal', 'reduced-motion', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '冻结遮罩是纯 CSS scrim，不引用任何登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
      timeout: '冻结遮罩本身是即时视觉状态；重开/返回标题各自的确认与超时分支由它们各自的 intent 生命周期承担，不是这个遮罩动效的分支。',
    },
    finalState: '暂停面板可读，冻结仅为视觉；规则未被写入。', advancesJourney: false,
  },
  {
    semanticId: 'transition.enter-dream.white-curtain', label: '纯白显形 · 进入', source: 'components/transition-dream.tsx',
    targetPage: 'transition-dream', trigger: 'state-transition', revision: 6,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip'],
    finalState: '停在纯白终帧的静态状态，等待显式 intent 才推进节点。', advancesJourney: false,
  },
  {
    semanticId: 'transition.return-home.white-curtain', label: '纯白显形 · 返回', source: 'components/transition-dream.tsx',
    targetPage: 'transition-dream', trigger: 'state-transition', revision: 5,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip'],
    finalState: '停在驻地入场静态帧，出发位置缺失时显示明确回退诊断。', advancesJourney: false,
  },
  {
    semanticId: 'transition.battle-intro.map-resolve', label: '对局地图成形', source: 'components/transition-battle-intro.tsx',
    targetPage: 'transition-battle-intro', trigger: 'state-transition', revision: 4,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip'],
    finalState: '对局信息静态可读；跳过不进入 HUD。', advancesJourney: false,
  },
  {
    semanticId: 'transition.result.settle', label: '结算收束', source: 'components/transition-result.tsx',
    targetPage: 'transition-result', trigger: 'state-transition', revision: 3,
    outcomes: ['normal', 'reduced-motion', 'load-failed', 'timeout', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '结算收束只用图标字体与文本数值，没有引用任何登记素材，因此没有「尚未交付」这一档；load-failed／empty 走的是页面级 PageStateFrame。',
    },
    finalState: '结算数值静态可读，或显示空投影／投影失败诊断。', advancesJourney: false,
  },
  {
    semanticId: 'hud.selection.highlight', label: 'HUD 选择效果', source: 'components/battle-hud.tsx',
    targetPage: 'hud-main', trigger: 'click-play', revision: 5,
    outcomes: ['normal', 'reduced-motion', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '选中态是边框／描��强调，不引用登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
      timeout: '选中是同步本地高亮，不等待任何异步确认。',
    },
    finalState: '被选中的动作卡／目标保持可读选中态，非颜色单一表达。', advancesJourney: false,
  },
  {
    semanticId: 'hud.trigger.impact', label: 'HUD 触发效果', source: 'components/battle-hud.tsx',
    targetPage: 'hud-main', trigger: 'click-play', revision: 5,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'timeout', 'skip'],
    notApplicableOutcomes: {
      'load-failed': '触发效果只用文本与图标呈现，没有可加载失败的图像资源；HUD 整体的素材缺失由 hud-main 的待交付素材横幅承担。',
    },
    finalState: '触发结果以文本与图标呈现；播放失败不改变提交状态。', advancesJourney: false,
  },
  {
    semanticId: 'hud.projection.revision-bump', label: 'HUD 投影版本更新', source: 'components/hud-main.tsx',
    targetPage: 'hud-main', trigger: 'state-transition', revision: 2,
    outcomes: ['normal', 'reduced-motion', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '版本徽标是纯文本，不引用登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
      timeout: '徽标只反映已经到达的 revision；等待新投影的超时属于 HUD 数据源本身，不是这个徽标动效的分支。',
    },
    finalState: '显示当前 revision 与来源徽标，陈旧投影明确标注。', advancesJourney: false,
  },
  {
    // V0-08 audit fix: LocationTitle forwards its `assetFailure` prop straight
    // into AssetSlot's `forceFailure`, which renders a distinct `load-failed`
    // state (separate from the `asset-missing`/pending fallback for A-301).
    // The outcome was implemented but had been left off this record.
    semanticId: 'location.title.arrival', label: '地点标题入场', source: 'components/location-title.tsx',
    targetPage: 'location-title', trigger: 'state-transition', revision: 2,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip'],
    finalState: '地点名称静态居中可读，A-301 未交付或载入失败时使用文本回退。', advancesJourney: false,
  },
  {
    semanticId: 'notice.toast.stack-in', label: '浮层入栈', source: 'components/notice-toast.tsx',
    targetPage: 'notice-toast', trigger: 'state-transition', revision: 3,
    outcomes: ['normal', 'reduced-motion', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '浮层只显示文本与图标，不引用登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
      timeout: '入栈是消息到达后的本地即时呈现，不等待任何异步确认。',
    },
    finalState: '消息静态可读，堆叠上限内保持顺序。', advancesJourney: false,
  },
  {
    semanticId: 'notice.broadcast.expand', label: '广播展开', source: 'components/notice-broadcast.tsx',
    targetPage: 'notice-broadcast', trigger: 'click-play', revision: 2,
    outcomes: ['normal', 'reduced-motion', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '展开/收起只重排已有文本内容，不引用登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
      timeout: '展开是本地即时交互，不提交任何等待确认的请求。',
    },
    finalState: '展开内容静态可读，收起状态保留摘要。', advancesJourney: false,
  },
  {
    // V0-08 audit fix: this motif's home moved from the standalone
    // `recap-surface.tsx` into the consolidated `progress-surfaces.tsx` during
    // the V0-04 refactor (RecapSurface). The `source` path is corrected here
    // so a reader can actually find the implementation, per the "traceable to
    // source" acceptance rule.
    semanticId: 'recap.replay.presentation', label: '回顾表现层重播', source: 'components/progress-surfaces.tsx (RecapSurface)',
    targetPage: 'recap', trigger: 'click-play', revision: 2,
    outcomes: ['normal', 'reduced-motion', 'timeout', 'skip'],
    notApplicableOutcomes: {
      'asset-missing': '回放卡片只重演已显示的文本内容，不引用登记素材。',
      'load-failed': '同上，没有可加载失败的资源。',
    },
    finalState: '事件卡回到静态状态；回放从不改写档案。', advancesJourney: false,
  },
  {
    semanticId: 'journey.node.travel', label: '旅程节点切换', source: 'components/b6-journey.tsx',
    targetPage: 'b6-journey', trigger: 'state-transition', revision: 7,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip'],
    finalState: '停在当前节点的静态最终状态，失败时显示节点级诊断。', advancesJourney: false,
  },
  {
    semanticId: 'workbench.b7.recipe-preview', label: 'B7 动效母题预览', source: 'components/b7-motion.tsx',
    targetPage: 'b7-motion', trigger: 'click-play', revision: 9,
    outcomes: ['normal', 'reduced-motion', 'asset-missing', 'load-failed', 'timeout', 'skip'],
    finalState: '母题停在终帧并显示所用降级档位。', advancesJourney: false,
  },
]

export function motionForPage(pageId: string): MotionRecord[] {
  return MOTION_REGISTRY.filter((record) => record.targetPage === pageId)
}

export function getMotion(semanticId: string): MotionRecord | undefined {
  return MOTION_REGISTRY.find((record) => record.semanticId === semanticId)
}
