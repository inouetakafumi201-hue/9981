/**
 * L12 Persistence: snapshot / journal / replay + checkpoint / restore / rewind
 * (design.md 3.13节 / 需求37.1-37.8, Property 18, 28).
 *
 * These are NOT Ops (write channel case d: persistence services).
 * They operate directly on WorldState outside the Op pipeline.
 */
import type { WorldState } from '../state/world-state.js';
import type { JournalEntry } from '../ops/transaction.js';
import type { Id } from '../state/ids.js';
import type { Value } from '../state/value.js';

// ---------------------------------------------------------------------------
// Snapshot (Property 18: snapshot immutability)
// ---------------------------------------------------------------------------

export interface Snapshot {
  readonly id: string;
  readonly state: WorldState;
  readonly createdAt: number;
  readonly label?: string;
}

let snapshotCounter = 0;

/**
 * Take an immutable snapshot of the current WorldState.
 * Uses structural sharing — the state object itself is the snapshot since WorldState is already
 * treated as immutable (all writes produce new objects via setDraft).
 * Property 18: snapshot must be immutable — never mutated after creation.
 */
export function takeSnapshot(state: WorldState, label?: string): Snapshot {
  return {
    id: `snap:${++snapshotCounter}`,
    state,        // structural sharing: same reference, immutable by convention
    createdAt: Date.now(),
    label,
  };
}

// ---------------------------------------------------------------------------
// Journal (append-only log of Ops)
// ---------------------------------------------------------------------------

export interface JournalRecord {
  readonly seq: number;
  readonly op: string;
  readonly args: unknown;
  readonly timestamp: number;
}

export class Journal {
  private records: JournalRecord[] = [];
  private seq = 0;

  append(entries: readonly JournalEntry[]): void {
    for (const entry of entries) {
      this.records.push({
        seq: ++this.seq,
        op: entry.op,
        args: entry.args,
        timestamp: Date.now(),
      });
    }
  }

  getAll(): readonly JournalRecord[] {
    return this.records;
  }

  since(seq: number): readonly JournalRecord[] {
    return this.records.filter((r) => r.seq > seq);
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
  }

  /** logRetention: keep only last N records */
  trim(maxRecords: number): void {
    if (this.records.length > maxRecords) {
      this.records = this.records.slice(this.records.length - maxRecords);
    }
  }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayDeps {
  invoke: (op: string, args: unknown) => { ok: boolean };
}

/**
 * Replay a sequence of journal records from a given seed state.
 * Returns the number of ops successfully replayed.
 */
export function replay(records: readonly JournalRecord[], deps: ReplayDeps): number {
  let count = 0;
  for (const record of records) {
    const result = deps.invoke(record.op, record.args);
    if (result.ok) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Checkpoint / Restore / Rewind (NOT Ops — write channel case d)
// ---------------------------------------------------------------------------

export interface CheckpointStore {
  /** Save a named checkpoint of the current state */
  checkpoint(name: string, state: WorldState): void;
  /** Restore state from a named checkpoint. Returns null if not found. */
  restore(name: string): WorldState | null;
  /** List all checkpoint names in creation order */
  list(): string[];
  /** Remove a named checkpoint */
  remove(name: string): void;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, WorldState>();
  private readonly order: string[] = [];

  checkpoint(name: string, state: WorldState): void {
    if (!this.checkpoints.has(name)) {
      this.order.push(name);
    }
    this.checkpoints.set(name, state);
  }

  restore(name: string): WorldState | null {
    return this.checkpoints.get(name) ?? null;
  }

  list(): string[] {
    return [...this.order];
  }

  remove(name: string): void {
    this.checkpoints.delete(name);
    const idx = this.order.indexOf(name);
    if (idx !== -1) this.order.splice(idx, 1);
  }
}

/**
 * rewind: restore state to the most recent checkpoint before `targetSeq`.
 * Used by PolicyDef mode:'search' to backtrack from an explored branch.
 */
export function rewind(store: CheckpointStore, targetName: string): WorldState | null {
  return store.restore(targetName);
}

// ---------------------------------------------------------------------------
// MigrationDef (Property 28: migration atomicity)
// ---------------------------------------------------------------------------

export interface MigrationDef {
  readonly id: Id;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly description?: string;
  /** Migration transform: produce new WorldState from old. Must be atomic. */
  readonly transform: (state: WorldState) => WorldState;
}

export interface MigrationResult {
  ok: boolean;
  state?: WorldState;
  error?: string;
}

/**
 * Apply a migration atomically.
 * Property 28: if transform throws, the original state is returned unchanged.
 */
export function applyMigration(state: WorldState, migration: MigrationDef): MigrationResult {
  try {
    const newState = migration.transform(state);
    return { ok: true, state: newState };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Compare version strings (semver-lite: major.minor.patch).
 * Returns <0, 0, >0 for a<b, a==b, a>b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// LogRetention + Query(from:'log') data source
// ---------------------------------------------------------------------------

export interface LogEntry {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, Value>;
  readonly timestamp: number;
}

export class LogStore {
  private entries: LogEntry[] = [];
  private seq = 0;
  private readonly maxCapacity: number;

  constructor(maxCapacity = 1000) {
    this.maxCapacity = maxCapacity;
  }

  append(type: string, payload: Record<string, Value>): void {
    if (this.entries.length >= this.maxCapacity) {
      this.entries.shift(); // ring-buffer behavior: drop oldest
    }
    this.entries.push({ seq: ++this.seq, type, payload, timestamp: Date.now() });
  }

  query(filter?: (e: LogEntry) => boolean): readonly LogEntry[] {
    return filter ? this.entries.filter(filter) : [...this.entries];
  }

  getAll(): readonly LogEntry[] {
    return this.entries;
  }
}
