/**
 * 玩法包复杂度评分。
 *
 * 用于定价分档。评分公式可后续调整，但原则不变：
 *  - 只计数结构复杂度，不管规则强度（一把伤害 5 的枪和伤害 1 的枪计数相同）
 *  - 地图比实例复杂（需要拓扑校验、曲线处理）
 *  - 自定义规则比数据复杂（需要逻辑验证）
 *
 * 定价分档由运营层决定，不在此硬编码。
 */
import type { ComplexityMetrics } from './types';

/**
 * 计算玩法包的复杂度评分。
 *
 * @param metrics - 复杂度指标
 * @returns 复杂度评分（0-∞）
 */
export function calculateComplexityScore(metrics: ComplexityMetrics): number {
  // 基础分：实例数 × 10
  let score = metrics.profileCount * 10;

  // 地图加权：地图比实例复杂，系数 5
  score += metrics.mapCount * 50;

  // 自定义规则加权：规则比数据复杂，系数 10
  score += metrics.customRuleCount * 100;

  return score;
}

/**
 * 根据复杂度评分推荐定价分档（供参考，实际定价由运营决定）。
 *
 * 分档逻辑：
 *  - Tier 1（简单）：≤10 个实例，无地图
 *  - Tier 2（中等）：≤50 个实例，或 1 张地图
 *  - Tier 3（复杂）：>50 个实例，或多张地图
 *  - Tier 4（非常复杂）：含自定义规则
 *
 * @param complexityScore - 复杂度评分
 * @returns 推荐分档（1-4）
 */
export function suggestPriceTier(complexityScore: number): 1 | 2 | 3 | 4 {
  if (complexityScore <= 100) return 1; // ≤10 个实例
  if (complexityScore <= 500) return 2; // ≤50 个实例或 1 张地图
  if (complexityScore <= 1000) return 3; // >50 个实例或多张地图
  return 4; // 含自定义规则
}
