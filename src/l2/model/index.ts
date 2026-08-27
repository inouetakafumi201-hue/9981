/**
 * L2 Model: 共享模型统一导出。
 *
 * 所有下游模块（compiler、codec、ugc、validation、resolution、registry、testing、adapters）
 * 必须从此处消费数据契约，不得自行定义语义字段 —— 这是 design.md 批次 B 门禁的要求。
 */

export * from './ids';
export * from './json';
export * from './source';
export * from './constitution';
export * from './def-kind';
export * from './diagnostic';
export * from './diagnostic-codes';
export * from './result';
export * from './schema';
export * from './reference';
export * from './family-contracts';
export * from './definition';
export * from './projection';
export * from './snapshot';
export * from './immutable';
export * from './ordering';
export * from './diagnostic-factory';
export * from './composition-registry';
export * from './composition-shape';
export * from './cas-field-alignment';
export * from './component-alignment';
export * from './family-component-shapes';

// 空间与物品领域公共面：仅只读目录、纯函数与类型。
export * from './space-items-domain-ids';
export * from './space-items-structural-bounds';
export * from './space-items-numeric-ownership';
export * from './space-items-diagnostic-categories';
export * from './space-items-unresolved';
export * from './space-items-contracts';
