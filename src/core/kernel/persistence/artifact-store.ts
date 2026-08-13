/**
 * 制品存储端口与实现
 *
 * 版本：1.0.0（2026-08-11）
 * 迁出源：spec-compiler/output-lease.ts（ArtifactStore 接口 + InMemoryArtifactStore）
 * 迁出源：spec-compiler/filesystem-artifact-store.ts
 *
 * 职责：
 * - 制品的生命周期管理（staging → published）
 * - 原子发布（all-or-nothing semantics）
 * - 隔离与恢复（避免部分发布的可见性）
 */

import { createHash } from 'node:crypto';

/**
 * 制品清单条目（元数据 + 哈希）
 */
export interface ArtifactManifestEntry {
  readonly name: string;
  readonly byteLength: number;
  readonly hash: string;
}

/**
 * 制品清单（generation 标头 + entry list）
 *
 * 发布原子单位。一个 manifest 对应一个已提交的 generation。
 */
export interface ArtifactManifest {
  readonly generation: number;
  readonly snapshotId: string;
  readonly baselineId: string;
  readonly compilationId: string;
  readonly artifactHash: string;
  readonly entries: readonly ArtifactManifestEntry[];
}

/**
 * 制品存储端口（抽象）
 *
 * 职责：
 * - createStaging：创建隔离的临时区域
 * - write/read/sync：分阶段操作与验证
 * - publish：原子提交
 * - discard/quarantine：失败处理
 *
 * 不变量：
 * - staging 对外不可见
 * - publish 是原子操作（all or nothing）
 * - committed 数据不可变
 */
export interface ArtifactStore {
  createStaging(stagingId: string): void;
  writeStaging(stagingId: string, name: string, bytes: Uint8Array): void;
  readStaging(stagingId: string, name: string): Uint8Array | null;
  syncStaging(stagingId: string): void;
  publish(stagingId: string, generation: number, manifest: ArtifactManifest): void;
  discardStaging(stagingId: string): void;
  quarantine(stagingId: string, incidentId: string): void;
  readCommittedManifest(): ArtifactManifest | null;
  readCommitted(generation: number, name: string): Uint8Array | null;
}

/**
 * 完全确定性的内存存储实现
 *
 * 用途：单元测试、快速迭代、故障注入。
 * 支持：inject failure points 以验证部分失败不会泄露。
 */
export class InMemoryArtifactStore implements ArtifactStore {
  private readonly stagingAreas = new Map<string, Map<string, { bytes: Uint8Array }>>();
  private readonly committed = new Map<number, Map<string, { bytes: Uint8Array }>>();
  private readonly quarantined = new Map<string, Map<string, { bytes: Uint8Array }>>();
  private manifest: ArtifactManifest | null = null;
  private failAt: 'createStaging' | 'writeStaging' | 'syncStaging' | 'publish' | 'discardStaging' | 'quarantine' | null = null;
  public publishLeaksPartialState = false;

  injectFailure(point: typeof this.failAt): void {
    this.failAt = point;
  }

  private maybeFail(point: typeof this.failAt): void {
    if (this.failAt === point) throw new Error(`Injected artifact store failure at ${point}`);
  }

  createStaging(stagingId: string): void {
    this.maybeFail('createStaging');
    this.stagingAreas.set(stagingId, new Map());
  }

  writeStaging(stagingId: string, name: string, bytes: Uint8Array): void {
    this.maybeFail('writeStaging');
    const area = this.stagingAreas.get(stagingId);
    if (!area) throw new Error(`Staging area ${stagingId} does not exist`);
    area.set(name, { bytes: Uint8Array.from(bytes) });
  }

  readStaging(stagingId: string, name: string): Uint8Array | null {
    const stored = this.stagingAreas.get(stagingId)?.get(name);
    return stored ? Uint8Array.from(stored.bytes) : null;
  }

  syncStaging(stagingId: string): void {
    this.maybeFail('syncStaging');
    if (!this.stagingAreas.has(stagingId)) throw new Error(`Staging area ${stagingId} does not exist`);
  }

  publish(stagingId: string, generation: number, manifest: ArtifactManifest): void {
    const area = this.stagingAreas.get(stagingId);
    if (!area) throw new Error(`Staging area ${stagingId} does not exist`);
    if (this.failAt === 'publish') {
      if (this.publishLeaksPartialState) this.committed.set(generation, new Map(area));
      throw new Error('Injected artifact store failure at publish');
    }
    this.committed.set(generation, new Map(area));
    this.manifest = manifest;
    this.stagingAreas.delete(stagingId);
  }

  discardStaging(stagingId: string): void {
    this.maybeFail('discardStaging');
    this.stagingAreas.delete(stagingId);
  }

  quarantine(stagingId: string, incidentId: string): void {
    this.maybeFail('quarantine');
    const area = this.stagingAreas.get(stagingId);
    if (area) this.quarantined.set(`${incidentId}:${stagingId}`, area);
    this.stagingAreas.delete(stagingId);
  }

  readCommittedManifest(): ArtifactManifest | null {
    return this.manifest;
  }

  readCommitted(generation: number, name: string): Uint8Array | null {
    const stored = this.committed.get(generation)?.get(name);
    return stored ? Uint8Array.from(stored.bytes) : null;
  }

  // 测试辅助方法

  listStagingIds(): string[] {
    return Array.from(this.stagingAreas.keys()).sort();
  }

  listQuarantineKeys(): string[] {
    return Array.from(this.quarantined.keys()).sort();
  }

  listCommittedGenerations(): number[] {
    return Array.from(this.committed.keys()).sort((a, b) => a - b);
  }

  verifyNoPartialGeneration(): { ok: boolean; reason?: string } {
    const manifest = this.manifest;
    for (const generation of Array.from(this.committed.keys())) {
      if (!manifest || generation > manifest.generation) {
        return { ok: false, reason: `generation ${generation} has no committed manifest` };
      }
    }
    if (!manifest) return { ok: true };
    const area = this.committed.get(manifest.generation);
    if (!area) return { ok: false, reason: `manifest generation ${manifest.generation} has no artifacts` };
    for (const entry of manifest.entries) {
      const stored = area.get(entry.name);
      if (!stored) return { ok: false, reason: `manifest entry ${entry.name} is missing` };
      if (hashBytes(stored.bytes) !== entry.hash) {
        return { ok: false, reason: `manifest entry ${entry.name} hash mismatch` };
      }
    }
    return { ok: true };
  }
}

/**
 * SHA-256 字节哈希
 */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
