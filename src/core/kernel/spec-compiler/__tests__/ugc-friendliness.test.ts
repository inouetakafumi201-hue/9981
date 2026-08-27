import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../state/diagnostic';
import { candidate, createHarness, validDocument } from './fixtures';
import { FULL_CORPUS, collectDiagnostics, runCase } from './diagnostic-corpus';

/**
 * These cases treat a confusing diagnostic as a defect.
 *
 * A UGC creator cannot read the compiler source, so a diagnostic that is technically accurate but
 * unreadable, unlocatable, or buried under cascade noise is a failure of this layer even when the
 * compiler's verdict is correct.
 */

/** Compiler-internal vocabulary that must never reach a creator-facing string. */
const FORBIDDEN_IN_CREATOR_TEXT: readonly RegExp[] = [
  /E_[A-Z]+_[A-Z_]+/,          // raw error codes
  /\bAST\b/,
  /\bJSON Pointer\b/i,
  /\bschemaVersion\b/,          // internal field name; creators see the marked position instead
  /\bnormativeStatus\b/,
  /\bsemanticFamily\b/,
  /\bbaseline\b/i,
  /\bsnapshot\b/i,
  /\bcanonical/i,
  /\bregistry\b/i,
  /\btraversal\b/i,
  /\bquota\b/i,
  /undefined|null pointer|NaN/,
  /\bstack\b/i,
  /[A-Za-z]:\\\\/,              // Windows absolute paths
  /\bfile:\/\//,
];

function creatorStrings(diagnostic: Diagnostic): readonly string[] {
  return [diagnostic.creatorMessage, diagnostic.actionableHint].filter(
    (value): value is string => typeof value === 'string');
}

describe('UGC friendliness: every diagnostic is readable without compiler knowledge', () => {
  it('gives every diagnostic a creator message and an actionable hint', async () => {
    const collected = await collectDiagnostics();
    expect(collected.length).toBeGreaterThan(20);

    for (const { label, diagnostic } of collected) {
      const context = `${label} / ${diagnostic.code}`;
      expect(diagnostic.creatorMessage, context).toBeTruthy();
      expect(diagnostic.actionableHint, context).toBeTruthy();
      // A hint that only restates the problem is not actionable; require a usable amount of guidance.
      expect((diagnostic.actionableHint ?? '').length, context).toBeGreaterThan(8);
    }
  });

  it('keeps compiler jargon out of creator-facing text', async () => {
    for (const { label, diagnostic } of await collectDiagnostics()) {
      for (const text of creatorStrings(diagnostic)) {
        for (const pattern of FORBIDDEN_IN_CREATOR_TEXT) {
          expect(pattern.test(text), `${label} / ${diagnostic.code} leaks ${pattern} in: ${text}`).toBe(false);
        }
      }
    }
  });

  it('tells the creator what to do, not only what is wrong', async () => {
    // Guidance must contain at least one imperative cue so it reads as an instruction.
    const actionCues = ['请', '改', '删', '补', '检查', '拆', '换', '移到', '联系'];
    for (const { label, diagnostic } of await collectDiagnostics()) {
      const hint = diagnostic.actionableHint ?? '';
      expect(
        actionCues.some((cue) => hint.includes(cue)),
        `${label} / ${diagnostic.code} hint is not actionable: ${hint}`,
      ).toBe(true);
    }
  });

  it('separates the technical message from the creator message', async () => {
    for (const { label, diagnostic } of await collectDiagnostics()) {
      // The technical string stays available for maintainers, but must not be what a creator reads.
      expect(diagnostic.message, `${label} / ${diagnostic.code}`).toBeTruthy();
      expect(diagnostic.creatorMessage).not.toBe(diagnostic.message);
    }
  });
});

describe('UGC friendliness: a creator can always find the problem', () => {
  it('anchors every candidate diagnostic to a verified position in the creator file', async () => {
    for (const { label, diagnostic } of await collectDiagnostics()) {
      const context = `${label} / ${diagnostic.code}`;
      if (diagnostic.scope === 'host') continue; // system incidents describe the compiler, not a file
      expect(diagnostic.source, context).toBeDefined();
      const span = diagnostic.source?.span;
      expect(span?.start.line, context).toBeGreaterThanOrEqual(1);
      expect(span?.start.column, context).toBeGreaterThanOrEqual(1);
      expect(span?.end.offset, context).toBeGreaterThanOrEqual(span?.start.offset ?? 0);
      // A verified slice hash is what makes the marked range trustworthy rather than approximate.
      expect(span?.sourceSliceHash, context).toBeTruthy();
    }
  });

  it('points a syntax error at the offending line rather than the file start', async () => {
    const text = [
      '{',
      '  "schemaVersion": "1.0.0",',
      '  "targetLayer": "基类层",',
      '  "definitions": [,]',
      '}',
    ].join('\n');
    const result = await createHarness().compiler.compileAndActivate(candidate(text));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const syntax = result.diagnostics.find((item) => item.code === 'E_LOAD_JSON_SYNTAX');
    expect(syntax?.source?.span.start.line).toBe(4);
  });

  it('names the field path so the creator can search for it', async () => {
    const result = await createHarness().compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层',
      definitions: [{ id: 'item.a', kind: 'item', iconRef: 'i', bogusField: 1 }],
    })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unknown = result.diagnostics.find((item) => item.code === 'E_LOAD_UNKNOWN_FIELD');
    expect(unknown?.path).toBe('/definitions/0/bogusField');
    expect(unknown?.at?.def).toBe('item.a');
  });

  it('links a duplicate identifier to the place it was first used', async () => {
    const result = await createHarness().compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层',
      definitions: [
        { id: 'item.a', kind: 'item', iconRef: 'i' },
        { id: 'item.a', kind: 'item', iconRef: 'i' },
      ],
    })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const duplicate = result.diagnostics.find((item) => item.code === 'E_LOAD_DUPLICATE_ID');
    // Without the first location the creator has to hunt for the other definition by hand.
    expect(duplicate?.relatedSources?.length).toBeGreaterThan(0);
  });
});

describe('UGC friendliness: one mistake does not become a wall of errors', () => {
  it('reports a single trailing comma as one problem, not a cascade', async () => {
    const result = await createHarness().compiler.compileAndActivate(
      candidate('{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],}'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Parsing stops at the first structural break, so exactly one diagnostic is the correct outcome.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_JSON_SYNTAX');
  });

  it('does not multiply one missing reference across every definition that uses it', async () => {
    const definitions = Array.from({ length: 30 }, (_, index) => ({
      id: `item.w${index}`, kind: 'item', iconRef: 'i', damageProfile: 'rule.ghost',
    }));
    const result = await createHarness().compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层', definitions,
    })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.diagnostics.filter((item) => item.code === 'E_REF_MISSING');
    // One diagnostic per offending site is expected and useful; anything beyond that is noise.
    expect(missing).toHaveLength(30);
    expect(missing.every((item) => item.path?.endsWith('/damageProfile'))).toBe(true);
    // The creator must not additionally receive derived errors invented from the same root cause.
    expect(result.diagnostics.filter((item) => item.isDerived === true)).toHaveLength(0);
  });

  it('stops at the schema layer instead of reporting downstream damage from an unusable document', async () => {
    // definitions is the wrong type, so nothing downstream can be checked meaningfully.
    const result = await createHarness().compiler.compileAndActivate(
      candidate('{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":{"a":1}}'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toEqual(['E_LOAD_FIELD_TYPE']);
  });

  it('keeps the reported diagnostic count bounded when a document is broken in many ways', async () => {
    const definitions = Array.from({ length: 40 }, (_, index) => ({
      id: `!bad-${index}`, kind: 'nonesuch', mystery: index,
    }));
    const result = await createHarness({ quotas: { diagnostics: 60 } })
      .compiler.compileAndActivate(candidate(JSON.stringify({
        schemaVersion: '1.0.0', targetLayer: '基类层', definitions,
      })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Bounded output is what keeps the first screen of feedback usable.
    expect(result.diagnostics.length).toBeLessThanOrEqual(61);
  });
});

describe('UGC friendliness: severity matches what the creator must do', () => {
  it('never blocks a release on a purely advisory notice', async () => {
    for (const { label, diagnostic } of await collectDiagnostics()) {
      const context = `${label} / ${diagnostic.code}`;
      if (diagnostic.severity === 'warn' || diagnostic.severity === 'info') {
        expect(diagnostic.haltClass, context).toBeUndefined();
      } else {
        expect(diagnostic.haltClass, context).toBeDefined();
      }
    }
  });

  it('lets a document with only advisory notices activate', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层',
      // A missing presentation asset is a notice, not a blocker.
      definitions: [{ id: 'rule.a', kind: 'rule', displayName: 'basic' }],
      statements: [{ key: 'k', value: 'a', status: 'historical' }],
    })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.some((item) => item.severity === 'error' || item.severity === 'fatal')).toBe(false);
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });

  it('distinguishes a creator mistake from a system incident in the reported class', async () => {
    for (const item of FULL_CORPUS) {
      const { label, result } = await runCase(item);
      if (result.ok) continue;
      // Nothing in the corpus is a system fault, so every rejection must be creator-addressable.
      expect(result.halted, `${label} must be a candidate rejection`).toBe('candidate');
      expect(result.unchangedState, label).toBe(true);
    }
  });

  it('explains a system incident without blaming the creator', async () => {
    const harness = createHarness();
    harness.artifactStore.injectFailure('syncStaging');
    const result = await harness.compiler.compileAndActivate(candidate(validDocument()));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.halted).toBe('infrastructure');
    const incident = result.diagnostics[0];
    expect(incident?.severity).toBe('fatal');
    expect(incident?.creatorMessage).toBeTruthy();
    // The creator is told their work was not lost, and is not asked to fix a compiler defect.
    expect(incident?.actionableHint).toMatch(/仍然有效|联系维护者|重试/);
  });
});
