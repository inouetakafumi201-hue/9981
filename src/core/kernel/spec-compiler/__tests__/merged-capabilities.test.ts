import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactChainError, FileSystemArtifactStore, hashBytes, hashUtf8, InMemoryArtifactStore,
} from '../index.js';
import type { ArtifactManifest } from '../index.js';
import type { SourceRecord } from '../../state/diagnostic.js';
import { DiagnosticSink } from '../../safety/safety.js';
import { compareCodePoints } from '../json-codec.js';
import { sortDiagnostics } from '../diagnostic-factory.js';
import { candidate, createHarness, validDocument } from './fixtures.js';

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'wakeup-artifacts-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function manifestFor(entries: readonly { name: string; bytes: Uint8Array }[], generation: number): ArtifactManifest {
  return {
    generation,
    snapshotId: `snap-${generation}`,
    baselineId: 'baseline',
    compilationId: 'compilation',
    artifactHash: hashBytes(entries[0]?.bytes ?? new Uint8Array()),
    entries: entries.map((entry) => ({
      name: entry.name,
      byteLength: entry.bytes.byteLength,
      hash: hashBytes(entry.bytes),
    })),
  };
}

function publishGeneration(store: FileSystemArtifactStore, generation: number, payload: string): void {
  const stagingId = `stage-${generation}`;
  const bytes = new Uint8Array(Buffer.from(payload, 'utf8'));
  store.createStaging(stagingId);
  store.writeStaging(stagingId, 'model.canonical.json', bytes);
  store.syncStaging(stagingId);
  store.publish(stagingId, generation, manifestFor([{ name: 'model.canonical.json', bytes }], generation));
}

describe('FileSystemArtifactStore: durable atomic publication', () => {
  it('publishes one immutable generation and leaves no staging area behind', () => {
    const root = tempRoot();
    const store = new FileSystemArtifactStore(root);
    publishGeneration(store, 1, '{"a":1}');

    expect(store.listCommittedGenerations()).toEqual([1]);
    expect(store.listStagingIds()).toEqual([]);
    expect(readdirSync(join(root, 'generations'))).toEqual(['g-00000000000000000001']);
    expect(store.readCommitted(1, 'model.canonical.json')).toEqual(new Uint8Array(Buffer.from('{"a":1}', 'utf8')));
    expect(store.readCommittedManifest()?.generation).toBe(1);
  });

  it('refuses to overwrite an already committed generation', () => {
    const store = new FileSystemArtifactStore(tempRoot());
    publishGeneration(store, 1, '{"a":1}');
    expect(() => publishGeneration(store, 1, '{"a":2}')).toThrow(/already committed/);
    // The original bytes survive the refused republish.
    expect(store.readCommitted(1, 'model.canonical.json')).toEqual(new Uint8Array(Buffer.from('{"a":1}', 'utf8')));
  });

  it('never leaves a failed staging write visible as a committed generation', () => {
    const root = tempRoot();
    const store = new FileSystemArtifactStore(root);
    store.createStaging('stage-x');
    store.writeStaging('stage-x', 'model.canonical.json', new Uint8Array([1, 2, 3]));
    // Session dies here without publishing.
    expect(store.listCommittedGenerations()).toEqual([]);
    expect(store.readCommittedManifest()).toBeNull();
    expect(readdirSync(join(root, 'generations'))).toEqual([]);

    // A fresh session cleans the abandoned staging area without touching committed data.
    const restarted = new FileSystemArtifactStore(root);
    expect(restarted.cleanupStaging()).toEqual(['stage-x']);
    expect(restarted.listStagingIds()).toEqual([]);
  });

  it('quarantines a staging area so it can never be read as committed content', () => {
    const store = new FileSystemArtifactStore(tempRoot());
    store.createStaging('stage-q');
    store.writeStaging('stage-q', 'model.canonical.json', new Uint8Array([9]));
    store.quarantine('stage-q', 'incident1');

    expect(store.listStagingIds()).toEqual([]);
    expect(store.listQuarantineKeys()).toEqual(['incident1-stage-q']);
    expect(store.listCommittedGenerations()).toEqual([]);
  });

  it('rejects artifact names and staging ids that would escape the root', () => {
    const store = new FileSystemArtifactStore(tempRoot());
    store.createStaging('stage-ok');
    expect(() => store.writeStaging('stage-ok', '../escape.json', new Uint8Array([1]))).toThrow(/safe flat file name/);
    expect(() => store.writeStaging('stage-ok', 'nested/deep.json', new Uint8Array([1]))).toThrow(/safe flat file name/);
    expect(() => store.createStaging('../escape')).toThrow(/not safe/);
  });
});

describe('FileSystemArtifactStore: recovery refuses to guess', () => {
  it('returns the head of an unbroken chain', () => {
    const store = new FileSystemArtifactStore(tempRoot());
    publishGeneration(store, 1, '{"a":1}');
    publishGeneration(store, 2, '{"a":2}');
    expect(store.recoverLatest()?.generation).toBe(2);
  });

  it('reports corruption instead of falling back when a generation is missing', () => {
    const root = tempRoot();
    const store = new FileSystemArtifactStore(root);
    publishGeneration(store, 1, '{"a":1}');
    publishGeneration(store, 2, '{"a":2}');
    publishGeneration(store, 3, '{"a":3}');
    rmSync(join(root, 'generations', 'g-00000000000000000002'), { recursive: true, force: true });

    expect(() => new FileSystemArtifactStore(root).recoverLatest()).toThrow(ArtifactChainError);
  });

  it('reports corruption when a committed payload no longer matches its manifest hash', () => {
    const root = tempRoot();
    publishGeneration(new FileSystemArtifactStore(root), 1, '{"a":1}');
    writeFileSync(join(root, 'generations', 'g-00000000000000000001', 'model.canonical.json'), '{"a":999}');

    expect(() => new FileSystemArtifactStore(root)).toThrow(ArtifactChainError);
  });

  it('reports corruption when a directory name disagrees with the manifest it contains', () => {
    const root = tempRoot();
    publishGeneration(new FileSystemArtifactStore(root), 1, '{"a":1}');
    const source = join(root, 'generations', 'g-00000000000000000001');
    const target = join(root, 'generations', 'g-00000000000000000007');
    mkdirSync(target);
    for (const entry of readdirSync(source)) {
      writeFileSync(join(target, entry), readFileSync(join(source, entry)));
    }
    rmSync(source, { recursive: true, force: true });

    expect(() => new FileSystemArtifactStore(root)).toThrow(ArtifactChainError);
  });

  it('reports corruption when an extra unlisted file appears inside a committed generation', () => {
    const root = tempRoot();
    publishGeneration(new FileSystemArtifactStore(root), 1, '{"a":1}');
    writeFileSync(join(root, 'generations', 'g-00000000000000000001', 'injected.json'), '{}');

    expect(() => new FileSystemArtifactStore(root)).toThrow(ArtifactChainError);
  });

  it('reports corruption for a non-canonical generation directory name', () => {
    const root = tempRoot();
    new FileSystemArtifactStore(root);
    mkdirSync(join(root, 'generations', 'g-1'));
    expect(() => new FileSystemArtifactStore(root)).toThrow(ArtifactChainError);
  });

  it('returns null for an empty but healthy store', () => {
    expect(new FileSystemArtifactStore(tempRoot()).recoverLatest()).toBeNull();
  });
});

describe('SAFE_DRAFT mode is structurally unable to publish', () => {
  it('validates fully, returns the previewable model, and advances no generation', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileDraft(candidate(validDocument()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('SAFE_DRAFT');
    expect(result.snapshotId).toBeNull();
    expect(result.draftModel?.definitions['item.shotgun']).toBeDefined();
    // Nothing was activated and nothing was written.
    expect(harness.registry.getSnapshot().generation).toBe(0);
    expect(harness.artifactStore.readCommittedManifest()).toBeNull();
    expect(harness.artifactStore.listStagingIds()).toEqual([]);
    expect(harness.emergencySink.getAll()).toEqual([]);
  });

  it('produces the same artifact hash the production run would publish', async () => {
    const draft = await createHarness().compiler.compileDraft(candidate(validDocument()));
    const release = await createHarness().compiler.compileAndActivate(candidate(validDocument()));

    expect(draft.ok && release.ok).toBe(true);
    if (!draft.ok || !release.ok) return;
    expect(draft.artifactHash).toBe(release.artifactHash);
  });

  it('rejects an invalid draft as a candidate error and still writes nothing', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileDraft(candidate('{ "schemaVersion": "1.0.0", }'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe('SAFE_DRAFT');
    expect(result.halted).toBe('candidate');
    expect(result.unchangedState).toBe(true);
    expect(harness.artifactStore.listStagingIds()).toEqual([]);
    expect(harness.artifactStore.readCommittedManifest()).toBeNull();
  });

  it('cannot be pushed into publishing by an artifact store fault', async () => {
    const harness = createHarness();
    // Any store interaction at all would trip this injected failure.
    harness.artifactStore.injectFailure('createStaging');
    const result = await harness.compiler.compileDraft(candidate(validDocument()));

    expect(result.ok).toBe(true);
    expect(harness.artifactStore.listCommittedGenerations()).toEqual([]);
  });
});

describe('statement authority cannot be raised, and dropped statements are reported', () => {
  function statementDoc(statements: readonly Record<string, unknown>[]): string {
    return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], statements });
  }

  it('blocks a historical document from promoting a statement to normative', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      statementDoc([{ key: 'gateway.kinds', value: 'three', status: 'normative' }]),
      { normativeStatus: 'historical' },
    ));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_SOURCE_STATUS_PROMOTION');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('tells the creator when a historical statement has no binding effect', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      statementDoc([{ key: 'weapon.damage', value: 3, status: 'historical' }]),
    ));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const notice = result.diagnostics.filter((item) => item.code === 'E_LOAD_SOURCE_DISPLACED');
    expect(notice.length).toBe(1);
    expect(notice[0]?.severity).toBe('info');
    expect(notice[0]?.haltClass).toBeUndefined();
    expect(notice[0]?.actionableHint).toContain('不会生效');
    // The statement is still excluded from the normative model.
    expect(harness.registry.getSnapshot().model?.normativeStatements['weapon.damage']).toBeUndefined();
  });

  it('allows a normative document to lower a single statement to unresolved', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      statementDoc([{ key: 'gateway.kinds', value: 'three', status: 'unresolved' }]),
    ));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.diagnostics.map((item) => item.code);
    // Lowering is permitted, so this is not a promotion block. It is also not an equal-precedence
    // conflict: one undecided statement disagrees with nobody, it simply has not been decided.
    expect(codes).not.toContain('E_LOAD_SOURCE_STATUS_PROMOTION');
    expect(codes).not.toContain('E_LOAD_EQUAL_PRECEDENCE_CONFLICT');
    expect(codes).toContain('E_LOAD_UNRESOLVED_NORMATIVE');
    const model = harness.registry.getSnapshot().model;
    // Withheld from the contracts, preserved as an open item so a later decision has something to resolve.
    expect(model?.normativeStatements['gateway.kinds']).toBeUndefined();
    expect(model?.unresolvedItems.map((item) => item.key)).toEqual(['gateway.kinds']);
  });

  it('requires a resolving decision before an undecided statement can become normative', async () => {
    const harness = createHarness();
    expect((await harness.compiler.compileAndActivate(candidate(
      statementDoc([{ key: 'gateway.kinds', value: 'three', status: 'unresolved' }]),
    ))).ok).toBe(true);

    const withoutDecision = await harness.compiler.compileAndActivate(candidate(
      statementDoc([{ key: 'gateway.kinds', value: 'three' }]),
    ));
    expect(withoutDecision.ok).toBe(false);
    if (withoutDecision.ok) return;
    expect(withoutDecision.diagnostics.map((item) => item.code))
      .toContain('E_LOAD_NORMATIVE_WITHOUT_PROVENANCE');

    const withDecision = await harness.compiler.compileAndActivate(candidate(
      statementDoc([{ key: 'gateway.kinds', value: 'three', decisionId: 'D-006' }]),
    ));
    expect(withDecision.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.normativeStatements['gateway.kinds']).toBeDefined();
    expect(harness.registry.getSnapshot().model?.unresolvedItems).toEqual([]);
  });
});

describe('decision identifier reuse is surfaced, never merged', () => {
  it('warns when one decision id carries two different statements', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0',
      targetLayer: '基类层',
      definitions: [],
      statements: [
        { key: 'gateway.kinds', value: 'three', decisionId: 'Q-04' },
        { key: 'vehicle.scene', value: 'external', decisionId: 'Q-04' },
      ],
    })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reused = result.diagnostics.filter((item) => item.code === 'E_LOAD_DECISION_ID_REUSED');
    expect(reused.length).toBe(2);
    expect(reused[0]?.severity).toBe('warn');
    // Both statements are preserved rather than collapsed into one.
    const model = harness.registry.getSnapshot().model;
    expect(model?.normativeStatements['gateway.kinds']).toBeDefined();
    expect(model?.normativeStatements['vehicle.scene']).toBeDefined();
  });

  it('stays silent when one decision id consistently describes one statement', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0',
      targetLayer: '基类层',
      definitions: [],
      statements: [
        { key: 'gateway.kinds', value: 'three', decisionId: 'Q-04', precedence: 100 },
        { key: 'gateway.kinds', value: 'three', decisionId: 'Q-04', precedence: 50 },
      ],
    })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.filter((item) => item.code === 'E_LOAD_DECISION_ID_REUSED')).toEqual([]);
  });
});

describe('ordering is locale-independent', () => {
  it('orders by code point, not by collation rules', () => {
    // Under most ICU collations 'a' sorts before 'B'; by code point 'B' (0x42) precedes 'a' (0x61).
    expect(compareCodePoints('B', 'a')).toBeLessThan(0);
    expect(['a', 'B', 'A'].slice().sort(compareCodePoints)).toEqual(['A', 'B', 'a']);
    // Astral-plane characters must compare by code point, not by UTF-16 surrogate order.
    expect(compareCodePoints('\u{1F600}', '\uFFFD')).toBeGreaterThan(0);
  });

  it('keeps diagnostic reporting order independent of collation', () => {
    const base = { severity: 'error', message: 'm', phase: 0 } as const;
    const sorted = sortDiagnostics([
      { ...base, code: 'E_LOAD_JSON_SYNTAX', sourcePackage: 'a' },
      { ...base, code: 'E_LOAD_JSON_SYNTAX', sourcePackage: 'B' },
      { ...base, code: 'E_LOAD_JSON_SYNTAX', sourcePackage: 'A' },
    ]);
    expect(sorted.map((item) => item.sourcePackage)).toEqual(['A', 'B', 'a']);
  });

  it('produces identical artifact bytes regardless of definition declaration order', async () => {
    const forward = JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层',
      definitions: [
        { id: 'rule.Alpha', kind: 'rule', iconRef: 'i' },
        { id: 'rule.beta', kind: 'rule', iconRef: 'i' },
      ],
    });
    const reversed = JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层',
      definitions: [
        { id: 'rule.beta', kind: 'rule', iconRef: 'i' },
        { id: 'rule.Alpha', kind: 'rule', iconRef: 'i' },
      ],
    });
    const first = await createHarness().compiler.compileAndActivate(candidate(forward));
    const second = await createHarness().compiler.compileAndActivate(candidate(reversed));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifactHash).toBe(first.artifactHash);
  });
});

describe('re-export surface stays intact after the merge', () => {
  it('exposes both the durable and the in-memory store from one entry point', () => {
    expect(typeof FileSystemArtifactStore).toBe('function');
    expect(typeof InMemoryArtifactStore).toBe('function');
    // The duplicate class-layer implementation must be gone, leaving exactly one compiler.
    expect(existsSync(join(process.cwd(), 'src', 'class', 'specification-compiler'))).toBe(false);
  });
});

describe('reverse audit findings stay fixed', () => {
  it('refuses to construct a store over a chain with a missing generation', () => {
    const root = tempRoot();
    const store = new FileSystemArtifactStore(root);
    publishGeneration(store, 1, '{"a":1}');
    publishGeneration(store, 2, '{"a":2}');
    publishGeneration(store, 3, '{"a":3}');
    rmSync(join(root, 'generations', 'g-00000000000000000002'), { recursive: true, force: true });

    // Continuity must be enforced at construction, not only when recoverLatest() happens to be called:
    // otherwise a host that never calls it keeps publishing on top of a chain that already lost a commit.
    expect(() => new FileSystemArtifactStore(root)).toThrow(ArtifactChainError);
  });

  it('refuses to construct a store whose chain does not start at generation 1', () => {
    const root = tempRoot();
    const store = new FileSystemArtifactStore(root);
    publishGeneration(store, 1, '{"a":1}');
    publishGeneration(store, 2, '{"a":2}');
    rmSync(join(root, 'generations', 'g-00000000000000000001'), { recursive: true, force: true });

    expect(() => new FileSystemArtifactStore(root)).toThrow(ArtifactChainError);
  });

  it('reports an unserializable migration result as a migration error, not a system incident', async () => {
    const harness = createHarness({ versions: ['1.0.0', '2.0.0'] });
    harness.migrationRegistry.register({
      id: 'mig.break',
      // '0.9.0' is deliberately not a registered schema, so the candidate must go through migration.
      fromVersion: '0.9.0',
      toVersion: '2.0.0',
      source: candidateSource(),
      // A transform is host-supplied code; producing a non-finite number must stay the creator's problem.
      transform: () => ({ schemaVersion: '2.0.0', targetLayer: '基类层', definitions: [], broken: 1 / 0 }),
    });

    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '0.9.0', targetLayer: '基类层', definitions: [],
    })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.halted).toBe('candidate');
    expect(result.diagnostics.map((item) => item.code)).toContain('E_MIG_FAILED');
    // No emergency envelope may be written for a candidate-class failure.
    expect(harness.emergencySink.getAll()).toEqual([]);
  });

  it('tells the creator that positions were rebased onto the migrated document', async () => {
    const harness = createHarness({ versions: ['1.0.0', '2.0.0'] });
    harness.migrationRegistry.register({
      id: 'mig.ok',
      fromVersion: '0.9.0',
      toVersion: '2.0.0',
      source: candidateSource(),
      transform: (value) => ({ ...(value as Record<string, unknown>), schemaVersion: '2.0.0' } as never),
    });

    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '0.9.0', targetLayer: '基类层', definitions: [],
    })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rebased = result.diagnostics.filter((item) => item.code === 'E_LOAD_MIGRATED_SOURCE_REBASED');
    expect(rebased.length).toBe(1);
    expect(rebased[0]?.severity).toBe('info');
    expect(rebased[0]?.haltClass).toBeUndefined();
    expect(rebased[0]?.actionableHint).toContain('升级');
  });

  it('keeps a non-finite precedence out of reach of untrusted input', async () => {
    const harness = createHarness();
    // JSON has no Infinity literal, and 1e400 must be rejected at parse rather than becoming Infinity
    // and silently outranking every legitimate source.
    const result = await harness.compiler.compileAndActivate(candidate(
      '{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],' +
      '"statements":[{"key":"k","value":1,"precedence":1e400}]}',
    ));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.halted).toBe('candidate');
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_FIELD_TYPE');
  });

  it('never drops an error or fatal diagnostic under the evict overflow policy', () => {
    const sink = new DiagnosticSink({ maxCapacity: 2, dedup: false, overflowPolicy: 'evict' });
    sink.emit({ code: 'E_REF_MISSING', severity: 'info', message: 'i', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'warn', message: 'w', phase: 0 });
    for (let index = 0; index < 6; index++) {
      sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: `e${index}`, phase: 0 });
    }
    expect(sink.getBySeverity('error')).toHaveLength(6);
    expect(sink.getAll().every((item) => item.severity === 'error')).toBe(true);
  });
});

/** Provenance for a host-registered migration edge. Not creator input, so a zero-width span is correct. */
function candidateSource(): SourceRecord {
  return {
    sourceId: 'src:migration',
    documentUri: 'file:///migration.json',
    sourcePackage: 'pkg.migration',
    contentHash: hashUtf8('migration'),
    precedence: 500,
    owningLayer: '引擎层',
    normativeStatus: 'normative',
    span: {
      file: 'file:///migration.json',
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
      sourceSliceHash: hashUtf8(''),
    },
  };
}
