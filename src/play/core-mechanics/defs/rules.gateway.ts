/**
 * 三种网关的类型与五阶段规则骨架（tasks.md 任务 3.8 / design.md 3.8）。
 *
 * 三种网关共用同一执行骨架（全成或全不成，Requirement 10.6-10.7）：全部写入发生在一次顶层
 * invoke 的事务内，任一步 abort 或 ok:false 使事务整体回滚，没有"先扣资源、后判定"的分步提交。
 *
 * 本包**不提供**任何具体网关实例（商店、锁门、合成台、检定难度、资源数量、网关 AP 成本都无
 * 默认值，Requirement 10.8）——`gateways: []` 是合法配置。这里只声明 default 阶段的**分派骨架**：
 * 按请求记录里的 gatewayKind 分派到资源转换 / 检定 / 条件三条路径。具体门槛、资源、判定标准
 * 由下游玩法层配置以额外 RuleDef 挂在同一事件上提供。
 *
 * 失败语义只有两种（design.md 3.8）：显式失败效果，或无效果；失败原因走 Diagnostic.reason，
 * 不新建错误模型。
 */
import type { RuleDef } from '../../../core/kernel/events/types.js';
import type { Expr } from '../../../core/kernel/state/expr-types.js';
import { playRule } from './rules.damage.js';
import {
  eq,
  ifEffect,
  isNull,
  or,
  requestField,
  setRequestField,
} from './expr.js';
import {
  EVENT_GATEWAY_EVALUATE,
  GATEWAY_KIND_CHECK,
  GATEWAY_KIND_CONDITION,
  GATEWAY_KIND_RESOURCE,
  PATH_REQ_GATEWAY,
  REQ_FIELD_GATEWAY_KIND,
  REQ_FIELD_VETO,
  RULE_GATEWAY_BEFORE,
  RULE_GATEWAY_DEFAULT,
} from './ids.js';

/** 网关类型（design.md 3.8 的 GatewayKind）。 */
export type GatewayKind = 'resourceConversion' | 'check' | 'condition';

const gatewayKind = requestField(PATH_REQ_GATEWAY, REQ_FIELD_GATEWAY_KIND);
const gatewayNotVetoed = isNull(requestField(PATH_REQ_GATEWAY, REQ_FIELD_VETO));

/**
 * before：触发者/目标资格。资格不满足即写 veto（发起动作的 vetoGuard 据此整体回滚）。
 *
 * 具体资格判定（actorRequireRef / targetRequireRef）由下游网关绑定以额外 RuleDef 提供；
 * 本骨架规则只在 gatewayKind 不是三种合法类型之一时写 veto——一个未知类型的网关请求必须失败关闭，
 * 不能静默走到 default 的兜底分支。
 */
export const gatewayBeforeRule: RuleDef = playRule({
  id: RULE_GATEWAY_BEFORE,
  on: EVENT_GATEWAY_EVALUATE,
  phase: 'before',
  priority: 100,
  effects: [
    ifEffect(
      isKnownGatewayKind(),
      [],
      [setRequestField(PATH_REQ_GATEWAY, REQ_FIELD_VETO, '网关类型不是资源转换/检定/条件三者之一：失败关闭，不产生任何效果。')],
    ),
  ],
  sourceTrace: ['Req 10.1', 'Req 10.2', 'D-006'],
});

/**
 * default：按 kind 分派的骨架。三条分支各自留出下游挂载点：
 * - resourceConversion：输入不足则不产生成功效果（下游规则负责扣减 + 成功效果，本骨架不含数值）；
 * - check：下游规则调用声明的 random.* 命名流后比对 criterion；
 * - condition：下游规则求值 predicate。
 *
 * 本骨架不写任何状态：它只确认 kind 合法（否则前面已 veto）。真正的资源扣减/判定/成功效果由
 * 下游网关绑定的额外 default 规则（更高 priority）在同一事务内完成，从而保持"全成或全不成"。
 */
export const gatewayDefaultRule: RuleDef = playRule({
  id: RULE_GATEWAY_DEFAULT,
  on: EVENT_GATEWAY_EVALUATE,
  phase: 'default',
  priority: 100,
  when: gatewayNotVetoed,
  effects: [
    // 骨架分支：本包不提供任何具体网关实例，因此三条分支体均为空，等待下游挂载。
    ifEffect(eq(gatewayKind, GATEWAY_KIND_RESOURCE), [], []),
    ifEffect(eq(gatewayKind, GATEWAY_KIND_CHECK), [], []),
    ifEffect(eq(gatewayKind, GATEWAY_KIND_CONDITION), [], []),
  ],
  sourceTrace: ['Req 10.3', 'Req 10.4', 'Req 10.5', 'Req 10.6'],
});

/**
 * 三种合法网关类型之一（D-006：资源转换 / 检定 / 条件）。
 *
 * 用 `or` 构造器而不是手写 `{ op:'or', args:[...] } as const`：`as const` 会把 `args` 推成只读
 * 元组，与 `Expr.args: Expr[]` 不兼容。构造器是同一份语义的唯一写法，避免同一表达式有两种构造路径。
 */
function isKnownGatewayKind(): Expr {
  return or(
    eq(gatewayKind, GATEWAY_KIND_RESOURCE),
    eq(gatewayKind, GATEWAY_KIND_CHECK),
    eq(gatewayKind, GATEWAY_KIND_CONDITION),
  );
}

/** 网关规则集合（骨架，下游可挂额外 RuleDef 到同一事件）。 */
export const CORE_GATEWAY_RULES: readonly RuleDef[] = [
  gatewayBeforeRule,
  gatewayDefaultRule,
];
