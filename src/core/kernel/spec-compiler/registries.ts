import { createHash } from 'node:crypto';
import type { SourceRecord } from '../state/diagnostic.js';
import type {
  CandidateMigration,
  CanonicalSnapshot,
  CompiledModel,
  IntegrationContract,
  PackageRecord,
  ResolvedDefinition,
  SchemaVersion,
  ValidationBaseline,
} from './types.js';
import { canonicalStringify, compareCodePoints } from './json-codec.js';
import { assertSchemaNumericContract } from './numeric-classification.js';
import { modelToJson } from './model-json.js';

export class SchemaRegistry {
  private readonly versions = new Map<string, SchemaVersion>();
  private revision = 0;

  /**
   * Register one schema version.
   *
   * The numeric contract is checked here rather than at validation time: an unclassified or unsourced
   * numeric field is a host defect, and letting it through would mean a creator could write a number
   * nobody can classify and no rule can bound.
   */
  register(schema: SchemaVersion): void {
    if (this.versions.has(schema.version)) {
      throw new Error(`Schema version ${schema.version} is already registered`);
    }
    for (const definitionSchema of schema.definitionSchemas.values()) {
      assertSchemaNumericContract(definitionSchema);
    }
    this.versions.set(schema.version, schema);
    this.revision++;
  }

  get(version: string): SchemaVersion | null {
    return this.versions.get(version) ?? null;
  }

  listVersions(): string[] {
    return [...this.versions.keys()].sort(compareVersions);
  }

  get id(): string {
    return hashText(`schema:${this.revision}:${this.listVersions().join(',')}`);
  }

  get integrationId(): string {
    const values: string[] = [];
    for (const version of this.listVersions()) {
      const schema = this.versions.get(version);
      if (!schema) continue;
      for (const contract of [...schema.integrationContracts.values()].sort((a, b) => compareCodePoints(a.id, b.id))) {
        values.push(`${version}:${contract.id}:${contract.version}:${contract.provider}`);
      }
    }
    return hashText(values.join('|'));
  }
}

export interface MigrationPathResult {
  readonly status: 'identity' | 'ok' | 'missing' | 'ambiguous' | 'cycle';
  readonly path: readonly CandidateMigration[];
  readonly competingPaths?: readonly (readonly CandidateMigration[])[];
}

export class CandidateMigrationRegistry {
  private readonly migrations: CandidateMigration[] = [];

  register(migration: CandidateMigration): void {
    if (migration.fromVersion === migration.toVersion) {
      throw new Error('Migration edge must change version');
    }
    if (this.migrations.some((item) => item.id === migration.id)) {
      throw new Error(`Migration ${migration.id} is already registered`);
    }
    if (this.migrations.some((item) =>
      item.fromVersion === migration.fromVersion && item.toVersion === migration.toVersion)) {
      throw new Error(`Migration edge ${migration.fromVersion} -> ${migration.toVersion} is duplicated`);
    }
    this.migrations.push(migration);
  }

  resolve(fromVersion: string, toVersion: string, maxSteps: number): MigrationPathResult {
    if (fromVersion === toVersion) return { status: 'identity', path: [] };
    const paths: CandidateMigration[][] = [];
    let cycleDetected = false;
    const visit = (version: string, path: CandidateMigration[], visited: Set<string>): void => {
      if (path.length > maxSteps || paths.length > 1) return;
      if (version === toVersion) {
        paths.push(path);
        return;
      }
      for (const edge of this.migrations
        .filter((item) => item.fromVersion === version)
        .sort((a, b) => compareCodePoints(a.id, b.id))) {
        if (visited.has(edge.toVersion)) {
          cycleDetected = true;
          continue;
        }
        visit(edge.toVersion, [...path, edge], new Set([...visited, edge.toVersion]));
      }
    };
    visit(fromVersion, [], new Set([fromVersion]));
    if (paths.length > 1) return { status: 'ambiguous', path: [], competingPaths: paths };
    if (paths.length === 1) return { status: 'ok', path: paths[0] ?? [] };
    return { status: cycleDetected ? 'cycle' : 'missing', path: [] };
  }
}

export interface RegistrySnapshot {
  readonly id: string;
  readonly generation: number;
  readonly model: CompiledModel | null;
  readonly artifactHash: string | null;
}

export class InMemorySpecificationRegistry {
  private snapshot: RegistrySnapshot = Object.freeze({
    id: hashText('empty-registry'),
    generation: 0,
    model: null,
    artifactHash: null,
  });
  private lockTail: Promise<void> = Promise.resolve();

  getSnapshot(): RegistrySnapshot {
    return this.snapshot;
  }

  createBaseline(schemaRegistry: SchemaRegistry): ValidationBaseline {
    return Object.freeze({
      id: hashText(`${schemaRegistry.id}:${schemaRegistry.integrationId}:${this.snapshot.id}`),
      schemaRegistryId: schemaRegistry.id,
      integrationRegistryId: schemaRegistry.integrationId,
      activeSnapshotId: this.snapshot.id,
    });
  }

  async withCommitLock<T>(operation: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.lockTail;
    this.lockTail = previous.then(() => gate);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  commit(expectedSnapshotId: string, model: CompiledModel, artifactHash: string): RegistrySnapshot | null {
    if (this.snapshot.id !== expectedSnapshotId) return null;
    const generation = this.snapshot.generation + 1;
    const id = hashText(`${generation}:${artifactHash}:${canonicalModelIdentity(model)}`);
    this.snapshot = Object.freeze({ id, generation, model, artifactHash });
    return this.snapshot;
  }

  restore(snapshot: RegistrySnapshot): void {
    this.snapshot = snapshot;
  }

  /**
   * Regression comparison view.
   *
   * A rejected change must leave this value byte-identical to what it was before the attempt, which is a
   * stronger statement than "the snapshot object is the same reference".
   */
  canonicalSnapshot(): CanonicalSnapshot {
    return Object.freeze({
      id: this.snapshot.id,
      generation: this.snapshot.generation,
      artifactHash: this.snapshot.artifactHash,
      canonicalModel: this.snapshot.model ? canonicalStringify(modelToJson(this.snapshot.model)) : '',
    });
  }

  /**
   * Read one activated definition after inheritance and composition have been applied.
   *
   * The result is deeply frozen, so a consumer holding it cannot reach back into the active registry and
   * change a semantic field. Consumers get a view, never a writable alias.
   */
  query(id: string): ResolvedDefinition | null {
    const resolved = this.snapshot.model?.resolvedDefinitions[id];
    return resolved ? (deepFreeze(resolved) as ResolvedDefinition) : null;
  }

  /** Outbound reference targets of one activated definition. */
  dependencies(id: string): readonly string[] {
    return this.snapshot.model?.dependencyGraph[id] ?? [];
  }

  /** Definitions that reference the given definition. Required before any removal can be accepted. */
  dependents(id: string): readonly string[] {
    return this.snapshot.model?.inboundGraph[id] ?? [];
  }

  /** Packages activated so far, used to detect a package dependency cycle in the next change. */
  packages(): Readonly<Record<string, PackageRecord>> {
    return this.snapshot.model?.packages ?? {};
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    return value;
  }
  Object.freeze(value);
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  return value;
}

function canonicalModelIdentity(model: CompiledModel): string {
  return canonicalStringify(modelToJson(model));
}

export function contractHasCapability(contract: IntegrationContract, capability: string): boolean {
  return contract.capabilities.includes(capability);
}

export function sourceIdentity(source: SourceRecord): string {
  return `${source.sourceId}:${source.span.start.offset}:${source.span.end.offset}`;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10));
  const b = right.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const leftPart = a[index];
    const rightPart = b[index];
    const leftValue = leftPart !== undefined && Number.isFinite(leftPart) ? leftPart : 0;
    const rightValue = rightPart !== undefined && Number.isFinite(rightPart) ? rightPart : 0;
    const difference = leftValue - rightValue;
    if (difference !== 0) return difference;
  }
  return compareCodePoints(left, right);
}
