/**
 * 持久化端口 characterization tests
 *
 * 版本：1.0.0（2026-08-12）
 *
 * 目标：验证 InMemoryArtifactStore 与 OutputLease 的原子性。
 *
 * 测试点：
 * - ✅ Staging 隔离（不可见）
 * - ✅ 原子发布（all-or-nothing）
 * - ✅ 失败后隔离（quarantine）
 * - ✅ 验证完整性
 */

import { describe, it, expect } from 'vitest';
import { InMemoryArtifactStore, hashBytes } from '../../persistence/index';
import { OutputLease } from '../../persistence/output-lease';

describe('Persistence Port: Characterization', () => {
  describe('InMemoryArtifactStore', () => {
    it('creates isolated staging areas', () => {
      const store = new InMemoryArtifactStore();
      store.createStaging('staging-1');
      expect(store.listStagingIds()).toContain('staging-1');
    });

    it('keeps staging invisible from committed readers', () => {
      const store = new InMemoryArtifactStore();
      store.createStaging('staging-1');
      store.writeStaging('staging-1', 'data.json', new Uint8Array([1, 2, 3]));

      // Committed is still null
      expect(store.readCommittedManifest()).toBeNull();
      expect(store.readCommitted(1, 'data.json')).toBeNull();

      // But staging can be read
      const staged = store.readStaging('staging-1', 'data.json');
      expect(staged).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('publishes atomically', () => {
      const store = new InMemoryArtifactStore();
      store.createStaging('staging-1');
      const bytes = new Uint8Array([4, 5, 6]);
      store.writeStaging('staging-1', 'artifact.bin', bytes);
      store.syncStaging('staging-1');

      const manifest = {
        generation: 1,
        snapshotId: 'snap-1',
        baselineId: 'base-1',
        compilationId: 'comp-1',
        artifactHash: 'abc123',
        entries: [
          {
            name: 'artifact.bin',
            byteLength: 3,
            hash: hashBytes(bytes),
          },
        ],
      };

      store.publish('staging-1', 1, manifest);

      expect(store.readCommittedManifest()).toEqual(manifest);
      expect(store.readCommitted(1, 'artifact.bin')).toEqual(bytes);

      // Staging should be cleaned up
      expect(store.listStagingIds()).not.toContain('staging-1');
    });

    it('allows republishing same generation (or silently ignores)', () => {
      const store = new InMemoryArtifactStore();
      store.createStaging('staging-1');
      store.writeStaging('staging-1', 'data.json', new Uint8Array([1]));
      store.syncStaging('staging-1');

      const manifest = {
        generation: 1,
        snapshotId: 's',
        baselineId: 'b',
        compilationId: 'c',
        artifactHash: 'h',
        entries: [{ name: 'data.json', byteLength: 1, hash: 'x' }],
      };

      store.publish('staging-1', 1, manifest);

      // Try to publish same generation again - InMemoryArtifactStore just updates
      store.createStaging('staging-2');
      store.writeStaging('staging-2', 'data.json', new Uint8Array([2]));
      store.syncStaging('staging-2');

      const manifest2 = {
        generation: 1,
        snapshotId: 's2',
        baselineId: 'b',
        compilationId: 'c',
        artifactHash: 'h2',
        entries: [{ name: 'data.json', byteLength: 1, hash: 'y' }],
      };

      // This succeeds in InMemoryArtifactStore (no duplicate check)
      // FileSystemArtifactStore would reject with "already committed"
      store.publish('staging-2', 1, manifest2);
      expect(store.readCommittedManifest()?.snapshotId).toBe('s2');
    });

    it('quarantines failed staging areas', () => {
      const store = new InMemoryArtifactStore();
      store.createStaging('staging-1');
      store.writeStaging('staging-1', 'data.json', new Uint8Array([1]));
      store.quarantine('staging-1', 'incident-123');

      expect(store.listQuarantineKeys()).toContain('incident-123:staging-1');
      expect(store.listStagingIds()).not.toContain('staging-1');
    });

    it('supports failure injection', () => {
      const store = new InMemoryArtifactStore();
      store.injectFailure('writeStaging');
      store.createStaging('staging-1');

      expect(() => store.writeStaging('staging-1', 'data.json', new Uint8Array([1]))).toThrow();
    });

    it('verifies no partial generation', () => {
      const store = new InMemoryArtifactStore();
      store.createStaging('staging-1');
      store.writeStaging('staging-1', 'file1.json', new Uint8Array([1]));
      store.syncStaging('staging-1');

      const manifest = {
        generation: 1,
        snapshotId: 's',
        baselineId: 'b',
        compilationId: 'c',
        artifactHash: 'h',
        entries: [
          {
            name: 'file1.json',
            byteLength: 1,
            hash: hashBytes(new Uint8Array([1])),
          },
        ],
      };

      store.publish('staging-1', 1, manifest);

      const check = store.verifyNoPartialGeneration();
      expect(check.ok).toBe(true);
    });
  });

  describe('OutputLease', () => {
    it('writes and verifies artifacts', () => {
      const store = new InMemoryArtifactStore();
      const lease = new OutputLease('comp-1', 'base-1', store);

      expect(lease.getState()).toBe('open');

      const bytes = new Uint8Array([1, 2, 3]);
      lease.write('data.json', bytes);

      expect(() => lease.verifyStaged()).not.toThrow();
    });

    it('publishes with manifest', () => {
      const store = new InMemoryArtifactStore();
      const lease = new OutputLease('comp-1', 'base-1', store);

      const bytes = new Uint8Array([4, 5, 6]);
      lease.write('artifact.bin', bytes);
      lease.verifyStaged();

      const manifest = lease.publish(1, 'snap-1', 'hash-xyz');

      expect(manifest.generation).toBe(1);
      expect(manifest.snapshotId).toBe('snap-1');
      expect(manifest.entries.length).toBe(1);
      expect(lease.getState()).toBe('published');
    });

    it('refuses empty publish', () => {
      const store = new InMemoryArtifactStore();
      const lease = new OutputLease('comp-1', 'base-1', store);

      expect(() => lease.publish(1, 'snap', 'hash')).toThrow('empty staging area');
    });

    it('refuses operations after revoke', () => {
      const store = new InMemoryArtifactStore();
      const lease = new OutputLease('comp-1', 'base-1', store);

      lease.write('data.json', new Uint8Array([1]));
      lease.revoke('incident-1');

      expect(lease.getState()).toBe('revoked');
      expect(() => lease.write('more.json', new Uint8Array([2]))).toThrow('revoked');
      expect(() => lease.publish(1, 'snap', 'hash')).toThrow('revoked');
    });

    it('sorts entries deterministically', () => {
      const store = new InMemoryArtifactStore();
      const lease = new OutputLease('comp-1', 'base-1', store);

      lease.write('z.txt', new Uint8Array([1]));
      lease.write('a.txt', new Uint8Array([2]));
      lease.write('m.txt', new Uint8Array([3]));
      lease.verifyStaged();

      const manifest = lease.publish(1, 'snap', 'hash');

      const names = manifest.entries.map((e) => e.name);
      expect(names).toEqual(['a.txt', 'm.txt', 'z.txt']);
    });
  });
});
