import { describe, expect, it } from 'vitest';
import { candidate, createHarness } from './fixtures.js';

async function codesFor(text: string, overrides = {}): Promise<readonly string[]> {
  const harness = createHarness();
  const result = await harness.compiler.compileAndActivate(candidate(text, overrides));
  expect(result.ok).toBe(false);
  if (result.ok) return [];
  expect(result.halted).toBe('candidate');
  expect(harness.registry.getSnapshot().generation).toBe(0);
  expect(harness.artifactStore.readCommittedManifest()).toBeNull();
  return result.diagnostics.map((item) => item.code);
}

function doc(definitions: readonly Record<string, unknown>[], targetLayer = '基类层', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer, definitions, ...extra });
}

describe('SpecificationCompiler: layer, numeric and terminology ownership', () => {
  it('rejects a concrete gameplay value inside 基类层', async () => {
    const codes = await codesFor(doc([{ id: 'item.a', kind: 'item', iconRef: 'i', damage: 3 }]));
    expect(codes).toContain('E_LOAD_LAYER_OWNERSHIP');
  });

  it('rejects a gameplay value outside the 1-5 constitutional range', async () => {
    const codes = await codesFor(doc([{ id: 'item.a', kind: 'item', iconRef: 'i', damage: 9 }], '玩法层'));
    expect(codes).toContain('E_LOAD_GAMEPLAY_VALUE_RANGE');
  });

  it('accepts an internal structural bound outside 1-5 because ownership differs', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      doc([{ id: 'item.a', kind: 'item', iconRef: 'i', slotCount: 40 }]),
    ));
    expect(result.ok).toBe(true);
  });

  it('rejects non-canonical architecture terminology in normative input', async () => {
    const codes = await codesFor(doc([{ id: 'item.a', kind: 'item', iconRef: 'i', term: '\u5185\u5bb9\u5c42' }]));
    expect(codes).toContain('E_LOAD_TERM_NONCANONICAL');
  });

  it('rejects a deprecated mechanic field', async () => {
    const codes = await codesFor(doc([{ id: 'item.a', kind: 'item', iconRef: 'i', volumeClass: 'large' }]));
    expect(codes).toContain('E_LOAD_DEPRECATED_MECHANIC');
  });
});

describe('SpecificationCompiler: identity, references and composition', () => {
  it('rejects duplicate identifiers and reports both source locations', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      doc([{ id: 'item.a', kind: 'item', iconRef: 'i' }, { id: 'item.a', kind: 'item', iconRef: 'j' }]),
    ));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const duplicate = result.diagnostics.find((item) => item.code === 'E_LOAD_DUPLICATE_ID');
    expect(duplicate).toBeDefined();
    expect(duplicate?.relatedSources?.length).toBe(1);
    expect(duplicate?.source?.span.start.line).toBeGreaterThan(0);
  });

  it('rejects a missing reference target', async () => {
    const codes = await codesFor(doc([{ id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'rule.absent' }]));
    expect(codes).toContain('E_REF_MISSING');
  });

  it('rejects a reference to an incompatible kind', async () => {
    const codes = await codesFor(doc([
      { id: 'item.b', kind: 'item', iconRef: 'i' },
      { id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'item.b' },
    ]));
    expect(codes).toContain('E_REF_KIND');
  });

  it('rejects instantiating an abstract definition through a reference', async () => {
    const codes = await codesFor(doc([
      { id: 'rule.base', kind: 'rule', abstract: true },
      { id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'rule.base' },
    ]));
    expect(codes).toContain('E_REF_ABSTRACT');
  });

  it('rejects an inheritance cycle and names every participant', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([
      { id: 'item.a', kind: 'item', iconRef: 'i', extends: ['item.b'] },
      { id: 'item.b', kind: 'item', iconRef: 'i', extends: ['item.a'] },
    ])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const cycles = result.diagnostics.filter((item) => item.code === 'E_LOAD_INHERITANCE_CYCLE');
    expect(cycles.length).toBe(2);
  });

  it('rejects unordered collection members without a stable identity', async () => {
    const codes = await codesFor(doc([
      { id: 'item.a', kind: 'item', iconRef: 'i', accessories: [{ name: 'scope' }] },
    ]));
    expect(codes).toContain('E_LOAD_CANONICAL_AMBIGUOUS');
  });
});

describe('SpecificationCompiler: source precedence and unresolved conflicts', () => {
  it('warns when a lower-precedence statement is displaced but still activates', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([], '基类层', {
      // The document itself sits at precedence 100, so a statement may restate a weaker source at 50 but
      // may never claim more authority than the document it lives in.
      statements: [
        { key: 'gateway.kinds', value: 'three', precedence: 100 },
        { key: 'gateway.kinds', value: 'two', precedence: 50 },
      ],
    })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const displaced = result.diagnostics.filter((item) => item.code === 'E_LOAD_SOURCE_DISPLACED');
    expect(displaced.length).toBe(1);
    expect(displaced[0]?.severity).toBe('warn');
  });

  it('preserves an equal-precedence conflict instead of picking a winner', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([], '基类层', {
      statements: [
        { key: 'gateway.kinds', value: 'three', precedence: 100 },
        { key: 'gateway.kinds', value: 'two', precedence: 100 },
      ],
    })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conflicts = result.diagnostics.filter((item) => item.code === 'E_LOAD_EQUAL_PRECEDENCE_CONFLICT');
    // Both sides are reported, and neither is silently promoted into a rule.
    expect(conflicts.length).toBe(2);
    expect(conflicts.every((item) => item.severity === 'warn')).toBe(true);
    const model = harness.registry.getSnapshot().model;
    expect(model?.normativeStatements['gateway.kinds']).toBeUndefined();
    const unresolved = model?.unresolvedItems.find((item) => item.key === 'gateway.kinds');
    expect(unresolved?.statements.map((item) => item.value)).toEqual(['three', 'two']);
  });

  it('refuses a bound that depends on a statement nobody has decided yet', async () => {
    const codes = await codesFor(doc([
      { id: 'item.a', kind: 'item', iconRef: 'i', connectionLimit: 5 },
    ], '基类层', {
      statements: [
        { key: 'topology.connectionLimit', value: 5, precedence: 100 },
        { key: 'topology.connectionLimit', value: 4, precedence: 100 },
      ],
    }));
    // The bound cites an undecided statement, so the definition cannot be activated with a default.
    expect(codes).toContain('E_LOAD_UNRESOLVED_NORMATIVE');
  });

  it('does not promote historical material into a normative statement', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc([], '基类层', {
      statements: [{ key: 'weapon.damage', value: 3, status: 'historical' }],
    })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const model = harness.registry.getSnapshot().model;
    expect(model?.normativeStatements['weapon.damage']).toBeUndefined();
  });
});

describe('SpecificationCompiler: presentation fallback stays a warning', () => {
  it('emits a warning and still activates when an optional presentation field is absent', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      doc([{ id: 'item.a', kind: 'item' }]),
    ));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fallback = result.diagnostics.filter((item) => item.code === 'E_LOAD_PRESENTATION_FALLBACK');
    expect(fallback.length).toBe(1);
    expect(fallback[0]?.severity).toBe('warn');
    expect(fallback[0]?.haltClass).toBeUndefined();
  });
});
