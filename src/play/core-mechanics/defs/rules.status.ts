/**
 * 状态施加/刷新/到期与隐蔽移除、体力授予规则（tasks.md 任务 3.6 / design.md 3.12、3.14、3.15）。
 *
 * "刷新"语义到引擎层的映射（design.md 3.12 的关键裁决）：
 * - 引擎层 AttachmentDef.stackStrategy 的 'refresh' 会 stack+1 并覆盖 expiresAt，与本 Spec 的
 *   "刷新保留较长剩余时间、不叠加强度"相反。
 * - 因此玩法层状态一律用 'unique'（stack 固定为 1，不叠加强度）；剩余时间在 play.status.apply
 *   的 modify 阶段用 pickLongerRemainingTurns 的等价逻辑取较大者，default 阶段以该值 attach.add
 *   后再 prop.set remainingTurns。
 *
 * 与 rules.damage.ts 共用 playRule 构造器，保证 priority 等数值归属分类一致。
 */
import type { RuleDef } from '../../../core/kernel/events/types.js';
import type { Expr } from '../../../core/kernel/state/expr-types.js';
import { playRule } from './rules.damage.js';
import {
  and,
  atOf,
  eq,
  getOf,
  gte,
  ifEffect,
  includesOf,
  isNull,
  lenOf,
  letEffect,
  maxNum,
  not,
  notNull,
  opEffect,
  pathOf,
  refGet,
  refId,
  requestField,
  setRequestField,
  subNum,
  varOf,
} from './expr.js';
import {
  ATT_CONCEALED,
  EVENT_STATUS_APPLY,
  EVENT_STATUS_TICK,
  EXPR_NOT_CONCEALED,
  PATH_REQ_STATUS,
  PATH_REQ_TICK,
  PROP_REMAINING_TURNS,
  REQ_FIELD_ATTACHMENT,
  REQ_FIELD_REMAINING_TURNS,
  REQ_FIELD_STATUS_DEF,
  REQ_FIELD_TARGET,
  REQ_FIELD_VETO,
  RULE_CONCEAL_REMOVE_ON_MOVE,
  RULE_STATUS_APPLY_DEFAULT,
  RULE_STATUS_APPLY_MODIFY,
  RULE_STATUS_TICK_DEFAULT,
  TAG_CONCEALED,
  VITALITY_MIN_ALIVE,
} from './ids.js';

const statusTarget = requestField(PATH_REQ_STATUS, REQ_FIELD_TARGET);
const statusDef = requestField(PATH_REQ_STATUS, REQ_FIELD_STATUS_DEF);
const statusIncoming = requestField(PATH_REQ_STATUS, REQ_FIELD_REMAINING_TURNS);
const statusNotVetoed = isNull(requestField(PATH_REQ_STATUS, REQ_FIELD_VETO));

/** 查询目标身上同名状态的现有 Attachment（用于取较长剩余）。 */
// 必须显式标注为 Expr：无标注时 `from` 会被推断为 string 而不是 QueryFrom，
// 该字面量就无法赋给 Expr 的查询变体。
const existingStatus: Expr = {
  q: {
    from: 'attachments',
    where: and(eq(pathOf('self.def'), statusDef), eq(pathOf('self.target'), statusTarget)),
  },
};

/**
 * modify：刷新策略裁决剩余时间。读出既有 remainingTurns，与新施加值取较大者，写回请求记录。
 * 这一步等价于 allocation.ts 的 pickLongerRemainingTurns（同一取最大语义，两处不漂移）。
 */
export const statusApplyModifyRule: RuleDef = playRule({
  id: RULE_STATUS_APPLY_MODIFY,
  on: EVENT_STATUS_APPLY,
  phase: 'modify',
  priority: 100,
  when: statusNotVetoed,
  effects: [
    letEffect('existing', existingStatus),
    ifEffect(
      eq(lenOf(varOf('existing')), 1),
      [
        letEffect('existingRemaining', refGet(atOf(varOf('existing'), 0), `props.${PROP_REMAINING_TURNS}`)),
        ifEffect(
          notNull(varOf('existingRemaining')),
          [setRequestField(PATH_REQ_STATUS, REQ_FIELD_REMAINING_TURNS, maxNum(varOf('existingRemaining'), statusIncoming))],
          [],
        ),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 13.2', 'S5 状态效果系统'],
});

/**
 * default：以裁决后的剩余时间施加状态。策略为 unique（stack 固定 1，不叠加强度）。
 * attach.add 的 props 映射不会被求值（DEVIATION-04），因此 remainingTurns 用后续 prop.set 落地。
 */
export const statusApplyDefaultRule: RuleDef = playRule({
  id: RULE_STATUS_APPLY_DEFAULT,
  on: EVENT_STATUS_APPLY,
  phase: 'default',
  priority: 100,
  when: statusNotVetoed,
  effects: [
    opEffect('attach.add', { def: statusDef, target: statusTarget }, 'appliedAtt'),
    ifEffect(
      notNull(statusIncoming),
      [
        opEffect('prop.set', {
          path: { op: 'concat', args: ['world.attachments.', refId(varOf('appliedAtt')), `.props.${PROP_REMAINING_TURNS}`] },
          value: statusIncoming,
        }),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 13.1', 'Req 13.7', 'S5 状态效果系统'],
});

const tickAttachment = requestField(PATH_REQ_TICK, REQ_FIELD_ATTACHMENT);

/**
 * status.tick default（清理阶段推进，Requirement 13.4）：
 * next = remaining - 1；next >= 1 时 prop.set，否则 attach.del（剩余 1 的状态在本次推进后被移除，
 * 而不是保留可见 0）。remainingTurns 是 Gameplay_Value 1-5，永不写 0。
 */
export const statusTickDefaultRule: RuleDef = playRule({
  id: RULE_STATUS_TICK_DEFAULT,
  on: EVENT_STATUS_TICK,
  phase: 'default',
  priority: 100,
  effects: [
    letEffect('remaining', refGet(tickAttachment, `props.${PROP_REMAINING_TURNS}`)),
    ifEffect(
      notNull(varOf('remaining')),
      [
        letEffect('next', subNum(varOf('remaining'), 1)),
        ifEffect(
          gte(varOf('next'), VITALITY_MIN_ALIVE),
          [
            opEffect('prop.set', {
              path: { op: 'concat', args: ['world.attachments.', refId(tickAttachment), `.props.${PROP_REMAINING_TURNS}`] },
              value: varOf('next'),
            }),
          ],
          [opEffect('attach.del', { id: refId(tickAttachment) })],
        ),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 13.4', 'Req 13.1'],
});

/**
 * 隐蔽移动后移除（Requirement 14.6）：挂在 after:entity.place 上。
 *
 * entity.place 是引擎层已标记的结构性 Op，因此 before/after:entity.place 的分发真实存在
 * （不依赖属性类 Op 的分发，design.md 2.4 / 3.14）。本规则的 phase 为 'default'：after 分发内的
 * default 子阶段写入会持久化（只有 after 子阶段才被回滚），因此 attach.del 真正生效。
 *
 * payload 是 entity.place 的参数 {entityId, nodeId}；这里按 entityId 匹配该活体的隐蔽 Attachment。
 */
export const concealRemoveOnMoveRule: RuleDef = playRule({
  id: RULE_CONCEAL_REMOVE_ON_MOVE,
  on: 'after:entity.place',
  phase: 'default',
  priority: 100,
  effects: [
    letEffect('placedId', getOf(varOf('payload'), 'entityId')),
    letEffect('concealAtt', {
      q: {
        from: 'attachments',
        where: and(eq(pathOf('self.def'), ATT_CONCEALED), eq(getOf(pathOf('self.target'), '$'), varOf('placedId'))),
      },
    }),
    ifEffect(
      gte(lenOf(varOf('concealAtt')), 1),
      [opEffect('attach.del', { id: refId(atOf(varOf('concealAtt'), 0)) })],
      [],
    ),
  ],
  sourceTrace: ['Req 14.6', 'D-015'],
});

/**
 * "找到"交互的目标守卫（Requirement 14.7）：带隐蔽标记的活体不进入合法目标集合。
 *
 * 本包不定义"找到"动作（它属于下游 AI/space-items）；这里以一个具名表达式 Def 提供可复用的
 * 目标谓词，供下游动作的 TargetSpec.query.where 引用。以 self 指代候选目标。
 */
export const notConcealedTargetExpr = {
  id: EXPR_NOT_CONCEALED,
  kind: 'expr' as const,
  body: not(includesOf(pathOf('self.tags'), TAG_CONCEALED)),
  pure: true,
  play: { numericOwnership: {}, sourceTrace: ['Req 14.7'] },
};

/** 状态相关规则集合（施加/刷新/到期/隐蔽移除）。 */
export const CORE_STATUS_RULES: readonly RuleDef[] = [
  statusApplyModifyRule,
  statusApplyDefaultRule,
  statusTickDefaultRule,
  concealRemoveOnMoveRule,
];

/** 状态相关的具名表达式 Def（供下游目标查询引用）。 */
export const CORE_STATUS_EXPRS = [notConcealedTargetExpr];
