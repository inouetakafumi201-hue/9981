/**
 * L2 Kernel Port: 引擎层能力契约。
 *
 * 对应 design.md「运行时写入边界」与 Requirements 6.1、10.2、13.6–13.7、10.13。
 *
 * 铁律：
 * - L2 **不**实现事务、Expr 求值、Hook 分发、持久化、随机流或搜索算法；它们只能通过本契约消费。
 * - 语义写入的唯一出口是 `KernelContract.invoke`，它必须转发到 L1 `OpRegistry.invoke`。
 *   L2 内不存在第二个写入分支。
 * - 依赖注入而非直接 import 具体内核实例：测试用 double、生产用
 *   `op-registry-adapter.ts` 包装真实 `OpRegistry`，两条路径共用同一契约。
 */

import type { JsonValue } from '../model/json.js';
import type { OpCause, RuntimeSemanticState } from '../model/projection.js';

/** 内核调用成功结果。 */
export interface KernelInvokeOk {
  readonly ok: true;
  readonly journalEntries: readonly string[];
  readonly semanticStateFingerprintAfter: string;
}

/**
 * 内核调用失败类别。
 *
 * - `op-not-found`        指定 Op 未注册：动作定义的 Op 映射失效。
 * - `vetoed`              结构性 Op 被 before-hook 否决。
 * - `invalid-args`        Op 实现拒绝参数。
 * - `invariant-violation` L1 不变量校验失败，包含事务已回滚。
 * - `transaction-aborted` Op 前置条件失败导致包含事务回滚。
 *
 * 后两类都保证"事务前语义状态不变"（Requirements 13.7），但诊断代码不同，
 * 以便调用方区分"违反不变量"与"前置条件不满足"。
 */
export const KERNEL_ERROR_KINDS = [
  'op-not-found',
  'vetoed',
  'invalid-args',
  'invariant-violation',
  'transaction-aborted',
] as const;

export type KernelErrorKind = (typeof KERNEL_ERROR_KINDS)[number];

export interface KernelInvokeError {
  readonly ok: false;
  readonly kind: KernelErrorKind;
  /** L1 原始错误代码，原样透传，不重写。 */
  readonly code: string;
  readonly detail: string;
  /** 失败后的语义状态指纹；按 L1 事务语义应与调用前等价。 */
  readonly semanticStateFingerprintAfter: string;
}

export type KernelInvokeResult = KernelInvokeOk | KernelInvokeError;

/** 引擎层能力契约。 */
export interface KernelContract {
  /** 指定 Op 是否已在 L1 注册。 */
  hasOp(opId: string): boolean;

  /**
   * 唯一语义写入通道。实现必须转发到 L1 `OpRegistry.invoke`。
   *
   * `cause` 是 L2 构造的因果链信息。L1 当前的 `OpRegistry.invoke(name, args)` 尚无
   * `cause` 形参（对应 H-001 Hook/cause 链缺口），因此适配器负责把它交给 L1 可用的
   * 记录通道；L1 增加形参后只需改适配器，L2 调用点不变。
   */
  invoke(
    opId: string,
    args: Readonly<Record<string, JsonValue>>,
    cause: OpCause,
  ): KernelInvokeResult;

  /**
   * Hook 分发接线是否可用。
   * 依赖 Hook 的动作在其为 false 时必须被拒绝，且不得由 L2 用本地分发器代替
   * （design.md「运行时写入边界」）。
   */
  hookIntegrationAvailable(): boolean;

  /** 当前语义状态指纹，用于断言"请求前后状态等价"。 */
  semanticStateFingerprint(): string;

  /** 当前运行时语义状态的只读视图，供投影裁剪使用。 */
  runtimeState(): RuntimeSemanticState;
}

/** L1 不变量错误代码前缀（`src/core/kernel/state/error-codes.ts` 的 `FATAL_PREFIXES`）。 */
export const L1_INVARIANT_CODE_PREFIX = 'E_INV';

/** 把 L1 错误代码归类为 `KernelErrorKind`。 */
export function classifyKernelErrorCode(code: string): KernelErrorKind {
  if (code === 'E_OP_NOT_FOUND') {
    return 'op-not-found';
  }
  if (code === 'E_OP_VETOED') {
    return 'vetoed';
  }
  if (code === 'E_OP_INVALID_ARGS') {
    return 'invalid-args';
  }
  if (code.startsWith(L1_INVARIANT_CODE_PREFIX)) {
    return 'invariant-violation';
  }
  return 'transaction-aborted';
}
