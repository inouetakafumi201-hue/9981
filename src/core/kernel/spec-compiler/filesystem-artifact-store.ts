import { createHash } from 'node:crypto';
import {
  mkdirSync, openSync, closeSync, fsyncSync, writeFileSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, lstatSync, existsSync,
} from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import type { ArtifactManifest, ArtifactStore } from './output-lease.js';
import { hashBytes } from './output-lease.js';
import { compareCodePoints } from './json-codec.js';

/**
 * Durable {@link ArtifactStore} backed by the real filesystem.
 *
 * The in-memory store proves the protocol; this one proves the protocol survives a real OS. The
 * invariants it must uphold are the ones a crash can violate:
 *
 * - A staging area is a sibling directory under `staging/`, never inside `generations/`, so a partially
 *   written candidate can never be mistaken for a committed generation.
 * - Publication is a single same-volume `rename` of a fully fsynced directory. `rename` is the only
 *   filesystem primitive that is atomic for this purpose; copy-then-delete and write-in-place are not.
 * - Committed generations are immutable and never overwritten. A republish of an existing generation is
 *   refused rather than clobbering history.
 * - `recoverLatest` refuses to guess. A gap, a duplicate head, a directory whose name disagrees with its
 *   contents, or a payload whose hash disagrees with its manifest is reported as corruption instead of
 *   silently falling back to an older generation.
 */
export class FileSystemArtifactStore implements ArtifactStore {
  private readonly root: string;
  private readonly stagingRoot: string;
  private readonly generationsRoot: string;
  private readonly quarantineRoot: string;
  private manifest: ArtifactManifest | null = null;

  constructor(root: string) {
    this.root = resolve(root);
    this.stagingRoot = join(this.root, 'staging');
    this.generationsRoot = join(this.root, 'generations');
    this.quarantineRoot = join(this.root, 'quarantine');
    mkdirSync(this.stagingRoot, { recursive: true });
    mkdirSync(this.generationsRoot, { recursive: true });
    mkdirSync(this.quarantineRoot, { recursive: true });
    this.manifest = this.loadCommittedManifest();
  }

  createStaging(stagingId: string): void {
    const path = this.stagingPath(stagingId);
    // `recursive: false` makes staging-id collision an error instead of silent reuse of foreign bytes.
    mkdirSync(path, { recursive: false });
  }

  writeStaging(stagingId: string, name: string, bytes: Uint8Array): void {
    const path = join(this.stagingPath(stagingId), assertArtifactName(name));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { flag: 'wx' });
  }

  readStaging(stagingId: string, name: string): Uint8Array | null {
    const path = join(this.stagingPath(stagingId), assertArtifactName(name));
    if (!existsSync(path)) return null;
    return new Uint8Array(readFileSync(path));
  }

  syncStaging(stagingId: string): void {
    const path = this.stagingPath(stagingId);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error(`Staging entry ${entry.name} is not a regular file`);
      fsyncPath(join(path, entry.name));
    }
    // The directory entry itself must be durable, otherwise a crash can lose the just-written names.
    fsyncPath(path);
  }

  publish(stagingId: string, generation: number, manifest: ArtifactManifest): void {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error(`Generation ${generation} is not a positive safe integer`);
    }
    const stage = this.stagingPath(stagingId);
    writeFileSync(join(stage, MANIFEST_NAME), Buffer.from(JSON.stringify(manifest), 'utf8'), { flag: 'wx' });
    fsyncPath(join(stage, MANIFEST_NAME));
    fsyncPath(stage);

    const target = join(this.generationsRoot, generationDirName(generation));
    if (existsSync(target)) throw new Error(`Generation ${generation} is already committed`);
    assertInside(this.generationsRoot, target);
    renameSync(stage, target);
    // Persist the rename itself before reporting success.
    fsyncPath(this.generationsRoot);
    this.manifest = manifest;
  }

  discardStaging(stagingId: string): void {
    rmSync(this.stagingPath(stagingId), { recursive: true, force: true });
  }

  quarantine(stagingId: string, incidentId: string): void {
    const stage = this.stagingPath(stagingId);
    if (!existsSync(stage)) return;
    const target = join(this.quarantineRoot, `${sanitizeSegment(incidentId)}-${sanitizeSegment(stagingId)}`);
    assertInside(this.quarantineRoot, target);
    renameSync(stage, target);
    fsyncPath(this.quarantineRoot);
  }

  readCommittedManifest(): ArtifactManifest | null {
    return this.manifest;
  }

  readCommitted(generation: number, name: string): Uint8Array | null {
    const path = join(this.generationsRoot, generationDirName(generation), assertArtifactName(name));
    if (!existsSync(path)) return null;
    return new Uint8Array(readFileSync(path));
  }

  /** Remove abandoned staging areas left behind by a crashed session. Committed data is never touched. */
  cleanupStaging(): readonly string[] {
    const removed: string[] = [];
    for (const entry of readdirSync(this.stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) throw new Error(`Unexpected non-directory entry ${entry.name} under staging`);
      rmSync(join(this.stagingRoot, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    }
    fsyncPath(this.stagingRoot);
    return removed;
  }

  /**
   * Verify the whole committed chain and return the head. Throws {@link ArtifactChainError} when the
   * chain cannot be trusted; the caller must halt rather than continue from a guessed state.
   */
  recoverLatest(): { readonly generation: number; readonly manifest: ArtifactManifest } | null {
    const head = this.verifyChain();
    if (!head) return null;
    this.manifest = head.manifest;
    return head;
  }

  /**
   * Verify per-generation integrity *and* chain continuity, returning the head.
   *
   * Continuity is checked here rather than only in `recoverLatest` on purpose: if the constructor
   * accepted a gapped chain, a host that never calls `recoverLatest` would keep publishing on top of
   * a chain that has already lost a commit, which is precisely the silent corruption this store exists
   * to prevent.
   */
  private verifyChain(): { readonly generation: number; readonly manifest: ArtifactManifest } | null {
    const generations = this.listVerifiedGenerations();
    if (generations.length === 0) return null;
    if (generations[0]!.generation !== 1) {
      throw new ArtifactChainError(`Committed chain starts at generation ${generations[0]!.generation}, expected 1`);
    }
    for (let index = 1; index < generations.length; index++) {
      const previous = generations[index - 1]!.generation;
      const current = generations[index]!.generation;
      if (current !== previous + 1) {
        throw new ArtifactChainError(`Committed chain breaks between generation ${previous} and ${current}`);
      }
    }
    return generations[generations.length - 1]!;
  }

  listCommittedGenerations(): number[] {
    return this.listVerifiedGenerations().map((entry) => entry.generation);
  }

  listStagingIds(): string[] {
    return readdirSync(this.stagingRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareCodePoints);
  }

  listQuarantineKeys(): string[] {
    return readdirSync(this.quarantineRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareCodePoints);
  }

  private listVerifiedGenerations(): readonly { generation: number; manifest: ArtifactManifest }[] {
    const found = new Map<number, ArtifactManifest>();
    for (const entry of readdirSync(this.generationsRoot, { withFileTypes: true })) {
      const path = join(this.generationsRoot, entry.name);
      // `lstat` on purpose: a symlink pointing outside the root must never be followed.
      if (!lstatSync(path).isDirectory()) {
        throw new ArtifactChainError(`Generation entry ${entry.name} is not a regular directory`);
      }
      const generation = parseGenerationDirName(entry.name);
      if (generation === null) {
        throw new ArtifactChainError(`Generation directory ${entry.name} does not follow the naming contract`);
      }
      const manifest = this.verifyGeneration(path, generation);
      if (found.has(generation)) {
        throw new ArtifactChainError(`Generation ${generation} has more than one committed head`);
      }
      found.set(generation, manifest);
    }
    return [...found.entries()]
      .sort(([a], [b]) => a - b)
      .map(([generation, manifest]) => ({ generation, manifest }));
  }

  private verifyGeneration(path: string, generation: number): ArtifactManifest {
    const manifestPath = join(path, MANIFEST_NAME);
    if (!existsSync(manifestPath)) {
      throw new ArtifactChainError(`Generation ${generation} has no manifest`);
    }
    let manifest: ArtifactManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtifactManifest;
    } catch (error) {
      throw new ArtifactChainError(`Generation ${generation} manifest is unreadable: ${describe(error)}`);
    }
    if (manifest.generation !== generation) {
      throw new ArtifactChainError(
        `Generation directory ${generation} declares generation ${manifest.generation}`);
    }
    if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
      throw new ArtifactChainError(`Generation ${generation} manifest lists no artifacts`);
    }
    const listed = new Set<string>([MANIFEST_NAME]);
    for (const entry of manifest.entries) {
      const artifactPath = join(path, assertArtifactName(entry.name));
      if (!existsSync(artifactPath)) {
        throw new ArtifactChainError(`Generation ${generation} is missing artifact ${entry.name}`);
      }
      const bytes = new Uint8Array(readFileSync(artifactPath));
      if (bytes.byteLength !== entry.byteLength || hashBytes(bytes) !== entry.hash) {
        throw new ArtifactChainError(`Generation ${generation} artifact ${entry.name} does not match its manifest hash`);
      }
      listed.add(entry.name);
    }
    // An unlisted extra file means something wrote into a committed generation after the fact.
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!listed.has(entry.name)) {
        throw new ArtifactChainError(`Generation ${generation} contains unlisted file ${entry.name}`);
      }
    }
    return manifest;
  }

  private loadCommittedManifest(): ArtifactManifest | null {
    return this.verifyChain()?.manifest ?? null;
  }

  private stagingPath(stagingId: string): string {
    const path = join(this.stagingRoot, sanitizeSegment(stagingId));
    assertInside(this.stagingRoot, path);
    return path;
  }
}

export class ArtifactChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactChainError';
  }
}

const MANIFEST_NAME = 'manifest.json';
const GENERATION_DIGITS = 20;

function generationDirName(generation: number): string {
  return `g-${String(generation).padStart(GENERATION_DIGITS, '0')}`;
}

function parseGenerationDirName(name: string): number | null {
  const match = /^g-(\d{20})$/.exec(name);
  if (!match) return null;
  const generation = Number.parseInt(match[1] as string, 10);
  if (!Number.isSafeInteger(generation) || generation < 1) return null;
  // Reject non-canonical padding so one generation cannot have two valid directory names.
  return generationDirName(generation) === name ? generation : null;
}

/** Artifact names are flat file names chosen by the compiler; path separators would escape the store. */
function assertArtifactName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === '.' || name === '..') {
    throw new Error(`Artifact name ${name} is not a safe flat file name`);
  }
  return name;
}

function sanitizeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Path segment ${value} is not safe`);
  }
  return value;
}

function assertInside(root: string, path: string): void {
  const normalizedRoot = resolve(root);
  const normalized = resolve(path);
  if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Resolved path escapes the controlled artifact root');
  }
}

function fsyncPath(path: string): void {
  // Directories must be opened read-only; some platforms refuse a writable handle on a directory.
  const handle = openSync(path, statSync(path).isDirectory() ? 'r' : 'r+');
  try {
    fsyncSync(handle);
  } catch (error) {
    // Some filesystems (notably certain Windows configurations) refuse fsync on directory handles.
    // Losing the durability barrier is acceptable; silently losing the write is not, so a real I/O
    // failure on a file handle still propagates.
    if (!statSync(path).isDirectory()) throw error;
  } finally {
    closeSync(handle);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Stable content hash helper shared with recovery checks. */
export function hashUtf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
