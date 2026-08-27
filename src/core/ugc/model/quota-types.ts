/**
 * 可信技术配额的纯类型（design.md「Trusted quota profile and monotonic budget」/ 需求 9.1-9.3）。
 *
 * 类型放在 model、执行放在 quota/：model 是依赖 DAG 的根，`ValidationReport` 需要引用配额快照，
 * 若类型定义在 quota/ 会造成 model 反向依赖 quota。这与内核把 ErrCode/Diagnostic 放在 L1 的理由一致。
 */
import type { SourceSpan } from '../../kernel/state/diagnostic';

/**
 * 全部配额类别。顺序固定，用于快照的确定性序列化。
 *
 * `migrationSteps` 对应共享错误码 `E_QUOTA_MIGRATION_STEPS`（本 Spec 任务 1.3 已登记到
 * `ERR_CODES.E_QUOTA`，因此该路径不再失败关闭）。
 */
export const QUOTA_KINDS = [
  'inputBytes',
  'nestingDepth',
  'objectMembers',
  'arrayElements',
  'sourceRecords',
  'astNodes',
  'definitions',
  'referenceEdges',
  'traversalWork',
  'diagnostics',
  'migrationSteps',
  'outputBytes',
] as const;

export type QuotaKind = (typeof QUOTA_KINDS)[number];

/**
 * 由可信宿主提供的配额档案。候选字段**不能**修改、禁用或重新解释其中任何一项（需求 5.8、9.1）。
 *
 * 每一项都是"自身 Schema 的非负有限整数"，**不受 1–5 玩法数值范围约束**（需求 9.3）。
 */
export type TrustedQuotaProfile = {
  readonly profileId: string;
  readonly version: string;
} & {
  readonly [K in QuotaKind]: number;
};

export interface QuotaUsage {
  readonly used: number;
  readonly limit: number;
}

export type QuotaUsageSnapshot = Readonly<Record<QuotaKind, QuotaUsage>>;

export function isQuotaKind(value: unknown): value is QuotaKind {
  return typeof value === 'string' && (QUOTA_KINDS as readonly string[]).includes(value);
}

/**
 * 单调预算接口。实现见 `quota/quota-budget.ts`。
 *
 * 契约：
 * - 只增不减。没有 release/refund/reset 方法——一旦消耗就不能退回，否则对抗性输入可以循环占用。
 * - 溢出安全。累加使用安全整数检查，越界立即终止受影响遍历而不是回绕。
 * - `consume` 失败后必须终止**受影响的**有界遍历，而不是继续尝试后续元素。
 */
export interface QuotaBudget {
  /** 消耗预算。成功返回 `null`；失败返回携带精确 `E_QUOTA_*` 的诊断。 */
  consume(kind: QuotaKind, amount: number, context?: QuotaConsumeContext): QuotaViolation | null;
  used(kind: QuotaKind): number;
  limit(kind: QuotaKind): number;
  remaining(kind: QuotaKind): number;
  /** 已耗尽判定；用于诊断配额的"只追加一条终止性诊断"逻辑。 */
  isExhausted(kind: QuotaKind): boolean;
  snapshot(): QuotaUsageSnapshot;
}

export interface QuotaConsumeContext {
  /** 最近可用的来源位置，用于资源诊断定位（需求 9.7）。 */
  readonly sourceSpan?: SourceSpan | null;
  readonly jsonPath?: string | null;
  readonly definitionId?: string | null;
}

/**
 * 配额越界事实。它只描述"哪一类配额、限额多少、观测用量多少"，
 * 不含完整超大载荷（需求 9.7 明确禁止回显完整超大输入）。
 */
export interface QuotaViolation {
  readonly kind: QuotaKind;
  readonly limit: number;
  /** 观测用量或下界。请求量本身可能远超限额，这里如实记录尝试后的下界。 */
  readonly observed: number;
  readonly requested: number;
  readonly context: QuotaConsumeContext | null;
}
