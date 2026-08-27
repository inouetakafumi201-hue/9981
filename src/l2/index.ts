/**
 * L2 基类层：公共导出。
 *
 * 端到端管线：来源编译 → JSON/UGC → 验证 → 引用解析 → 原子注册 → 只读投影 → AI/UI → 统一动作提交。
 */

export * as model from './model/index';
export * as compiler from './compiler/index';
export * as codec from './codec/index';
export * as ugc from './ugc/index';
export * as validation from './validation/index';
export * as resolution from './resolution/index';
export * as registry from './registry/index';
export * as adapters from './adapters/index';
export * as testing from './testing/index';

// 空间与物品领域的稳定公共面；与 model namespace 同步转出。
export * from './model/space-items-domain-ids';
export * from './model/space-items-structural-bounds';
export * from './model/space-items-numeric-ownership';
export * from './model/space-items-diagnostic-categories';
export * from './model/space-items-unresolved';
export * from './model/space-items-contracts';

export * from './kernel/kernel-contract';
export * from './kernel/op-registry-adapter';
export * from './kernel/registry-bridge';
