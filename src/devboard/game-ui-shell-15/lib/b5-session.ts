export type B5Stage = 'dialogue' | 'choice' | 'quest' | 'guidance' | 'archive'

export type B5Choice = 'trust' | 'verify' | 'observe' | 'confront'

export interface B5Session {
  stage: B5Stage
  choice: B5Choice | null
  trackedQuestId: string
  tutorialSeen: boolean
  archiveUnlocked: boolean
  revision: number
}

export const INITIAL_B5_SESSION: B5Session = {
  stage: 'dialogue',
  choice: null,
  trackedQuestId: 'q-main-01',
  tutorialSeen: false,
  archiveUnlocked: false,
  revision: 0,
}

export const B5_STAGES: Array<{ id: B5Stage; label: string }> = [
  { id: 'dialogue', label: '接通信号' },
  { id: 'choice', label: '作出判断' },
  { id: 'quest', label: '追踪目标' },
  { id: 'guidance', label: '进入区域' },
  { id: 'archive', label: '写入回顾' },
]

export const B5_CHOICE_COPY: Record<B5Choice, { label: string; result: string }> = {
  trust: { label: '相信她，继续前进', result: '你决定相信记录者。中继站坐标被写入任务日志。' },
  verify: { label: '先自己确认一遍', result: '你保留判断，要求先扫描三处信号锚点。' },
  observe: { label: '什么都不做，观察情况', result: '你没有回应。沉默让隐藏的载波变得清晰。' },
  confront: { label: '直接质问她的动机', result: '你要求真相。记录者开放了一段被封锁的档案。' },
}
