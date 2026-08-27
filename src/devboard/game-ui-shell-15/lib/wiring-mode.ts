'use client'

/**
 * V0 壳 wiring mode 全局状态机 (H-G-1, H-G-1a, H-G-2, H-G-16, H-G-17)。
 *
 * 负责：
 *  1. 读取 `?wiring=` URL param 或 `NODE_ENV=production` 决定模式
 *  2. 在 product-shell 挂载时把 real adapter 注册到 shell-route / shell-intent
 *  3. 导出 WiringMode badge 信息供控制面板消费
 */

import type { UiSystem } from '../../../ui/model/view'
import { setActiveRouterAdapter as _setActiveRouterAdapter } from './shell-route'
import { installRealIntentBridge, uninstallRealIntentBridge, type RealIntentBridgeDeps } from './real-intent-bridge'
import { getForcedIntentOutcome } from './shell-intent'

export type WiringMode = 'mock' | 'iter-V0' | 'real'

export const WIRING_MODE_LABELS: Record<WiringMode, string> = {
  mock: 'Mock',
  'iter-V0': 'Iter-V0',
  real: 'Real',
}

export const WIRING_MODE_COLORS: Record<WiringMode, string> = {
  mock: 'var(--badge-mock, #6b7280)',
  'iter-V0': 'var(--badge-iter, #f59e0b)',
  real: 'var(--badge-real, #10b981)',
}

let _mode: WiringMode = 'mock'
let _realUiSystem: UiSystem | null = null
let _getProjectionRevision: (() => number) | null = null

export function getWiringMode(): WiringMode {
  return _mode
}

export function wiringModeLabel(mode?: WiringMode): string {
  return WIRING_MODE_LABELS[mode ?? _mode]
}

export function wiringModeColor(mode?: WiringMode): string {
  return WIRING_MODE_COLORS[mode ?? _mode]
}

export function parseWiringMode(): WiringMode {
  if (process.env.NODE_ENV === 'production') return 'real'
  /* istanbul ignore next — browser-only */
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '')
    const p = params.get('wiring')
    if (p === 'mock' || p === 'iter-V0' || p === 'real') return p
  } catch {
    // SSR / non-browser environment — fall through
  }
  return 'mock'
}

export function installWiringMode(
  mode: WiringMode,
  uiSystem: UiSystem | null,
  getProjectionRevision?: () => number,
) {
  _mode = mode
  _realUiSystem = uiSystem
  _getProjectionRevision = getProjectionRevision ?? null

  if (mode === 'real' && uiSystem) {
    const forced = getForcedIntentOutcome()
    const deps: RealIntentBridgeDeps = {
      uiSystem,
      getProjectionRevision: getProjectionRevision ?? (() => 0),
      forcedOutcome: forced === 'auto' ? 'auto' : forced,
    }
    installRealIntentBridge(deps)
    // shell-route adapter is registered by product-shell after boot
    void forced
  } else {
    uninstallRealIntentBridge()
  }
}

export function getRealUiSystem(): UiSystem | null {
  return _realUiSystem
}

export function getProjectionRevisionFn(): (() => number) | null {
  return _getProjectionRevision
}

export function syncForcedOutcome(mode: WiringMode) {
  const _forced = getForcedIntentOutcome()
  if (mode !== 'real') return
  // real mode: propagate forced outcome to bridge
  // (bridge reads forcedOutcome from deps on each call, so no push needed here)
  void _forced
}
