'use client'

export const JOURNEY_ROUTES = ['cold-start','loading','title','residence','anchor-device','matching','residence-roaming','shadow-lobby','bed-front-ready','battle-intro','enter-dream','battle-hud','result','reward','return-home','residence-original-position'] as const
export type JourneyRoute = typeof JOURNEY_ROUTES[number]
export type PortScenario = 'accepted' | 'rejected' | 'stale' | 'timeout'
export type JourneyPhase = 'idle' | 'loading' | 'pending' | 'ready' | 'error' | 'timeout' | 'stale'
export type OverlayId = 'pause' | 'settings' | 'narrative' | 'notification' | 'blocking-error'

export interface JourneyProjection {
  readonly route: JourneyRoute
  readonly phase: JourneyPhase
  readonly revision: number
  readonly source: 'mock'
  readonly returnOrigin: string | null
  readonly match: 'none' | 'matching' | 'complete'
  readonly bedA: 'locked' | 'lit' | 'ready'
  readonly activeOverlay: OverlayId | null
  readonly pendingIntent: string | null
  readonly feedback: { status: PortScenario | 'pending' | 'info'; message: string } | null
}

export const ROUTE_LABELS: Record<JourneyRoute, string> = {
  'cold-start':'冷启动','loading':'载入投影','title':'标题','residence':'驻地','anchor-device':'锚定导流仪','matching':'匹配中','residence-roaming':'驻地漫游','shadow-lobby':'影子大厅','bed-front-ready':'床 A 就绪','battle-intro':'对局介绍','enter-dream':'进入梦境','battle-hud':'对局 HUD','result':'对局结算','reward':'奖励确认','return-home':'返回驻地','residence-original-position':'原位置恢复',
}

export const INITIAL_JOURNEY: JourneyProjection = {
  route: 'cold-start', phase: 'idle', revision: 1, source: 'mock', returnOrigin: null,
  match: 'none', bedA: 'locked', activeOverlay: null, pendingIntent: null, feedback: null,
}

export function nextRoute(route: JourneyRoute): JourneyRoute {
  const i = JOURNEY_ROUTES.indexOf(route)
  return JOURNEY_ROUTES[Math.min(i + 1, JOURNEY_ROUTES.length - 1)]
}

export async function submitJourneyIntent(kind: string, scenario: PortScenario): Promise<{ status: PortScenario; reason?: string }> {
  const delay = scenario === 'timeout' ? 1250 : 420
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  if (scenario === 'accepted') return { status: 'accepted' }
  return { status: scenario, reason: scenario === 'rejected' ? 'HOST_REJECTED_MOCK' : scenario === 'stale' ? 'REVISION_STALE_MOCK' : 'PORT_TIMEOUT_MOCK' }
}
