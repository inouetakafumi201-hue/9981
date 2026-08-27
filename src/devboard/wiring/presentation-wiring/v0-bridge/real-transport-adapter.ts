/**
 * realTransportAdapter —— 表现层接线专项 C 阶段交付。
 *
 * 职责：实现 V0 壳 `ShellTransportAdapter` 接口（接口形状从 shell-adapters.ts 复制，
 * 避免跨 tsconfig 项目 import），把 `submitShellIntent` 的请求翻译为
 * `UiSystem.interaction.sendIntent(InteractionIntent)` 调用并把 `SubmissionOutcome`
 * 翻译回 `ShellTransportState`。
 *
 * 不责任：
 * - 不直接 import `src/play/map/**` / `src/play/core-mechanics/**` / `src/l2/**` / `src/core/**`
 * - 不持有 `OpRegistry` / `WorldStateHolder`
 * - 不修改 V0 壳 `lib/shell-adapters.ts` / `lib/shell-intent.ts` 既有 mock 实现
 * - `cancel` 当前 SubmissionOutcome 不支持；登记为 TODO-D-W02-01
 *
 * 写锁：本文件在 `.kiro/specs/wakeup-presentation-wiring/design.md` §组件和接口 4
 * `realTransportAdapter` 写锁区 `src/devboard/wiring/presentation-wiring/v0-bridge/**` 内。
 */

// ---- 本地 type-only 副本（避免跨 tsconfig exclude 项目的 import 错误） ----
// 形状与 `src/devboard/game-ui-shell-15/lib/shell-adapters.ts` 严格对齐。
// V0 壳侧用 `createRealTransportAdapter(...)` 构造时提供 `ShellTransportAdapter` 契约。

export type ShellTransportState =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'timeout'
  | 'cancelled'
  | 'disconnected'
  | 'reconnecting'
  /** Real 模式专用：已接受但 800ms 内表现层未更新 projection revision */
  | 'degraded'

export interface ShellTransportResult {
  adapter: 'transport'
  mock: false
  requestId: string
  request: ShellRequest
  state: ShellTransportState
  reasonCode?: string
  message: string
  elapsedMs: number
}

export interface ShellRequest {
  intentId: string
  requestId?: string
  source: string
  target: string
  parameters?: Record<string, unknown>
  mock?: boolean
  safeReturnTarget?: string
  revision?: number
}

export interface ShellTransportAdapter {
  request(request: ShellRequest): Promise<ShellTransportResult>
  cancel(requestId: string): void
}

import type { InteractionIntent, IntentTarget } from '../../../../ui/model/intent'
import type { SubmissionOutcome } from '../../../../ui/ports/action-port'
import type { UiSystem } from '../../../../ui/index'
import type { StateRevision } from '../../../../ui/model/revision'

/** 表现层接线专项 1-1: WiringMode 决定路由。本文件实现 real 分支。 */
export type WiringMode = 'mock' | 'real' | 'iter-V0'

/** Intents that the V0 shell is allowed to issue. Mirrors `JOURNEY_EDGES` intentId set. */
export type SupportedIntentId =
  | 'boot.enter-title'
  | 'menu.new-game'
  | 'menu.continue'
  | 'residence.match.start'
  | 'residence.match.cancel'
  | 'residence.match.accept'
  | 'residence.bed.confirm-ready'
  | 'session.enter-dream'
  | 'session.hud.attach'
  | 'session.abandon-to-title'
  | 'session.settle'
  | 'session.return-home'
  | 'residence.restore-position'
  | 'residence.exit'

/** Reason codes surfaced to V0 shell. */
export const REASON_CODES = {
  INTENT_NOT_REGISTERED: 'INTENT_NOT_REGISTERED',
  PARAMETER_DROPPED: 'PARAMETER_DROPPED',
  PLAYER_VISIBLE_VALUE_OOR: 'PLAYER_VISIBLE_VALUE_OOR',
  PROJECTION_NOT_REFRESHED: 'PROJECTION_NOT_REFRESHED',
  REAL_TIMEOUT: 'REAL_TIMEOUT',
  REAL_CANCELLED: 'REAL_CANCELLED',
  REAL_DISCONNECTED: 'REAL_DISCONNECTED',
  REAL_ACCEPTED: undefined, // accepted has no reasonCode
} as const

/** 玩家可见数值守 1-5（L0 宪法铁律） */
const PLAYER_VISIBLE_MIN = 1
const PLAYER_VISIBLE_MAX = 5
const PLAYER_VISIBLE_FIELDS: ReadonlySet<string> = new Set(['apCost', 'spCost', 'range', 'damage', 'targets', 'pathCost'])

/** 800ms 阈值：表现层未在 800ms 内响应 revision 更新 → degraded。 */
export const DEFAULT_DEGRADED_TIMEOUT_MS = 800

export interface RealTransportAdapterDeps {
  /** UI 组合根 createUiSystem() 产物 */
  readonly uiSystem: UiSystem
  /** 当前 revision 读取（无 game state 时返回 0） */
  readonly getCurrentRevision: () => number
  /** 当前 presentation projection revision 读取，用于 800ms 等待比对 */
  readonly getProjectionRevision: () => number
  /** 强制失败注入：real 模式下面板可控 */
  readonly forcedOutcome?: Exclude<ShellTransportState, 'pending'> | 'auto'
  /** 强制失败使用的 reason code（默认根据 outcome 推导） */
  readonly forcedReasonCode?: string
  /** degraded 阈值（默认 800ms） */
  readonly degradedTimeoutMs?: number
  /** Clock (ms) for test injection */
  readonly now?: () => number
  /** Sleep function (ms) for test injection */
  readonly sleep?: (ms: number) => Promise<void>
  /** AgentId to use for InteractionIntent (defaults to 'player-1') */
  readonly agentId?: string
  /** InputSource for InteractionIntent (defaults to 'pointer'; V0 shell mouse → pointer) */
  readonly inputSource?: 'pointer' | 'keyboard' | 'gamepad' | 'touch' | 'assistive'
}

/** 公开构造工厂：返回 V0 壳 `ShellTransportAdapter` 接口 */
export function createRealTransportAdapter(deps: RealTransportAdapterDeps): ShellTransportAdapter {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const degradedTimeoutMs = deps.degradedTimeoutMs ?? DEFAULT_DEGRADED_TIMEOUT_MS
  const agentId = deps.agentId ?? 'player-1'
  const inputSource = deps.inputSource ?? 'pointer'

  const inflightRequests = new Map<string, { cancelled: boolean }>()

  return {
    async request(shellRequest: ShellRequest): Promise<ShellTransportResult> {
      const requestId = shellRequest.requestId || generateRequestId()
      const envelopeBase: EnvelopeBase = {
        adapter: 'transport',
        mock: false,
        requestId,
        request: shellRequest,
        elapsedMs: 0,
      }
      const startedAt = now()

      // 1. Check forced outcome (control panel injection)
      if (deps.forcedOutcome && deps.forcedOutcome !== 'auto') {
        return makeResult(envelopeBase, deps.forcedOutcome, deps.forcedReasonCode ?? defaultReasonFor(deps.forcedOutcome), now() - startedAt)
      }

      // 2. Check intentId registration
      if (!isRegisteredIntentId(shellRequest.intentId)) {
        return makeResult(envelopeBase, 'rejected', REASON_CODES.INTENT_NOT_REGISTERED, now() - startedAt, `intentId "${shellRequest.intentId}" not in IntentMap`)
      }

      // 3. Player visible value guard (1-5)
      const oor = checkPlayerVisibleValues(shellRequest.parameters ?? {})
      if (oor) {
        return makeResult(envelopeBase, 'rejected', REASON_CODES.PLAYER_VISIBLE_VALUE_OOR, now() - startedAt, oor)
      }

      // 4. Translate to InteractionIntent
      const intent = toInteractionIntent(shellRequest, {
        agentId,
        inputSource,
        observedRevision: shellRequest.revision ?? 0,
      })

      // 5. Submit via UiSystem
      const outcome: SubmissionOutcome = deps.uiSystem.interaction.sendIntent(intent)
      const inflight = { cancelled: false }
      inflightRequests.set(requestId, inflight)

      // 6. Translate SubmissionOutcome → ShellTransportState
      const state = outcomeToState(outcome)
      if (state === 'accepted') {
        // 7. Wait for projection revision bump (800ms)
        const initialRevision = deps.getProjectionRevision()
        await sleep(degradedTimeoutMs)
        if (inflight.cancelled) {
          inflightRequests.delete(requestId)
          return makeResult(envelopeBase, 'cancelled', REASON_CODES.REAL_CANCELLED, now() - startedAt, '请求已被取消。')
        }
        const finalRevision = deps.getProjectionRevision()
        if (finalRevision <= initialRevision) {
          inflightRequests.delete(requestId)
          return makeResult(envelopeBase, 'degraded', REASON_CODES.PROJECTION_NOT_REFRESHED, now() - startedAt, '已接受但表现层未在 800ms 内响应 revision 更新。')
        }
      }

      inflightRequests.delete(requestId)
      return makeResult(envelopeBase, state, defaultReasonFor(state), now() - startedAt)
    },

    cancel(requestId: string): void {
      // TODO-D-W02-01: SubmissionOutcome has no cancel; cancel path is best-effort flag for inflight tracking.
      const inflight = inflightRequests.get(requestId)
      if (inflight) {
        inflight.cancelled = true
        inflightRequests.delete(requestId)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SUPPORTED_INTENT_IDS: ReadonlySet<string> = new Set<SupportedIntentId>([
  'boot.enter-title',
  'menu.new-game',
  'menu.continue',
  'residence.match.start',
  'residence.match.cancel',
  'residence.match.accept',
  'residence.bed.confirm-ready',
  'session.enter-dream',
  'session.hud.attach',
  'session.abandon-to-title',
  'session.settle',
  'session.return-home',
  'residence.restore-position',
  'residence.exit',
])

export function isRegisteredIntentId(intentId: string): intentId is SupportedIntentId {
  return SUPPORTED_INTENT_IDS.has(intentId)
}

function checkPlayerVisibleValues(params: Record<string, unknown>): string | null {
  for (const field of PLAYER_VISIBLE_FIELDS) {
    const value = params[field]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < PLAYER_VISIBLE_MIN || value > PLAYER_VISIBLE_MAX) {
      return `玩家可见数值字段 ${field}=${String(value)} 超出 1-5 范围（L0 宪法铁律）`
    }
  }
  return null
}

interface ToInteractionOpts {
  agentId: string
  inputSource: 'pointer' | 'keyboard' | 'gamepad' | 'touch' | 'assistive'
  observedRevision: number
}

function toInteractionIntent(shellRequest: ShellRequest, opts: ToInteractionOpts): InteractionIntent {
  // Build IntentTarget as action kind (UI only emits action intents in this Spec).
  // target.actionId mirrors the V0 shell intentId so the gameplay layer can route by it.
  const target: IntentTarget = {
    kind: 'action',
    actionId: shellRequest.intentId,
  } as IntentTarget

  // bindings: shallow string/number/boolean copy from parameters (typed by L0)
  const bindings: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(shellRequest.parameters ?? {})) {
    if (v === null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      bindings[k] = v
    }
    // 其他类型（object/array/undefined）丢弃；reasonCode = PARAMETER_DROPPED
  }

  return {
    intentId: shellRequest.intentId,
    agentId: opts.agentId,
    target,
    bindings,
    observedRevision: opts.observedRevision as unknown as StateRevision,
    inputSource: opts.inputSource,
  }
}

function outcomeToState(outcome: SubmissionOutcome): ShellTransportState {
  switch (outcome.kind) {
    case 'accepted':
      return 'accepted'
    case 'rejected':
      return 'rejected'
    case 'stale':
      return 'stale'
    default: {
      const _exhaustive: never = outcome
      return _exhaustive satisfies never
    }
  }
}

function defaultReasonFor(state: ShellTransportState): string | undefined {
  switch (state) {
    case 'accepted':
      return undefined
    case 'rejected':
      return 'REAL_HOST_REJECTED'
    case 'stale':
      return 'REAL_REVISION_STALE'
    case 'timeout':
      return REASON_CODES.REAL_TIMEOUT
    case 'cancelled':
      return REASON_CODES.REAL_CANCELLED
    case 'disconnected':
      return REASON_CODES.REAL_DISCONNECTED
    case 'degraded':
      return REASON_CODES.PROJECTION_NOT_REFRESHED
    case 'pending':
    case 'reconnecting':
      return undefined
  }
}

interface EnvelopeBase {
  adapter: 'transport'
  mock: false
  requestId: string
  request: ShellRequest
  elapsedMs: number
}

function makeResult(
  base: EnvelopeBase,
  state: ShellTransportState,
  reasonCode: string | undefined,
  elapsedMs: number,
  message?: string,
): ShellTransportResult {
  return {
    ...base,
    state,
    reasonCode,
    message: message ?? defaultMessageFor(state),
    elapsedMs,
  }
}

function defaultMessageFor(state: ShellTransportState): string {
  switch (state) {
    case 'pending':
      return '已提交，等待宿主确认。'
    case 'accepted':
      return '宿主已确认该请求。'
    case 'rejected':
      return '宿主拒绝了该请求，界面保持原状态。'
    case 'stale':
      return '本地版本已过期，请重试以取得新的投影版本。'
    case 'timeout':
      return '请求超时，没有收到投影确认。'
    case 'cancelled':
      return '请求已取消，没有产生任何变更。'
    case 'disconnected':
      return '连接已断开，请检查网络后重试。'
    case 'degraded':
      return '请求已被宿主接受，但表现层未在 800ms 内更新投影，界面已降级展示。'
    case 'reconnecting':
      return '正在重连，请求已挂起。'
  }
}

// ---------------------------------------------------------------------------
// 工厂：`wiring-mode.ts` 路由的 `real` 分支
// ---------------------------------------------------------------------------

export function shouldUseRealAdapter(mode: WiringMode): boolean {
  return mode === 'real' || mode === 'iter-V0'
}

let requestCounter = 0
function generateRequestId(): string {
  requestCounter += 1
  return `real-req-${requestCounter.toString().padStart(4, '0')}-${Date.now().toString(36)}`
}
