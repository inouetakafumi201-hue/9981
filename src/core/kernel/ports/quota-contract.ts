/**
 * 引擎层配额验证稳定端口契约（L0 不可变）
 *
 * 职责：通用资源限制验证，在处理开始前拒绝有问题的配置。
 * 消费方：基类层 L2、玩法层、UGC 集成
 * 版本：1.0.0（2026-08-11）
 *
 * 演变规则：
 * - 可增加新的配额字段
 * - 可提高现有配额上限
 * - 不能降低现有配额上限（会影响现有输入）
 * - 不能删除现有字段
 */

import type { TechnicalQuotas } from './json-codec-contract';

/**
 * 配额验证错误
 */
export class QuotaError extends Error {
  constructor(
    message: string,
    readonly field: keyof TechnicalQuotas,
    readonly actualValue: number,
    readonly limit: number,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

/**
 * 配额验证器端口
 *
 * 职责：在任何 JSON 解析前验证宿主配置。
 * 契约：
 * - ✅ 所有字段都是非负整数
 * - ✅ 字段都在 [1, Number.MAX_SAFE_INTEGER] 范围内
 * - ✅ 拒绝 NaN、Infinity、小数
 * - ✅ 拒绝 null、undefined
 * - ✅ 拒绝缺失字段（所有 13 字段必须）
 * - ❌ 不能被输入文档覆盖
 */
export interface QuotaValidatorPort {
  /**
   * 验证配额集合是否有效
   *
   * 失败抛错（host defect，不是创作者错误）
   */
  validateQuotas(quotas: TechnicalQuotas): void;

  /**
   * 验证单个字段值
   */
  validateQuotaField(field: keyof TechnicalQuotas, value: unknown): void;
}

/**
 * 配额 violation 收集器
 *
 * 运行时用于追踪使用量是否超限。
 */
export class QuotaBudget {
  private used: Record<keyof TechnicalQuotas, number> = {
    inputBytes: 0,
    nestingDepth: 0,
    objectMembers: 0,
    arrayElements: 0,
    astNodes: 0,
    definitions: 0,
    referenceEdges: 0,
    traversalWork: 0,
    diagnostics: 0,
    outputBytes: 0,
    migrationSteps: 0,
    identifierLength: 0,
    packageDependencyEdges: 0,
  };

  constructor(readonly limits: TechnicalQuotas) {}

  /**
   * 尝试申请配额
   *
   * 返回 true 表示有预算，false 表示超限
   */
  tryAllocate(field: keyof TechnicalQuotas, amount: number): boolean {
    if (this.used[field] + amount > this.limits[field]) {
      return false;
    }
    this.used[field] += amount;
    return true;
  }

  /**
   * 申请配额，超限抛错
   */
  allocateOrThrow(field: keyof TechnicalQuotas, amount: number): void {
    if (!this.tryAllocate(field, amount)) {
      throw new QuotaError(
        `Quota exceeded: ${field} (used ${this.used[field]} + ${amount} > limit ${this.limits[field]})`,
        field,
        this.used[field] + amount,
        this.limits[field],
      );
    }
  }

  /**
   * 获取剩余预算
   */
  remaining(field: keyof TechnicalQuotas): number {
    return Math.max(0, this.limits[field] - this.used[field]);
  }

  /**
   * 重置计数器
   */
  reset(): void {
    for (const key of Object.keys(this.used) as (keyof TechnicalQuotas)[]) {
      this.used[key] = 0;
    }
  }
}
