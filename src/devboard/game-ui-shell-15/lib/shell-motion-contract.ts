/**
 * V0-11 — motion CONTRACTS, as distinct from the round-2 motion registry.
 *
 * `lib/motion-registry.ts` answered "is this effect registered, and which of
 * the six degradation outcomes does it claim?". That check passed while a
 * real defect survived underneath it: a record could list
 * `outcomes: ['normal','skip']` without anyone stating what the *final visual
 * state* is, whether reduced-motion keeps the information, or what happens
 * when the asset never arrives.
 *
 * So this module states the behaviour instead of the coverage. Every entry
 * declares, for each failure mode, both the behaviour and — the field that
 * matters — whether the semantic final state survives it.
 *
 * The invariant, restated as a type: `advancesJourney: false`. A motion
 * settling is reported to the router via `notifyMotionSettled`, which unlocks
 * the page's own advance control. It never moves a page.
 */

export type MotionContractTrigger = 'state-transition' | 'click-play'

export interface MotionDegradation<B extends string> {
  behavior: B
  /** The one question round 2 never answered per-animation. */
  finalStatePreserved: boolean
  /** How a tester reproduces this branch. */
  reproduce: string
}

export interface ShellMotionContract {
  /** Stable key, shared with journey edges' `motionIds`. */
  semanticId: string
  label: string
  /** File + symbol that owns the effect. */
  source: string
  targetPageId: string
  trigger: MotionContractTrigger
  /** The state that must be on screen after ANY branch below. */
  finalState: string
  durationMs?: number
  reducedMotion: MotionDegradation<'instant-final-state' | 'shortened' | 'disabled'>
  assetFailure: MotionDegradation<'static-fallback' | 'semantic-slot' | 'skip-to-final' | 'not-applicable'>
  timeout: MotionDegradation<'static-fallback' | 'error-state' | 'skip-to-final'>
  skip: { enabled: boolean; finalStatePreserved: boolean; note: string }
  /** Structural invariant. Not a comment — a type. */
  advancesJourney: false
  mock: boolean
  /** Round-3 visual audit verdict. */
  audit: MotionAudit
}

export interface MotionAudit {
  /** Whether this contract was walked in the browser this round. */
  verified: 'browser-verified' | 'code-verified' | 'not-verified'
  /** Defects found, empty when clean. Honest, not aspirational. */
  findings: readonly string[]
  reworkRequired: boolean
}

const CLEAN: MotionAudit = { verified: 'browser-verified', findings: [], reworkRequired: false }
const CODE_ONLY = (findings: readonly string[] = []): MotionAudit => ({
  verified: 'code-verified', findings, reworkRequired: false,
})

/* ------------------------------------------------------------------ */
/* boot + title                                                        */
/* ------------------------------------------------------------------ */

const BOOT_MOTIONS: readonly ShellMotionContract[] = [
  {
    semanticId: 'startup.loading-progress',
    label: '启动进度推进', source: 'components/startup-loading.tsx', targetPageId: 'startup-loading',
    trigger: 'state-transition', finalState: '进度停在 mock 终值，并显示「进入标题」按钮（不自动跳转）',
    durationMs: 2400,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '控制面板「减少动效」' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '纯 DOM 进度条，无素材依赖' },
    timeout: { behavior: 'error-state', finalStatePreserved: true, reproduce: '强制 intent timeout；进度停住并给出重试' },
    skip: { enabled: true, finalStatePreserved: true, note: '跳过只把进度推到终值，不进入标题' },
    advancesJourney: false, mock: true,
    audit: { ...CLEAN, findings: ['进度百分比是演示数据，界面已标注 MOCK，不冒充真实载入量'] },
  },
  {
    semanticId: 'title.contour-reveal',
    label: '标题轮廓显形', source: 'components/menu-title.tsx', targetPageId: 'menu-title',
    trigger: 'state-transition', finalState: '标题与四个菜单项全部可见、可聚焦',
    durationMs: 900,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '控制面板「减少动效」：标题与菜单层级不丢失' },
    assetFailure: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '控制面板「素材载入失败」' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '素材 timeout：回落静态标题' },
    skip: { enabled: true, finalStatePreserved: true, note: '任意键落到终态；菜单项不因此被选中' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'title.diagnostic-scan',
    label: '标题诊断扫描行', source: 'components/menu-title.tsx', targetPageId: 'menu-title',
    trigger: 'state-transition', finalState: '扫描行停在最后一条，百分比静止',
    durationMs: 0,
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：只显示末条文本' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '纯文本，无素材' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '无外部依赖，恒定落终态' },
    skip: { enabled: false, finalStatePreserved: true, note: '装饰性循环，无需跳过；不阻塞输入' },
    advancesJourney: false, mock: true,
    audit: { ...CLEAN, findings: ['循环无终点但不阻塞输入，也不产生成功语义——不视为「有开始没有结束」缺陷'] },
  },
  {
    semanticId: 'title.quit-confirm-pulse',
    label: '退出确认脉冲', source: 'components/menu-title.tsx', targetPageId: 'menu-title',
    trigger: 'state-transition', finalState: '确认对话保持打开，焦点在「取消」上',
    durationMs: 480,
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：确认框仍以边框与文案区分' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'error-state', finalStatePreserved: true, reproduce: '强制 intent timeout：留在标题并显示超时原因' },
    skip: { enabled: false, finalStatePreserved: true, note: '脉冲不可跳过，也永不触发退出本身' },
    advancesJourney: false, mock: true,
    audit: { ...CLEAN, findings: ['已确认脉冲结束不会调用退出 intent'] },
  },
  {
    semanticId: 'title.ambient-motes',
    label: '标题环境浮尘', source: 'components/menu-sprite-field.tsx', targetPageId: 'menu-title',
    trigger: 'state-transition', finalState: '静止的稀疏点阵，不遮挡文字',
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：粒子层整体移除' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：不渲染，标题不受影响' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '装饰层，超时即不渲染' },
    skip: { enabled: false, finalStatePreserved: true, note: '纯装饰，无跳过需求' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
]

/* ------------------------------------------------------------------ */
/* transitions — the group round 2 conflated                           */
/* ------------------------------------------------------------------ */

const TRANSITION_MOTIONS: readonly ShellMotionContract[] = [
  {
    semanticId: 'dream.enter-white',
    label: '入梦 · 纯白显形（去程）', source: 'components/transition-dream.tsx', targetPageId: 'transition-dream',
    trigger: 'state-transition', finalState: '纯白静态终帧 + 显式「接入 HUD」按钮（按钮出现前不允许推进）',
    durationMs: 1600,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：直接落纯白终帧与按钮' },
    assetFailure: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '素材失败：无残留空白屏，直接终帧' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '演出超时：停在当前节点终态，不推进' },
    skip: { enabled: true, finalStatePreserved: true, note: '跳过只落终态并解锁按钮，绝不代替 accepted' },
    advancesJourney: false, mock: true,
    audit: { ...CLEAN, findings: ['与 return-white 是两个独立 semanticId，方向与语义不再混用'] },
  },
  {
    semanticId: 'dream.return-white',
    label: '归途 · 纯白显形（返程）', source: 'components/transition-dream.tsx', targetPageId: 'transition-dream',
    trigger: 'state-transition', finalState: '纯白静态终帧 + 显式「回到原位置」按钮',
    durationMs: 1600,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：直接落终帧' },
    assetFailure: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '素材失败：纯白由 CSS 承担，不依赖贴图' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '超时：留在归途节点，不自动回驻地' },
    skip: { enabled: true, finalStatePreserved: true, note: '返程使用纯白显形，与普通 fade 明确区分' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'battle-intro.map-forming',
    label: '对局介绍 · 地图成形', source: 'components/transition-battle-intro.tsx', targetPageId: 'transition-battle-intro',
    trigger: 'state-transition', finalState: '对局信息静态排布 + 「进入」按钮可聚焦',
    durationMs: 1400,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：信息直接呈现' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：显示语义槽位而非空白' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '超时：仍显示对局信息与按钮' },
    skip: { enabled: true, finalStatePreserved: true, note: '跳过表现，不跳过节点' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'result.seal',
    label: '结算 · 印记落定', source: 'components/transition-result.tsx', targetPageId: 'transition-result',
    trigger: 'state-transition', finalState: '结果行与奖励投影行静态可读',
    durationMs: 550,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：结果行立即可读' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '图标为矢量组件，无外部素材' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '无外部依赖' },
    skip: { enabled: true, finalStatePreserved: true, note: '跳过后奖励行仍完整可读' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'result.reward-rows',
    label: '奖励投影行淡入', source: 'components/transition-result.tsx', targetPageId: 'transition-result',
    trigger: 'state-transition', finalState: '奖励投影示例行全部可见，标注为投影而非结算事实',
    durationMs: 400,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：奖励行立即显示' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '无外部依赖' },
    skip: { enabled: true, finalStatePreserved: true, note: '奖励数值来自 mock fixture，动画不生成任何数值' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'location.title-reveal',
    label: '地点标题显形', source: 'components/location-title.tsx', targetPageId: 'location-title',
    trigger: 'click-play', finalState: '地点名静态居中显示',
    durationMs: 2000,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '控制面板「减少动效」' },
    assetFailure: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '控制面板「素材载入失败」' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '素材超时：文本仍显示' },
    skip: { enabled: true, finalStatePreserved: true, note: '关键地名不只在动画中出现' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
]

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

const HUD_MOTIONS: readonly ShellMotionContract[] = [
  {
    semanticId: 'hud.burst-selection',
    label: '爆发档位 · 选择效果', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'click-play', finalState: '所选档位（0/1/2）保持高亮，+3 保持置灰',
    durationMs: 180,
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：以边框与文字标注选中' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现，无外部依赖' },
    skip: { enabled: false, finalStatePreserved: true, note: '与 trigger 完全独立：选择不提交，也不播放触发效果' },
    advancesJourney: false, mock: true,
    audit: { ...CLEAN, findings: ['+3 已确认不可选、不可提交（aria-disabled 且无 intent 出口）'] },
  },
  {
    semanticId: 'hud.burst-trigger',
    label: '爆发档位 · 触发效果', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'click-play', finalState: '触发反馈结束后回到 HUD 静态读数，数值来自 fixture',
    durationMs: 420,
    reducedMotion: { behavior: 'shortened', finalStatePreserved: true, reproduce: '减少动效：保留一次静态确认' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：文字反馈仍在' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '超时：直接落静态读数' },
    skip: { enabled: true, finalStatePreserved: true, note: '触发效果可独立播放，且不推导伤害/AP/胜负' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.action-card-selection',
    label: '动作卡选择', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'click-play', finalState: '所选卡保持选中态，禁用卡保留禁用解释',
    durationMs: 160,
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：选中以边框表达' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '图标缺失：显示文字名称' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '选择不等于提交' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.target-focus',
    label: '目标聚焦环', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'click-play', finalState: '目标保持聚焦标记，附带文字目标名',
    durationMs: 200,
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：静态描边' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '矢量绘制' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '颜色不是唯一语义，始终有文字目标名' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.turn-order-update',
    label: '回合顺序更新', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'state-transition', finalState: '顺序条落到 fixture 给出的新序列',
    durationMs: 300,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：直接重排' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '投影未到：保留旧序列并标注过期' },
    skip: { enabled: false, finalStatePreserved: true, note: '顺序由 fixture 决定，动画不计算顺序' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.projection-revision',
    label: '投影版本变更提示', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'state-transition', finalState: '显示新的 revision 号，旧值标注为过期',
    durationMs: 240,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：直接替换数字' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '纯文本' },
    timeout: { behavior: 'error-state', finalStatePreserved: true, reproduce: 'stale 强制结果：显示版本过期与重试' },
    skip: { enabled: false, finalStatePreserved: true, note: '只显示 revision 变化，绝不生成 revision' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.hit-feedback',
    label: '命中反馈', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'state-transition', finalState: '命中行文字 + HP 条读数（粒子不是唯一渠道）',
    durationMs: 360,
    reducedMotion: { behavior: 'shortened', finalStatePreserved: true, reproduce: '减少动效：保留静态命中符号与文字' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：命中结果文字仍在' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '超时：直接显示命中行' },
    skip: { enabled: true, finalStatePreserved: true, note: '命中/格挡/未命中只接受传入语义，前端不判定' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.blocked-feedback',
    label: '格挡反馈', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'state-transition', finalState: '格挡行文字 + 图标',
    durationMs: 320,
    reducedMotion: { behavior: 'shortened', finalStatePreserved: true, reproduce: '减少动效：静态格挡图标' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：保留文字' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '超时：直接显示格挡行' },
    skip: { enabled: true, finalStatePreserved: true, note: '与 hit 使用不同图标与文案，不靠颜色区分' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'hud.result-feedback',
    label: '对局结果反馈', source: 'components/battle-hud.tsx', targetPageId: 'hud-main',
    trigger: 'state-transition', finalState: '结果标签静态显示，等待显式结算转移',
    durationMs: 500,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：结果标签直接出现' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：文字结果保留' },
    timeout: { behavior: 'skip-to-final', finalStatePreserved: true, reproduce: '超时：结果标签仍显示' },
    skip: { enabled: true, finalStatePreserved: true, note: 'HUD 不推导胜负；结果来自 fixture' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
]

/* ------------------------------------------------------------------ */
/* overlays                                                            */
/* ------------------------------------------------------------------ */

const OVERLAY_MOTIONS: readonly ShellMotionContract[] = [
  {
    semanticId: 'overlay.pause-open',
    label: '暂停层打开', source: 'components/menu-pause.tsx', targetPageId: 'menu-pause',
    trigger: 'state-transition', finalState: '暂停层可见，焦点落在「继续」',
    durationMs: 220,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：仍可分辨打开/关闭（标题 + 遮罩）' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '打开动画不破坏焦点' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.pause-close',
    label: '暂停层关闭', source: 'components/menu-pause.tsx', targetPageId: 'menu-pause',
    trigger: 'state-transition', finalState: '暂停层移除，焦点回到触发控件',
    durationMs: 200,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：立即移除' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '焦点归还在动画之外完成，跳过不影响' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.settings-open',
    label: '设置层打开', source: 'components/settings-panel.tsx', targetPageId: 'utility-settings',
    trigger: 'state-transition', finalState: '设置层可见，焦点进入面板',
    durationMs: 220,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：立即可见' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '不与其他 overlay 争夺焦点（栈式管理）' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.settings-close',
    label: '设置层关闭', source: 'components/settings-panel.tsx', targetPageId: 'utility-settings',
    trigger: 'state-transition', finalState: '设置层移除，焦点回到打开它的按钮',
    durationMs: 200,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：立即移除' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '焦点归还已实测（标题与暂停两条路径）' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.blocking-error',
    label: '阻断错误层', source: 'components/connection-error-overlay.tsx', targetPageId: 'connection-error',
    trigger: 'state-transition', finalState: '阻断层可见，重试与安全返回都可聚焦且不被遮挡',
    durationMs: 240,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：错误状态仍以图标+文案表达' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'error-state', finalStatePreserved: true, reproduce: '这一层本身就是超时的落点' },
    skip: { enabled: false, finalStatePreserved: true, note: '优先级高于普通 overlay，Escape 首先由它消费' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.toast-enter-exit',
    label: '浮层通告进出', source: 'components/notice-toast.tsx', targetPageId: 'notice-toast',
    trigger: 'state-transition', finalState: '堆栈落到上限内，超期项移除',
    durationMs: 260,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：无位移，仅出现/消失' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: true, finalStatePreserved: true, note: '不遮挡阻断错误层与主提交按钮（已实测层级）' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.broadcast-expand',
    label: '广播横幅展开/收起', source: 'components/notice-broadcast.tsx', targetPageId: 'notice-broadcast',
    trigger: 'click-play', finalState: '展开或收起的静态终态，展开状态由 aria-expanded 表达',
    durationMs: 240,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：立即切换高度' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '被动横幅，不抢占输入' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.notification-history-open',
    label: '通告历史打开', source: 'components/notification-history.tsx', targetPageId: 'notification-history',
    trigger: 'click-play', finalState: '只读历史列表可见并可键盘浏览',
    durationMs: 220,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：立即可见' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地表现' },
    skip: { enabled: false, finalStatePreserved: true, note: '只读层，不发起写入' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'overlay.connection-state-change',
    label: '连接状态切换（断开/重连/恢复）', source: 'components/connection-error-overlay.tsx', targetPageId: 'connection-error',
    trigger: 'state-transition', finalState: '三种状态各有独立图标与文案的静态终态',
    durationMs: 280,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：状态仍可分辨（不依赖闪烁）' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'error-state', finalStatePreserved: true, reproduce: '重连超时：落到失败终态并提供安全返回' },
    skip: { enabled: false, finalStatePreserved: true, note: '恢复不是动画推导的，来自传入状态' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
]

/* ------------------------------------------------------------------ */
/* residence                                                           */
/* ------------------------------------------------------------------ */

const RESIDENCE_MOTIONS: readonly ShellMotionContract[] = [
  {
    semanticId: 'residence.anchor-pulse',
    label: '锚定导流仪匹配脉冲', source: 'components/residence-main.tsx', targetPageId: 'residence-main',
    trigger: 'state-transition', finalState: '匹配状态条静态显示当前阶段，取消按钮始终可点',
    durationMs: 0,
    reducedMotion: { behavior: 'disabled', finalStatePreserved: true, reproduce: '减少动效：状态条只显示文字阶段' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'error-state', finalStatePreserved: true, reproduce: '12s 守卫落到「匹配超时」并给出重试' },
    skip: { enabled: false, finalStatePreserved: true, note: '匹配中仍可漫游，脉冲不阻塞输入' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'residence.shadow-lobby-fade',
    label: '影子大厅剪影淡入', source: 'components/residence-main.tsx', targetPageId: 'residence-main',
    trigger: 'state-transition', finalState: '就绪剪影静态叠加在同一房间内，附「就绪」文字标签',
    durationMs: 420,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：剪影直接出现' },
    assetFailure: { behavior: 'semantic-slot', finalStatePreserved: true, reproduce: '素材失败：保留剪影槽位与文字' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '投影未到：不渲染剪影，房间不受影响' },
    skip: { enabled: false, finalStatePreserved: true, note: '不是独立大厅页面，也不触发场景重载' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
  {
    semanticId: 'residence.ready-prompt',
    label: '床 A 就绪面板出现', source: 'components/residence-main.tsx', targetPageId: 'residence-main',
    trigger: 'state-transition', finalState: '就绪面板可见，焦点在「确认就绪」，取消可用',
    durationMs: 220,
    reducedMotion: { behavior: 'instant-final-state', finalStatePreserved: true, reproduce: '减少动效：面板立即出现' },
    assetFailure: { behavior: 'not-applicable', finalStatePreserved: true, reproduce: '无素材依赖' },
    timeout: { behavior: 'static-fallback', finalStatePreserved: true, reproduce: '本地空间事实驱动' },
    skip: { enabled: false, finalStatePreserved: true, note: '出现条件是走进半径，不是点击，也不是动画结束' },
    advancesJourney: false, mock: true, audit: CLEAN,
  },
]

export const MOTION_CONTRACTS: readonly ShellMotionContract[] = [
  ...BOOT_MOTIONS,
  ...TRANSITION_MOTIONS,
  ...HUD_MOTIONS,
  ...OVERLAY_MOTIONS,
  ...RESIDENCE_MOTIONS,
]

export function getMotionContract(semanticId: string): ShellMotionContract | undefined {
  return MOTION_CONTRACTS.find((contract) => contract.semanticId === semanticId)
}

export function motionContractsForPage(pageId: string): readonly ShellMotionContract[] {
  return MOTION_CONTRACTS.filter((contract) => contract.targetPageId === pageId)
}

/**
 * A contract is defective when any branch loses the semantic final state.
 * That is the round-3 rework trigger, checked instead of asserted.
 */
export function motionContractDefects(contract: ShellMotionContract): string[] {
  const defects: string[] = []
  if (!contract.reducedMotion.finalStatePreserved) defects.push('reduced-motion 后信息消失')
  if (contract.assetFailure.behavior !== 'not-applicable' && !contract.assetFailure.finalStatePreserved) {
    defects.push('素材失败后没有终态')
  }
  if (!contract.timeout.finalStatePreserved) defects.push('超时后没有终态')
  if (contract.skip.enabled && !contract.skip.finalStatePreserved) defects.push('跳过后没有终态')
  if (contract.audit.reworkRequired) defects.push('审查判定需要返工')
  return defects
}

export function allMotionDefects(): { semanticId: string; defects: string[] }[] {
  return MOTION_CONTRACTS
    .map((contract) => ({ semanticId: contract.semanticId, defects: motionContractDefects(contract) }))
    .filter((entry) => entry.defects.length > 0)
}
