/**
 * submitRealShellIntent —— 表现层接线专项 D 阶段交付。
 *
 * 职责：V0 壳 `submitShellIntent` 的真接入版本。从 V0 壳侧调用时把 `mockTransportAdapter`
 * 的 `request()` 调用替换为本函数，把 `ShellRequest` 翻译为 `InteractionIntent` 后提交
 * 到 `UiSystem`。
 *
 * V0 壳侧接入方式（不在本 Spec 写锁内，属于 V0 壳维护线范围）：
 *   import { submitRealShellIntent } from '<主仓>/src/devboard/wiring/presentation-wiring/v0-bridge/submit-real-shell-intent'
 *   const result = await submitRealShellIntent(uiSystem, request)
 *
 * 写锁：本文件在 `src/devboard/wiring/presentation-wiring/v0-bridge/**` 内。
 */

import { createRealTransportAdapter, type ShellRequest, type ShellTransportResult, type ShellTransportState } from './real-transport-adapter'
import type { UiSystem } from '../../../../ui/index'

export interface SubmitRealShellIntentDeps {
  readonly uiSystem: UiSystem
  readonly getProjectionRevision: () => number
  readonly getCurrentRevision?: () => number
  readonly forcedOutcome?: Exclude<ShellTransportState, 'pending'> | 'auto'
  readonly degradedTimeoutMs?: number
}

export async function submitRealShellIntent(
  deps: SubmitRealShellIntentDeps,
  request: ShellRequest,
): Promise<ShellTransportResult> {
  const adapter = createRealTransportAdapter({
    uiSystem: deps.uiSystem,
    getProjectionRevision: deps.getProjectionRevision,
    getCurrentRevision: deps.getCurrentRevision ?? (() => 0),
    forcedOutcome: deps.forcedOutcome,
    degradedTimeoutMs: deps.degradedTimeoutMs,
  })
  return adapter.request(request)
}
