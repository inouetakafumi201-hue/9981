/**
 * 引擎层持久化与租约原语（稳定导出）
 *
 * 版本：1.0.0（2026-08-11）
 *
 * 消费方：
 * - src/l2/** （基类层编译器）
 * - 宿主实现（FileSystemArtifactStore 等）
 *
 * 维护规则（v1.1+ 只能扩展）：
 * - 可新增存储实现
 * - 不能删除现有接口与类
 * - 不能改变原子性保证
 */

export { InMemoryArtifactStore, hashBytes } from './artifact-store.js';
export type { ArtifactStore, ArtifactManifest, ArtifactManifestEntry } from './artifact-store.js';
export { OutputLease, OutputLeaseError } from './output-lease.js';
export type { OutputLeaseState } from './output-lease.js';
