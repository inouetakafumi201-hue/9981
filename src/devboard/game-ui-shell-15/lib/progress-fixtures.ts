/**
 * V0-04 — read-only fixtures for the four independent progress pages
 * (stats / achievements / codex / recap) and the objective tracker.
 *
 * Every value is a `displayValue` string: the shell displays it verbatim and
 * performs no arithmetic, no aggregation and no unlock logic. Comparison
 * groups and on-screen lists are capped at 5 items by contract.
 */

export const PROGRESS_MAX_VISIBLE = 5

export interface StatEntry { statId: string; label: string; displayValue: string; category: string; comparisonGroup?: string }
export interface AchievementEntry { achievementId: string; title: string; description: string; state: 'locked' | 'in-progress' | 'unlocked'; progressLabel?: string }
export interface CodexEntry { entryId: string; category: 'enemy' | 'item' | 'location'; unlocked: boolean; title: string; description?: string; weaknesses?: string[] }
export interface RecapEntry { eventId: string; occurredAtLabel: string; title: string; summary: string; category: 'story' | 'dialogue' | 'choice' }
export interface ObjectiveEntry {
  objectiveId: string
  label: string
  detail: string
  /** Where in the world this objective is anchored. Text only — no topology. */
  anchorLabel: string
  distanceLabel: string
  state: 'active' | 'blocked' | 'complete'
  /** Explains a blocked objective so the state is never bare. */
  blockedReason?: string
}

export const STAT_FIXTURES: StatEntry[] = [
  { statId: 's1', label: '累计游玩时间', displayValue: '14 小时 22 分', category: '总览' },
  { statId: 's2', label: '完成任务', displayValue: '18', category: '总览' },
  { statId: 's3', label: '深潜次数', displayValue: '31', category: '总览' },
  { statId: 's4', label: '击杀 · 常规', displayValue: '204', category: '战斗', comparisonGroup: '击杀分类' },
  { statId: 's5', label: '击杀 · 精英', displayValue: '27', category: '战斗', comparisonGroup: '击杀分类' },
  { statId: 's6', label: '击杀 · 首领', displayValue: '5', category: '战斗', comparisonGroup: '击杀分类' },
  { statId: 's7', label: '死亡次数', displayValue: '12', category: '战斗' },
  { statId: 's8', label: '探索区域', displayValue: '9 / 14', category: '探索' },
]

export const ACHIEVEMENT_FIXTURES: AchievementEntry[] = [
  { achievementId: 'a1', title: '初次深潜', description: '完成第一次匹配下潜。', state: 'unlocked' },
  { achievementId: 'a2', title: '毫发无伤', description: '在一次深潜中未受任何损伤。', state: 'unlocked' },
  { achievementId: 'a3', title: '锲而不舍', description: '累计完成 25 个任务。', state: 'in-progress', progressLabel: '18 / 25' },
  { achievementId: 'a4', title: '深渊回响', description: '抵达深潜网络的最深层。', state: 'locked' },
  { achievementId: 'a5', title: '收藏家', description: '解锁全部图鉴条目。', state: 'in-progress', progressLabel: '6 / 20' },
  { achievementId: 'a6', title: '守夜人', description: '在安全区连续驻留三个周期。', state: 'locked' },
]

export const CODEX_FIXTURES: CodexEntry[] = [
  { entryId: 'c1', category: 'enemy', unlocked: true, title: '锚定导流仪', description: '扫描型障碍，会周期性发出探测脉冲。', weaknesses: ['窗口期贴墙', '信号干扰弹'] },
  { entryId: 'c2', category: 'enemy', unlocked: false, title: '？？？' },
  { entryId: 'c3', category: 'item', unlocked: true, title: '回收零件', description: '深潜途中最常见的可回收物资，用于补充信号强度。' },
  { entryId: 'c4', category: 'item', unlocked: true, title: '中继钥匙', description: '开启中继站封锁门的一次性密钥。' },
  { entryId: 'c5', category: 'item', unlocked: false, title: '？？？' },
  { entryId: 'c6', category: 'location', unlocked: true, title: '第七区 · 中继站', description: '深潜网络的关键节点，信号在此第一次变得清晰。' },
  { entryId: 'c7', category: 'location', unlocked: false, title: '？？？' },
]

export const RECAP_FIXTURES: RecapEntry[] = [
  { eventId: 'v1', occurredAtLabel: '第 1 天', title: '苏醒', summary: '你在一间陌生的房间里醒来，信号从墙缝间渗进来。', category: 'story' },
  { eventId: 'v2', occurredAtLabel: '第 1 天', title: '与记录者的第一次通话', summary: '「你还没真正醒来。」——一个自称记录者的声音这样说。', category: 'dialogue' },
  { eventId: 'v3', occurredAtLabel: '第 2 天', title: '关键抉择：信标', summary: '你选择了回收信标核心，而不是原地销毁它。', category: 'choice' },
  { eventId: 'v4', occurredAtLabel: '第 3 天', title: '抵达中继站', summary: '第七区中继站的封锁门在你面前打开。', category: 'story' },
  { eventId: 'v5', occurredAtLabel: '第 4 天', title: '断裂的誓约', summary: '一条无法挽回的路线，永远留在了日志里。', category: 'choice' },
]

export const OBJECTIVE_FIXTURES: ObjectiveEntry[] = [
  { objectiveId: 'o1', label: '接入锚定导流仪', detail: '在驻地西侧建立稳定坐标。', anchorLabel: '驻地 · 西侧设备位', distanceLabel: '同一房间', state: 'active' },
  { objectiveId: 'o2', label: '等待同频信号', detail: '匹配期间可在驻地自由漫游。', anchorLabel: '驻地 · 任意位置', distanceLabel: '无需移动', state: 'active' },
  { objectiveId: 'o3', label: '前往床 A', detail: '床 A 是唯一正式竞技入局门。', anchorLabel: '驻地 · 床位 A', distanceLabel: '同一房间', state: 'blocked', blockedReason: '影子中继尚未就绪，床 A 还没有点亮。' },
  { objectiveId: 'o4', label: '回收信标核心', detail: '完成后返回驻地原位置。', anchorLabel: '第七区 · 中继站', distanceLabel: '需完成一次下潜', state: 'blocked', blockedReason: '需要先建立一次稳定的下潜连接。' },
  { objectiveId: 'o5', label: '确认首次结算', detail: '结算与奖励确认已完成。', anchorLabel: '驻地 · 原出发位置', distanceLabel: '已抵达', state: 'complete' },
]

export const LOCATION_FIXTURE = {
  locationId: 'loc-07-relay',
  title: '第七区 · 中继站',
  subtitle: 'SECTOR 07 // RELAY STATION',
  note: '信号在这里第一次变得清晰。',
}
