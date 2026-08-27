export type UiSource = 'mock' | 'projection'
export type ScreenState = 'ready' | 'empty' | 'loading' | 'pending' | 'accepted' | 'rejected' | 'stale' | 'timeout' | 'retrying' | 'safe-return'

export interface StateSnapshot<T = unknown> {
  source: UiSource
  revision: number
  screenState: ScreenState
  data: T
  reason?: string
  updatedAtLabel?: string
}

export const SCREEN_STATE_LABELS: Record<ScreenState, string> = {
  ready: '就绪', empty: '暂无记录', loading: '载入中', pending: '等待确认', accepted: '已确认', rejected: '已拒绝', stale: '版本过期', timeout: '请求超时', retrying: '正在重试', 'safe-return': '安全返回',
}

export const SOURCE_LABELS: Record<UiSource, string> = { mock: 'MOCK', projection: 'PROJECTION' }

export const createMockSnapshot = <T,>(data: T, revision = 1, screenState: ScreenState = 'ready'): StateSnapshot<T> => ({
  source: 'mock', revision, screenState, data, updatedAtLabel: 'LOCAL FIXTURE',
})
