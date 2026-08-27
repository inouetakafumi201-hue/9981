import { describe, expect, it } from 'vitest';
import { ERR_CODES } from '../../state/error-codes';
import { HINT_TEMPLATES } from '../../safety/safety';
import { candidate, createHarness, validDocument } from './fixtures';
import type { CompilationRejection } from '../index';

function rejection(result: Awaited<ReturnType<ReturnType<typeof createHarness>['compiler']['compileAndActivate']>>): CompilationRejection {
  if (result.ok) throw new Error('expected a rejection');
  return result;
}

describe('SpecificationCompiler: successful activation', () => {
  it('publishes one atomic generation and exposes a canonical artifact', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(validDocument()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.registry.getSnapshot().generation).toBe(1);
    expect(harness.artifactStore.listCommittedGenerations()).toEqual([1]);
    expect(harness.artifactStore.readCommittedManifest()?.artifactHash).toBe(result.artifactHash);
    expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(true);
    // No staging area may remain observable after a successful publish.
    expect(harness.artifactStore.listStagingIds()).toEqual([]);
    expect(harness.artifactStore.listQuarantineKeys()).toEqual([]);
  });

  it('produces byte-identical output for equivalent input formatting', async () => {
    const compact = JSON.parse(validDocument()) as Record<string, unknown>;
    const first = await createHarness().compiler.compileAndActivate(candidate(validDocument()));
    const second = await createHarness().compiler.compileAndActivate(candidate(JSON.stringify(compact)));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifactHash).toBe(first.artifactHash);
  });

  it('keeps every registered ErrCode paired with creator guidance', () => {
    const missing = Object.entries(ERR_CODES)
      .flatMap(([prefix, suffixes]) => suffixes.map((suffix) => `${prefix}_${suffix}`))
      .filter((code) => !HINT_TEMPLATES[code]);
    expect(missing).toEqual([]);
  });
});

describe('SpecificationCompiler: candidate rejection preserves state', () => {
  const cases: readonly { readonly name: string; readonly code: string; readonly text: string }[] = [
    { name: 'JSON syntax', code: 'E_LOAD_JSON_SYNTAX', text: '{ "schemaVersion": "1.0.0", }' },
    { name: 'truncated input', code: 'E_LOAD_INPUT_TRUNCATED', text: '{ "schemaVersion": "1.0.0"' },
    {
      name: 'duplicate member',
      code: 'E_LOAD_DUPLICATE_MEMBER',
      text: '{ "schemaVersion": "1.0.0", "schemaVersion": "1.0.0", "targetLayer": "基类层", "definitions": [] }',
    },
    {
      name: 'prohibited construct',
      code: 'E_LOAD_PROHIBITED_CONSTRUCT',
      text: JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], $eval: 'x' }),
    },
    {
      name: 'unsupported schema version',
      code: 'E_MIG_NEWER_SAVE',
      text: JSON.stringify({ schemaVersion: '9.0.0', targetLayer: '基类层', definitions: [] }),
    },
    {
      name: 'unknown field',
      code: 'E_LOAD_UNKNOWN_FIELD',
      text: validDocument({ mysteryField: 1 }),
    },
  ];

  for (const testCase of cases) {
    it(`rejects ${testCase.name} and changes nothing`, async () => {
      const harness = createHarness();
      const before = harness.registry.getSnapshot();
      const result = rejection(await harness.compiler.compileAndActivate(candidate(testCase.text)));

      expect(result.halted).toBe('candidate');
      expect(result.unchangedState).toBe(true);
      expect(result.diagnostics.map((item) => item.code)).toContain(testCase.code);
      expect(harness.registry.getSnapshot()).toBe(before);
      expect(harness.artifactStore.readCommittedManifest()).toBeNull();
      expect(harness.artifactStore.listStagingIds()).toEqual([]);
      expect(harness.emergencySink.getAll()).toEqual([]);
    });
  }
});
