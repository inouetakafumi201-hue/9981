/**
 * L2 基类层：公共导出。
 *
 * 端到端管线：来源编译 → JSON/UGC → 验证 → 引用解析 → 原子注册 → 只读投影 → AI/UI → 统一动作提交。
 */

export * as model from './model/index.js';
export * as compiler from './compiler/index.js';
export * as codec from './codec/index.js';
export * as ugc from './ugc/index.js';
export * as validation from './validation/index.js';
export * as resolution from './resolution/index.js';
export * as registry from './registry/index.js';
export * as adapters from './adapters/index.js';
export * as testing from './testing/index.js';

export * from './kernel/kernel-contract.js';
export * from './kernel/op-registry-adapter.js';
