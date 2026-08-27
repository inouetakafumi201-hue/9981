import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Diagnostic } from '../../state/diagnostic';
import { validateSourceRecord } from '../../state/source-record';
import { canonicalStringify, compareCodePoints } from '../json-codec';
import { sortDiagnostics } from '../diagnostic-factory';
import { checkDiagnosticClosure } from '../closure';
import type { JsonValue } from '../index';
import { candidate, createHarness, validDocument } from './fixtures';

/**
 * Property tests for the compiler surface a UGC creator can reach.
 *
 * The invariants below are the ones that must hold for *every* input, including inputs no fixture
 * anticipated: never throw, never activate a rejected candidate, never publish twice from one document,
 * and always emit a locatable, ordered, closed diagnostic set.
 */

/** Arbitrary text that is frequently *almost* valid JSON, which is where real creator mistakes live. */
const nearMissJson = fc.oneof(
  fc.string(),
  fc.constantFrom(
    '', ' ', '{', '}', '[]', '{}', 'null', 'true', '0', '"x"',
    '{"a":}', '{,}', '{"a":1,}', '[1,]', '{"a" 1}', '{a:1}', "{'a':1}",
    '{"a":01}', '{"a":.5}', '{"a":1.}', '{"a":+1}', '{"a":1e}', '{"a":NaN}',
    '{"a":"\\q"}', '{"a":"unterminated', '{"a":1}}', '[[[[[',
  ),
  fc.json(),
  // Structurally valid documents with a randomly corrupted byte, the classic near-miss.
  fc.tuple(fc.constant(validDocument()), fc.nat(), fc.char()).map(([text, index, char]) => {
    const at = text.length === 0 ? 0 : index % text.length;
    return `${text.slice(0, at)}${char}${text.slice(at + 1)}`;
  }),
);

function isBlocking(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error' || diagnostic.severity === 'fatal';
}

describe('Property: arbitrary input is total and fail-closed', () => {
  it('never throws and never returns a rejection without a blocking diagnostic', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(text));

      if (result.ok) {
        // A pass must have advanced exactly one generation and published exactly one artifact.
        expect(harness.registry.getSnapshot().generation).toBe(1);
        expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(true);
        return;
      }
      // A rejection must always carry something the caller can act on.
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics.some(isBlocking)).toBe(true);
      expect(result.unchangedState).toBe(true);
    }), { numRuns: 300 });
  });

  it('leaves the registry and the artifact store untouched whenever it rejects', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(text));
      if (result.ok) return;

      expect(harness.registry.getSnapshot().generation).toBe(0);
      expect(harness.registry.getSnapshot().model).toBeNull();
      expect(harness.artifactStore.readCommittedManifest()).toBeNull();
      expect(harness.artifactStore.listCommittedGenerations()).toEqual([]);
      // No staging directory may survive a rejection, or the next run would read stale bytes.
      expect(harness.artifactStore.listStagingIds()).toEqual([]);
    }), { numRuns: 300 });
  });

  it('classifies a creator mistake as a candidate rejection, never as a system incident', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(text));
      if (result.ok) return;
      expect(result.halted).toBe('candidate');
      // No emergency envelope may be written for input the creator can fix.
      expect(harness.emergencySink.getAll()).toEqual([]);
    }), { numRuns: 300 });
  });
});

describe('Property: every diagnostic is locatable, ordered and closed', () => {
  it('anchors each candidate diagnostic to a span that verifies against the compiled text', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const result = await createHarness().compiler.compileAndActivate(candidate(text));
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.scope === 'host') continue;
        const source = diagnostic.source;
        expect(source).toBeDefined();
        if (!source) continue;
        // The span must describe the bytes the compiler actually read, hash included.
        expect(validateSourceRecord(source, text)).toEqual([]);
      }
    }), { numRuns: 250 });
  });

  it('returns diagnostics already in the deterministic reporting order', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const result = await createHarness().compiler.compileAndActivate(candidate(text));
      const reported = [...result.diagnostics];
      expect(sortDiagnostics(reported)).toEqual(reported);
    }), { numRuns: 250 });
  });

  it('passes the closure gate for every reported set', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const result = await createHarness().compiler.compileAndActivate(candidate(text));
      const sourceTexts = new Map([['src:main', text]]);
      const issues = checkDiagnosticClosure(result.diagnostics, sourceTexts, { requireRejection: false });
      expect(issues).toEqual([]);
    }), { numRuns: 250 });
  });

  it('Property: diagnostic ordering is a total order', () => {
    const diagnostic = (over: Partial<Diagnostic>): Diagnostic => ({
      code: 'E_LOAD_JSON_SYNTAX', severity: 'error', message: 'm', phase: 0, ...over,
    });
    fc.assert(fc.property(
      fc.array(fc.record({
        sourcePackage: fc.constantFrom('a', 'B', 'c'),
        path: fc.constantFrom('/a', '/b', ''),
        code: fc.constantFrom<Diagnostic['code']>('E_LOAD_JSON_SYNTAX', 'E_REF_MISSING'),
      }), { maxLength: 12 }),
      (specs) => {
        const items = specs.map((spec) => diagnostic(spec));
        const once = sortDiagnostics(items);
        // Sorting is idempotent and independent of the input permutation.
        expect(sortDiagnostics(once)).toEqual(once);
        expect(sortDiagnostics([...items].reverse()).map((d) => [d.sourcePackage, d.path, d.code]))
          .toEqual(once.map((d) => [d.sourcePackage, d.path, d.code]));
      },
    ), { numRuns: 200 });
  });
});

describe('Property: canonicalisation is deterministic and order-independent', () => {
  const jsonValue: fc.Arbitrary<JsonValue> = fc.jsonValue() as fc.Arbitrary<JsonValue>;

  it('produces identical bytes for the same value on every call', () => {
    fc.assert(fc.property(jsonValue, (value) => {
      expect(canonicalStringify(value)).toBe(canonicalStringify(value));
    }), { numRuns: 500 });
  });

  it('ignores object key insertion order', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), jsonValue, { maxKeys: 8 }),
      (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse());
        expect(canonicalStringify(reversed as JsonValue)).toBe(canonicalStringify(record as JsonValue));
      },
    ), { numRuns: 400 });
  });

  it('round-trips through JSON.parse without changing the canonical form', () => {
    fc.assert(fc.property(jsonValue, (value) => {
      const text = canonicalStringify(value);
      expect(canonicalStringify(JSON.parse(text) as JsonValue)).toBe(text);
    }), { numRuns: 400 });
  });

  it('refuses non-finite numbers instead of emitting invalid JSON', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalStringify(value as unknown as JsonValue)).toThrow(TypeError);
    }
    expect(canonicalStringify(-0 as unknown as JsonValue)).toBe('0');
  });

  it('Property: code-point ordering is a strict total order', () => {
    fc.assert(fc.property(fc.string(), fc.string(), fc.string(), (a, b, c) => {
      const ab = compareCodePoints(a, b);
      const ba = compareCodePoints(b, a);
      // Compared as booleans so the assertion is not sensitive to the sign of zero.
      expect(ab === 0 ? ba === 0 : Math.sign(ab) === -Math.sign(ba)).toBe(true);
      expect(compareCodePoints(a, a)).toBe(0);
      if (compareCodePoints(a, b) < 0 && compareCodePoints(b, c) < 0) {
        expect(compareCodePoints(a, c)).toBeLessThan(0);
      }
    }), { numRuns: 500 });
  });
});

describe('Property: compilation is reproducible and single-effect', () => {
  it('yields the same artifact hash for the same document across independent hosts', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), { minLength: 1, maxLength: 6 }),
      async (names) => {
        const unique = [...new Set(names)];
        const text = JSON.stringify({
          schemaVersion: '1.0.0', targetLayer: '基类层',
          definitions: unique.map((name) => ({ id: `rule.${name}`, kind: 'rule', iconRef: 'i' })),
        });
        const first = await createHarness().compiler.compileAndActivate(candidate(text));
        const second = await createHarness().compiler.compileAndActivate(candidate(text));
        expect(second.ok).toBe(first.ok);
        if (first.ok && second.ok) expect(second.artifactHash).toBe(first.artifactHash);
      },
    ), { numRuns: 120 });
  });

  it('does not depend on the order definitions are written in', async () => {
    await fc.assert(fc.asyncProperty(
      fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), { minLength: 2, maxLength: 6 }),
      async (names) => {
        const build = (list: readonly string[]) => JSON.stringify({
          schemaVersion: '1.0.0', targetLayer: '基类层',
          definitions: list.map((name) => ({ id: `rule.${name}`, kind: 'rule', iconRef: 'i' })),
        });
        const forward = await createHarness().compiler.compileAndActivate(candidate(build(names)));
        const reverse = await createHarness().compiler.compileAndActivate(candidate(build([...names].reverse())));
        expect(reverse.ok).toBe(forward.ok);
        if (forward.ok && reverse.ok) expect(reverse.artifactHash).toBe(forward.artifactHash);
      },
    ), { numRuns: 120 });
  });

  it('advances at most one generation per successful compilation', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(text));
      expect(harness.registry.getSnapshot().generation).toBe(result.ok ? 1 : 0);
      expect(harness.artifactStore.listCommittedGenerations().length).toBe(result.ok ? 1 : 0);
    }), { numRuns: 250 });
  });

  it('never publishes anything in draft mode, whatever the input', async () => {
    await fc.assert(fc.asyncProperty(nearMissJson, async (text) => {
      const harness = createHarness();
      const result = await harness.compiler.compileDraft(candidate(text));
      expect(harness.registry.getSnapshot().generation).toBe(0);
      expect(harness.artifactStore.listCommittedGenerations()).toEqual([]);
      expect(harness.artifactStore.listStagingIds()).toEqual([]);
      if (result.ok) expect(result.snapshotId).toBeNull();
    }), { numRuns: 250 });
  });
});
