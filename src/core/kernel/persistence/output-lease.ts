/**
 * 输出租约实现
 *
 * 版本：1.0.0（2026-08-11）
 * 迁出源：spec-compiler/output-lease.ts（OutputLease class）
 *
 * 职责：
 * - 单次使用的写入能力
 * - 阶段式操作（write → verify → publish）
 * - 失败后立即撤销（revoke）
 */

import { randomUUID } from 'node:crypto';
import type { ArtifactStore, ArtifactManifest } from './artifact-store.js';
import { hashBytes } from './artifact-store.js';

export type OutputLeaseState = 'open' | 'revoked' | 'published';

/**
 * 输出租约错误
 */
export class OutputLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputLeaseError';
  }
}

/**
 * 单次使用的写入能力
 *
 * 生命周期：
 * 1. open: write/verify 操作允许
 * 2. published: 已发布，无法再写
 * 3. revoked: 因错误撤销，无法操作
 *
 * 任何候选拒绝或基础设施中止都会撤销租约。
 */
export class OutputLease {
  readonly leaseToken: string;
  readonly stagingId: string;
  private state: OutputLeaseState = 'open';
  private readonly staged = new Map<string, { name: string; byteLength: number; hash: string }>();

  constructor(
    readonly compilationId: string,
    readonly baselineId: string,
    private readonly store: ArtifactStore,
    leaseToken = randomUUID(),
  ) {
    this.leaseToken = leaseToken;
    this.stagingId = `staging-${compilationId}-${leaseToken}`;
    this.store.createStaging(this.stagingId);
  }

  getState(): OutputLeaseState {
    return this.state;
  }

  private assertOpen(): void {
    if (this.state !== 'open') {
      throw new OutputLeaseError(`Output lease is ${this.state}; writes and publication are refused`);
    }
  }

  /**
   * 写入制品到 staging 区域
   *
   * 同时记录元数据（byteLength + hash）供后续验证。
   */
  write(name: string, bytes: Uint8Array): void {
    this.assertOpen();
    this.store.writeStaging(this.stagingId, name, bytes);
    this.staged.set(name, {
      name,
      byteLength: bytes.byteLength,
      hash: hashBytes(bytes),
    });
  }

  /**
   * 验证 staging 字节与意图一致
   *
   * 用途：编译器验证（在发布前）未发生崩溃或磁盘故障。
   */
  verifyStaged(): void {
    this.assertOpen();
    for (const entry of Array.from(this.staged.values())) {
      const actual = this.store.readStaging(this.stagingId, entry.name);
      if (!actual) throw new OutputLeaseError(`Staged artifact ${entry.name} is missing`);
      if (actual.byteLength !== entry.byteLength || hashBytes(actual) !== entry.hash) {
        throw new OutputLeaseError(`Staged artifact ${entry.name} does not match the intended bytes`);
      }
    }
    this.store.syncStaging(this.stagingId);
  }

  /**
   * 原子发布
   *
   * 创建 manifest，将 staging 区域提升为 generation。
   * 失败时不改变已提交状态。
   */
  publish(generation: number, snapshotId: string, artifactHash: string): ArtifactManifest {
    this.assertOpen();
    if (this.staged.size === 0) throw new OutputLeaseError('Refusing to publish an empty staging area');

    const manifest: ArtifactManifest = Object.freeze({
      generation,
      snapshotId,
      baselineId: this.baselineId,
      compilationId: this.compilationId,
      artifactHash,
      entries: Object.freeze(Array.from(this.staged.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))),
    });

    this.store.publish(this.stagingId, generation, manifest);
    this.state = 'published';
    return manifest;
  }

  /**
   * 撤销租约并清理 staging 区域
   *
   * 失败处理：
   * 1. 尝试 discard（推荐路径）
   * 2. discard 失败 → quarantine（隔离，防止缓存中毒）
   * 3. 两者都失败 → 向调用者报告，要求 halt
   */
  revoke(incidentId: string): void {
    if (this.state === 'open') this.state = 'revoked';
    try {
      this.store.discardStaging(this.stagingId);
    } catch (discardError) {
      try {
        this.store.quarantine(this.stagingId, incidentId);
      } catch (quarantineError) {
        throw new OutputLeaseError(
          `Cache rollback failed and quarantine failed: ${describe(discardError)}; ${describe(quarantineError)}`,
        );
      }
      throw new OutputLeaseError(`Cache rollback failed; staging area quarantined: ${describe(discardError)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
