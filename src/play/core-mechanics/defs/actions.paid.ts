/**
 * 付费动作集合（tasks.md 任务 3.3 / design.md 3.2、3.6-3.11）。
 *
 * 三条不可协商的形状约束：
 * 1. 每个动作的 `cost` **恰好一项**，`pool` 为 AP 池，`amount` 为**字面量 `1`**（不接受 Expr）。
 *    字面量而不是 Expr 的理由：Expr 可以求值出 2，而 Requirement 4.3 禁止任何单次 2 AP 原子动作；
 *    收窄为字面量让这条铁律在**装载期**即可机械判定，不依赖运行期抽样（design.md 复核项 B）。
 * 2. 全部付费动作的 `require` 统一带"不带零血倒地标记"守卫；观战与退出除外——它们是零血倒地
 *    玩家唯一可执行的两个动作（Requirement 11.6），且成功后写入永久退出标记（单向不可逆）。
 * 3. 多步流程一律是**两个各 1 AP 的付费动作 + 显式中间状态**，不存在任何一次消耗 2 AP 的动作。
 *
 * ## 一处必须如实记录的实现位置调整（自主判断，需人工确认）
 *
 * design.md 3.7/3.10 把若干前置条件放在 `require` 里，例如"完成动作的 `require` 要求
 * 中间状态.props.targetRef === bindings.target"、"爬行的 `require` 要求天然场景归属相同"。
 * 这些判定需要**从一个 Id 反查对象**（中间状态 Attachment、当前所在 Node），而 `require` 的求值
 * 上下文两条通道都不具备：
 * - 没有 `runQuery`（`{q:...}` 恒为 `null`）；
 * - 无法用 Expr 构造 `{$: <动态 id>}` 这样的 Ref（映射字面量不被递归求值，见 `ids.ts` DEVIATION-04）。
 *
 * 因此这类判定改为**动作效果序列的首条守卫**：条件不满足即 `abort`，使整个 `intent.resolve`
 * 事务回滚，"不产生任何效果"这一验收结论不变（Requirement 9.2、9.7、12.2）。差别只在拒绝
 * 出现在 `intent.resolve` 而不是 `queryActions` 的灰显阶段：动作会出现在菜单里但执行时被拒。
 * `require` 仍然承担全部**可在其上下文内表达**的守卫（标记、目标存在性、目标字段比较）。
 */
import type { ActionDef, CostSpec } from '../../../core/kernel/actions/types';
import type { Effect } from '../../../core/kernel/events/effect-types';
import type { Expr } from '../../../core/kernel/state/expr-types';
import type { PlayDefExtension } from '../ownership';
import { buildNumericOwnership, constitutionalConstant, playExt, structuralBound } from '../ownership';
import {
  and,
  atOf,
  clearRequest,
  emitEffect,
  eq,
  getOf,
  guardEffect,
  hasTag,
  lacksTag,
  lenOf,
  notNull,
  opEffect,
  pathOf,
  refExists,
  refGet,
  refId,
  SELF,
  setRequestField,
  varOf,
  vetoGuard,
} from './expr';
import {
  ACT_ATTACK,
  ACT_BOARD_VEHICLE,
  ACT_CRAWL,
  ACT_ETERNAL_SLEEP,
  ACT_LEAVE_VEHICLE,
  ACT_MOVE,
  ACT_PICKUP,
  ACT_PRECISE_BEGIN,
  ACT_PRECISE_COMPLETE,
  ACT_QUIT,
  ACT_RAISE_SHIELD,
  ACT_SLEEP_DOWN,
  ACT_SPECTATE,
  ACT_STAND_UP,
  ACT_TIDY_BACKPACK,
  ACT_TRANSIT_BEGIN,
  ACT_TRANSIT_COMPLETE,
  ACT_WAKE_UP,
  ATT_BLOCKING,
  ATT_KNOCKED_DOWN,
  ATT_PERMANENT_EXIT,
  ATT_PRECISE_INTERACTION,
  ATT_SLEEPING,
  ATT_TRANSIT,
  EVENT_ATTACH_INVOKE,
  EVENT_DAMAGE_REQUEST,
  EVENT_ETERNAL_SLEEP_REQUEST,
  EVENT_STAMINA_GRANT,
  GROUP_PAID,
  PATH_REQ_ATTACH,
  REQ_FIELD_ACTION_ID,
  REQ_FIELD_ITEM,
  REQ_FIELD_PHASE,
  TRIGGER_AFTER_PARENT,
  TRIGGER_BEFORE_PARENT,
  PATH_DAMAGE_AMOUNT_REF,
  PATH_REQ_DAMAGE,
  PATH_REQ_ETERNAL_SLEEP,
  PATH_REQ_STAMINA,
  POOL_AP,
  PROP_VITALITY,
  REQ_FIELD_ACTOR,
  REQ_FIELD_AMOUNT,
  REQ_FIELD_SOURCE,
  REQ_FIELD_TARGET,
  REQ_FIELD_TO_MAX,
  REQ_FIELD_VETO,
  TAG_DOWNED_ZERO,
  TAG_KNOCKED_DOWN,
  TAG_PERMANENT_EXIT,
  TAG_PRECISE_IN_PROGRESS,
  TAG_SLEEPING,
  TAG_TRANSIT_IN_PROGRESS,
} from './ids';

/**
 * 付费动作的成本恒等式：`cost` 数组恰好一项，`pool` 为 AP，`amount` 是字面量 `1`。
 * 每个动作都复用**同一个**常量，因此不存在"某个动作偷偷写成 2"的可能。
 */
export const PAID_ACTION_COST: readonly CostSpec[] = [{ pool: POOL_AP, amount: 1 }];

/** 附着动作的成本：空数组。**不得**写成 `amount: 0`（Requirement 3.6）。 */
export const ATTACHED_ACTION_COST: readonly CostSpec[] = [];

/** 全部付费动作共享的基础守卫：不带零血倒地标记、不带永久退出标记。 */
const NOT_DOWNED_ZERO_AND_PRESENT: Expr = and(
  lacksTag(SELF, TAG_DOWNED_ZERO),
  lacksTag(SELF, TAG_PERMANENT_EXIT),
);

/** 归属规则：付费动作里出现的数值只有两类。 */
const PAID_ACTION_OWNERSHIP_RULES = [
  {
    pathSuffix: 'cost.0.amount',
    ownership: constitutionalConstant('S8「一个动作永远 1 AP」/ Req 4.2：付费动作成本恒为 1，不可配置。'),
  },
  {
    pathSuffix: 'range.min',
    ownership: structuralBound('槽位下标从 0 起：0 表示"第一个槽位"，是结构性编号，不是玩家可见刻度。'),
  },
  {
    pathSuffix: 'range.max',
    ownership: structuralBound('同屏并列槽位上限（五并列原则）：结构性上限，不是玩法平衡数值。'),
  },
  {
    pathSuffix: 'range.step',
    ownership: structuralBound('槽位下标步长恒为 1：结构性事实。'),
  },
  {
    pathSuffix: 'args.1',
    ownership: structuralBound('长度/下标比较的右操作数：结构性判据，不是玩家可见刻度。'),
  },
  {
    pathSuffix: 'args.atSlot',
    ownership: structuralBound('目标槽位下标：结构性编号。'),
  },
] as const;

/**
 * 附着动作的调用块（design.md 3.6 的"执行形态"）。
 *
 * 附着动作**不产生独立 `Intent`**：它作为父付费动作 `intent.submit` 的一个绑定项提交
 * （`bindings.attached = [{actionId, item?, target?}]`），由父动作在声明的触发时点 `emit`
 * `play.attach.invoke`，再由装载期从该附着 `ActionDef` 派生的一条 `RuleDef` 执行其效果。
 * 因此引擎层的 `Intent` 集合里永远看不到独立的附着动作意图，AI 的搜索分支也不含它们。
 *
 * `bindings.attached` 缺失时 `forEach` 的列表求值为 `null`，`FlowInterpreter` 对非数组直接跳过，
 * 因此不带附着项的父动作没有任何额外开销，也不会失败。
 */
function attachedInvocationBlock(triggerPoint: string): readonly Effect[] {
  return [
    {
      forEach: varOf('attached'),
      as: 'attachedEntry',
      do: [
        setRequestField(PATH_REQ_ATTACH, REQ_FIELD_ACTION_ID, getOf(varOf('attachedEntry'), REQ_FIELD_ACTION_ID)),
        setRequestField(PATH_REQ_ATTACH, REQ_FIELD_PHASE, triggerPoint),
        setRequestField(PATH_REQ_ATTACH, REQ_FIELD_ACTOR, SELF),
        setRequestField(PATH_REQ_ATTACH, REQ_FIELD_ITEM, getOf(varOf('attachedEntry'), REQ_FIELD_ITEM)),
        setRequestField(PATH_REQ_ATTACH, REQ_FIELD_TARGET, getOf(varOf('attachedEntry'), REQ_FIELD_TARGET)),
        emitEffect(EVENT_ATTACH_INVOKE, pathOf(PATH_REQ_ATTACH)),
        // 附着动作声明 onFailure:'rejectWholeAction' 时，其派生规则会写 veto 字段，
        // 这条守卫使父动作连同附着效果整体回滚（Requirement 8.6）。
        vetoGuard(
          PATH_REQ_ATTACH,
          REQ_FIELD_VETO,
          '附着动作前置条件不满足且其失败行为为 rejectWholeAction：父付费动作连同附着效果整体回滚。',
        ),
        clearRequest(PATH_REQ_ATTACH),
      ],
    },
  ];
}

/** 构造一个付费动作，并在同一处保证成本形状、分组与 `play` 扩展齐备。 */
function paidAction(input: {
  readonly id: string;
  readonly label: string;
  readonly targets?: ActionDef['targets'];
  readonly extraRequire?: Expr;
  readonly effects: readonly Effect[];
  readonly sourceTrace: readonly string[];
  /** 观战 / 退出这两个动作允许在零血倒地状态下执行（Requirement 11.6）。 */
  readonly allowWhenDownedZero?: boolean;
}): ActionDef {
  const baseRequire = input.allowWhenDownedZero === true
    ? lacksTag(SELF, TAG_PERMANENT_EXIT)
    : NOT_DOWNED_ZERO_AND_PRESENT;
  const body = {
    id: input.id,
    kind: 'action' as const,
    label: input.label,
    group: GROUP_PAID,
    ...(input.targets === undefined ? {} : { targets: input.targets }),
    require: input.extraRequire === undefined ? baseRequire : and(baseRequire, input.extraRequire),
    cost: [...PAID_ACTION_COST],
    // 双轨制 P3：付费动作进卡片轨，由玩家在发牌器里管理 1 AP 消耗策略。
    track: 'card' as const,
    effects: [
      ...attachedInvocationBlock(TRIGGER_BEFORE_PARENT),
      ...input.effects,
      ...attachedInvocationBlock(TRIGGER_AFTER_PARENT),
    ],
  };
  const extension: PlayDefExtension = playExt({
    numericOwnership: buildNumericOwnership(body, PAID_ACTION_OWNERSHIP_RULES, `${input.id} 的数值归属`),
    costClass: 'paid',
    sourceTrace: input.sourceTrace,
  });
  return { ...body, play: extension };
}

/**
 * 查询挂在**当前行动者**身上的某个 Attachment（只能在效果里用：`require` 没有 `runQuery`）。
 * 目标比较用 `eq(候选.target, self)`：`valueEquals` 对两个 Ref 按 `$` 比较，不需要取出 Id。
 */
const selfAttachments = (defId: string): Expr => ({
  q: {
    from: 'attachments',
    where: and(eq(pathOf('self.def'), defId), eq(pathOf('self.target'), SELF)),
  },
});

/** 取该 Attachment 的 Id（不存在时为 `null`，守卫会因此拒绝）。 */
const firstAttachmentId = (defId: string): Expr => refId(atOf(selfAttachments(defId), 0));

/** 断言行动者身上存在该 Attachment，否则中止整个事务。 */
const requireSelfAttachment = (defId: string, reason: string): Effect =>
  guardEffect(and(eq(lenOf(selfAttachments(defId)), 1), notNull(firstAttachmentId(defId))), reason);

/** 移动到相邻合法位置（1 AP）。相邻性、负重与禁止进入由 `before:entity.place` 的空间层规则否决。 */
export const moveAction = paidAction({
  id: ACT_MOVE,
  label: '移动到相邻位置',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  extraRequire: and(refExists(varOf('node')), lacksTag(SELF, TAG_KNOCKED_DOWN)),
  effects: [
    opEffect('entity.place', { entityId: refId(SELF), nodeId: refId(varOf('node')) }),
  ],
  sourceTrace: ['Req 4.7', 'Req 11.5', 'S5 行动点系统'],
});

/**
 * 爬行（普通倒地专属，1 AP，Requirement 12.2）：可进出微型场景，但**不得离开当前所属天然场景**。
 *
 * 天然场景归属比较放在效果首条守卫而不是 `require`：见文件头的说明（`require` 无法把
 * `entities.<id>.node` 这个 Id 反查成 Node 对象来读它的 `parent`）。
 */
export const crawlAction = paidAction({
  id: ACT_CRAWL,
  label: '爬行',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  extraRequire: and(hasTag(SELF, TAG_KNOCKED_DOWN), refExists(varOf('node'))),
  effects: [
    { let: 'currentNodeId', be: refGet(SELF, 'node') },
    {
      let: 'currentNode',
      be: { q: { from: 'nodes', where: eq(pathOf('self.id'), varOf('currentNodeId')) } },
    },
    guardEffect(eq(lenOf(varOf('currentNode')), 1), '爬行前置失败：无法确定行动者当前所在节点。'),
    guardEffect(
      eq(refGet(atOf(varOf('currentNode'), 0), 'parent'), refGet(varOf('node'), 'parent')),
      '爬行不得离开当前所属天然场景（Requirement 12.2）：目标节点与当前节点的父场景不同，整个动作事务回滚。',
    ),
    opEffect('entity.place', { entityId: refId(SELF), nodeId: refId(varOf('node')) }),
  ],
  sourceTrace: ['Req 12.2', 'S5 普通倒地'],
});

/** 拾取（1 AP）。容量与槽位资格由 `before:item.move` 的下游规则否决，玩法层不复制物品契约。 */
export const pickupAction = paidAction({
  id: ACT_PICKUP,
  label: '拾取',
  targets: [{ name: 'item', query: { from: 'items' } }],
  extraRequire: refExists(varOf('item')),
  effects: [
    { let: 'ownContainer', be: atOf(refGet(SELF, 'containers'), 0) },
    guardEffect(notNull(varOf('ownContainer')), '拾取前置失败：行动者没有可用容器。'),
    opEffect('item.move', { itemId: refId(varOf('item')), toContainerId: varOf('ownContainer') }),
  ],
  sourceTrace: ['Req 4.7', 'S5 AP 消耗类型'],
});

/**
 * 攻击（1 AP）。伤害走通用 `play.damage.request` 管道。
 *
 * **本玩法包不提供任何伤害数值**：首条守卫要求配置提供了伤害数值来源引用，而 T-001 冻结前
 * 该引用恒为 `null`，因此攻击在**产生任何写入之前**被拒绝（Requirement 11.2、17.2）。
 * 这不是"功能缺失"，而是"未冻结项不得默认化"的直接后果。
 */
export const attackAction = paidAction({
  id: ACT_ATTACK,
  label: '攻击',
  targets: [{ name: 'target', query: { from: 'entities' } }],
  extraRequire: and(refExists(varOf('target')), notNull(refGet(varOf('target'), `props.${PROP_VITALITY}`))),
  effects: [
    guardEffect(
      notNull(pathOf(PATH_DAMAGE_AMOUNT_REF)),
      'T-001 未冻结：枪械基础伤害表未裁决，本玩法包不得给出任何默认伤害数值，攻击在任何写入之前被拒绝。',
    ),
    setRequestField(PATH_REQ_DAMAGE, REQ_FIELD_SOURCE, SELF),
    setRequestField(PATH_REQ_DAMAGE, REQ_FIELD_TARGET, varOf('target')),
    setRequestField(PATH_REQ_DAMAGE, REQ_FIELD_AMOUNT, pathOf(PATH_DAMAGE_AMOUNT_REF)),
    emitEffect(EVENT_DAMAGE_REQUEST, pathOf(PATH_REQ_DAMAGE)),
    vetoGuard(PATH_REQ_DAMAGE, REQ_FIELD_VETO, '伤害被 before 阶段规则否决（目标资格或免疫）：整个动作事务回滚。'),
    clearRequest(PATH_REQ_DAMAGE),
  ],
  sourceTrace: ['Req 4.7', 'Req 11.2', 'Req 11.3', 'T-001'],
});

/** 整理背包（1 AP）：一揽子重排在同一事务内全成或全不成。 */
export const tidyBackpackAction = paidAction({
  id: ACT_TIDY_BACKPACK,
  label: '整理背包',
  targets: [
    { name: 'item', query: { from: 'items' } },
    { name: 'slot', range: { min: 0, max: 4, step: 1 } },
  ],
  extraRequire: refExists(varOf('item')),
  effects: [
    { let: 'ownContainer', be: atOf(refGet(SELF, 'containers'), 0) },
    guardEffect(notNull(varOf('ownContainer')), '整理背包前置失败：行动者没有可用容器。'),
    opEffect('item.move', {
      itemId: refId(varOf('item')),
      toContainerId: varOf('ownContainer'),
      atSlot: varOf('slot'),
    }),
  ],
  sourceTrace: ['Req 4.7', 'Req 3.8', 'S0 五并列'],
});

/**
 * 上车 / 下车（各 1 AP）。
 *
 * 用 `relation.set` / `relation.del` 表达"在载具上"这一关系，**不**在此实现载具内部微型场景：
 * 具体载具、座位、货舱与其空间语义属于 space-items 的稳定契约（Requirement 18），
 * 由那一层用 `entity.place` 的 `microScene` 参数落地。玩法层只保证成本类别与关系语义。
 */
export const boardVehicleAction = paidAction({
  id: ACT_BOARD_VEHICLE,
  label: '上车',
  targets: [{ name: 'vehicle', query: { from: 'entities' } }],
  extraRequire: refExists(varOf('vehicle')),
  effects: [
    opEffect('relation.set', { from: refId(SELF), to: refId(varOf('vehicle')), kind: 'play:onboard' }),
  ],
  sourceTrace: ['Req 4.7', 'Req 18 稳定下游契约 space-items'],
});

export const leaveVehicleAction = paidAction({
  id: ACT_LEAVE_VEHICLE,
  label: '下车',
  targets: [{ name: 'vehicle', query: { from: 'entities' } }],
  extraRequire: refExists(varOf('vehicle')),
  effects: [
    opEffect('relation.del', { from: refId(SELF), to: refId(varOf('vehicle')), kind: 'play:onboard' }),
  ],
  sourceTrace: ['Req 4.7', 'Req 18 稳定下游契约 space-items'],
});

/**
 * 举盾格挡（1 AP，Requirement 14.1-14.2）。
 * 格挡状态是**条件持续**：持续到受击或主动取消，回合结束不自动移除。
 * 具体减免、盾牌类型、破损规则与可格挡范围由 space-items 提供，本包不给默认数值。
 */
export const raiseShieldAction = paidAction({
  id: ACT_RAISE_SHIELD,
  label: '举盾格挡',
  effects: [
    opEffect('attach.add', { def: ATT_BLOCKING, target: SELF }),
  ],
  sourceTrace: ['Req 14.1', 'Req 14.2', 'Req 14.4', 'D-009'],
});

/** 睡下（1 AP）。**只建立中间状态，不产生任何体力恢复**（Requirement 6.11、15.4）。 */
export const sleepDownAction = paidAction({
  id: ACT_SLEEP_DOWN,
  label: '睡下',
  extraRequire: lacksTag(SELF, TAG_SLEEPING),
  effects: [
    opEffect('attach.add', { def: ATT_SLEEPING, target: SELF }),
  ],
  sourceTrace: ['Req 6.11', 'Req 15.4'],
});

/**
 * 起床（1 AP，Requirement 6.11、15.4）：**只有完成起床动作时**才把体力恢复至 5。
 * 仅完成"睡下"或流程被中断都不产生任何恢复，也不叠加 S8 已被置换的"睡眠每回合恢复 1"。
 */
export const wakeUpAction = paidAction({
  id: ACT_WAKE_UP,
  label: '起床',
  extraRequire: hasTag(SELF, TAG_SLEEPING),
  effects: [
    requireSelfAttachment(ATT_SLEEPING, '起床前置失败：行动者身上没有唯一的睡下中间状态。'),
    opEffect('attach.del', { id: firstAttachmentId(ATT_SLEEPING) }),
    setRequestField(PATH_REQ_STAMINA, REQ_FIELD_TARGET, SELF),
    setRequestField(PATH_REQ_STAMINA, REQ_FIELD_TO_MAX, true),
    emitEffect(EVENT_STAMINA_GRANT, pathOf(PATH_REQ_STAMINA)),
    vetoGuard(PATH_REQ_STAMINA, REQ_FIELD_VETO, '起床后的体力恢复被 before 阶段规则否决：整个动作事务回滚。'),
    clearRequest(PATH_REQ_STAMINA),
  ],
  sourceTrace: ['Req 6.11', 'Req 15.4', 'S5 体力恢复途径'],
});

/** 站起（1 AP，Requirement 12.3）：成功后离开普通倒地状态。 */
export const standUpAction = paidAction({
  id: ACT_STAND_UP,
  label: '站起',
  extraRequire: hasTag(SELF, TAG_KNOCKED_DOWN),
  effects: [
    requireSelfAttachment(ATT_KNOCKED_DOWN, '站起前置失败：行动者身上没有唯一的普通倒地状态。'),
    opEffect('attach.del', { id: firstAttachmentId(ATT_KNOCKED_DOWN) }),
  ],
  sourceTrace: ['Req 12.3', 'S5 普通倒地'],
});

/**
 * 令其长眠（1 AP，Requirement 12.5-12.6、12.11）。
 *
 * `require` 承担两条可在其上下文内表达的条件：目标存在、目标带零血倒地标记。
 * 第三条"执行者与目标位于同一微型场景"以及目标资格由 `play.eternalSleep.request` 的
 * `default` 规则在同一事务内重检（见 `rules.damage.ts` 同域的说明）——那里能用 Query，
 * 而 `require` 不能。任一条件不满足 → `abort` → 整个事务回滚：**不恢复执行者体力、不创建
 * 死亡背包、目标仍存在**（Requirement 12.11）。
 */
export const eternalSleepAction = paidAction({
  id: ACT_ETERNAL_SLEEP,
  label: '令其长眠',
  targets: [{ name: 'target', query: { from: 'entities' } }],
  extraRequire: and(refExists(varOf('target')), hasTag(varOf('target'), TAG_DOWNED_ZERO)),
  effects: [
    setRequestField(PATH_REQ_ETERNAL_SLEEP, REQ_FIELD_ACTOR, SELF),
    setRequestField(PATH_REQ_ETERNAL_SLEEP, REQ_FIELD_TARGET, varOf('target')),
    emitEffect(EVENT_ETERNAL_SLEEP_REQUEST, pathOf(PATH_REQ_ETERNAL_SLEEP)),
    vetoGuard(
      PATH_REQ_ETERNAL_SLEEP,
      REQ_FIELD_VETO,
      '令其长眠的三条件重检失败或被 before 阶段规则否决：整个事务回滚，执行者体力不变、无死亡背包被创建、目标仍存在。',
    ),
    clearRequest(PATH_REQ_ETERNAL_SLEEP),
  ],
  sourceTrace: ['Req 12.5', 'Req 12.6', 'Req 12.11', 'Req 6.10'],
});

/**
 * 精密交互「开始」（1 AP，Requirement 9.1-9.2）：建立绑定发起者、目标与交互种类的中间状态。
 * `props` 用 `attach.add` 之后的 `prop.set` 写入（映射型参数的嵌套值不会被求值，见 DEVIATION-04）。
 */
export const preciseBeginAction = paidAction({
  id: ACT_PRECISE_BEGIN,
  label: '开始精密交互',
  targets: [
    { name: 'target', query: { from: 'entities' } },
    { name: 'kind', query: { from: 'defs' } },
  ],
  extraRequire: and(refExists(varOf('target')), lacksTag(SELF, TAG_PRECISE_IN_PROGRESS)),
  effects: [
    opEffect('attach.add', { def: ATT_PRECISE_INTERACTION, target: SELF }, 'preciseAtt'),
    opEffect('prop.set', {
      path: { op: 'concat', args: ['world.attachments.', refId(varOf('preciseAtt')), '.props.targetRef'] },
      value: varOf('target'),
    }),
    opEffect('prop.set', {
      path: { op: 'concat', args: ['world.attachments.', refId(varOf('preciseAtt')), '.props.kind'] },
      value: refId(varOf('kind')),
    }),
    opEffect('prop.set', {
      path: { op: 'concat', args: ['world.attachments.', refId(varOf('preciseAtt')), '.props.beganAtPhase'] },
      value: pathOf('world.turn.phaseEnteredAt'),
    }),
  ],
  sourceTrace: ['Req 9.1', 'Req 9.2', 'S5 精密交互'],
});

/**
 * 精密交互「完成」（1 AP，Requirement 9.2、9.7）。
 *
 * "中间状态不得被另一目标的完成动作复用"由效果首条守卫保证：
 * `中间状态.props.targetRef === bindings.target`，不等即 `abort`，不产生完成效果。
 * 该判定无法放进 `require`（见文件头说明），因此以同事务守卫等价实现。
 */
export const preciseCompleteAction = paidAction({
  id: ACT_PRECISE_COMPLETE,
  label: '完成精密交互',
  targets: [{ name: 'target', query: { from: 'entities' } }],
  extraRequire: and(hasTag(SELF, TAG_PRECISE_IN_PROGRESS), refExists(varOf('target'))),
  effects: [
    requireSelfAttachment(ATT_PRECISE_INTERACTION, '完成精密交互前置失败：行动者身上没有唯一的中间状态。'),
    { let: 'preciseAtt', be: atOf(selfAttachments(ATT_PRECISE_INTERACTION), 0) },
    guardEffect(
      eq(refGet(varOf('preciseAtt'), 'props.targetRef'), varOf('target')),
      '中间状态绑定的目标与本次完成动作的目标不一致（Requirement 9.2）：不得复用，整个事务回滚。',
    ),
    // 前置条件重检通过后清除中间状态。具体完成效果（开锁、通路变化等）由 space-items 的
    // 配置在同一事件链上提供，本包不填默认值（Requirement 9.5）。
    opEffect('attach.del', { id: refId(varOf('preciseAtt')) }),
  ],
  sourceTrace: ['Req 9.2', 'Req 9.5', 'Req 9.7'],
});

/**
 * 多步移动「开始」（1 AP，Requirement 9.6）：重型负重的大范围移动与楼梯/窗户等过渡的第一步，
 * 只建立**可观察的**过渡中间状态，不改变位置。**不存在任何一次消耗 2 AP 的移动动作。**
 */
export const transitBeginAction = paidAction({
  id: ACT_TRANSIT_BEGIN,
  label: '开始过渡移动',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  extraRequire: and(refExists(varOf('node')), lacksTag(SELF, TAG_TRANSIT_IN_PROGRESS)),
  effects: [
    opEffect('attach.add', { def: ATT_TRANSIT, target: SELF }, 'transitAtt'),
    opEffect('prop.set', {
      path: { op: 'concat', args: ['world.attachments.', refId(varOf('transitAtt')), '.props.targetRef'] },
      value: varOf('node'),
    }),
    opEffect('prop.set', {
      path: { op: 'concat', args: ['world.attachments.', refId(varOf('transitAtt')), '.props.beganAtPhase'] },
      value: pathOf('world.turn.phaseEnteredAt'),
    }),
  ],
  sourceTrace: ['Req 9.6', 'Req 4.3'],
});

/**
 * 多步移动「完成」（1 AP，Requirement 9.7）：执行前重检空间与过渡前置条件；
 * 失效则拒绝第二步并按显式中断规则清理中间状态（这里由同一事务的 `abort` 完成回滚）。
 */
export const transitCompleteAction = paidAction({
  id: ACT_TRANSIT_COMPLETE,
  label: '完成过渡移动',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  extraRequire: and(hasTag(SELF, TAG_TRANSIT_IN_PROGRESS), refExists(varOf('node'))),
  effects: [
    requireSelfAttachment(ATT_TRANSIT, '完成过渡移动前置失败：行动者身上没有唯一的过渡中间状态。'),
    { let: 'transitAtt', be: atOf(selfAttachments(ATT_TRANSIT), 0) },
    guardEffect(
      eq(refGet(varOf('transitAtt'), 'props.targetRef'), varOf('node')),
      '过渡中间状态绑定的目标与本次完成动作的目标不一致：拒绝第二步，整个事务回滚。',
    ),
    opEffect('attach.del', { id: refId(varOf('transitAtt')) }),
    // 负重、容量与禁止进入由 `before:entity.place` 的空间层规则否决；玩法层不重复实现空间语义。
    opEffect('entity.place', { entityId: refId(SELF), nodeId: refId(varOf('node')) }),
  ],
  sourceTrace: ['Req 9.6', 'Req 9.7'],
});

/**
 * 观战（1 AP，Requirement 11.6）。零血倒地玩家可执行；成功后**永久退出**本局后续投点，
 * 且不得自行恢复为参战状态（`ATT_PERMANENT_EXIT` 刻意不声明 `onRemove`）。
 */
export const spectateAction = paidAction({
  id: ACT_SPECTATE,
  label: '观战',
  allowWhenDownedZero: true,
  effects: [opEffect('attach.add', { def: ATT_PERMANENT_EXIT, target: SELF })],
  sourceTrace: ['Req 11.6', 'Req 11.4'],
});

/** 退出游戏（1 AP，Requirement 11.6）。与观战同为单向不可逆操作。 */
export const quitAction = paidAction({
  id: ACT_QUIT,
  label: '退出游戏',
  allowWhenDownedZero: true,
  effects: [opEffect('attach.add', { def: ATT_PERMANENT_EXIT, target: SELF })],
  sourceTrace: ['Req 11.6'],
});

/** 本模块声明的全部付费动作，按 Id 稳定排序。 */
export const CORE_PAID_ACTIONS: readonly ActionDef[] = [
  attackAction,
  boardVehicleAction,
  crawlAction,
  eternalSleepAction,
  leaveVehicleAction,
  moveAction,
  pickupAction,
  preciseBeginAction,
  preciseCompleteAction,
  quitAction,
  raiseShieldAction,
  sleepDownAction,
  spectateAction,
  standUpAction,
  tidyBackpackAction,
  transitBeginAction,
  transitCompleteAction,
  wakeUpAction,
].sort((left, right) => left.id.localeCompare(right.id, 'en'));
