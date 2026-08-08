/**
 * 阶段结算、体力授予、令其长眠与死亡背包只出不进规则（tasks.md 任务 3.7-3.8 / design.md 3.3、3.4、3.11）。
 *
 * DEVIATION-07（如实记录，需人工确认）：结算阶段的 AP 差值分配在本文件里以**声明式 Flow**
 * 重新表达。它与 `allocation.ts` 的纯函数 `allocateAp` 是**同一算法的两个实现**：
 * - `allocateAp`（纯 TS）是 Requirement 5.12 指定的、可脱离随机独立验证的权威实现；
 * - 本文件的 settle 规则是运行期落地实现（写 AP 池、退还、行动顺序）。
 * 两者必须保持一致。由于整条投点→结算链路被 U-001 门禁阻塞（`roll` 阶段 onEnter 的守卫在
 * `rollPolicyReady` 为 false 时 abort），本 settle 规则在标准配置下**不会执行**；它只在 U-001
 * 冻结、且提供了已审批投点策略后才被触发。因此其运行期一致性验证属于 U-001 解冻后的集成范围，
 * 不在本次交付的检查点内。这不是占位实现——算法逐条对应 5.4-5.8 与 D-037 档位裁剪。
 */
import type { RuleDef } from '../../../core/kernel/events/types.js';
import type { Effect } from '../../../core/kernel/events/effect-types.js';
import type { Expr } from '../../../core/kernel/state/expr-types.js';
import type { NumericOwnershipRule } from '../ownership.js';
import { constitutionalConstant, internalMetric, structuralBound } from '../ownership.js';
import { playRule } from './rules.damage.js';
import {
  addNum,
  and,
  atOf,
  coalesce,
  emitEffect,
  entityPropPath,
  eq,
  forEachEffect,
  getOf,
  gte,
  hasTag,
  ifEffect,
  includesOf,
  isNull,
  lenOf,
  letEffect,
  lt,
  minNum,
  mulNum,
  not,
  notNull,
  opEffect,
  pathOf,
  poolFieldPath,
  poolFieldRead,
  refExists,
  refGet,
  refId,
  requestField,
  setRequestField,
  subNum,
  varOf,
} from './expr.js';
import {
  ATT_BOOST_COMMITMENT,
  DEATH_BAG_CONTAINER_NAME,
  ENTITY_DEATH_BAG,
  EVENT_DEATH_SETTLED,
  EVENT_ETERNAL_SLEEP_REQUEST,
  EVENT_PHASE_SETTLE,
  EVENT_STAMINA_GRANT,
  PATH_NO_DEPOSIT_CONTAINERS,
  PATH_NPC_QUEUE,
  PATH_PLAYER_QUEUE,
  PATH_REQ_ETERNAL_SLEEP,
  PATH_REQ_STAMINA,
  PATH_SETTLE_SCRATCH,
  PATH_SETTLE_DONE,
  PATH_TURN_ORDER,
  POOL_AP,
  POOL_STAMINA,
  PROP_ROLL_TIER,
  PROP_SORT_KEY,
  PROP_STAMINA_COST,
  REQ_FIELD_ACTOR,
  REQ_FIELD_AMOUNT,
  REQ_FIELD_DEATH_BAG,
  REQ_FIELD_TARGET,
  REQ_FIELD_TO_MAX,
  REQ_FIELD_VETO,
  RULE_DEATH_BAG_NO_DEPOSIT,
  RULE_ETERNAL_SLEEP_DEFAULT,
  RULE_PHASE_SETTLE_DEFAULT,
  RULE_STAMINA_GRANT_DEFAULT,
  STAMINA_MAX,
  TAG_DOWNED_ZERO,
  TAG_NO_DEPOSIT,
  TAG_ROLL_PARTICIPANT,
  TIE_BREAK_SIDES,
  RNG_STREAM_TURN_ORDER_TIE,
} from './ids.js';

/**
 * 结算/体力授予/长眠规则里的数值归属。
 *
 * 这三条规则是**算法型**的：它们的数值字面量是计算中间常量（如 AP 档位 2/3、领先量哨兵 99）、
 * 排序权重（10000/100）、随机流骰面数（100）与刻度上限（5）。**真正写入玩家可见字段的值一律
 * 经由变量或引用**（`varOf('ap')`、`varOf('healed')`），不是字面量。因此除刻度上限 5（宪法常量）
 * 与 priority（结算次序）外，其余字面量统一归为 Internal_Metric——它们不是玩家可配置的平衡赋值。
 * 这条兜底规则用通配后缀 `*`，并在最后匹配，前面的具体规则优先。
 */
const PHASE_OWNERSHIP_RULES: readonly NumericOwnershipRule[] = [
  { pathSuffix: 'priority', ownership: internalMetric('规则结算次序编号。') },
  { pathSuffix: 'sides', ownership: structuralBound('同分定序随机流骰面数：结构性参数，仅用于打破并列，不呈现给玩家。') },
  { pathSuffix: '*', whenValue: (value) => value === STAMINA_MAX, ownership: constitutionalConstant('S0 四·4.2 / D-007：生命与体力刻度上限 5。') },
  { pathSuffix: '*', ownership: internalMetric('结算/体力授予/长眠算法的中间常量、计算权重或档位阈值；写入玩家可见字段的值经由变量而非字面量。') },
];

/** 投点参与者判据：带参与者标记且已生成最终投点等级。 */
const PARTICIPANT_PRED: Expr = and(
  includesOf(pathOf('self.tags'), TAG_ROLL_PARTICIPANT),
  notNull(pathOf(`self.props.${PROP_ROLL_TIER}`)),
);

const participantsQuery: Expr = { q: { from: 'entities', where: PARTICIPANT_PRED } };

/** 一个足够大的领先量常量：用于"唯一最高且下方无人"时表达"领先 >= 2 恒成立"。 */
const LEAD_UNBOUNDED = 99;

/** 结算规则用的构造器：本文件的数值归属规则与 rules.damage 的 playRule 不同，单独走一份。 */
function phaseRule(input: {
  readonly id: string;
  readonly on: string;
  readonly phase: 'before' | 'default' | 'after';
  readonly priority: number;
  readonly when?: Expr;
  readonly effects: readonly Effect[];
  readonly sourceTrace: readonly string[];
}): RuleDef {
  return playRule({ ...input, ownershipRules: PHASE_OWNERSHIP_RULES });
}

/**
 * play.phase.settle default：在同一事务内完成最终等级确认、AP 分配、强力骰退还、行动顺序固定
 * （Requirement 5.9）。算法逐条对应 allocation.ts 的 allocateAp（DEVIATION-07）。
 */
export const phaseSettleRule: RuleDef = phaseRule({
  id: RULE_PHASE_SETTLE_DEFAULT,
  on: EVENT_PHASE_SETTLE,
  phase: 'default',
  priority: 100,
  effects: [
    // 清除上一回合遗留的排序键，避免跨回合漂移。
    forEachEffect(participantsQuery, 'stale', [
      opEffect('prop.del', { path: entityPropPath(refId(varOf('stale')), PROP_SORT_KEY) }),
    ]),
    letEffect('participants', participantsQuery),
    letEffect('count', lenOf(varOf('participants'))),
    ifEffect(
      eq(varOf('count'), 0),
      // 无参与者：写空顺序表，标记完成（长度相等 0==0，推进守卫通过）。
      finalizeSettle({ order: emptyArray() }),
      allocateAndOrder(),
    ),
  ],
  sourceTrace: ['Req 5.9', 'Req 5.4', 'Req 5.5', 'Req 5.6', 'Req 5.7', 'Req 5.8', 'Req 7.6', 'D-037'],
});

/** 空数组字面量表达式。 */
function emptyArray(): Expr {
  return { op: 'array', args: [] };
}

/** 写入行动顺序 + 玩家队列 + 空 NPC 队列 + 完成标记。 */
function finalizeSettle(input: { readonly order: Expr }): Effect[] {
  return [
    opEffect('prop.set', { path: PATH_TURN_ORDER, value: input.order }),
    opEffect('prop.set', { path: PATH_PLAYER_QUEUE, value: input.order }),
    // NPC 队列由 NPC 行动阶段按稳定编号构建；结算阶段先置空（无 NPC 时守卫直接通过）。
    opEffect('prop.set', { path: PATH_NPC_QUEUE, value: emptyArray() }),
    opEffect('prop.set', { path: PATH_SETTLE_DONE, value: true }),
  ];
}

/** 主分配路径（参与者 >= 1）。 */
function allocateAndOrder(): Effect[] {
  return [
    // ---- 预备量：最高等级、并列最高数、领先量、档位上限 ----
    letEffect('sortedTop', { q: { from: 'entities', where: PARTICIPANT_PRED, orderBy: pathOf(`self.props.${PROP_ROLL_TIER}`), desc: true, limit: 1 } }),
    letEffect('maxTier', refGet(atOf(varOf('sortedTop'), 0), `props.${PROP_ROLL_TIER}`)),
    letEffect('atMax', { q: { from: 'entities', where: and(PARTICIPANT_PRED, eq(pathOf(`self.props.${PROP_ROLL_TIER}`), varOf('maxTier'))) } }),
    letEffect('countAtMax', lenOf(varOf('atMax'))),
    letEffect('below', { q: { from: 'entities', where: and(PARTICIPANT_PRED, lt(pathOf(`self.props.${PROP_ROLL_TIER}`), varOf('maxTier'))), orderBy: pathOf(`self.props.${PROP_ROLL_TIER}`), desc: true, limit: 1 } }),
    ifEffect(
      eq(lenOf(varOf('below')), 0),
      // 唯一最高且下方无人：领先量视为足够大（必然满足"领先 >= 2"）。
      [letEffect('lead', LEAD_UNBOUNDED)],
      [letEffect('lead', subNum(varOf('maxTier'), refGet(atOf(varOf('below'), 0), `props.${PROP_ROLL_TIER}`)))],
    ),
    ifEffect(gte(varOf('count'), 3), [letEffect('cap', 3)], [letEffect('cap', 2)]),

    // ---- 逐参与者分配 AP / 退还强力骰 / 计算排序键 ----
    forEachEffect(participantsQuery, 'p', allocateOne()),

    // ---- 行动顺序：仅含已分配 AP 者（带 sortKey），按复合键降序 ----
    letEffect('order', { q: { from: 'entities', where: and(PARTICIPANT_PRED, notNull(pathOf(`self.props.${PROP_SORT_KEY}`))), orderBy: pathOf(`self.props.${PROP_SORT_KEY}`), desc: true } }),
    ...finalizeSettle({ order: varOf('order') }),
  ];
}

/** 单个参与者的分配：对应 allocateAp 的 per-participant 分支。 */
function allocateOne(): Effect[] {
  return [
    letEffect('tier', refGet(varOf('p'), `props.${PROP_ROLL_TIER}`)),
    letEffect('pid', refId(varOf('p'))),
    // 分支 1-2：最高者的 raw AP，再套档位上限（D-037）。
    ifEffect(
      eq(varOf('tier'), varOf('maxTier')),
      [
        ifEffect(
          and(eq(varOf('countAtMax'), 1), gte(varOf('lead'), 2)),
          [letEffect('rawAp', 3)],
          [letEffect('rawAp', 2)],
        ),
        letEffect('ap', minNum(varOf('rawAp'), varOf('cap'))),
      ],
      // 分支 3-4：非最高者按差值。
      [
        ifEffect(
          eq(subNum(varOf('maxTier'), varOf('tier')), 1),
          [letEffect('ap', 1)],
          [letEffect('ap', 0)],
        ),
      ],
    ),
    // 掷同分定序值（命名随机流，Requirement 7.4）。
    opEffect('random.roll', { sides: TIE_BREAK_SIDES, stream: RNG_STREAM_TURN_ORDER_TIE }, 'tie'),
    ifEffect(
      gte(varOf('ap'), 1),
      allocatedBranch(),
      unallocatedBranch(),
    ),
  ];
}

/**
 * 已分配 AP：成对写入 available 与 real（design.md 11.6 的成对写入纪律），写复合排序键。
 * 复合键 = ap*10000 + tier*100 - tieBreak（降序：AP 高优先 → 等级高优先 → tieBreak 小优先）。
 */
function allocatedBranch(): Effect[] {
  return [
    opEffect('prop.set', { path: poolFieldPath(POOL_AP, varOf('pid'), 'available'), value: varOf('ap') }),
    opEffect('prop.set', { path: poolFieldPath(POOL_AP, varOf('pid'), 'real'), value: varOf('ap') }),
    opEffect('prop.set', {
      path: entityPropPath(varOf('pid'), PROP_SORT_KEY),
      value: subNum(addNum(mulNum(varOf('ap'), 10000), mulNum(varOf('tier'), 100)), varOf('tie')),
    }),
  ];
}

/**
 * 未分配 AP（Requirement 5.7、6.8）：全额退还本回合为强力骰冻结的体力。
 *
 * 不写 sortKey（因此不进入行动顺序/玩家队列）。不写 AP 池的 available/real（保持字段缺失 =
 * 离散状态"未分配 AP"，design.md 3.2 第 3 条 / 5.3 投影规则）。退还量取自强力骰承诺 Attachment
 * 的 props.staminaCost；退还写回 stamina 的 available 与 real（成对，design.md 11.6 纪律）。
 */
function unallocatedBranch(): Effect[] {
  return [
    letEffect('commitment', {
      q: { from: 'attachments', where: and(eq(pathOf('self.def'), ATT_BOOST_COMMITMENT), eq(pathOf('self.target'), varOf('p'))) },
    }),
    ifEffect(
      eq(lenOf(varOf('commitment')), 1),
      [
        letEffect('refund', refGet(atOf(varOf('commitment'), 0), `props.${PROP_STAMINA_COST}`)),
        ifEffect(
          and(notNull(varOf('refund')), gte(varOf('refund'), 1)),
          [
            opEffect('prop.add', { path: poolFieldPath(POOL_STAMINA, varOf('pid'), 'available'), delta: varOf('refund') }),
            opEffect('prop.add', { path: poolFieldPath(POOL_STAMINA, varOf('pid'), 'real'), delta: varOf('refund') }),
          ],
          [],
        ),
      ],
      [],
    ),
  ];
}

const staminaTarget = requestField(PATH_REQ_STAMINA, REQ_FIELD_TARGET);
const staminaAmount = requestField(PATH_REQ_STAMINA, REQ_FIELD_AMOUNT);
const staminaToMax = requestField(PATH_REQ_STAMINA, REQ_FIELD_TO_MAX);
const staminaNotVetoed = isNull(requestField(PATH_REQ_STAMINA, REQ_FIELD_VETO));

/**
 * play.stamina.grant default（Requirement 6.2、6.14、15.8）：体力恢复，上限恒为 5。
 *
 * 显式 clamp 到 5（pool 路径不经 Def.clamp，见 prop.add 的 parsePropsPath 只认 entities/items/... 前缀）。
 * toMax（起床、令其长眠）直接置 5；固定量则 min(current + amount, 5)。available 与 real 成对写入。
 * 达上限保持 5，不触发任何过载（U-003 未冻结，design.md 3.4）。
 */
export const staminaGrantRule: RuleDef = phaseRule({
  id: RULE_STAMINA_GRANT_DEFAULT,
  on: EVENT_STAMINA_GRANT,
  phase: 'default',
  priority: 100,
  when: staminaNotVetoed,
  effects: [
    letEffect('sid', refId(staminaTarget)),
    ifEffect(
      eq(staminaToMax, true),
      [
        opEffect('prop.set', { path: poolFieldPath(POOL_STAMINA, varOf('sid'), 'available'), value: STAMINA_MAX }),
        opEffect('prop.set', { path: poolFieldPath(POOL_STAMINA, varOf('sid'), 'real'), value: STAMINA_MAX }),
      ],
      [
        letEffect('curr', coalesce(poolFieldRead(POOL_STAMINA, varOf('sid'), 'real'), 0)),
        letEffect('next', minNum(addNum(varOf('curr'), staminaAmount), STAMINA_MAX)),
        opEffect('prop.set', { path: poolFieldPath(POOL_STAMINA, varOf('sid'), 'available'), value: varOf('next') }),
        opEffect('prop.set', { path: poolFieldPath(POOL_STAMINA, varOf('sid'), 'real'), value: varOf('next') }),
      ],
    ),
  ],
  sourceTrace: ['Req 6.2', 'Req 6.14', 'Req 15.8', 'D-007'],
});

const esActor = requestField(PATH_REQ_ETERNAL_SLEEP, REQ_FIELD_ACTOR);
const esTarget = requestField(PATH_REQ_ETERNAL_SLEEP, REQ_FIELD_TARGET);

/**
 * play.eternalSleep.request default（Requirement 12.5-12.8、6.10）：一个事务内完成
 * 目标死亡、执行者体力恢复至 5、死亡背包创建，任一步失败整体回滚。
 *
 * DEVIATION-08（item 灌注的分层，如实记录，需人工确认）：design.md 3.11 把"把死者可转移物品
 * 灌入死亡背包"放在本规则内。但当前引擎层的声明式 Expr **无法枚举一个实体持有的物品**：
 * Item 的位置是 slot?:Id，容器不是 QueryEngine 的数据源（QueryFrom 无 'containers'），
 * 且 flow 求值上下文没有 containerOf/slotOf（stateAccess 缺失）。因此本核心包只搭建骨架并
 * emit play.death.settled，把物品灌注交给**持有容器访问能力的 space-items 层**在同一事务内
 * 监听该事件完成（Requirement 18 已把死亡背包取出的物品契约定为 space-items 的下游职责）。
 * 灌注发生在 emit 时（打 no-deposit 标记之前），因此"灌注完成后才禁止存入"的顺序成立；
 * 物品守恒由 item.move 保证（Requirement 12.8）。核心包单独运行时死亡背包为空——纯核心世界里
 * 本就没有物品，这是诚实且无损的状态。
 *
 * DEVIATION-09（"只出不进"的实现，如实记录）：引擎层 tags 只存在于 Entity/Item/Node/Link，
 * 容器没有 tags；且 item.move 的目的地是 toContainerId（容器 id），无法从容器反查其宿主实体
 * 的标记。因此"只出不进"改为：死亡背包容器 id 登记进 world.props.play.noDepositContainers 清单，
 * before:item.move 规则对目的地在该清单中的移动 abort（item.move 是结构性 Op，before 否决真实生效）。
 *
 * 同微型场景的重检以"同节点"近似（微型场景本身是附属于宿主节点的节点，同微型场景即同节点）。
 */
export const eternalSleepRule: RuleDef = phaseRule({
  id: RULE_ETERNAL_SLEEP_DEFAULT,
  on: EVENT_ETERNAL_SLEEP_REQUEST,
  phase: 'default',
  priority: 100,
  effects: [
    ifEffect(
      not(and(
        refExists(esTarget),
        hasTag(esTarget, TAG_DOWNED_ZERO),
        notNull(refGet(esActor, 'node')),
        eq(refGet(esActor, 'node'), refGet(esTarget, 'node')),
      )),
      [setRequestField(PATH_REQ_ETERNAL_SLEEP, REQ_FIELD_VETO, '令其长眠三条件重检失败：目标非零血倒地、或与执行者不在同一（微型）场景。')],
      [
        opEffect('entity.create', { def: ENTITY_DEATH_BAG }, 'deathBag'),
        opEffect('entity.place', { entityId: refId(varOf('deathBag')), nodeId: refGet(esTarget, 'node') }),
        // 死亡背包容器 id 登记进禁存清单（DEVIATION-09）。
        opEffect('list.insert', {
          path: PATH_NO_DEPOSIT_CONTAINERS,
          value: getOf(refGet(varOf('deathBag'), 'containers'), DEATH_BAG_CONTAINER_NAME),
        }),
        // 执行者体力恢复至 5（成对写入 available/real）。
        opEffect('prop.set', { path: poolFieldPath(POOL_STAMINA, refId(esActor), 'available'), value: STAMINA_MAX }),
        opEffect('prop.set', { path: poolFieldPath(POOL_STAMINA, refId(esActor), 'real'), value: STAMINA_MAX }),
        // 回填死亡背包引用并 emit：下游 space-items 在此灌注物品（灌注早于下一步打标记）。
        setRequestField(PATH_REQ_ETERNAL_SLEEP, REQ_FIELD_DEATH_BAG, varOf('deathBag')),
        emitEffect(EVENT_DEATH_SETTLED, pathOf(PATH_REQ_ETERNAL_SLEEP)),
        // 灌注完成后再登记 no-deposit（清单登记已在上面完成，这里的标记供投影/查询识别死亡背包）。
        ...noDepositTagEffects(),
        // 目标死亡：其容器占用者已被灌注移走，级联清理不会遗失物品。
        opEffect('entity.destroy', { id: refId(esTarget) }),
      ],
    ),
  ],
  sourceTrace: ['Req 12.5', 'Req 12.6', 'Req 12.7', 'Req 12.8', 'Req 6.10'],
});

/** 给死亡背包实体打 no-deposit 标记（供投影/查询识别；实际否决靠禁存清单，见 DEVIATION-09）。 */
function noDepositTagEffects(): Effect[] {
  return [
    opEffect('prop.set', { path: `${PATH_SETTLE_SCRATCH}.ref.collection`, value: 'entities' }),
    opEffect('prop.set', { path: `${PATH_SETTLE_SCRATCH}.ref.id`, value: refId(varOf('deathBag')) }),
    opEffect('tag.add', { ref: pathOf(`${PATH_SETTLE_SCRATCH}.ref`), tag: TAG_NO_DEPOSIT }),
    opEffect('prop.del', { path: `${PATH_SETTLE_SCRATCH}.ref` }),
  ];
}

/**
 * before:item.move：死亡背包"只出不进"（Requirement 12.7，DEVIATION-09）。
 * 目的地容器在禁存清单里即 abort——item.move 是结构性 Op，before 阶段的 abort 触发真实 veto
 * （invokeInline 见 dispatchBefore.cancelled → 回滚 + E_OP_VETOED）。
 */
export const deathBagNoDepositRule: RuleDef = phaseRule({
  id: RULE_DEATH_BAG_NO_DEPOSIT,
  on: 'before:item.move',
  phase: 'before',
  priority: 100,
  effects: [
    ifEffect(
      includesOf(pathOf(PATH_NO_DEPOSIT_CONTAINERS), getOf(varOf('payload'), 'toContainerId')),
      [{ abort: '死亡背包只出不进：拒绝把物品存入该容器（Requirement 12.7）。' }],
      [],
    ),
  ],
  sourceTrace: ['Req 12.7'],
});

/** 阶段/结算/长眠/死亡背包规则集合。 */
export const CORE_PHASE_RULES: readonly RuleDef[] = [
  phaseSettleRule,
  staminaGrantRule,
  eternalSleepRule,
  deathBagNoDepositRule,
];
