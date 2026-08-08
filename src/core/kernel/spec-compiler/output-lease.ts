import { createHash, randomUUID } from 'node:crypto';

/**
 * Host storage abstraction for staged, atomically published artifacts.
 *
 * The kernel does not depend on `node:fs` directly: the runtime host owns real storage, and tests
 * need a fully deterministic in-memory implementation that can inject failures at every step.
 * Every method must be all-or-nothing from the caller's perspective.
 */
export interface ArtifactStore {
  /** Create an empty, private staging area. Must not be visible to committed readers. */
  createStaging(stagingId: string): void;
  /** Write bytes into the staging area only. */
  writeStaging(stagingId: string, name: string, bytes: Uint8Array): void;
  /** Read back staged bytes for verification. Returns null when absent. */
  readStaging(stagingId: string, name: string): Uint8Array | null;
  /** Flush staged bytes to durable storage. */
  syncStaging(stagingId: string): void;
  /**
   * Atomically publish the staging area as `generation`, then make it the committed manifest.
   * Implementations must either fully publish or leave the previous committed manifest intact.
   */
  publish(stagingId: string, generation: number, manifest: ArtifactManifest): void;
  /** Remove a staging area. Throwing here signals that isolation could not be guaranteed. */
  discardStaging(stagingId: string): void;
  /** Move an unclean staging area into quarantine so it can never be read as cache. */
  quarantine(stagingId: string, incidentId: string): void;
  /** Currently committed manifest, or null when nothing has been published. */
  readCommittedManifest(): ArtifactManifest | null;
  /** Read published bytes for a committed generation. */
  readCommitted(generation: number, name: string): Uint8Array | null;
}

export interface ArtifactManifest {
  readonly generation: number;
  readonly snapshotId: string;
  readonly baselineId: string;
  readonly compilationId: string;
  readonly artifactHash: string;
  readonly entries: readonly ArtifactManifestEntry[];
}

export interface ArtifactManifestEntry {
  readonly name: string;
  readonly byteLength: number;
  readonly hash: string;
}

export type OutputLeaseState = 'open' | 'revoked' | 'published';

export class OutputLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputLeaseError';
  }
}

/**
 * A single-use write capability. Any candidate rejection or infrastructure halt revokes it, and a
 * revoked lease can never write, verify, or publish again.
 */
export class OutputLease {
  readonly leaseToken: string;
  readonly stagingId: string;
  private state: OutputLeaseState = 'open';
  private readonly staged = new Map<string, ArtifactManifestEntry>();

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

  write(name: string, bytes: Uint8Array): void {
    this.assertOpen();
    this.store.writeStaging(this.stagingId, name, bytes);
    this.staged.set(name, { name, byteLength: bytes.byteLength, hash: hashBytes(bytes) });
  }

  /** Verify staged bytes against what the compiler intended to write. */
  verifyStaged(): void {
    this.assertOpen();
    for (const entry of this.staged.values()) {
      const actual = this.store.readStaging(this.stagingId, entry.name);
      if (!actual) throw new OutputLeaseError(`Staged artifact ${entry.name} is missing`);
      if (actual.byteLength !== entry.byteLength || hashBytes(actual) !== entry.hash) {
        throw new OutputLeaseError(`Staged artifact ${entry.name} does not match the intended bytes`);
      }
    }
    this.store.syncStaging(this.stagingId);
  }

  publish(generation: number, snapshotId: string, artifactHash: string): ArtifactManifest {
    this.assertOpen();
    if (this.staged.size === 0) throw new OutputLeaseError('Refusing to publish an empty staging area');
    const manifest: ArtifactManifest = Object.freeze({
      generation,
      snapshotId,
      baselineId: this.baselineId,
      compilationId: this.compilationId,
      artifactHash,
      entries: Object.freeze([...this.staged.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))),
    });
    this.store.publish(this.stagingId, generation, manifest);
    this.state = 'published';
    return manifest;
  }

  /**
   * Revoke the lease and remove the staging area. When cleanup cannot be confirmed, the staging area
   * is quarantined and the failure is reported so the caller can halt instead of reusing the cache.
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

interface StoredArtifact {
  readonly bytes: Uint8Array;
}

export type ArtifactFailurePoint =
  | 'createStaging'
  | 'writeStaging'
  | 'syncStaging'
  | 'publish'
  | 'discardStaging'
  | 'quarantine';

/**
 * Deterministic in-memory store. `failAt` injects a failure at a specific step so tests can prove
 * that no partial artifact ever becomes visible.
 */
export class InMemoryArtifactStore implements ArtifactStore {
  private readonly stagingAreas = new Map<string, Map<string, StoredArtifact>>();
  private readonly committed = new Map<number, Map<string, StoredArtifact>>();
  private readonly quarantined = new Map<string, Map<string, StoredArtifact>>();
  private manifest: ArtifactManifest | null = null;
  private failAt: ArtifactFailurePoint | null = null;
  /** Simulates a store that reports publish failure after the bytes already landed. */
  publishLeaksPartialState = false;

  injectFailure(point: ArtifactFailurePoint | null): void {
    this.failAt = point;
  }

  private maybeFail(point: ArtifactFailurePoint): void {
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

  /** Test/diagnostic helpers. Quarantined data must never participate in cache lookups. */
  listStagingIds(): string[] {
    return [...this.stagingAreas.keys()].sort();
  }

  listQuarantineKeys(): string[] {
    return [...this.quarantined.keys()].sort();
  }

  listCommittedGenerations(): number[] {
    return [...this.committed.keys()].sort((a, b) => a - b);
  }

  /** Verify that every committed generation is fully described by a manifest entry set. */
  verifyNoPartialGeneration(): { ok: boolean; reason?: string } {
    const manifest = this.manifest;
    for (const generation of this.committed.keys()) {
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

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
