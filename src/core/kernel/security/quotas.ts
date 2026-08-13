/**
 * 技术配额定义与验证
 *
 * 版本：1.0.0（2026-08-11）
 * 迁出源：spec-compiler/types.ts（TechnicalQuotas + validateTechnicalQuotas）
 *
 * 职责：
 * - 定义会话级资源限制（非规范性）
 * - 验证宿主配置的有效性
 * - 保证每个编译会话可被有限约束
 *
 * 不变量：
 * - 所有配额都是正整数
 * - 候选不能提升配额（宿主所有权）
 * - 配额是全局的，不针对特定内容
 */

/**
 * 完整的技术配额集合
 *
 * 每个字段都是宿主注入的资源限制，不源于规范。
 * 包括：字节限制、结构限制、标识符限制、图遍历限制等。
 */
export interface TechnicalQuotas {
  readonly inputBytes: number;
  readonly nestingDepth: number;
  readonly objectMembers: number;
  readonly arrayElements: number;
  readonly astNodes: number;
  readonly definitions: number;
  readonly referenceEdges: number;
  readonly traversalWork: number;
  readonly diagnostics: number;
  readonly outputBytes: number;
  readonly migrationSteps: number;
  /** 标识符长度上限（仅宿主资源限制） */
  readonly identifierLength: number;
  /** 包依赖图遍历上限 */
  readonly packageDependencyEdges: number;
}

/**
 * 默认技术配额
 *
 * 保守估计，适合大多数场景。可由宿主调整。
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
 * 配额配置错误
 *
 * 宿主配置问题，不源于候选内容。
 */
export class TechnicalQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TechnicalQuotaError';
  }
}

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
 * 验证宿主配置的配额集合
 *
 * 每个配额必须是正整数。任何非有限、小数或非正数值都是宿主配置错误。
 *
 * 抛出异常条件：
 * - 配额不是 safe integer
 * - 配额小于 1
 * - 配额不是 number 类型
 *
 * 这是早期失败设计：宿主配置错误不应该让编译阶段才失败。
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
 * 检查配额是否为严格正数倍数
 *
 * 用于检验两个配额集合之间的关系（例如：child <= parent）。
 */
export function isQuotaSubsetOf(child: TechnicalQuotas, parent: TechnicalQuotas): boolean {
  for (const field of QUOTA_FIELDS) {
    if (child[field] > parent[field]) return false;
  }
  return true;
}

/**
 * 合并两个配额集合（取较小值）
 *
 * 用于组合多个限制来源。
 */
export function mergeQuotasConservative(a: TechnicalQuotas, b: TechnicalQuotas): TechnicalQuotas {
  const result: Partial<TechnicalQuotas> = {};
  for (const field of QUOTA_FIELDS) {
    (result as Record<keyof TechnicalQuotas, number>)[field] = Math.min(a[field], b[field]);
  }
  return result as TechnicalQuotas;
}

/**
 * 配额消耗记录
 *
 * 用于运行时跟踪已使用的配额。
 */
export interface QuotaConsumption {
  inputBytes: number;
  nestingDepth: number;
  objectMembers: number;
  arrayElements: number;
  astNodes: number;
  definitions: number;
  referenceEdges: number;
  traversalWork: number;
  diagnostics: number;
  outputBytes: number;
  migrationSteps: number;
  identifierLength: number;
  packageDependencyEdges: number;
}

/**
 * 创建配额消耗追踪器
 *
 * 初始化为全 0，在编译过程中递增。
 */
export function createQuotaConsumption(): QuotaConsumption {
  return {
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
}

/**
 * 检查是否超过配额
 *
 * 用于运行时决策。
 */
export function isQuotaExhausted(consumed: QuotaConsumption, quota: TechnicalQuotas): boolean {
  for (const field of QUOTA_FIELDS) {
    if (consumed[field] >= quota[field]) return true;
  }
  return false;
}

/**
 * 配额消耗追踪器
 *
 * 提供增量消耗、检查和详细错误报告。
 */
export class QuotaTracker {
  private consumption: QuotaConsumption;

  constructor(private readonly quota: TechnicalQuotas) {
    this.consumption = createQuotaConsumption();
  }

  /**
   * 增加某个配额的消耗量
   *
   * 不检查是否超限（调用方应先用 canIncrement）。
   */
  increment(field: keyof QuotaConsumption, delta: number): void {
    this.consumption[field] += delta;
  }

  /**
   * 检查增加 delta 后是否会超限
   *
   * 返回 true 表示可以安全增加。
   */
  canIncrement(field: keyof QuotaConsumption, delta: number): boolean {
    return this.consumption[field] + delta <= this.quota[field];
  }

  /**
   * 获取当前消耗快照（不可修改）
   */
  getConsumption(): Readonly<QuotaConsumption> {
    return Object.freeze({ ...this.consumption });
  }

  /**
   * 生成超限详情（用于诊断）
   *
   * 返回所有已超限的字段及其值。
   */
  getExhaustedFields(): readonly { readonly field: keyof TechnicalQuotas; readonly current: number; readonly limit: number }[] {
    const exhausted: { field: keyof TechnicalQuotas; current: number; limit: number }[] = [];
    for (const field of QUOTA_FIELDS) {
      if (this.consumption[field] >= this.quota[field]) {
        exhausted.push({
          field,
          current: this.consumption[field],
          limit: this.quota[field],
        });
      }
    }
    return exhausted;
  }

  /**
   * 重置追踪器到初始状态
   */
  reset(): void {
    this.consumption = createQuotaConsumption();
  }
}
