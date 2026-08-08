import { describe, expect, it } from 'vitest';
import { candidate, createHarness } from '../spec-compiler/__tests__/fixtures.js';

/**
 * Equally authoritative sources that disagree are preserved, never arbitrated.
 *
 * The failure this guards against is not "the compiler picked a side": it is "the disagreement vanished".
 * Rejecting the whole document threw the conflicting statements away, so nothing downstream could see what
 * was still open. The contract now is narrower and stronger: keep every conflicting statement, withhold
 * the contract it would have produced, let unaffected content compile, and refuse anything that actually
 * depends on the withheld contract.
 */
function doc(statements: readonly Record<string, unknown>[], definitions: readonly Record<string, unknown>[] = []): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions, statements });
}

describe('an equal-precedence conflict survives as an open item', () => {
  it('keeps every conflicting statement and produces no contract', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'gateway.kinds', value: 'three', precedence: 100 },
      { key: 'gateway.kinds', value: 'two', precedence: 100 },
      { key: 'gateway.shape', value: 'single', precedence: 100 },
    ])));

    expect(result.ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    expect(model?.unresolvedItems.map((item) => item.key)).toEqual(['gateway.kinds']);
    expect(model?.unresolvedItems[0]?.statements.map((item) => item.value)).toEqual(['three', 'two']);
    expect(model?.normativeStatements['gateway.kinds']).toBeUndefined();
    // An unrelated statement at the same precedence is unaffected: blocking is scoped to the conflict.
    expect(model?.normativeStatements['gateway.shape']?.value).toBe('single');
  });

  it('reports the conflict as advisory on every side without blocking activation', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'k', value: 'a', precedence: 100 },
      { key: 'k', value: 'b', precedence: 100 },
    ])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conflicts = result.diagnostics.filter((item) => item.code === 'E_LOAD_EQUAL_PRECEDENCE_CONFLICT');
    expect(conflicts.length).toBe(2);
    for (const conflict of conflicts) {
      expect(conflict.severity).toBe('warn');
      expect(conflict.haltClass).toBeUndefined();
      // Each side points at the other, so a reader can see the whole disagreement from either end.
      expect(conflict.relatedSources?.length).toBe(1);
    }
  });
});

describe('cross-precedence disagreement is still decided by precedence', () => {
  it('takes the higher-precedence statement and records the displacement', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'k', value: 'high', precedence: 100 },
      { key: 'k', value: 'low', precedence: 50 },
    ])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.registry.getSnapshot().model?.normativeStatements['k']?.value).toBe('high');
    expect(harness.registry.getSnapshot().model?.unresolvedItems).toEqual([]);
    const displaced = result.diagnostics.filter((item) => item.code === 'E_LOAD_SOURCE_DISPLACED');
    expect(displaced.length).toBe(1);
    expect(displaced[0]?.severity).toBe('warn');
  });
});

describe('a definition that depends on a withheld contract is refused', () => {
  const definition = { id: 'item.a', kind: 'item', iconRef: 'i', connectionLimit: 5 };

  it('refuses the bound while the statement it cites is undecided', async () => {
    const harness = createHarness();
    const before = harness.registry.canonicalSnapshot();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'topology.connectionLimit', value: 5, precedence: 100 },
      { key: 'topology.connectionLimit', value: 4, precedence: 100 },
    ], [definition])));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const blocked = result.diagnostics.find((item) => item.code === 'E_LOAD_UNRESOLVED_NORMATIVE');
    expect(blocked?.severity).toBe('error');
    expect(blocked?.path).toBe('/definitions/0/connectionLimit');
    expect(blocked?.messageArgs?.['statementKey']).toBe('topology.connectionLimit');
    expect(harness.registry.canonicalSnapshot()).toEqual(before);
  });

  it('accepts the same bound once the statement is settled', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'topology.connectionLimit', value: 5, precedence: 100 },
      { key: 'topology.connectionLimit', value: 4, precedence: 50 },
    ], [definition])));
    expect(result.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.definitions['item.a']).toBeDefined();
  });

  it('leaves a bound that cites nothing unaffected by unrelated open items', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'unrelated', value: 'a', precedence: 100 },
      { key: 'unrelated', value: 'b', precedence: 100 },
    ], [{ id: 'item.a', kind: 'item', iconRef: 'i', slotCount: 9 }])));
    expect(result.ok).toBe(true);
  });
});

describe('an open item can only be closed by a recorded decision', () => {
  it('refuses a later promotion that names no decision', async () => {
    const harness = createHarness();
    expect((await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'k', value: 'a', precedence: 100 },
      { key: 'k', value: 'b', precedence: 100 },
    ])))).ok).toBe(true);

    const result = await harness.compiler.compileAndActivate(candidate(doc([{ key: 'k', value: 'a' }])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_NORMATIVE_WITHOUT_PROVENANCE');
  });

  it('accepts the promotion when the resolving decision is recorded', async () => {
    const harness = createHarness();
    expect((await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'k', value: 'a', precedence: 100 },
      { key: 'k', value: 'b', precedence: 100 },
    ])))).ok).toBe(true);

    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'k', value: 'a', decisionId: 'D-006' },
    ])));
    expect(result.ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    expect(model?.normativeStatements['k']?.value).toBe('a');
    expect(model?.normativeStatements['k']?.source.decisionId).toBe('D-006');
    expect(model?.unresolvedItems).toEqual([]);
  });
});

describe('draft mode can preview an open item without publishing anything', () => {
  it('returns the preserved conflict in the draft model', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileDraft(candidate(doc([
      { key: 'k', value: 'a', precedence: 100 },
      { key: 'k', value: 'b', precedence: 100 },
    ])));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draftModel?.unresolvedItems.map((item) => item.key)).toEqual(['k']);
    expect(result.draftModel?.normativeStatements['k']).toBeUndefined();
    expect(result.snapshotId).toBeNull();
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });
});

describe('one decision identifier still describes one decision', () => {
  it('keeps both statements and warns rather than merging them', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'a', value: 1, decisionId: 'D-009' },
      { key: 'b', value: 2, decisionId: 'D-009' },
    ])));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reuse = result.diagnostics.filter((item) => item.code === 'E_LOAD_DECISION_ID_REUSED');
    expect(reuse.length).toBe(2);
    expect(reuse.every((item) => item.severity === 'warn')).toBe(true);
    const model = harness.registry.getSnapshot().model;
    // Separate entries, separate provenance: the reuse is tracked, not resolved.
    expect(model?.normativeStatements['a']?.value).toBe(1);
    expect(model?.normativeStatements['b']?.value).toBe(2);
  });
});

describe('historical and deprecated material never becomes binding', () => {
  it('drops the statement and says so', async () => {
    for (const status of ['historical', 'deprecated'] as const) {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(doc([
        { key: 'k', value: 'a', status },
      ])));
      expect(result.ok, status).toBe(true);
      if (!result.ok) continue;
      const notice = result.diagnostics.find((item) => item.code === 'E_LOAD_SOURCE_DISPLACED');
      expect(notice?.severity, status).toBe('info');
      expect(harness.registry.getSnapshot().model?.normativeStatements['k'], status).toBeUndefined();
      expect(harness.registry.getSnapshot().model?.unresolvedItems, status).toEqual([]);
    }
  });
});

describe('a statement cannot award itself more authority than its document has', () => {
  it('refuses a precedence above the document precedence', async () => {
    const harness = createHarness();
    // The host assigns the document precedence from the source hierarchy. Without this ceiling any
    // document could outrank the constitution just by writing a larger integer.
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { key: 'k', value: 'a', precedence: 100000 },
    ])));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const invalid = result.diagnostics.find((item) => item.code === 'E_LOAD_SOURCE_INVALID');
    expect(invalid?.path).toBe('/statements/0/precedence');
    expect(invalid?.severity).toBe('error');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('accepts a precedence at or below the document precedence', async () => {
    for (const precedence of [100, 50, 0, -10]) {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(doc([
        { key: 'k', value: 'a', precedence },
      ])));
      expect(result.ok, `precedence ${precedence}`).toBe(true);
      expect(harness.registry.getSnapshot().model?.normativeStatements['k']?.source.precedence, `${precedence}`)
        .toBe(precedence);
    }
  });

  it('keeps the elevated statement out of the model entirely', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileDraft(candidate(doc([
      { key: 'ok', value: 'a' },
      { key: 'elevated', value: 'b', precedence: 500 },
    ])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A rejected document publishes nothing, so the legitimate statement must not be visible either.
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_SOURCE_INVALID');
    expect(harness.registry.getSnapshot().model).toBeNull();
  });
});
