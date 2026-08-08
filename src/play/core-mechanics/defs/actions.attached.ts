/**
 * 附着动作集合（tasks.md 任务 3.4 / design.md 3.6、3.15）。
 *
 * 附着动作 = **没有独立 AP 成本、必须依附一个已声明的付费动作、不能独立形成决策分支**的动作。
 * 三重机械保证（design.md 3.6）：
 * 1. **提交形态**：不产生独立 `Intent`；作为父动作 `bindings.attached` 的一项提交。
 * 2. **枚举形态**：`require` 里含"存在一个正在解算的、声明了本动作为附着项的父意图"守卫，
 *    顶层枚举时该守卫为假且未声明 `visible`，因此 `queryActions` 不返回它（Requirement 8.4）。
 * 3. **执行形态**：效果由装载期从本 `ActionDef` 派生的一条 `RuleDef` 在 `play.attach.invoke` 的
 *    `default` 阶段执行——同一份 `effects` 只声明一次，不产生第二份定义。
 *
 * `cost` 是**空数组**，不得写成 `amount: 0`（Requirement 3.6：投影为"无独立 AP 成本"类别）。
 *
 * ## 为什么效果体是"一个 `if`"而不是"守卫 + abort"
 *
 * 派生规则跑在 `HookDispatcher` 的 `default` 阶段。已核对：`dispatchInner` 的 `default` 分支
 * **不检查** `runOneSafely` 的返回值，且该阶段没有保存点——因此一条 `abort` 既不会取消分发，
 * 也不会回滚 `abort` 之前已经落下的写入。把前置条件写成"要么整体执行、要么只记 `veto`"的
 * 单个 `if`，才能保证"前置不满足 ⇒ 零写入"。`veto` 由父动作的守卫兑现为整体回滚。
 */
import type { ActionDef, CostSpec } from '../../../core/kernel/actions/types.js';
import type { Def } from '../../../core/kernel/state/def.js';
import type { Effect } from '../../../core/kernel/events/effect-types.js';
import type { Expr } from '../../../core/kernel/state/expr-types.js';
import type { RuleDef } from '../../../core/kernel/events/types.js';
import type { AttachedFailureBehavior, AttachedTriggerPoint, NumericOwnershipRule } from '../ownership.js';
import { buildNumericOwnership, gameplayValue, internalMetric, playExt, structuralBound } from '../ownership.js';
import {
  and,
  atOf,
  clearRequest,
  emitEffect,
  eq,
  getOf,
  hasTag,
  ifEffect,
  isNull,
  lacksTag,
  lenOf,
  notNull,
  opEffect,
  or,
  pathOf,
  refExists,
  refGet,
  refId,
  requestField,
  setRequestField,
  varOf,
} from './expr.js';
import {
  ACT_ATTACK,
  ACT_CANCEL_BLOCK,
  ACT_DROP_ITEM,
  ACT_MOVE,
  ACT_PICKUP,
  ACT_TIDY_BACKPACK,
  ACT_USE_ATTACHED_CONSUMABLE,
  ACT_USE_MEDICAL_ITEM,
  ACT_USE_STAMINA_ITEM,
  ATT_BLOCKING,
  attachedRuleIdFor,
  EVENT_ATTACH_INVOKE,
  EVENT_HEAL_REQUEST,
  EVENT_STAMINA_GRANT,
  EXPR_HAS_MEDICAL_TARGET,
  EXPR_HAS_STAMINA_TARGET,
  EXPR_HOLDS_DROPPABLE_ITEM,
  EXPR_IS_BLOCKING,
  EXPR_PARENT_INTENT_DECLARES_SELF,
  GROUP_ATTACHED,
  PATH_REQ_ATTACH,
  PATH_REQ_HEAL,
  PATH_REQ_STAMINA,
  PROP_VITALITY,
  REQ_FIELD_ACTION_ID,
  REQ_FIELD_ACTOR,
  REQ_FIELD_AMOUNT,
  REQ_FIELD_ITEM,
  REQ_FIELD_PHASE,
  REQ_FIELD_SOURCE,
  REQ_FIELD_TARGET,
  REQ_FIELD_VETO,
  TAG_BLOCKING,
  TAG_DOWNED_ZERO,
  TRIGGER_AFTER_PARENT,
  TRIGGER_BEFORE_PARENT,
} from './ids.js';

/** 附着动作的成本：空数组（Requirement 3.6、4.8）。 */
export const ATTACHED_COST: readonly CostSpec[] = [];

/** 调用上下文字段的读取快捷方式（静态路径，因此 `require` 与效果两处都可用）。 */
const ctxActionId = requestField(PATH_REQ_ATTACH, REQ_FIELD_ACTION_ID);
const ctxPhase = requestField(PATH_REQ_ATTACH, REQ_FIELD_PHASE);
const ctxActor = requestField(PATH_REQ_ATTACH, REQ_FIELD_ACTOR);
const ctxItem = requestField(PATH_REQ_ATTACH, REQ_FIELD_ITEM);
const ctxTarget = requestField(PATH_REQ_ATTACH, REQ_FIELD_TARGET);

/**
 * "存在一个正在解算的、声明了本动作为附着项的父意图"。
 *
 * 实现方式：父付费动作在触发时点把 `actionId` 与 `phase` 写进调用上下文再 `emit`；顶层枚举时
 * 上下文不存在，因此该守卫为假。这是唯一能同时在 `require`（无 Query、无 stateAccess）与效果里
 * 求值的表达形式。
 */
export const parentIntentDeclaresSelf = (actionId: string, triggerPoint: AttachedTriggerPoint): Expr =>
  and(eq(ctxActionId, actionId), eq(ctxPhase, triggerPoint));

/** 记录 veto：让父动作的守卫把整个事务回滚（`onFailure: 'rejectWholeAction'`）。 */
const recordVeto = (reason: string): Effect => setRequestField(PATH_REQ_ATTACH, REQ_FIELD_VETO, reason);

interface AttachedActionInput {
  readonly id: string;
  readonly label: string;
  /** 必须非空（Requirement 8.5）。 */
  readonly parentActions: readonly string[];
  readonly triggerPoint: AttachedTriggerPoint;
  /** 已登记具名表达式 Def 的 Id；其 `body` 与下面的 `preconditions` 是同一个 TS 常量，不会漂移。 */
  readonly requireRef: string;
  readonly onFailure: AttachedFailureBehavior;
  readonly preconditions: Expr;
  readonly body: readonly Effect[];
  readonly sourceTrace: readonly string[];
  /** 数值归属规则集：默认按结构类处理；恢复量类动作显式传入 `RECOVERY_OWNERSHIP_RULES`。 */
  readonly ownershipRules?: readonly NumericOwnershipRule[];
}

/**
 * 恢复量类附着动作（医疗 / 体力消耗品）的归属规则。
 *
 * 这两个动作里唯一的数值字面量是"允许的单次恢复量"比较（`eq(recoverAmount, 1)` /
 * `eq(recoverAmount, 2)`），它们是 Requirement 15.1「单次恢复量只能是 1 或 2」这条**玩法规则**
 * 的直接体现，因此归属为 Gameplay_Value。实际写入的恢复量是 `refGet(item, 'props.recoverAmount')`
 * 这个**引用**，不是字面量，所以本包不给恢复量任何默认值（具体物品实例属下游配置）。
 */
const RECOVERY_OWNERSHIP_RULES = [
  {
    pathSuffix: 'args.1',
    ownership: gameplayValue(),
  },
] as const;

/**
 * 结构类附着动作（取消格挡等）的归属规则。
 *
 * 这类动作里的数值字面量只有两种，都不是玩法平衡赋值：
 * - `at(list, 0)` 的数组下标 `0`：结构性编号（"第一个元素"）。
 * - `eq(len(...), 1)` 的基数比较 `1`：结构性判据（"恰好一条"），不是玩家可见刻度。
 */
const STRUCTURAL_OWNERSHIP_RULES = [
  {
    pathSuffix: 'args.1',
    whenValue: (value: number) => value === 0,
    ownership: structuralBound('数组下标：0 表示"第一个元素"，是结构性编号，不是玩家可见刻度。'),
  },
  {
    pathSuffix: 'args.1',
    ownership: structuralBound('基数比较（如 len === 1「恰好一条」）：结构性判据，不是玩法平衡赋值。'),
  },
] as const;

/** 附着动作在装载期从其 ActionDef 派生的执行规则（每个附着动作恰好一条，Id 与其一一对应）。 */
const DERIVED_INVOKE_RULES: RuleDef[] = [];

function attachedAction(input: AttachedActionInput): ActionDef {
  const contextGuard = parentIntentDeclaresSelf(input.id, input.triggerPoint);
  const failureBranch: Effect[] = input.onFailure === 'rejectWholeAction'
    ? [recordVeto(`附着动作 ${input.id} 的前置条件不满足，其失败行为为 rejectWholeAction。`)]
    : [];
  // 执行体：单个 if（default 阶段无保存点、不看返回值，abort 不回滚已落写入；见文件头）。
  const invocationEffects: Effect[] = [ifEffect(input.preconditions, [...input.body], failureBranch)];
  const ownershipRules = input.ownershipRules ?? STRUCTURAL_OWNERSHIP_RULES;
  const body = {
    id: input.id,
    kind: 'action' as const,
    label: input.label,
    group: GROUP_ATTACHED,
    // 顶层枚举时 contextGuard 为假，且**刻意不声明 `visible`**：依引擎层 `queryActions` 的默认
    // 规则（require 不满足且 visible 不满足即不出现），附着动作不进入任何结果集。
    require: and(contextGuard, input.preconditions),
    cost: [...ATTACHED_COST],
    effects: invocationEffects,
  };

  // 派生执行规则（design.md 3.6 执行形态）：同一份 effects 只声明一次，派生规则引用它，
  // 不产生第二份定义。when 只认自己声明的 actionId + triggerPoint，因此两个触发时点互不串扰。
  const derivedBody = {
    id: attachedRuleIdFor(input.id),
    kind: 'rule' as const,
    on: EVENT_ATTACH_INVOKE,
    phase: 'default' as const,
    priority: 100,
    when: and(
      eq(getOf(varOf('payload'), REQ_FIELD_ACTION_ID), input.id),
      eq(getOf(varOf('payload'), REQ_FIELD_PHASE), input.triggerPoint),
    ),
    effects: invocationEffects,
  };
  DERIVED_INVOKE_RULES.push({
    ...derivedBody,
    play: playExt({
      numericOwnership: buildNumericOwnership(
        derivedBody,
        [{ pathSuffix: 'priority', ownership: internalMetric('规则结算次序编号。') }, ...ownershipRules],
        `${derivedBody.id} 的数值归属`,
      ),
      sourceTrace: input.sourceTrace,
    }),
  });

  return {
    ...body,
    play: playExt({
      numericOwnership: buildNumericOwnership(body, ownershipRules, `${input.id} 的数值归属`),
      costClass: 'attached',
      parentActions: input.parentActions,
      triggerPoint: input.triggerPoint,
      requireRef: input.requireRef,
      onFailure: input.onFailure,
      sourceTrace: input.sourceTrace,
    }),
  };
}

// ---------------------------------------------------------------------------
// 前置条件（同一常量同时作为 ActionDef.require 的一部分与具名表达式 Def 的 body）
// ---------------------------------------------------------------------------

/** 丢弃物品：手持物品必须存在。 */
const holdsDroppableItem: Expr = refExists(ctxItem);

/** 取消格挡：行动者必须处于格挡状态。 */
const isBlocking: Expr = hasTag(ctxActor, TAG_BLOCKING);

/**
 * 医疗物品的目标资格（Requirement 15.2 + design.md 11.6 的字段缺失防护）。
 *
 * `notNull(target.props.vitality)` 这一条**不可省略**：引擎层 `prop.add` 读到不存在的路径会
 * 退化为 `0` 再加上恢复量，等于给零血倒地目标静默写出 1 点生命——即静默复活。`clamp` 挡不住它
 * （`clamp` 只在 `Def.clamp` 声明存在时生效，且它约束的是结果范围，不是"字段是否存在"）。
 */
const hasMedicalTarget: Expr = and(
  refExists(ctxItem),
  refExists(ctxTarget),
  notNull(refGet(ctxTarget, `props.${PROP_VITALITY}`)),
  lacksTag(ctxTarget, TAG_DOWNED_ZERO),
  or(eq(refGet(ctxItem, 'props.recoverAmount'), 1), eq(refGet(ctxItem, 'props.recoverAmount'), 2)),
);

/** 体力消耗品的目标资格：单次恢复量只能是 1 或 2（Requirement 6.12、15.5）。 */
const hasStaminaTarget: Expr = and(
  refExists(ctxItem),
  refExists(ctxTarget),
  or(eq(refGet(ctxItem, 'props.recoverAmount'), 1), eq(refGet(ctxItem, 'props.recoverAmount'), 2)),
);

// ---------------------------------------------------------------------------
// 五个附着动作（Requirement 4.8 的最小启用集）
// ---------------------------------------------------------------------------

/** 丢弃物品：把手持物品提升为节点上的独立物品。 */
export const dropItemAction = attachedAction({
  id: ACT_DROP_ITEM,
  label: '丢弃物品',
  parentActions: [ACT_MOVE, ACT_PICKUP, ACT_TIDY_BACKPACK],
  triggerPoint: TRIGGER_AFTER_PARENT,
  requireRef: EXPR_HOLDS_DROPPABLE_ITEM,
  onFailure: 'skipAttachedOnly',
  preconditions: holdsDroppableItem,
  body: [
    opEffect('item.promote', { itemId: refId(ctxItem), nodeId: refGet(ctxActor, 'node') }),
  ],
  sourceTrace: ['Req 4.8', 'Req 8.5', 'S5 零费动作'],
});

/** 使用已声明的随动作消耗品：具体物品实例与使用资格由下游配置提供，本包只保证成本类别。 */
export const useAttachedConsumableAction = attachedAction({
  id: ACT_USE_ATTACHED_CONSUMABLE,
  label: '使用随动作消耗品',
  parentActions: [ACT_MOVE, ACT_ATTACK, ACT_PICKUP],
  triggerPoint: TRIGGER_BEFORE_PARENT,
  requireRef: EXPR_HOLDS_DROPPABLE_ITEM,
  onFailure: 'rejectWholeAction',
  preconditions: refExists(ctxItem),
  body: [
    opEffect('item.destroy', { id: refId(ctxItem) }),
  ],
  sourceTrace: ['Req 4.8', 'Req 8.5'],
});

/**
 * 取消格挡（Requirement 14.2）：主动取消必须依附一个合法父付费动作，不能独立成为一次选择。
 */
export const cancelBlockAction = attachedAction({
  id: ACT_CANCEL_BLOCK,
  label: '取消格挡',
  parentActions: [ACT_MOVE, ACT_ATTACK, ACT_PICKUP, ACT_TIDY_BACKPACK],
  triggerPoint: TRIGGER_BEFORE_PARENT,
  requireRef: EXPR_IS_BLOCKING,
  onFailure: 'skipAttachedOnly',
  preconditions: isBlocking,
  body: [
    {
      let: 'blockAtt',
      be: {
        q: {
          from: 'attachments',
          where: and(eq(pathOf('self.def'), ATT_BLOCKING), eq(pathOf('self.target'), ctxActor)),
        },
      },
    },
    ifEffect(
      eq(lenOf(varOf('blockAtt')), 1),
      [opEffect('attach.del', { id: refId(atOf(varOf('blockAtt'), 0)) })],
      [],
    ),
  ],
  sourceTrace: ['Req 14.2', 'Req 4.8', 'D-009'],
});

/**
 * 医疗物品（Requirement 15.1-15.2）：附着动作，单次恢复量只能是 1 或 2，不得超过 5，
 * 不得对不满足目标资格者生效，**不得复活零血倒地目标**。
 *
 * 恢复量取自物品实例的 `props.recoverAmount`——本包**不给默认值**（具体物品实例属下游配置），
 * 只用前置条件把它约束在 1 或 2。
 */
export const useMedicalItemAction = attachedAction({
  id: ACT_USE_MEDICAL_ITEM,
  label: '使用医疗物品',
  parentActions: [ACT_MOVE, ACT_PICKUP],
  triggerPoint: TRIGGER_AFTER_PARENT,
  requireRef: EXPR_HAS_MEDICAL_TARGET,
  onFailure: 'rejectWholeAction',
  ownershipRules: RECOVERY_OWNERSHIP_RULES,
  preconditions: hasMedicalTarget,
  body: [
    setRequestField(PATH_REQ_HEAL, REQ_FIELD_SOURCE, ctxActor),
    setRequestField(PATH_REQ_HEAL, REQ_FIELD_TARGET, ctxTarget),
    setRequestField(PATH_REQ_HEAL, REQ_FIELD_AMOUNT, refGet(ctxItem, 'props.recoverAmount')),
    emitEffect(EVENT_HEAL_REQUEST, pathOf(PATH_REQ_HEAL)),
    ifEffect(
      isNull(requestField(PATH_REQ_HEAL, REQ_FIELD_VETO)),
      [
        // 物品消耗与恢复写入处于同一事务（Requirement 15.8）。
        opEffect('item.destroy', { id: refId(ctxItem) }),
        clearRequest(PATH_REQ_HEAL),
      ],
      [recordVeto('医疗恢复被 before 阶段规则否决：父动作连同附着效果整体回滚。')],
    ),
  ],
  sourceTrace: ['Req 15.1', 'Req 15.2', 'Req 15.8', 'Req 11.8'],
});

/** 体力消耗品（Requirement 6.12、15.5）：附着动作，恢复 1 或 2 体力，上限 5。 */
export const useStaminaItemAction = attachedAction({
  id: ACT_USE_STAMINA_ITEM,
  label: '使用体力消耗品',
  parentActions: [ACT_MOVE, ACT_PICKUP],
  triggerPoint: TRIGGER_AFTER_PARENT,
  requireRef: EXPR_HAS_STAMINA_TARGET,
  onFailure: 'rejectWholeAction',
  ownershipRules: RECOVERY_OWNERSHIP_RULES,
  preconditions: hasStaminaTarget,
  body: [
    setRequestField(PATH_REQ_STAMINA, REQ_FIELD_TARGET, ctxTarget),
    setRequestField(PATH_REQ_STAMINA, REQ_FIELD_AMOUNT, refGet(ctxItem, 'props.recoverAmount')),
    emitEffect(EVENT_STAMINA_GRANT, pathOf(PATH_REQ_STAMINA)),
    ifEffect(
      isNull(requestField(PATH_REQ_STAMINA, REQ_FIELD_VETO)),
      [
        opEffect('item.destroy', { id: refId(ctxItem) }),
        clearRequest(PATH_REQ_STAMINA),
      ],
      [recordVeto('体力恢复被 before 阶段规则否决：父动作连同附着效果整体回滚。')],
    ),
  ],
  sourceTrace: ['Req 6.12', 'Req 15.5', 'Req 6.14'],
});

/** 本模块声明的全部附着动作，按 Id 稳定排序。 */
export const CORE_ATTACHED_ACTIONS: readonly ActionDef[] = [
  cancelBlockAction,
  dropItemAction,
  useAttachedConsumableAction,
  useMedicalItemAction,
  useStaminaItemAction,
].sort((left, right) => left.id.localeCompare(right.id, 'en'));

/**
 * 附着动作派生的执行规则（每个附着动作恰好一条）。装载期与附着动作一并注册进玩法包，
 * 挂在 play.attach.invoke 事件上。DERIVED_INVOKE_RULES 在上面五个 attachedAction() 调用时被填充，
 * 因此这里在模块求值末尾读取时已经齐全。
 */
export const CORE_ATTACHED_INVOKE_RULES: readonly RuleDef[] = [...DERIVED_INVOKE_RULES]
  .sort((left, right) => left.id.localeCompare(right.id, 'en'));

/**
 * 附着动作 `requireRef` 指向的具名表达式 Def。
 *
 * 它们的 `body` 与上面 `preconditions` 用的是**同一个 TS 常量**，因此"声明的前置条件"与
 * "实际求值的前置条件"在结构上不可能漂移。装载期 Linter 校验每个 `requireRef` 都能解析到
 * 一个 `kind:'expr'` 的已登记 Def（否则 `E_LOAD_UNDEFINED_REF`）。
 *
 * 为什么 `require` 里是**内联**而不是 `{call: <exprId>}`：`ActionDef.require` 的求值上下文
 * （`decision/intent-ops.ts` 的 `evalRequire`）没有提供 `resolveNamedExpr`，`{call:...}` 会恒为
 * `null`——声明了却不可用。内联 + 同源常量是唯一既可求值又不产生第二份定义的写法。
 */
export const CORE_ATTACHED_REQUIRE_EXPRS: readonly Def[] = [
  {
    id: EXPR_HOLDS_DROPPABLE_ITEM,
    kind: 'expr',
    body: holdsDroppableItem,
    pure: true,
    play: playExt({ sourceTrace: ['Req 8.5', 'Req 4.8'] }),
  },
  {
    id: EXPR_IS_BLOCKING,
    kind: 'expr',
    body: isBlocking,
    pure: true,
    play: playExt({ sourceTrace: ['Req 14.2'] }),
  },
  {
    id: EXPR_HAS_MEDICAL_TARGET,
    kind: 'expr',
    body: hasMedicalTarget,
    pure: true,
    play: playExt({
      numericOwnership: { 'body.args.4.args.0.args.1': gameplayValue(), 'body.args.4.args.1.args.1': gameplayValue() },
      sourceTrace: ['Req 15.1', 'Req 15.2', 'Req 11.6'],
    }),
  },
  {
    id: EXPR_HAS_STAMINA_TARGET,
    kind: 'expr',
    body: hasStaminaTarget,
    pure: true,
    play: playExt({
      numericOwnership: { 'body.args.2.args.0.args.1': gameplayValue(), 'body.args.2.args.1.args.1': gameplayValue() },
      sourceTrace: ['Req 6.12', 'Req 15.5'],
    }),
  },
  {
    id: EXPR_PARENT_INTENT_DECLARES_SELF,
    kind: 'expr',
    /** 参数化形态：调用方传入 `actionId` 与 `triggerPoint`。 */
    body: and(eq(ctxActionId, varOf('actionId')), eq(ctxPhase, varOf('triggerPoint'))),
    params: ['actionId', 'triggerPoint'],
    pure: true,
    play: playExt({ sourceTrace: ['Req 8.4', 'Req 8.8'] }),
  },
];
