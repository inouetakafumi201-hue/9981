/**
 * UGC 激活层导出根。
 *
 * 注意：`mintValidatedChangeSet` 在这里导出**仅供流水线内部使用**，
 * 不得从 `src/core/ugc/index.ts` 再导出（由架构测试强制）。
 */
export type { MintFailureReason, MintInput, MintResult } from './validated-change-set.js';
export { isMintedValidatedChangeSet, mintValidatedChangeSet } from './validated-change-set.js';

export type { AtomicActivationCoordinator, AtomicActivationDeps } from './atomic-activation-coordinator.js';
export { createAtomicActivationCoordinator } from './atomic-activation-coordinator.js';
