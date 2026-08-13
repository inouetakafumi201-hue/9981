/**
 * 引擎层安全与配额原语（稳定导出）
 *
 * 版本：1.0.0（2026-08-11）
 *
 * 消费方：
 * - src/core/kernel/codec/** （JSON 编解码配额检查）
 * - src/l2/** （基类层编译配额管理）
 * - 制品与缓存系统
 *
 * 维护规则（v1.1+ 只能扩展）：
 * - 可新增哈希算法
 * - 可新增配额字段（宿主扩展）
 * - 不能删除现有导出
 * - 不能改变默认配额的严格性（只能变更严格）
 */

export { hashBytes, hashUtf8, hashObject, fnv1aHash, fnv1aString } from './hash.js';
export {
  DEFAULT_TECHNICAL_QUOTAS,
  TechnicalQuotaError,
  validateTechnicalQuotas,
  isQuotaSubsetOf,
  mergeQuotasConservative,
  createQuotaConsumption,
  isQuotaExhausted,
} from './quotas.js';
export type { TechnicalQuotas, QuotaConsumption } from './quotas.js';
