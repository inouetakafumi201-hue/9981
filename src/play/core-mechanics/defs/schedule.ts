/**
 * 五回合阶段表与阶段边界守卫（tasks.md 任务 3.2 + 3.7 的守卫部分 / design.md 3.5）。
 *
 * 阶段顺序恒为：投点 → 结算 → 玩家行动 → NPC 行动 → 清理，长度恒为 5，`loop: true`。
 * 推进由引擎层 `schedule.advance` 执行；玩法层只声明 `PhaseDef` 数据，不自建相位推进器。
 *
 * 守卫落点说明（对 tasks.md 的一处细化）：任务 3.2 要求"每个 `PhaseDef` 的 `onEnter`/`onExit`
 * 预留守卫位（首条 `Effect` 为 `if` + `abort`），具体守卫条件在 3.7 填入"。守卫条件因此直接写在
 * 本文件里（它们是相位边界数据，属于 `PhaseDef`），而 `rules.phase.ts` 只放挂在 `play.*` 事件上的
 * `RuleDef`。两个任务的交付物都齐备，只是物理位置按"数据归 PhaseDef、规则归 RuleDef"划分。
 *
 * 推进失败不是异常：守卫 `abort` 使 `schedule.advance` 返回 `ok:false` 并整体回滚，
 * 阶段索引不变（design.md 7.4 / Requirement 7.10）。
 */
import type { ScheduleDef, PhaseDef } from '../../../core/kernel/schedule/types';
import type { Effect } from '../../../core/kernel/events/effect-types';
import { buildNumericOwnership, gameplayValue, playExt, structuralBound } from '../ownership';
import {
  and,
  candidateProp,
  clearRequest,
  emitEffect,
  eq,
  forEachEffect,
  guardEffect,
  includesOf,
  isNull,
  lenOf,
  notNull,
  opEffect,
  or,
  pathOf,
  setRequestField,
  varOf,
  vetoGuard,
} from './expr';
import {
  EVENT_OVERLOAD_TICK,
  EVENT_PHASE_SETTLE,
  EVENT_ROLL_REQUEST,
  EVENT_ROUND_INCREMENT,
  EVENT_STAMINA_GRANT,
  EVENT_STATUS_TICK,
  PATH_COMMITMENTS_DONE,
  PATH_COMMITMENTS_REQUIRED,
  PATH_NPC_QUEUE,
  PATH_PENDING_EXPIRY,
  PATH_PLAYER_QUEUE,
  PATH_REQ_OVERLOAD,
  PATH_REQ_SETTLE,
  PATH_REQ_STAMINA,
  PATH_REQ_TICK,
  PATH_ROLL_POLICY_READY,
  PATH_SETTLE_DONE,
  PATH_TURN_ORDER,
  PHASE_CLEANUP,
  PHASE_NPC_ACTION,
  PHASE_PLAYER_ACTION,
  PHASE_ROLL,
  PHASE_SETTLE,
  PROP_REMAINING_TURNS,
  PROP_VITALITY,
  REQ_FIELD_TARGET,
  REQ_FIELD_VETO,
  SCHEDULE_ID,
  TAG_OVERLOADED,
} from './ids';

/** 五阶段名（design.md 3.5 的 `CorePhaseName`）。 */
export type CorePhaseName = 'roll' | 'settle' | 'playerAction' | 'npcAction' | 'cleanup';

export interface CorePhaseSpec {
  readonly name: CorePhaseName;
  readonly id: string;
  /** 引擎层 `PhaseDef.input`。 */
  readonly input: 'none' | 'actor' | 'all';
  /** 本阶段允许的写入语义摘要（文档性字段，装载期用于交叉校验 `RuleDef` 挂载点）。 */
  readonly settles: readonly string[];
}

/** 阶段规格常量。装载期契约测试断言它与 `coreSchedule.phases` 逐项一致且长度为 5。 */
export const CORE_PHASES: readonly CorePhaseSpec[] = [
  {
    name: 'roll',
    id: PHASE_ROLL,
    input: 'all',
    settles: ['强力骰承诺收集', '投点等级生成（U-001 门禁）'],
  },
  {
    name: 'settle',
    id: PHASE_SETTLE,
    input: 'none',
    settles: ['最终等级确认', 'AP 分配', '强力骰退还', '行动顺序固定'],
  },
  {
    name: 'playerAction',
    id: PHASE_PLAYER_ACTION,
    input: 'actor',
    settles: ['按固定顺序执行付费动作与其附着动作'],
  },
  {
    name: 'npcAction',
    id: PHASE_NPC_ACTION,
    input: 'none',
    settles: ['按稳定 NPC 编号顺序执行（预算见 D-052，默认 1 AP）'],
  },
  {
    name: 'cleanup',
    id: PHASE_CLEANUP,
    input: 'none',
    settles: ['自然体力恢复', '显式状态到期', '已声明持续效果'],
  },
];

/** 空表判定用的 0：结构性判据（"队列是否已空"），不是玩家在 1-5 刻度上选择的数值。 */
const EMPTY_LENGTH = 0;

/** 清理阶段的自然体力恢复量（Requirement 6.2）：玩家可见玩法数值，恒为 1。 */
const NATURAL_STAMINA_RECOVERY = 1;

/**
 * 投点阶段 `onEnter`。
 *
 * **第一条效果**是 U-001 策略守卫：策略不齐备时 `abort`，因此它发生在任何 `random.*` 调用与
 * 任何体力扣减之前（Requirement 5.9、6.7）。在 U-001 冻结前，`rollPolicyReady` 恒为 `false`，
 * 于是标准回合循环从投点阶段起整体阻塞——这正是"未冻结项不得默认化"的预期后果，不是缺陷。
 */
const rollOnEnter: readonly Effect[] = [
  guardEffect(
    eq(pathOf(PATH_ROLL_POLICY_READY), true),
    'U-001 未冻结：基础投点等级生成策略与强力骰修正后边界策略均未审批，标准随机投点与强力骰结算阻塞。'
    + '本次阶段推进在任何命名随机流被推进、任何体力被扣减之前中止。',
  ),
  // 投点开始时推进过载归队计数：仍带过载标记的实体先 tick，再进入本轮投点。
  forEachEffect(
    { q: { from: 'entities', where: includesOf(pathOf('self.tags'), TAG_OVERLOADED) } },
    'overloadedActor',
    [
      setRequestField(PATH_REQ_OVERLOAD, REQ_FIELD_TARGET, varOf('overloadedActor')),
      emitEffect(EVENT_OVERLOAD_TICK, pathOf(PATH_REQ_OVERLOAD)),
      clearRequest(PATH_REQ_OVERLOAD),
    ],
  ),
  opEffect('prop.set', { path: PATH_COMMITMENTS_DONE, value: false }),
  // 只发出请求事件，不在此给出任何分布：分布属于 U-001（见 ids.ts 的 EVENT_ROLL_REQUEST 说明）。
  emitEffect(EVENT_ROLL_REQUEST),
];

/** 投点 → 结算：全部投点参与者的承诺已收集齐，或该玩法层配置声明本阶段无需承诺。 */
const rollOnExit: readonly Effect[] = [
  guardEffect(
    or(
      eq(pathOf(PATH_COMMITMENTS_REQUIRED), false),
      eq(pathOf(PATH_COMMITMENTS_DONE), true),
    ),
    '投点阶段仍有未收集的强力骰承诺：推进被拒绝，阶段索引不变（Requirement 7.10）。',
  ),
];

/**
 * 结算阶段 `onEnter`：在**同一事务**内完成最终等级确认、AP 分配、强力骰退还与顺序固定
 * （Requirement 5.9）。四件事的具体写入由 `play.phase.settle` 的 `default` 规则执行
 * （见 `rules.phase.ts`），本处只负责：重置完成标记 → 发出事件 → 否决守卫 → 完成度守卫 → 清请求。
 */
const settleOnEnter: readonly Effect[] = [
  opEffect('prop.set', { path: PATH_SETTLE_DONE, value: false }),
  opEffect('prop.del', { path: PATH_REQ_SETTLE }),
  emitEffect(EVENT_PHASE_SETTLE, pathOf(PATH_REQ_SETTLE)),
  vetoGuard(
    PATH_REQ_SETTLE,
    REQ_FIELD_VETO,
    '结算被 before 阶段规则否决：整个结算事务回滚，最终等级、AP 分配、退还与顺序四项均不生效。',
  ),
  guardEffect(
    eq(pathOf(PATH_SETTLE_DONE), true),
    '结算阶段未完成四项写入（最终等级确认 / AP 分配 / 强力骰退还 / 行动顺序）：整个结算事务回滚。',
  ),
  clearRequest(PATH_REQ_SETTLE),
];

/**
 * 结算 → 玩家行动：AP 分配、退还、顺序三项写入均已完成，且 `turnOrder` 长度等于应行动玩家数。
 *
 * "应行动玩家数" = `playerQueue` 的长度：两者由同一条结算规则用同一个查询结果写入，
 * 因此长度相等是"三项写入都落地"的可机械检查的必要条件。
 */
const settleOnExit: readonly Effect[] = [
  guardEffect(
    and(
      eq(pathOf(PATH_SETTLE_DONE), true),
      notNull(pathOf(PATH_TURN_ORDER)),
      notNull(pathOf(PATH_PLAYER_QUEUE)),
      eq(lenOf(pathOf(PATH_TURN_ORDER)), lenOf(pathOf(PATH_PLAYER_QUEUE))),
    ),
    '结算阶段尚未完成 AP 分配 / 强力骰退还 / 行动顺序三项写入，或行动顺序长度与应行动玩家数不一致：推进被拒绝。',
  ),
];

/** 玩家行动 → NPC 行动：执行队列已空（每名玩家 AP 耗尽或显式弃权）。 */
const playerActionOnExit: readonly Effect[] = [
  guardEffect(
    and(notNull(pathOf(PATH_PLAYER_QUEUE)), eq(lenOf(pathOf(PATH_PLAYER_QUEUE)), EMPTY_LENGTH)),
    '玩家行动阶段仍有未完成的行动者（执行队列非空）：推进被拒绝，阶段索引不变。',
  ),
];

/** NPC 行动 → 清理：NPC 队列已空。`npcBudget === null` 时该队列恒为空表，阶段直接通过。 */
const npcActionOnExit: readonly Effect[] = [
  guardEffect(
    and(notNull(pathOf(PATH_NPC_QUEUE)), eq(lenOf(pathOf(PATH_NPC_QUEUE)), EMPTY_LENGTH)),
    'NPC 行动阶段仍有未完成的 NPC（队列非空）：推进被拒绝，阶段索引不变。',
  ),
];

/**
 * 清理 → 投点：无未完成的到期结算。
 *
 * "无处于打开状态且未到期的 `Decision`" 这一条**不在此重复实现**：引擎层需求 31.4 已经保证
 * 该项（`E_INV_DECISION_TERMINATION` 不变量），玩法层不建第二套检查（design.md 4.2 第 3 条）。
 */
const cleanupOnExit: readonly Effect[] = [
  guardEffect(
    or(isNull(pathOf(PATH_PENDING_EXPIRY)), eq(pathOf(PATH_PENDING_EXPIRY), EMPTY_LENGTH)),
    '清理阶段仍有未完成的到期结算：推进被拒绝，阶段索引不变。',
  ),
];

/**
 * 清理阶段 `onEnter`（Requirement 7.9、6.2、13.4）：
 * 自然体力恢复 1（上限 5 由 `play.stamina.grant` 的 `default` 规则用 `clamp` 保证）、
 * 显式状态到期推进、已声明持续效果。每项写入都与本次 `schedule.advance` 同一事务；
 * 中途任一失败 → 整个清理阶段的写入都不生效（Requirement 7.9 的原子性）。
 */
const cleanupOnEnter: readonly Effect[] = [
  opEffect('prop.set', { path: PATH_PENDING_EXPIRY, value: EMPTY_LENGTH }),

  // ---- 自然体力恢复：每个"活体"恢复 1。活体判据 = 存在可见生命字段（零血倒地者该字段已被删除）。
  forEachEffect(
    { q: { from: 'entities', where: notNull(candidateProp(PROP_VITALITY)) } },
    'recoveryActor',
    [
      setRequestField(PATH_REQ_STAMINA, 'target', varOf('recoveryActor')),
      setRequestField(PATH_REQ_STAMINA, 'amount', NATURAL_STAMINA_RECOVERY),
      emitEffect(EVENT_STAMINA_GRANT, pathOf(PATH_REQ_STAMINA)),
      vetoGuard(PATH_REQ_STAMINA, REQ_FIELD_VETO, '自然体力恢复被 before 阶段规则否决：整个清理阶段回滚。'),
      clearRequest(PATH_REQ_STAMINA),
    ],
  ),

  // ---- 状态到期推进：只处理带 `remainingTurns` 的回合型状态（条件持续状态不在此列，
  //      因此格挡与隐蔽不会因回合结束被移除，Requirement 14.2）。
  forEachEffect(
    { q: { from: 'attachments', where: notNull(candidateProp(PROP_REMAINING_TURNS)) } },
    'tickAttachment',
    [
      setRequestField(PATH_REQ_TICK, 'attachment', varOf('tickAttachment')),
      emitEffect(EVENT_STATUS_TICK, pathOf(PATH_REQ_TICK)),
      vetoGuard(PATH_REQ_TICK, REQ_FIELD_VETO, '状态到期推进被 before 阶段规则否决：整个清理阶段回滚。'),
      clearRequest(PATH_REQ_TICK),
    ],
  ),
];

/** 五个 `PhaseDef`。`phaseKind` 表达 Intent 时序：投点=submit、结算=resolve、其余=normal。 */
const phases: PhaseDef[] = [
  {
    id: PHASE_ROLL,
    name: '投点阶段',
    phaseKind: 'submit',
    input: 'all',
    onEnter: [...rollOnEnter],
    onExit: [...rollOnExit],
  },
  {
    id: PHASE_SETTLE,
    name: '结算阶段',
    phaseKind: 'resolve',
    input: 'none',
    onEnter: [...settleOnEnter],
    onExit: [...settleOnExit],
  },
  {
    id: PHASE_PLAYER_ACTION,
    name: '玩家行动阶段',
    phaseKind: 'normal',
    input: 'actor',
    onExit: [...playerActionOnExit],
  },
  {
    id: PHASE_NPC_ACTION,
    name: 'NPC 行动阶段',
    phaseKind: 'normal',
    input: 'none',
    onExit: [...npcActionOnExit],
  },
  {
    id: PHASE_CLEANUP,
    name: '清理阶段',
    phaseKind: 'normal',
    input: 'none',
    onEnter: [...cleanupOnEnter],
    onExit: [...cleanupOnExit],
  },
];

/** 阶段表本体（不含 `play` 扩展），供归属自检使用。 */
const scheduleBody = {
  id: SCHEDULE_ID,
  kind: 'schedule' as const,
  phases,
  loop: true,
  /** cleanup→roll 回绕时先发 round.increment，再回到投点阶段。 */
  roundEnd: [emitEffect(EVENT_ROUND_INCREMENT)],
  /** 固定顺序：玩家行动顺序由结算阶段写入 `turnOrder`，不交给引擎层的 initiative 排序。 */
  order: 'fixed' as const,
};

/**
 * 五阶段回合表。
 *
 * 数值归属按**语义位置**声明（`buildNumericOwnership` 的规则表），未命中的数值会在模块初始化时
 * 直接抛错——理由见 `ownership.ts` 的 `buildNumericOwnership` 文档。
 */
export const coreSchedule: ScheduleDef = {
  ...scheduleBody,
  play: playExt({
    numericOwnership: buildNumericOwnership(
      scheduleBody,
      [
        {
          pathSuffix: 'args.value',
          whenValue: (value) => value === EMPTY_LENGTH,
          ownership: structuralBound('队列/计数的空值初始化：0 表示"没有条目"，是结构性判据，不是玩家可见刻度。'),
        },
        {
          pathSuffix: 'args.value',
          whenValue: (value) => value === NATURAL_STAMINA_RECOVERY,
          ownership: gameplayValue(),
        },
        {
          pathSuffix: 'args.1',
          whenValue: (value) => value === EMPTY_LENGTH,
          ownership: structuralBound('长度比较的右操作数：判断队列是否为空，不是玩家可见刻度。'),
        },
      ],
      `${SCHEDULE_ID} 的数值归属`,
    ),
    sourceTrace: ['Req 7.1', 'Req 7.9', 'Req 7.10', 'Req 6.2', 'Req 13.4', 'D-008', 'S5 完整回合流程'],
  }),
};

/** 契约自检：阶段数恒为 5，且与 `CORE_PHASES` 逐项一致（Id 与顺序都不得漂移）。 */
export const CORE_PHASE_COUNT = 5;
