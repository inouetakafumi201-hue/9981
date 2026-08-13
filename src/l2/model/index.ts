/**
 * L2 Model: 共享模型统一导出。
 *
 * 所有下游模块（compiler、codec、ugc、validation、resolution、registry、testing、adapters）
 * 必须从此处消费数据契约，不得自行定义语义字段 —— 这是 design.md 批次 B 门禁的要求。
 */

export * from './ids.js';
export * from './json.js';
export * from './source.js';
export * from './constitution.js';
export * from './def-kind.js';
export * from './diagnostic.js';
export * from './diagnostic-codes.js';
export * from './result.js';
export * from './schema.js';
export * from './reference.js';
export * from './family-contracts.js';
export * from './definition.js';
export * from './projection.js';
export * from './snapshot.js';
export * from './immutable.js';
export * from './ordering.js';
export * from './diagnostic-factory.js';

// 空间与物品领域公共面：仅只读目录、纯函数与类型。
export * from './space-items-domain-ids.js';
export * from './space-items-structural-bounds.js';
export * from './space-items-numeric-ownership.js';
export * from './space-items-diagnostic-categories.js';
export * from './space-items-unresolved.js';
export * from './space-items-contracts.js';
