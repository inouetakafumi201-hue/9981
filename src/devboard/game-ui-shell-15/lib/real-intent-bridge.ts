'use client'

/**
 * V0 壳侧 `submitShellIntent` 的真实实现 (H-G-1a)。
 *
 * 角色：把 V0 壳的 `ShellIntentRequest` 翻译为主仓 `InteractionIntent` 并
 * 提交到 `UiSystem.interaction.sendIntent()`，再把 `SubmissionOutcome` 翻译
 * 回 `ShellIntentResult`。
 *
 * 与主仓 `src/devboard/wiring/presentation-wiring/v0-bridge/real-transport-adapter.ts`
 * 的关系：本文件是 V0 壳侧薄包装，重复实现「ShellRequest → InteractionIntent」
 * 翻译是因为 V0 壳被主仓 tsconfig exclude，跨 tsconfig 不可 import。运行时
 * 双方 intentId 集合（`SUPPORTED_INTENT_IDS`）需保持一致（H-G-19）。
 *
 * 注册：见 `lib/wiring-mode.ts` 的 `installRealIntentBridge()`。
 */

import type { UiSystem } from '../../../ui/index'
import type { StateRevision } from '../../../ui/model/revision'
import { createPresentationGatewayAdapter } from '../../wiring/presentation-wiring/presentation-gateway-adapter'
import type { ShellIntentRequest, ShellIntentResult, ShellIntentOutcome } from './shell-intent'
import { OUTCOME_MESSAGES, OUTCOME_REASONS, isRealIntentRegistered, registerRealSubmitIntent } from './shell-intent'

export interface RealIntentBridgeDeps {
  readonly uiSystem: UiSystem
  readonly getProjectionRevision: () => number
  readonly forcedOutcome?: Exclude<ShellIntentOutcome, 'pending'> | 'auto'
}

const SUPPORTED_INTENT_IDS = new Set<string>([
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

const PLAYER_VISIBLE_FIELDS = new Set(['apCost', 'spCost', 'range', 'damage', 'targets', 'pathCost'])
const PLAYER_VISIBLE_MIN = 1
const PLAYER_VISIBLE_MAX = 5

const DEFAULT_DEGRADED_TIMEOUT_MS = 800

let _deps: RealIntentBridgeDeps | null = null

export function installRealIntentBridge(deps: RealIntentBridgeDeps) {
  _deps = deps
  if (isRealIntentRegistered()) return
  registerRealSubmitIntent(submitRealIntent)
}

export function uninstallRealIntentBridge() {
  _deps = null
}

async function submitRealIntent(request: ShellIntentRequest): Promise<ShellIntentResult> {
  if (!_deps) {
    return { request, outcome: 'rejected', reasonCode: 'NO_REAL_BRIDGE', message: '真实接线未安装' }
  }
  const { uiSystem, getProjectionRevision, forcedOutcome } = _deps

  // 1. forced outcome
  if (forcedOutcome && forcedOutcome !== 'auto') {
    const nonAccepted = forcedOutcome === 'accepted' ? 'timeout' : (forcedOutcome as Exclude<typeof forcedOutcome, 'accepted' | 'auto'>)
    return {
      request,
      outcome: forcedOutcome,
      reasonCode: OUTCOME_REASONS[nonAccepted],
      message: OUTCOME_MESSAGES[forcedOutcome],
    }
  }

  // 2. intentId registration
  if (!SUPPORTED_INTENT_IDS.has(request.intentId)) {
    return {
      request,
      outcome: 'rejected',
      reasonCode: 'INTENT_NOT_REGISTERED',
      message: `intentId "${request.intentId}" not in IntentMap`,
    }
  }

  // 3. player-visible value guard
  for (const field of PLAYER_VISIBLE_FIELDS) {
    const v = request.parameters[field]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isInteger(v) || v < PLAYER_VISIBLE_MIN || v > PLAYER_VISIBLE_MAX) {
      return {
        request,
        outcome: 'rejected',
        reasonCode: 'PLAYER_VISIBLE_VALUE_OOR',
        message: `玩家可见数值 ${field}=${String(v)} 超出 1-5 范围`,
      }
    }
  }

  // 4. translate to InteractionIntent
  const bindings: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(request.parameters ?? {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') bindings[k] = v
  }
  const intent = {
    intentId: request.intentId,
    agentId: 'player-1',
    target: { kind: 'action' as const, actionId: request.intentId },
    bindings,
    observedRevision: request.revision as unknown as StateRevision,
    inputSource: 'pointer' as const,
  }

  const outcome = uiSystem.interaction.sendIntent(intent)
  const state = outcome.kind
  if (state === 'accepted') {
    const beforeRev = getProjectionRevision()
    await new Promise<void>((r) => setTimeout(r, DEFAULT_DEGRADED_TIMEOUT_MS))
    const afterRev = getProjectionRevision()
    if (afterRev <= beforeRev) {
      return {
        request,
        outcome: 'degraded',
        reasonCode: 'PROJECTION_NOT_REFRESHED',
        message: OUTCOME_MESSAGES.degraded,
      }
    }
  }
  return {
    request,
    outcome: state,
    reasonCode: state === 'accepted' ? undefined : OUTCOME_REASONS[state],
    message: OUTCOME_MESSAGES[state],
  }
}

export { SUPPORTED_INTENT_IDS as REAL_INTENT_IDS, submitRealIntent }
export { createPresentationGatewayAdapter }
