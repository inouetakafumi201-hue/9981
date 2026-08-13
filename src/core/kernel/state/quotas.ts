/**
 * 引擎层技术配额与验证
 *
 * 版本：1.0.0（2026-08-11，迁出自 spec-compiler/types.ts）
 * 迁出源：src/core/kernel/spec-compiler/types.ts
 * 职责：资源限制定义、会话配额验证、运行时预算追踪
 *
 * 不涉及语义解释，仅处理技术性 host 资源防御。
 * 所有配额均为绝对上限，运行时不可更改。超限即拒绝。
 */

/**
 * Host 拥有的资源上限（编译会话级别）
 *
 * 这些数值都不是规范常数：
 * - 没有权威来源规定输入大小、集合容量或标识符长度
 * - 它们仅存在于单个会话的边界保障
 * - 由 host 注入，候选输入永远无法提高
 *
 * 需求 5.12 禁止将无溯源的限制抬升为规范常数，
 * 这是为什么 identifierLength 放在这里而不是硬编码到验证器的原因。
 */
export interface TechnicalQuotas {
  /** UTF-8 输入字节数上限（防止 OOM） */
  readonly inputBytes: number;
  /** 嵌套深度上限（防止栈溢出） */
  readonly nestingDepth: number;
  /** 对象成员数上限 */
  readonly objectMembers: number;
  /** 数组元素数上限 */
  readonly arrayElements: number;
  /** AST 节点数上限 */
  readonly astNodes: number;
  /** 定义总数上限 */
  readonly definitions: number;
  /** 引用边数上限 */
  readonly referenceEdges: number;
  /** 验证遍历工作量上限 */
  readonly traversalWork: number;
  /** 诊断数上限 */
  readonly diagnostics: number;
  /** 输出字节数上限 */
  readonly outputBytes: number;
  /** 版本迁移步数上限 */
  readonly migrationSteps: number;
  /** 定义、语义族、包标识符的最大长度。Host 资源限制 */
  readonly identifierLength: number;
  /** 搜索依赖循环时遍历的最大包依赖边数 */
  readonly packageDependencyEdges: number;
}

/**
 * 默认技术配额
 *
 * Host 可按需调整，但所有配额必须满足 validateTechnicalQuotas 检查
 */
export const DEFAULT_TECHNICAL_QUOTAS: TechnicalQuotas = Object.freeze({
  inputBytes: 2_000_000,
  nestingDepth: 64,
  objectMembers: 50_000,
  arrayElements: 50_000,
  astNodes: 100_000,
  definitions: 10_000,
  referenceEdges: 100_000,
  traversalWork: 1_000_000,
  diagnostics: 2_000,
  outputBytes: 8_000_000,
  migrationSteps: 100,
  identifierLength: 128,
  packageDependencyEdges: 10_000,
});

/**
 * Host 配置错误：会话配额无效
 *
 * 永远无法从候选输入触发。Host 缺陷。
 */
export class TechnicalQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TechnicalQuotaError';
  }
}

/** 所有配额字段列表（用于遍历验证） */
const QUOTA_FIELDS: readonly (keyof TechnicalQuotas)[] = Object.freeze([
  'inputBytes',
  'nestingDepth',
  'objectMembers',
  'arrayElements',
  'astNodes',
  'definitions',
  'referenceEdges',
  'traversalWork',
  'diagnostics',
  'outputBytes',
  'migrationSteps',
  'identifierLength',
  'packageDependencyEdges',
]);

/**
 * 验证配额集合有效性
 *
 * 每个配额都作为倒数计数或上限被消费，所以非有限、非整数或非正值会导致未定义行为：
 * - `budget-- <= 0` 在 NaN 上不会触发
 * - 零上限让编译器无法报告停止原因
 *
 * 在任何 JSON 解析前调用此函数。失败表示 host 配置错误，编译无法开始。
 */
export function validateTechnicalQuotas(quotas: TechnicalQuotas): void {
  const issues: string[] = [];
  for (const field of QUOTA_FIELDS) {
    const value = quotas[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      issues.push(`${String(field)} must be a positive safe integer, received ${String(value)}`);
    }
  }
  if (issues.length > 0) {
    throw new TechnicalQuotaError(`Technical quotas are unusable: ${issues.join('; ')}`);
  }
}

/**
 * 运行时配额预算追踪
 *
 * 用于在编译过程中监控资源使用是否超限。
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
   * @returns true 表示有预算且已分配，false 表示超限
   */
  tryAllocate(field: keyof TechnicalQuotas, amount: number): boolean {
    if (this.used[field] + amount > this.limits[field]) {
      return false;
    }
    this.used[field] += amount;
    return true;
  }

  /**
   * 申请配额，超限时抛错
   */
  allocateOrThrow(field: keyof TechnicalQuotas, amount: number): void {
    if (!this.tryAllocate(field, amount)) {
      throw new TechnicalQuotaError(
        `Quota exceeded: ${field} (used ${this.used[field]} + ${amount} > limit ${this.limits[field]})`,
      );
    }
  }

  /**
   * 查询剩余预算
   */
  remaining(field: keyof TechnicalQuotas): number {
    return Math.max(0, this.limits[field] - this.used[field]);
  }

  /**
   * 获取已使用量
   */
  getUsed(field: keyof TechnicalQuotas): number {
    return this.used[field];
  }

  /**
   * 重置所有计数器
   */
  reset(): void {
    for (const key of QUOTA_FIELDS) {
      this.used[key] = 0;
    }
  }

  /**
   * 检查是否任何字段超限
   */
  isExhausted(): boolean {
    for (const field of QUOTA_FIELDS) {
      if (this.used[field] >= this.limits[field]) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取所有字段的使用状态快照
   */
  snapshot(): Readonly<Record<keyof TechnicalQuotas, { used: number; limit: number }>> {
    const result: Record<keyof TechnicalQuotas, { used: number; limit: number }> = {} as any;
    for (const field of QUOTA_FIELDS) {
      result[field] = { used: this.used[field], limit: this.limits[field] };
    }
    return Object.freeze(result);
  }
}
