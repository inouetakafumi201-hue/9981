/**
 * 单调配额预算（design.md「Trusted quota profile and monotonic budget」/ 需求 9.1-9.10）。
 *
 * 三条不变量：
 * 1. **只增不减**。没有 release/refund/reset。若允许退回，对抗性输入就能反复申请-释放，
 *    在总量不变的表象下无限占用工作量。
 * 2. **溢出安全**。累加前用 `amount > limit - used` 判断，永不构造可能越过安全整数范围的中间和。
 * 3. **越界即饱和**。违规后把该类别用量饱和到限额，使 `isExhausted` 为真，从而让受影响的
 *    有界遍历立即停止，而不是对后续元素继续尝试并产出成百上千条同类诊断。
 */
import type {
  QuotaBudget,
  QuotaConsumeContext,
  QuotaKind,
  QuotaUsageSnapshot,
  QuotaViolation,
  TrustedQuotaProfile,
} from '../model/quota-types.js';
import { QUOTA_KINDS } from '../model/quota-types.js';

/**
 * 非法消耗量。这只可能来自 UGC 自身实现缺陷（消耗量恒由内部计数派生，不来自候选），
 * 因此显式抛出而不是静默当作违规——把实现 bug 伪装成"候选超配额"会掩盖真正的问题。
 */
export class QuotaUsageError extends Error {
  constructor(kind: QuotaKind, amount: number) {
    super(`Invalid quota consume amount for ${kind}: ${String(amount)}`);
    this.name = 'QuotaUsageError';
  }
}

class MonotonicQuotaBudget implements QuotaBudget {
  private readonly usage: Map<QuotaKind, number> = new Map();

  constructor(private readonly profile: TrustedQuotaProfile) {
    for (const kind of QUOTA_KINDS) {
      this.usage.set(kind, 0);
    }
  }

  private usedOf(kind: QuotaKind): number {
    return this.usage.get(kind) ?? 0;
  }

  consume(kind: QuotaKind, amount: number, context?: QuotaConsumeContext): QuotaViolation | null {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new QuotaUsageError(kind, amount);
    }
    const limit = this.profile[kind];
    const used = this.usedOf(kind);
    const remaining = limit - used;
    if (amount > remaining) {
      // 饱和到限额：该类别自此耗尽，受影响遍历必须停止。
      this.usage.set(kind, limit);
      return Object.freeze({
        kind,
        limit,
        observed: limit,
        requested: amount,
        context: context ?? null,
      });
    }
    this.usage.set(kind, used + amount);
    return null;
  }

  used(kind: QuotaKind): number {
    return this.usedOf(kind);
  }

  limit(kind: QuotaKind): number {
    return this.profile[kind];
  }

  remaining(kind: QuotaKind): number {
    return this.profile[kind] - this.usedOf(kind);
  }

  isExhausted(kind: QuotaKind): boolean {
    return this.usedOf(kind) >= this.profile[kind];
  }

  snapshot(): QuotaUsageSnapshot {
    const entries: Record<string, { used: number; limit: number }> = {};
    for (const kind of QUOTA_KINDS) {
      entries[kind] = Object.freeze({ used: this.usedOf(kind), limit: this.profile[kind] });
    }
    return Object.freeze(entries) as QuotaUsageSnapshot;
  }
}

/**
 * 为一次验证创建独立预算。每个候选一份：预算跨候选共享会让一个候选的用量影响另一个候选的判定，
 * 从而破坏"同一输入 + 同一档案 → 同一结果"的确定性（需求 9.10）。
 */
export function createQuotaBudget(profile: TrustedQuotaProfile): QuotaBudget {
  return new MonotonicQuotaBudget(profile);
}

/**
 * 深度配额的特殊性：嵌套深度是**峰值**而非累计量。
 *
 * 若把每层嵌套都 `consume('nestingDepth', 1)`，一个宽而浅的文档（1000 个兄弟对象，每个深 2 层）
 * 会累计出 2000 的"深度"用量，与它的真实结构深度完全无关，从而错误地以深度配额拒绝合法输入。
 * 因此深度用单独的峰值跟踪器：只在**超过历史峰值**时消耗差额，使用量最终等于观测到的最大深度。
 */
export class DepthTracker {
  private peak = 0;

  constructor(private readonly budget: QuotaBudget) {}

  /** 进入一层。返回违规事实或 null。 */
  enter(depth: number, context?: QuotaConsumeContext): QuotaViolation | null {
    if (depth <= this.peak) return null;
    const delta = depth - this.peak;
    this.peak = depth;
    return this.budget.consume('nestingDepth', delta, context);
  }

  currentPeak(): number {
    return this.peak;
  }
}
