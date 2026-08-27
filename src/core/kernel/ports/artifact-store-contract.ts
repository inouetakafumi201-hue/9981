/**
 * 引擎层持久化（制品存储）稳定端口契约（L0 不可变）
 *
 * 职责：通用原子文件发布、代一制、恢复。
 * 消费方：基类层 L2、玩法层、UGC 集成
 * 版本：1.0.0（2026-08-11）
 *
 * 演变规则：
 * - 可增加新的故障检测点
 * - 不能改变现有发布事务语义
 * - 不能删除恢复能力
 */

import type { Sha256Hash } from './hash-contract';

/**
 * 制品清单条目（每个 generation 一条）
 *
 * 用于链连续性验证与恢复。
 */
export interface ArtifactManifestEntry {
  readonly generation: number;
  readonly artifactId: string;
  readonly hash: Sha256Hash;
  readonly size: number;
  readonly timestamp: number; // Unix timestamp
  readonly files: Readonly<Record<string, { readonly hash: Sha256Hash; readonly size: number }>>;
}

/**
 * 制品清单（生成链）
 *
 * 包含所有已发布 generation 的签名。
 */
export interface ArtifactManifest {
  readonly artifactId: string;
  readonly entries: readonly ArtifactManifestEntry[];
}

/**
 * 制品存储故障点
 *
 * 用于故障注入测试与恢复决策
 */
export enum ArtifactFailurePoint {
  /** 创建 staging 目录 */
  CREATE_STAGING = 'createStaging',
  /** 写入 staging 文件 */
  WRITE_STAGING = 'writeStaging',
  /** 同步（fsync） */
  SYNC_STAGING = 'syncStaging',
  /** 重命名到 committed */
  PUBLISH = 'publish',
}

/**
 * 输出租约（单次发布能力）
 *
 * 职责：管理单次写操作的全生命周期。
 * 契约：
 * - ✅ 仅一次写入机会
 * - ✅ 拒绝覆盖已提交 generation
 * - ✅ 失败恢复：隔离 staging，状态不变
 * - ✅ 成功提交：原子重命名，不可回滚
 * - ❌ 不支持并发写入同一 artifact
 * - ❌ 不支持增量更新
 */
export interface OutputLease {
  readonly leasedStagingId: string;
  readonly artifactId: string;

  /**
   * 写入数据到 staging
   *
   * 失败场景（抛错，staging 保留用于调查）：
   * - 磁盘满
   * - 权限不足
   * - 注入测试
   */
  write(filename: string, data: Uint8Array): Promise<void>;

  /**
   * 读回验证（可选）
   *
   * 验证写入的数据与预期一致
   */
  read(filename: string): Promise<Uint8Array>;

  /**
   * 计算文件哈希
   */
  hashFile(filename: string): Promise<Sha256Hash>;

  /**
   * 同步到磁盘（fsync）
   *
   * 失败场景（抛错，staging 保留）：
   * - I/O 错误
   * - 注入测试
   */
  sync(): Promise<void>;

  /**
   * 原子发布
   *
   * 成功：staging → committed/{generation}，生成 manifest entry
   * 失败：staging 隔离到 .quarantine/，状态不变
   *
   * 失败场景（抛错，staging 隔离）：
   * - 目标 generation 已存在
   * - 重命名失败
   * - 注入测试
   */
  publish(generation: number): Promise<ArtifactManifestEntry>;

  /**
   * 取消未发布的 staging
   *
   * 删除 staging 目录。成功后 lease 失效。
   */
  revoke(): Promise<void>;
}

/**
 * 制品存储端口
 *
 * 职责：管理制品的生命周期（write → publish → recovery）。
 * 契约：
 * - ✅ 原子发布：staging 写入完整后一次性重命名
 * - ✅ 生成链：manifest 记录所有 generation
 * - ✅ 恢复拒绝猜测：缺失 generation 或哈希不匹配时报告并拒绝恢复
 * - ✅ 隔离失败 staging：失败后移至 .quarantine，防止污染
 * - ✅ 空 manifest 返回 null（允许首次发布）
 * - ❌ 不支持并发访问同一 artifact
 * - ❌ 不支持跨卷操作
 */
export interface ArtifactStorePort {
  /**
   * 创建新的输出租约
   *
   * 失败场景（抛错）：
   * - Artifact 已存在且不可覆盖
   * - Staging 目录创建失败
   * - 权限不足
   */
  createLease(artifactId: string, expectedGeneration: number): Promise<OutputLease>;

  /**
   * 恢复最新提交的 generation
   *
   * 返回最新的 manifest 条目。
   *
   * 失败场景（抛错，不自动降级）：
   * - Manifest 链断裂（缺失 generation）
   * - 文件哈希不匹配
   * - Generation 目录损坏
   * - 空 manifest 返回 null（允许首次发布）
   *
   * 设计原则：恢复拒绝猜测，宁可失败也不返回不一致状态。
   */
  recover(artifactId: string): Promise<ArtifactManifestEntry | null>;

  /**
   * 隔离失败的 staging（内部使用）
   *
   * 将 staging 目录移至 .quarantine/，便于事后调查。
   */
  quarantine(stagingId: string): Promise<void>;

  /**
   * 列出所有 artifact
   */
  listArtifacts(): Promise<readonly string[]>;
}

/**
 * 输出租约错误
 */
export class OutputLeaseError extends Error {
  constructor(
    message: string,
    readonly artifact: string,
    readonly staging: string,
  ) {
    super(message);
    this.name = 'OutputLeaseError';
  }
}

/**
 * 制品链错误（恢复失败）
 */
export class ArtifactChainError extends Error {
  constructor(
    message: string,
    readonly artifactId: string,
    readonly failurePoint: 'missing-generation' | 'hash-mismatch' | 'corrupted-directory',
  ) {
    super(message);
    this.name = 'ArtifactChainError';
  }
}

/**
 * 内存制品存储（测试用）
 *
 * 职责：实现 ArtifactStorePort，所有数据存储在内存中。
 * 契约：
 * - ✅ 所有操作原子
 * - ✅ 支持故障注入
 * - ✅ 恢复拒绝猜测
 * - ❌ 无持久化
 * - ❌ 进程退出时数据丢失
 */
export interface InMemoryArtifactStore extends ArtifactStorePort {
  /**
   * 故障注入
   *
   * 在指定故障点抛错。多次设置会覆盖前一个。
   */
  injectFailureAt(artifactId: string, failurePoint: ArtifactFailurePoint): void;

  /**
   * 清空所有制品
   */
  clear(): void;

  /**
   * 获取 manifest
   */
  getManifest(artifactId: string): ArtifactManifest | undefined;
}
