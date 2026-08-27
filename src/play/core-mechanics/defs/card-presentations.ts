/**
 * 双轨制 P1-B3：CardPresentationDef 实例注册
 *
 * 每个 track === 'card' 的付费动作都有一个对应的 CardPresentationDef，
 * 为 BattleHud 卡片轨提供渲染元数据（icon / colorTheme / effectText / interactionMode）。
 *
 * 设计原则：
 * - icon：静态资源路径；V0 DevBoard 阶段使用占位 SVG path，生产阶段替换为纹理 atlas 坐标
 * - colorTheme：动作语义派生（attack=aggressive / shield=defensive / vehicle=utility / sleep=mystical / movement=neutral）
 * - effectText：直接用动作语义静态值；未来通过 Expr 动态求值
 * - interactionMode：目标型（target）/ 开关型（toggle）/ 即时型（instant）
 *
 * CardPresentationDef 与所有玩法层 Def 一样，必须挂 play 扩展命名空间（numericOwnership / sourceTrace），
 * 装载期 Linter 否则会拒绝（E_LOAD_NUMERIC_OWNERSHIP / E_LOAD_NORMATIVE_WITHOUT_PROVENANCE）。
 */

import type { Def } from '../../../core/kernel/state/def'
import { playExt } from '../ownership'

// ---------------------------------------------------------------------------
// Icon asset paths — V0 DevBoard 阶段使用 SVG 精灵路径
// ---------------------------------------------------------------------------
const ICON = {
  MOVE:         'icons/action/move.svg',
  CRAWL:        'icons/action/crawl.svg',
  PICKUP:       'icons/action/pickup.svg',
  ATTACK:       'icons/action/attack.svg',
  TIDY:         'icons/action/tidy.svg',
  BOARD:        'icons/action/board.svg',
  LEAVE:        'icons/action/leave.svg',
  SHIELD:       'icons/action/shield.svg',
  SLEEP_DOWN:   'icons/action/sleep.svg',
  WAKE_UP:      'icons/action/wake.svg',
  STAND_UP:     'icons/action/stand.svg',
  ETERNAL:      'icons/action/eternal.svg',
  PRECISE_B:    'icons/action/precise-b.svg',
  PRECISE_C:    'icons/action/precise-c.svg',
  TRANSIT_B:    'icons/action/transit-b.svg',
  TRANSIT_C:    'icons/action/transit-c.svg',
} as const

// ---------------------------------------------------------------------------
// Helper：把 CardPresentationDef 业务字段包装成合法 Def（含 play 扩展）
// ---------------------------------------------------------------------------
type CardPresentationBody = Omit<Def, 'id' | 'kind' | 'play'>

function cardPresentation(
  id: string,
  body: Omit<CardPresentationBody, 'play'> & { readonly tags?: readonly string[] },
  sourceTrace: readonly string[],
): Def {
  return {
    id,
    kind: 'card-presentation',
    ...body,
    play: playExt({ sourceTrace }),
  } as Def
}

// ---------------------------------------------------------------------------
// CardPresentationDef instances — 与 actions.paid.ts 的 15 个 paidAction 一一对应
// ---------------------------------------------------------------------------
export const CARD_PRESENTATIONS: readonly Def[] = Object.freeze([
  // ── 移动组 ──────────────────────────────────────────────────────────────
  cardPresentation('cp:move', {
    icon: ICON.MOVE,
    colorTheme: 'neutral',
    effectText: '移动至相邻节点',
    interactionMode: 'target',
    tags: ['movement'],
  }, ['Req 6.1', 'S0 行动点系统']),

  cardPresentation('cp:crawl', {
    icon: ICON.CRAWL,
    colorTheme: 'neutral',
    effectText: '俯卧移动（低矮节点）',
    interactionMode: 'target',
    tags: ['movement'],
  }, ['Req 6.1', 'Req 12.2', 'S5 普通倒地']),

  cardPresentation('cp:pickup', {
    icon: ICON.PICKUP,
    colorTheme: 'neutral',
    effectText: '拾取节点上的物品',
    interactionMode: 'instant',
    tags: ['item'],
  }, ['Req 6.1', 'Req 4.7', 'S5 AP 消耗类型']),

  // ── 战斗组 ──────────────────────────────────────────────────────────────
  cardPresentation('cp:attack', {
    icon: ICON.ATTACK,
    colorTheme: 'aggressive',
    effectText: '对目标造成伤害',
    interactionMode: 'target',
    tags: ['combat'],
  }, ['Req 6.1', 'Req 11.2', 'T-001 伤害表']),

  // ── 管理组 ──────────────────────────────────────────────────────────────
  cardPresentation('cp:tidy', {
    icon: ICON.TIDY,
    colorTheme: 'utility',
    effectText: '整理背包腾出空位',
    interactionMode: 'instant',
    tags: ['inventory'],
  }, ['Req 6.1', 'Req 3.8', 'S0 五并列']),

  // ── 载具组 ─────────────────────────────────────────────────────────────
  cardPresentation('cp:board-vehicle', {
    icon: ICON.BOARD,
    colorTheme: 'utility',
    effectText: '登载具节点',
    interactionMode: 'instant',
    tags: ['vehicle'],
  }, ['Req 6.1', 'Req 18 stable 契约 space-items']),

  cardPresentation('cp:leave-vehicle', {
    icon: ICON.LEAVE,
    colorTheme: 'utility',
    effectText: '离开载具节点',
    interactionMode: 'instant',
    tags: ['vehicle'],
  }, ['Req 6.1', 'Req 18 stable 契约 space-items']),

  // ── 防御组 ─────────────────────────────────────────────────────────────
  cardPresentation('cp:raise-shield', {
    icon: ICON.SHIELD,
    colorTheme: 'defensive',
    effectText: '激活护盾：抵消一次伤害',
    interactionMode: 'toggle',
    tags: ['defense'],
  }, ['Req 6.1', 'Req 14.1', 'D-009']),

  // ── 睡眠/苏醒组 ─────────────────────────────────────────────────────────
  cardPresentation('cp:sleep-down', {
    icon: ICON.SLEEP_DOWN,
    colorTheme: 'mystical',
    effectText: '主动入睡（跳过本回合）',
    interactionMode: 'instant',
    tags: ['sleep'],
  }, ['Req 6.1', 'Req 6.11', 'Req 15.4']),

  cardPresentation('cp:wake-up', {
    icon: ICON.WAKE_UP,
    colorTheme: 'mystical',
    effectText: '唤醒入睡的单位',
    interactionMode: 'instant',
    tags: ['sleep'],
  }, ['Req 6.1', 'Req 6.11', 'Req 15.4']),

  cardPresentation('cp:stand-up', {
    icon: ICON.STAND_UP,
    colorTheme: 'mystical',
    effectText: '从倒地状态站起',
    interactionMode: 'instant',
    tags: ['sleep'],
  }, ['Req 6.1', 'Req 12.3', 'S5 普通倒地']),

  cardPresentation('cp:eternal-sleep', {
    icon: ICON.ETERNAL,
    colorTheme: 'mystical',
    effectText: '使目标永久入睡（无法唤醒）',
    interactionMode: 'target',
    tags: ['sleep', 'combat'],
  }, ['Req 6.1', 'Req 12.5', 'Req 12.6', 'Req 12.11']),

  // ── 精密操作组 ──────────────────────────────────────────────────────────
  cardPresentation('cp:precise-begin', {
    icon: ICON.PRECISE_B,
    colorTheme: 'utility',
    effectText: '开始精密操作（本回合无法移动）',
    interactionMode: 'instant',
    tags: ['precision'],
  }, ['Req 6.1', 'Req 9.1', 'Req 9.2', 'S5 精密交互']),

  cardPresentation('cp:precise-complete', {
    icon: ICON.PRECISE_C,
    colorTheme: 'utility',
    effectText: '完成精密操作（需先执行 begin）',
    interactionMode: 'instant',
    tags: ['precision'],
  }, ['Req 6.1', 'Req 9.2', 'Req 9.5', 'Req 9.7']),

  // ── 传送组 ─────────────────────────────────────────────────────────────
  cardPresentation('cp:transit-begin', {
    icon: ICON.TRANSIT_B,
    colorTheme: 'mystical',
    effectText: '建立传送门连接（需相邻节点）',
    interactionMode: 'target',
    tags: ['transit'],
  }, ['Req 6.1', 'Req 9.6', 'Req 4.3']),

  cardPresentation('cp:transit-complete', {
    icon: ICON.TRANSIT_C,
    colorTheme: 'mystical',
    effectText: '完成传送（需先建立连接）',
    interactionMode: 'instant',
    tags: ['transit'],
  }, ['Req 6.1', 'Req 9.6', 'Req 9.7']),
])

/** 按 id 快速查找 */
export const CARD_PRESENTATION_BY_ID = Object.fromEntries(
  CARD_PRESENTATIONS.map((cp) => [cp.id, cp]),
) as Readonly<Record<string, Def>>
