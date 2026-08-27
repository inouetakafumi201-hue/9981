import { getForcedIntentOutcome } from './shell-intent'

export type B1Source = 'mock'
export type IntentStatus = 'accepted' | 'rejected' | 'stale' | 'timeout' | 'cancelled'

export type B1IntentId =
  | 'navigate.page'
  | 'navigate.category'
  | 'navigate.variant'
  | 'startup.retry'
  | 'startup.cancel'
  | 'startup.fallback'
  | 'settings.save'
  | 'settings.cancel'
  | 'settings.defaults'
  | 'menu.quit'
  | 'battle.select-power-die-tier'
  | 'battle.select-reversal-tier'
  | 'battle.confirm-roll'
  | 'battle.cancel-roll-selection'
  | 'battle.select-action'
  | 'battle.select-target'
  | 'battle.cancel-target-selection'
  | 'battle.camera-focus-participant'
  | 'battle.reconnect'
  | 'battle.continue-result'
  | 'pause.open'
  | 'pause.continue'
  | 'pause.open-settings'
  | 'pause.request-restart'
  | 'pause.confirm-restart'
  | 'pause.request-return-title'
  | 'pause.confirm-return-title'
  | 'pause.cancel-confirm'
  | 'pause.close'
  | 'pause.retry'
  | 'settings.preview'
  | 'settings.restore-defaults'
  | 'settings.confirm-restore'
  | 'settings.retry'
  | 'inventory.select-slot'
  | 'inventory.swap-slots'
  | 'inventory.context'
  | 'inventory.cancel-drag'
  | 'safe.select-entry'
  | 'safe.use'
  | 'safe.category'
  | 'match.open'
  | 'match.cancel'
  | 'match.retry'
  | 'match.close'
  | 'notice.dismiss'
  | 'notice.history.open'
  | 'notice.history.close'
  | 'notice.history.group'
  | 'notice.history.select'
  | 'notice.broadcast.expand'
  | 'notice.broadcast.close'
  | 'notice.retry'
  | 'subtitle.toggle'
  | 'connection.retry'
  | 'connection.cancel'
  | 'connection.dismiss-recovered'
  | 'connection.safe-return'
  | 'connection.retry-asset'
  | 'connection.close-details'
  // --- B5 narrative RPG surfaces ---
  | 'dialog.reveal-complete'
  | 'dialog.advance'
  | 'dialog.option.select'
  | 'dialog.skip-line'
  | 'dialog.close'
  | 'dialog.retry-asset'
  | 'quest-log.open'
  | 'quest-log.close'
  | 'quest.filter.category'
  | 'quest.filter.status'
  | 'quest.select'
  | 'quest.track'
  | 'tracker.toggle'
  | 'tutorial.acknowledge'
  | 'tutorial.more-help'
  | 'tutorial.replay'
  | 'tutorial.dismiss'
  | 'help.open'
  | 'help.select-entry'
  | 'help.close'
  | 'archive.open'
  | 'archive.close'
  | 'archive.tab.select'
  | 'archive.filter'
  | 'archive.entry.select'
  | 'recap.replay'

export type B1Intent<T = Record<string, unknown>> = {
  intentId: B1IntentId
  payload: T
  requestId: string
  source: B1Source
  revision: number
  safeReturnTarget: string
}

export type IntentResult<T = Record<string, unknown>> = B1Intent<T> & {
  status: IntentStatus
  reason?: string
}

let revision = 0
export function createIntent<T extends Record<string, unknown>>(intentId: B1IntentId, payload: T, safeReturnTarget = 'menu-title'): B1Intent<T> {
  revision += 1
  return { intentId, payload, requestId: `mock-${Date.now()}-${revision}`, source: 'mock', revision, safeReturnTarget }
}

export async function submitIntent<T extends Record<string, unknown>>(intent: B1Intent<T>): Promise<IntentResult<T>> {
  await new Promise((resolve) => setTimeout(resolve, 120))
  // The control panel's global "强制结果" override takes priority over any
  // per-call demoFailure payload, so every page (legacy or shell adapter)
  // reproduces the same failure branch from one shared control.
  const globalOverride = getForcedIntentOutcome()
  const failure = globalOverride !== 'auto' ? globalOverride : String(intent.payload.demoFailure ?? '')
  if (failure === 'rejected') return { ...intent, status: 'rejected', reason: 'MOCK_REJECTED: projection refused this request.' }
  if (failure === 'timeout') return { ...intent, status: 'timeout', reason: 'MOCK_TIMEOUT: no projection arrived before the deadline.' }
  if (failure === 'stale') return { ...intent, status: 'stale', reason: 'MOCK_STALE: a newer revision already superseded this request.' }
  if (failure === 'cancelled') return { ...intent, status: 'cancelled', reason: 'MOCK_CANCELLED: cancelled before the host replied.' }
  return { ...intent, status: 'accepted' }
}

export const B1_PAGE_IDS = ['startup-loading', 'menu-title', 'residence-main', 'hud', 'transition-dream', 'transition-battle-intro', 'transition-result'] as const
export const B1_SETTINGS = ['display', 'sound', 'input', 'accessibility', 'language', 'graphics'] as const
export type B1SettingId = (typeof B1_SETTINGS)[number]
