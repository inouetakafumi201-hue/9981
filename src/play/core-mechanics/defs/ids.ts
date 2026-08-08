/**
 * 玩法层核心机制的共享标识符与状态路径（声明式常量，无任何运行时逻辑）。
 *
 * DEVIATION-01（结构性自主判断，需人工确认）：design.md 1.6 的文件清单里没有 `defs/ids.ts`
 * 与 `defs/expr.ts`。把标识符常量与纯 `Expr`/`Effect` 构造器抽成这两个文件，是为了让
 * `defs/*.ts` 之间不出现同一字符串的多份字面量副本（同一个 Def Id 写错一处就是一条静默的
 * `E_LOAD_UNDEFINED_REF`）。两个文件都只含声明式数据与纯函数，不持有写能力，因此不破坏
 * design.md 1.6 "只包含声明式定义 + 装载器 + 只读投影" 这条约束。
 *
 * 标识符本身属于**未冻结契约**（requirements.md Requirement 18「未冻结契约」明确列出
 * "具体 Def 标识符、JSON 字段名、动作标识符、状态标识符"），因此下游不得依赖这些字符串。
 */

// ---------------------------------------------------------------------------
// 资源池（design.md 3.2）
// ---------------------------------------------------------------------------

/** AP：本规则集回合内执行动作的唯一时间货币（Requirement 4.1）。 */
export const POOL_AP = 'ap';
/** 体力池。上限 5 是 Constitutional_Constant（D-007）。 */
export const POOL_STAMINA = 'stamina';

// ---------------------------------------------------------------------------
// 状态路径（design.md 5.1；已按引擎层 `isWritablePropsPath` 的实际白名单校正）
// ---------------------------------------------------------------------------

/**
 * 引擎层可写自由区的真实前缀（`src/core/kernel/ops/path.ts` 的 `WRITABLE_PATH_PATTERNS`）。
 *
 * 校正记录：design.md 5.1 把回合型状态剩余写作 `attachments.<id>.props.remainingTurns`，
 * 但引擎层允许写入的是 `world.attachments.<id>.props.*`——顶层 `attachments.*` 不在白名单里，
 * 写它会得到 `E_OP_INVALID_ARGS`。本模块使用引擎层实际接受的路径。
 */
export const PATH_POOLS_ROOT = 'world.props.pools';
export const PATH_PLAY_ROOT = 'world.props.play';
/** 本回合行动顺序（有序表，全局共用、同步生效）。 */
export const PATH_TURN_ORDER = `${PATH_PLAY_ROOT}.turnOrder`;
/** 结算阶段完成度标记（Internal_Metric，供阶段推进守卫读取）。 */
export const PATH_SETTLE_DONE = `${PATH_PLAY_ROOT}.settleComplete`;
/** 投点阶段承诺收集完成标记（Internal_Metric）。 */
export const PATH_COMMITMENTS_DONE = `${PATH_PLAY_ROOT}.commitmentsCollected`;
/** 玩家行动阶段的执行队列（有序表；空表示本阶段已推进完毕）。 */
export const PATH_PLAYER_QUEUE = `${PATH_PLAY_ROOT}.playerQueue`;
/** NPC 行动阶段的执行队列（按稳定 NPC 编号升序）。 */
export const PATH_NPC_QUEUE = `${PATH_PLAY_ROOT}.npcQueue`;
/** 尚未完成的到期结算计数（Internal_Metric；cleanup→roll 守卫读取）。 */
export const PATH_PENDING_EXPIRY = `${PATH_PLAY_ROOT}.pendingExpiry`;
/** U-001 策略齐备标记：由装载入口按配置写入，投点阶段守卫读取。 */
export const PATH_ROLL_POLICY_READY = `${PATH_PLAY_ROOT}.rollPolicyReady`;

/** NPC 预算是否启用（`npcBudget === null` 时为 false，NPC 行动阶段无参与者）。 */
export const PATH_NPC_ENABLED = `${PATH_PLAY_ROOT}.npcEnabled`;

/** 活体属性字段名（落在 `entities.<id>.props.*` 自由区）。 */
export const PROP_VITALITY = 'vitality';
export const PROP_ROLL_TIER = 'rollTier';
/** 附着上的回合型状态剩余（Gameplay_Value 1-5，永不写 0）。 */
export const PROP_REMAINING_TURNS = 'remainingTurns';

// ---------------------------------------------------------------------------
// 标记（tags：Entity/Item/Node/Link 的一等结构区字段，由 tag.add / tag.del 维护）
// ---------------------------------------------------------------------------

/** 零血倒地标记。与同名 Attachment 成对存在：标记供 require 快速判定，Attachment 承载状态语义。 */
export const TAG_DOWNED_ZERO = 'play:downed-zero';
/** 普通倒地标记（与零血倒地是两种不混淆的语义，Requirement 12.1）。 */
export const TAG_KNOCKED_DOWN = 'play:knocked-down';
/** 格挡标记。 */
export const TAG_BLOCKING = 'play:blocking';
/** 隐蔽标记。 */
export const TAG_CONCEALED = 'play:concealed';
/** 永久退出（观战 / 退出）标记：单向、不可恢复（Requirement 11.6）。 */
export const TAG_PERMANENT_EXIT = 'play:permanent-exit';
/** 死亡背包的"只出不进"标记：`before:item.move` 规则据此否决存入（Requirement 12.7）。 */
export const TAG_NO_DEPOSIT = 'play:no-deposit';
/** 精密交互中间状态标记（供动作 require 快速判定）。 */
export const TAG_PRECISE_IN_PROGRESS = 'play:precise-in-progress';
/** 多步移动过渡中间状态标记。 */
export const TAG_TRANSIT_IN_PROGRESS = 'play:transit-in-progress';
/** 睡下中间状态标记：只有"起床"完成时才恢复体力（Requirement 6.11、15.4）。 */
export const TAG_SLEEPING = 'play:sleeping';
/** 投点参与者标记：观战/退出后不再带此标记（Requirement 11.4、11.6）。 */
export const TAG_ROLL_PARTICIPANT = 'play:roll-participant';
/** NPC 标记：NPC 不参与玩家投点，也不得进入逆转/超逆转的 actorFilter（D-052）。 */
export const TAG_NPC = 'play:npc';

// ---------------------------------------------------------------------------
// 玩法层事件命名空间（design.md 2.4：`play.<域>.<语义>`）
// ---------------------------------------------------------------------------

export const EVENT_DAMAGE_REQUEST = 'play.damage.request';
export const EVENT_HEAL_REQUEST = 'play.heal.request';
export const EVENT_STAMINA_GRANT = 'play.stamina.grant';
export const EVENT_STATUS_APPLY = 'play.status.apply';
export const EVENT_STATUS_TICK = 'play.status.tick';
export const EVENT_GATEWAY_EVALUATE = 'play.gateway.evaluate';
export const EVENT_PHASE_SETTLE = 'play.phase.settle';
export const EVENT_ATTACH_INVOKE = 'play.attach.invoke';
export const EVENT_DOWNED_ENTERED = 'play.downed.entered';
export const EVENT_PRECISE_INTERRUPTED = 'play.precise.interrupted';
export const EVENT_ETERNAL_SLEEP_REQUEST = 'play.eternalSleep.request';
export const EVENT_DEATH_SETTLED = 'play.death.settled';

// ---------------------------------------------------------------------------
// Def 标识符
// ---------------------------------------------------------------------------

export const PLAYPACK_ID = 'playpack:play.core-mechanics';
export const SCHEDULE_ID = 'schedule:play.core';

/** 离散状态 AttachmentDef。 */
export const ATT_DOWNED_ZERO = 'attachment:play.downed-zero';
export const ATT_KNOCKED_DOWN = 'attachment:play.knocked-down';
export const ATT_BLOCKING = 'attachment:play.blocking';
export const ATT_CONCEALED = 'attachment:play.concealed';
export const ATT_PRECISE_INTERACTION = 'attachment:play.precise-interaction';
export const ATT_TRANSIT = 'attachment:play.transit';
export const ATT_BOOST_COMMITMENT = 'attachment:play.boost-commitment';
export const ATT_PERMANENT_EXIT = 'attachment:play.permanent-exit';
export const ATT_SLEEPING = 'attachment:play.sleeping';
/** 死亡背包容器实体的 EntityDef（独立新建，不复用死者原背包实体，Requirement 12.7）。 */
export const ENTITY_DEATH_BAG = 'entity:play.death-bag';

/** 付费动作。 */
export const ACT_MOVE = 'action:play.move';
export const ACT_CRAWL = 'action:play.crawl';
export const ACT_PICKUP = 'action:play.pickup';
export const ACT_ATTACK = 'action:play.attack';
export const ACT_TIDY_BACKPACK = 'action:play.tidy-backpack';
export const ACT_BOARD_VEHICLE = 'action:play.board-vehicle';
export const ACT_LEAVE_VEHICLE = 'action:play.leave-vehicle';
export const ACT_RAISE_SHIELD = 'action:play.raise-shield';
export const ACT_SLEEP_DOWN = 'action:play.sleep-down';
export const ACT_WAKE_UP = 'action:play.wake-up';
export const ACT_STAND_UP = 'action:play.stand-up';
export const ACT_ETERNAL_SLEEP = 'action:play.eternal-sleep';
export const ACT_PRECISE_BEGIN = 'action:play.precise-begin';
export const ACT_PRECISE_COMPLETE = 'action:play.precise-complete';
export const ACT_TRANSIT_BEGIN = 'action:play.transit-begin';
export const ACT_TRANSIT_COMPLETE = 'action:play.transit-complete';
export const ACT_SPECTATE = 'action:play.spectate';
export const ACT_QUIT = 'action:play.quit';

/** 附着动作（无独立 AP 成本，必须依附父付费动作）。 */
export const ACT_DROP_ITEM = 'action:play.drop-item';
export const ACT_USE_ATTACHED_CONSUMABLE = 'action:play.use-attached-consumable';
export const ACT_CANCEL_BLOCK = 'action:play.cancel-block';
export const ACT_USE_MEDICAL_ITEM = 'action:play.use-medical-item';
export const ACT_USE_STAMINA_ITEM = 'action:play.use-stamina-item';

/** 付费动作的启用集合（Requirement 4.7 + design.md 3.2 的最小启用集）。 */
export const PAID_ACTION_IDS: readonly string[] = [
  ACT_MOVE, ACT_CRAWL, ACT_PICKUP, ACT_ATTACK, ACT_TIDY_BACKPACK,
  ACT_BOARD_VEHICLE, ACT_LEAVE_VEHICLE, ACT_RAISE_SHIELD,
  ACT_SLEEP_DOWN, ACT_WAKE_UP, ACT_STAND_UP, ACT_ETERNAL_SLEEP,
  ACT_PRECISE_BEGIN, ACT_PRECISE_COMPLETE, ACT_TRANSIT_BEGIN, ACT_TRANSIT_COMPLETE,
  ACT_SPECTATE, ACT_QUIT,
];

/** 附着动作的启用集合（Requirement 4.8）。 */
export const ATTACHED_ACTION_IDS: readonly string[] = [
  ACT_DROP_ITEM, ACT_USE_ATTACHED_CONSUMABLE, ACT_CANCEL_BLOCK,
  ACT_USE_MEDICAL_ITEM, ACT_USE_STAMINA_ITEM,
];

/**
 * 零血倒地玩家被禁止的付费动作（Requirement 11.5）。
 * 观战与退出**不在**此列：它们是零血倒地玩家唯一可执行的两个动作（Requirement 11.6）。
 */
export const ACTIONS_FORBIDDEN_WHEN_DOWNED_ZERO: readonly string[] = PAID_ACTION_IDS
  .filter((id) => id !== ACT_SPECTATE && id !== ACT_QUIT);

/** 规则 Def 标识符。 */
export const RULE_DAMAGE_BEFORE = 'rule:play.damage.before-eligibility';
export const RULE_DAMAGE_MODIFY = 'rule:play.damage.modify-mitigation';
export const RULE_DAMAGE_INSTEAD = 'rule:play.damage.instead-immune-block';
export const RULE_DAMAGE_DEFAULT = 'rule:play.damage.default-apply';
export const RULE_DAMAGE_AFTER_PRESENTATION = 'rule:play.damage.after-presentation';
export const RULE_DAMAGE_AFTER_CANCEL_BLOCK = 'rule:play.damage.after-cancel-block';
export const RULE_DAMAGE_AFTER_INTERRUPT_PRECISE = 'rule:play.damage.after-interrupt-precise';
export const RULE_HEAL_BEFORE = 'rule:play.heal.before-eligibility';
export const RULE_HEAL_MODIFY = 'rule:play.heal.modify';
export const RULE_HEAL_INSTEAD = 'rule:play.heal.instead';
export const RULE_HEAL_DEFAULT = 'rule:play.heal.default-apply';
export const RULE_HEAL_AFTER = 'rule:play.heal.after-presentation';
export const RULE_STAMINA_GRANT_DEFAULT = 'rule:play.stamina.default-grant';
export const RULE_STATUS_APPLY_MODIFY = 'rule:play.status.modify-duration';
export const RULE_STATUS_APPLY_DEFAULT = 'rule:play.status.default-apply';
export const RULE_STATUS_TICK_DEFAULT = 'rule:play.status.default-tick';
export const RULE_CONCEAL_REMOVE_ON_MOVE = 'rule:play.conceal.remove-on-move';
export const RULE_PHASE_SETTLE_DEFAULT = 'rule:play.phase.default-settle';
export const RULE_ATTACH_INVOKE_ROOT = 'rule:play.attach.invoke-root';
export const RULE_GATEWAY_BEFORE = 'rule:play.gateway.before-eligibility';
export const RULE_GATEWAY_MODIFY = 'rule:play.gateway.modify-input';
export const RULE_GATEWAY_INSTEAD = 'rule:play.gateway.instead-substitute';
export const RULE_GATEWAY_DEFAULT = 'rule:play.gateway.default-dispatch';
export const RULE_GATEWAY_AFTER = 'rule:play.gateway.after-presentation';
export const RULE_DEATH_BAG_NO_DEPOSIT = 'rule:play.death-bag.no-deposit';
export const RULE_ETERNAL_SLEEP_DEFAULT = 'rule:play.eternal-sleep.default-settle';

/**
 * 附着动作在装载期派生的 `RuleDef` Id（design.md 3.6 第 3 条）。
 * 同一份 `effects` 只声明一次（在 `ActionDef` 上），派生规则引用它，不产生第二份定义。
 */
export function attachedRuleIdFor(actionId: string): string {
  return `rule:play.attach.${actionId}`;
}

/** 具名表达式 Def（`kind:'expr'`）：附着动作的 `requireRef` 与网关的资格判定引用它们。 */
export const EXPR_ALIVE_AND_ACTING = 'expr:play.alive-and-acting';
export const EXPR_HAS_MEDICAL_TARGET = 'expr:play.has-medical-target';
export const EXPR_HAS_STAMINA_TARGET = 'expr:play.has-stamina-target';
export const EXPR_HOLDS_DROPPABLE_ITEM = 'expr:play.holds-droppable-item';
export const EXPR_IS_BLOCKING = 'expr:play.is-blocking';
export const EXPR_PARENT_INTENT_DECLARES_SELF = 'expr:play.parent-intent-declares-self';
export const EXPR_GATEWAY_ACTOR_ELIGIBLE = 'expr:play.gateway-actor-eligible';
export const EXPR_GATEWAY_TARGET_ELIGIBLE = 'expr:play.gateway-target-eligible';

/** 命名随机流（Requirement 7.4：同分定序必须走命名随机 Op，不得用容器迭代顺序替代）。 */
export const RNG_STREAM_TURN_ORDER_TIE = 'play.turnOrder.tieBreak';
export const RNG_STREAM_ROLL_TIER = 'play.roll.baseTier';
export const RNG_STREAM_GATEWAY_CHECK = 'play.gateway.check';

// ---------------------------------------------------------------------------
// 五并列（S0 第五条 / Requirement 3.8）
// ---------------------------------------------------------------------------

/** 同时向单个玩家并列提供的独立选项上限。 */
export const MAX_PARALLEL_OPTIONS = 5;

/** 投影层的动作分组名（付费组 / 附着组）。 */
export const GROUP_PAID = 'play.paid';
export const GROUP_ATTACHED = 'play.attached';

// ---------------------------------------------------------------------------
// 请求记录（request record）与暂存区
// ---------------------------------------------------------------------------

/**
 * 玩法层事件的**权威请求记录**根路径。
 *
 * DEVIATION-02（自主设计判断，需人工确认）：design.md 2.4 把伤害等语义写成"`emit` 的
 * `payload.amount` 由 `modify` 阶段改写"。该形态在当前引擎层**无法实现**，原因是两条已核对的
 * 事实：
 *
 * 1. `ExprEngine` 没有"构造映射"的算子，且它对**普通对象字面量**只做浅拷贝——
 *    `evalInner` 的兜底分支是 `result[k] = (v as Value) ?? null`，不递归求值。因此
 *    `{emit:'x', data:{amount:{op:'sub',…}}}` 得到的 payload 里 `amount` 是**未求值的 Expr 对象**。
 * 2. `HookDispatcher` 的 `modify` 阶段靠 `{let:'payload', be:…}` 回写 payload，而 `be` 同样受
 *    第 1 条限制，无法整体重建一个映射。
 *
 * 因此本设计把"可被 `modify` 改写的请求数据"落在**事务内的请求记录路径**上：
 * - 发起方逐字段 `prop.set` 写入请求记录（`path` 是静态字符串，`value` 是顶层参数会被求值）；
 * - `emit` 的 `data` 用 `{path: <请求记录根>}` 读出**真实映射**，供规则的 `when` 谓词使用；
 * - `modify` 阶段规则改写请求记录的字段；`default` 阶段从请求记录**重新读取**最终值。
 *
 * 语义与 design.md 一致（同一事务、同一 `HookDispatcher`、同一五阶段），差别只在"可改写的数据
 * 放在事务内的哪个位置"。请求记录随事务提交/回滚，因此失败时不留半态。
 */
export const PATH_REQUEST_ROOT = `${PATH_PLAY_ROOT}.request`;
export const PATH_REQ_DAMAGE = `${PATH_REQUEST_ROOT}.damage`;
export const PATH_REQ_HEAL = `${PATH_REQUEST_ROOT}.heal`;
export const PATH_REQ_STAMINA = `${PATH_REQUEST_ROOT}.stamina`;
export const PATH_REQ_STATUS = `${PATH_REQUEST_ROOT}.status`;
export const PATH_REQ_TICK = `${PATH_REQUEST_ROOT}.tick`;
export const PATH_REQ_GATEWAY = `${PATH_REQUEST_ROOT}.gateway`;
export const PATH_REQ_ATTACH = `${PATH_REQUEST_ROOT}.attach`;
export const PATH_REQ_ETERNAL_SLEEP = `${PATH_REQUEST_ROOT}.eternalSleep`;
export const PATH_REQ_SETTLE = `${PATH_REQUEST_ROOT}.settle`;

/**
 * 请求记录的统一否决字段名。
 *
 * DEVIATION-03（自主设计判断，需人工确认）：`before` 阶段的 veto 对 `emit` 型事件**不生效**。
 * 已核对的原因：`wire-hooks.ts` 的 `dispatchEmit` 丢弃了 `HookDispatcher.dispatch` 的返回值
 * （`DispatchResult.cancelled` 无人读取），而 `OpContext.emit` 与 Flow 的 `emit` 效果都返回
 * `void`——因此一条 `before` 规则即使 `abort`，发起方的效果序列也会继续执行。这是一个**静默**
 * 失效路径。
 *
 * 本设计给出的可用否决通道：`before` 阶段规则把否决理由写进请求记录的 `veto` 字段（`before`
 * 阶段的写入**不会**被回滚），发起方在 `emit` 之后紧跟一条守卫，读到 `veto` 非空即 `abort`，
 * 使整个动作事务回滚。这不新增引擎层能力，只使用 `prop.set` + `if` + `abort`。
 */
export const REQ_FIELD_VETO = 'veto';

/**
 * `tag.add` / `tag.del` 的引用暂存区。
 *
 * DEVIATION-04（自主设计判断，需人工确认）：`tag.add` 的 `ref` 参数形状是
 * `{collection, id}` 这样一个**映射**。由于 DEVIATION-02 第 1 条列出的同一原因（映射字面量
 * 不被递归求值），`{ref: {collection:'entities', id:{op:'refGet',…}}}` 里的 `id` 会以未求值的
 * Expr 对象送进 Op，导致 `E_REF_MISSING`。既有 `src/play/action-turn/playpack.json` 里所有
 * 映射型参数都只写静态字面量（如 `props: {bonus: 1}`），印证了这一限制。
 *
 * 因此动态目标的打标记走三步：把 `collection` 与 `id` 分两次 `prop.set` 写进暂存区（`path` 是
 * 静态字符串、`value` 是会被求值的顶层参数），再用 `{path: <暂存区>}` 作为 `ref` 读出真实映射，
 * 最后 `prop.del` 清掉暂存区不留残留。`defs/expr.ts` 的 `tagEffects` 封装了这三步。
 */
export const PATH_SCRATCH_REF = `${PATH_PLAY_ROOT}.scratch.ref`;

// ---------------------------------------------------------------------------
// 五回合阶段（design.md 3.5 / Requirement 7.1）
// ---------------------------------------------------------------------------

export const PHASE_ROLL = 'phase:play.roll';
export const PHASE_SETTLE = 'phase:play.settle';
export const PHASE_PLAYER_ACTION = 'phase:play.player-action';
export const PHASE_NPC_ACTION = 'phase:play.npc-action';
export const PHASE_CLEANUP = 'phase:play.cleanup';

/** 本玩法包配置是否要求在投点阶段收集强力骰承诺（由装载入口按配置写入）。 */
export const PATH_COMMITMENTS_REQUIRED = `${PATH_PLAY_ROOT}.commitmentsRequired`;

/**
 * 投点请求事件。
 *
 * 本玩法包**只发出该事件，不为它注册任何 `default` 规则**：基础等级分布属于 U-001 未冻结内容，
 * 一旦在这里给出任何分布（哪怕是"均匀 1-5"）就是把未冻结项默认化（Requirement 5.2、17.2）。
 * 已审批的投点策略在冻结后作为独立玩法层配置提供 `default` 规则。
 */
export const EVENT_ROLL_REQUEST = 'play.roll.request';

/** 同分定序值字段（Internal_Metric：由命名随机流的洗牌次序派生，不展示给玩家）。 */
export const PROP_TIE_BREAK = 'tieBreak';

/**
 * 伤害数值来源引用（T-001）。由装载入口按配置写入；T-001 冻结前配置必须为 `null`，
 * 因此攻击动作在效果序列首条守卫处 `abort`，不会产生任何伤害——这正是"未冻结项不得默认化"的
 * 预期后果（Requirement 11.2、17.2）。本玩法包**不**给出任何默认伤害数值。
 */
export const PATH_DAMAGE_AMOUNT_REF = `${PATH_PLAY_ROOT}.damageAmountRef`;

/** 掩体减伤/命中修正数值来源引用（T-002 数值部分）。同样在冻结前为 `null`。 */
export const PATH_COVER_MAGNITUDE_REF = `${PATH_PLAY_ROOT}.coverMagnitudeRef`;

/** 请求记录的通用字段名。 */
export const REQ_FIELD_SOURCE = 'source';
export const REQ_FIELD_TARGET = 'target';
export const REQ_FIELD_AMOUNT = 'amount';
export const REQ_FIELD_TO_MAX = 'toMax';
export const REQ_FIELD_ACTOR = 'actor';
export const REQ_FIELD_ATTACHMENT = 'attachment';
export const REQ_FIELD_STATUS_DEF = 'statusDef';
export const REQ_FIELD_REMAINING_TURNS = 'remainingTurns';
export const REQ_FIELD_GATEWAY_ID = 'gatewayId';
export const REQ_FIELD_GATEWAY_KIND = 'gatewayKind';
export const REQ_FIELD_ACTION_ID = 'actionId';
export const REQ_FIELD_ABSORBED = 'absorbed';

/** 附着动作调用上下文的字段名（`PATH_REQ_ATTACH` 下）。 */
export const REQ_FIELD_PHASE = 'phase';
export const REQ_FIELD_ITEM = 'item';

/**
 * 附着动作的触发时点取值。父动作在两个时点各发一次 `play.attach.invoke`，
 * 每条派生规则用 `when` 只认自己声明的那个时点——因此"触发时点"是可机械校验的声明，
 * 不是靠效果顺序的约定。
 */
export const TRIGGER_BEFORE_PARENT = 'beforeParentEffects';
export const TRIGGER_AFTER_PARENT = 'afterParentEffects';

// ---------------------------------------------------------------------------
// 生命与体力的宪法上界（design.md 3.4、3.9、5.2）
// ---------------------------------------------------------------------------

/** 生命上限：Constitutional_Constant（S0 第四条，值 5）。 */
export const VITALITY_MAX = 5;
/** "仍存活"的生命下界：剩余 ≥ 1 即存活，< 1 转零血倒地。结构性阈值。 */
export const VITALITY_MIN_ALIVE = 1;
/** 体力上限：Constitutional_Constant（D-007，值 5）。 */
export const STAMINA_MAX = 5;


/** "找到"交互的目标谓词具名表达式（Requirement 14.7），供下游动作的目标查询引用。 */
export const EXPR_NOT_CONCEALED = 'expr:play.not-concealed';


/** 三种网关类型的稳定标识（design.md 3.8）。 */
export const GATEWAY_KIND_RESOURCE = 'resourceConversion';
export const GATEWAY_KIND_CHECK = 'check';
export const GATEWAY_KIND_CONDITION = 'condition';


// ---------------------------------------------------------------------------
// 结算阶段的暂存量（Internal_Metric，投影层禁止展示）
// ---------------------------------------------------------------------------

export const PATH_SETTLE_MAX_TIER = `${PATH_PLAY_ROOT}.settle.maxTier`;
export const PATH_SETTLE_COUNT_AT_MAX = `${PATH_PLAY_ROOT}.settle.countAtMax`;
export const PATH_SETTLE_LEAD = `${PATH_PLAY_ROOT}.settle.lead`;
export const PATH_SETTLE_CAP = `${PATH_PLAY_ROOT}.settle.cap`;
export const PATH_SETTLE_SCRATCH = `${PATH_PLAY_ROOT}.settle`;

/** 参与者身上的复合排序键（Internal_Metric）：ap*10000 + tier*100 - tieBreak，降序。 */
export const PROP_SORT_KEY = 'sortKey';
/** 强力骰承诺的体力消耗字段（写在承诺 Attachment 的 props 上）。 */
export const PROP_STAMINA_COST = 'staminaCost';

/** 同分定序命名随机流的骰面数：100 面，使 tieBreak 落在 1-100，远大于并列人数上限。 */
export const TIE_BREAK_SIDES = 100;


/**
 * 死亡背包容器的名字（死亡背包 EntityDef 声明的唯一容器）。
 * "只出不进"通过"容器 id 登记进禁存清单 + before:item.move 否决"实现，而不是给容器打标记
 * （引擎层 tags 只在 Entity/Item/Node/Link 上，容器无 tags）——见 rules.phase.ts 的 DEVIATION-09。
 */
export const DEATH_BAG_CONTAINER_NAME = 'contents';
/** 禁止存入的容器 id 清单（world.props 自由区）。before:item.move 据此否决存入。 */
export const PATH_NO_DEPOSIT_CONTAINERS = `${PATH_PLAY_ROOT}.noDepositContainers`;
/** 令其长眠请求记录里回填的死亡背包引用字段。 */
export const REQ_FIELD_DEATH_BAG = 'deathBag';
