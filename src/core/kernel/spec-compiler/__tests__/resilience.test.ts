import { describe, expect, it } from 'vitest';
import { DiagnosticHaltError, DiagnosticSink } from '../../safety/safety';
import { FatalErrorBoundary, InMemoryEmergencySink } from '../../safety/fatal-boundary';
import type { ArtifactFailurePoint } from '../index';
import { candidate, createHarness, validDocument } from './fixtures';

describe('DiagnosticSink: fail-closed capacity and dedup', () => {
  it('halts instead of dropping diagnostics when capacity is exhausted', () => {
    const sink = new DiagnosticSink({ maxCapacity: 2, dedup: false, overflowPolicy: 'halt' });
    sink.emit({ code: 'E_LOAD_LINT', severity: 'warn', message: 'a', phase: 0 });
    sink.emit({ code: 'E_LOAD_LINT', severity: 'warn', message: 'b', phase: 0 });

    let halted: unknown = null;
    try {
      sink.emit({ code: 'E_LOAD_LINT', severity: 'warn', message: 'c', phase: 0 });
    } catch (error) {
      halted = error;
    }
    expect(halted).toBeInstanceOf(DiagnosticHaltError);
    expect((halted as DiagnosticHaltError).diagnostic.code).toBe('E_QUOTA_DIAGNOSTICS');
    // The two earlier diagnostics must still be present: nothing is evicted.
    expect(sink.getAll().map((item) => item.message)).toEqual(['a', 'b']);
    expect(sink.isHalted()).toBe(true);
  });

  it('keeps same-code diagnostics from different locations distinct', () => {
    const sink = new DiagnosticSink({ maxCapacity: 10 });
    const base = { code: 'E_LOAD_LINT', severity: 'warn', message: 'style', phase: 0 } as const;
    sink.emit({ ...base, path: '/definitions/0/name' });
    sink.emit({ ...base, path: '/definitions/1/name' });
    sink.emit({ ...base, path: '/definitions/1/name' });
    expect(sink.getAll().length).toBe(2);
  });

  it('refuses to continue after a halting diagnostic', () => {
    const sink = new DiagnosticSink();
    expect(() => sink.emit({ code: 'E_INV_DANGLING', severity: 'error', message: 'x', phase: 0 })).toThrow(DiagnosticHaltError);
    expect(() => sink.emit({ code: 'E_LOAD_LINT', severity: 'warn', message: 'y', phase: 0 })).toThrow(DiagnosticHaltError);
  });

  it('halts even when the onFatal callback returns normally', () => {
    let notified = 0;
    const sink = new DiagnosticSink({ onFatal: () => { notified++; } });
    expect(() => sink.emit({ code: 'E_LOAD_DIAGNOSTIC_FAILURE', severity: 'fatal', message: 'x', phase: 0 })).toThrow(DiagnosticHaltError);
    expect(notified).toBe(1);
  });
});

describe('FatalErrorBoundary: preallocated envelopes', () => {
  it('writes a fixed envelope and refuses to resume the session', () => {
    const emergency = new InMemoryEmergencySink();
    const boundary = new FatalErrorBoundary(emergency);
    expect(() => boundary.run('parse', 'DIAGNOSTIC_BUILD_FAILED', () => { throw new Error('boom'); })).toThrow();
    expect(boundary.isHalted()).toBe(true);
    expect(emergency.getAll()).toEqual([{
      kind: 'COMPILATION_FATAL',
      compilationId: boundary.compilationId,
      incidentId: boundary.incidentId,
      stage: 'parse',
      emergencyCode: 'DIAGNOSTIC_BUILD_FAILED',
    }]);
    expect(() => boundary.run('parse', 'DIAGNOSTIC_BUILD_FAILED', () => 1)).toThrow();
  });

  it('reports rollback failure rather than the original stage when cleanup fails', () => {
    const boundary = new FatalErrorBoundary(new InMemoryEmergencySink());
    try {
      boundary.run('publish', 'OUTPUT_ISOLATION_FAILED',
        () => { throw new Error('write failed'); },
        () => { throw new Error('rollback failed'); });
    } catch {
      // Intentionally ignored: the envelope carries the classification.
    }
    expect(boundary.getHaltedEnvelope()?.stage).toBe('rollback');
    expect(boundary.getHaltedEnvelope()?.emergencyCode).toBe('ROLLBACK_FAILED');
  });

  it('still halts when the emergency sink itself throws', () => {
    const boundary = new FatalErrorBoundary({ writeFixed: () => { throw new Error('log down'); } });
    expect(() => boundary.halt('publish', 'OUTPUT_ISOLATION_FAILED')).toThrow();
    expect(boundary.isHalted()).toBe(true);
  });
});

describe('SpecificationCompiler: artifact store fault injection', () => {
  const points: readonly ArtifactFailurePoint[] = ['createStaging', 'writeStaging', 'syncStaging', 'publish'];

  for (const point of points) {
    it(`keeps the previous state intact when ${point} fails`, async () => {
      const harness = createHarness();
      const first = await harness.compiler.compileAndActivate(candidate(validDocument()));
      expect(first.ok).toBe(true);
      const goodSnapshot = harness.registry.getSnapshot();
      const goodManifest = harness.artifactStore.readCommittedManifest();

      harness.artifactStore.injectFailure(point);
      // Distinct ids: reusing an active id is a separate (candidate-level) override violation.
      const second = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
        schemaVersion: '1.0.0',
        targetLayer: '基类层',
        definitions: [{ id: 'item.rifle', kind: 'item', iconRef: 'icon:rifle' }],
      })));

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.halted).toBe('infrastructure');
      expect(second.unchangedState).toBe(true);
      // The previously committed generation must still be the only visible one.
      expect(harness.registry.getSnapshot().id).toBe(goodSnapshot.id);
      expect(harness.registry.getSnapshot().generation).toBe(1);
      expect(harness.artifactStore.readCommittedManifest()?.artifactHash).toBe(goodManifest?.artifactHash);
      expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(true);
      expect(harness.emergencySink.getAll().length).toBeGreaterThan(0);
    });
  }

  it('quarantines the staging area when cleanup cannot be confirmed', async () => {
    const harness = createHarness();
    harness.artifactStore.injectFailure('discardStaging');
    const result = await harness.compiler.compileAndActivate(candidate('{ "schemaVersion": "1.0.0", }'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.halted).toBe('infrastructure');
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_CACHE_ROLLBACK_FAILED');
    expect(harness.artifactStore.listQuarantineKeys().length).toBe(1);
    // Quarantined data must never be visible as committed content.
    expect(harness.artifactStore.readCommittedManifest()).toBeNull();
  });

  it('detects a store that leaks partial state during publish', async () => {
    const harness = createHarness();
    harness.artifactStore.publishLeaksPartialState = true;
    harness.artifactStore.injectFailure('publish');
    const result = await harness.compiler.compileAndActivate(candidate(validDocument()));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(harness.registry.getSnapshot().generation).toBe(0);
    expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(false);
  });
});

describe('DiagnosticSink: bounded runtime log never drops blocking diagnostics', () => {
  it('evicts only low-severity entries and keeps every error past capacity', () => {
    const sink = new DiagnosticSink({ maxCapacity: 2, dedup: false });
    sink.emit({ code: 'E_LOAD_LINT', severity: 'warn', message: 'w1', phase: 0 });
    sink.emit({ code: 'E_LOAD_JSON_SYNTAX', severity: 'error', message: 'e1', phase: 0 });
    sink.emit({ code: 'E_LOAD_JSON_SYNTAX', severity: 'error', message: 'e2', phase: 0 });
    sink.emit({ code: 'E_LOAD_JSON_SYNTAX', severity: 'error', message: 'e3', phase: 0 });

    const kept = sink.getAll().map((item) => item.message);
    expect(kept).toContain('e1');
    expect(kept).toContain('e2');
    expect(kept).toContain('e3');
    expect(kept).not.toContain('w1');
  });
});

describe('SpecificationCompiler: override protection and stale baseline', () => {
  it('rejects redefining an active id without an explicit override', async () => {
    const harness = createHarness();
    expect((await harness.compiler.compileAndActivate(candidate(validDocument()))).ok).toBe(true);
    const result = await harness.compiler.compileAndActivate(candidate(validDocument()));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_OVERRIDE_INVALID');
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });

  it('accepts an authorized self-targeted override and advances one generation', async () => {
    const harness = createHarness();
    expect((await harness.compiler.compileAndActivate(candidate(validDocument()))).ok).toBe(true);
    const overriding = JSON.stringify({
      schemaVersion: '1.0.0',
      targetLayer: '基类层',
      definitions: [
        { id: 'rule.damage.basic', kind: 'rule', iconRef: 'icon:rule', override: 'rule.damage.basic' },
        {
          id: 'item.shotgun', kind: 'item', iconRef: 'icon:shotgun',
          damageProfile: 'rule.damage.basic', slotCount: 3, override: 'item.shotgun',
        },
      ],
    });
    const result = await harness.compiler.compileAndActivate(candidate(overriding));
    expect(result.ok).toBe(true);
    expect(harness.registry.getSnapshot().generation).toBe(2);
    expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(true);
  });
});
