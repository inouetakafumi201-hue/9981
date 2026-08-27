import { describe, expect, it } from 'vitest';
import { findSemanticFieldDamage } from '../spec-compiler/integrity';
import type { CompiledModel, JsonValue } from '../spec-compiler/index';
import { buildSchemaVersion, candidate, createHarness } from '../spec-compiler/__tests__/fixtures';

/**
 * The pipeline's self-check.
 *
 * Every other validation asks whether the creator's input is legal. This one asks whether the compiler
 * carried that input through faithfully. The distinction matters because the pipeline rewrites the
 * candidate several times (working-set merge, override stripping, resolution, canonicalisation) and a
 * silent drop in any of those steps would publish a specification that says less than the document it came
 * from, with nothing in the diagnostics to show it. The creator can neither see nor fix that, so it has to
 * be caught before publication and reported as a system fault rather than as their mistake.
 */
function doc(definitions: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions });
}

async function activatedModel(definitions: readonly Record<string, unknown>[]): Promise<CompiledModel> {
  const harness = createHarness();
  const result = await harness.compiler.compileAndActivate(candidate(doc(definitions)));
  expect(result.ok).toBe(true);
  const model = harness.registry.getSnapshot().model;
  if (!model) throw new Error('expected an activated model');
  return model;
}

const SCHEMA = buildSchemaVersion('1.0.0');

function damage(definitions: readonly Record<string, unknown>[], model: CompiledModel) {
  return findSemanticFieldDamage(parsedRoot(definitions), model, SCHEMA);
}

function parsedRoot(definitions: readonly Record<string, unknown>[]): JsonValue {
  return JSON.parse(doc(definitions)) as JsonValue;
}

const DEFINITIONS: readonly Record<string, unknown>[] = [
  { id: 'rule.a', kind: 'rule', iconRef: 'icon:rule' },
  { id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'rule.a', traits: ['t'], slotCount: 2 },
];

describe('a faithful activation reports no damage', () => {
  it('finds nothing to report for a model that matches its candidate', async () => {
    const model = await activatedModel(DEFINITIONS);
    expect(damage(DEFINITIONS, model)).toEqual([]);
  });

  it('tolerates a document whose definitions are absent or malformed', async () => {
    const model = await activatedModel(DEFINITIONS);
    // Shape problems are the schema pass's job; this check must not double-report them.
    expect(findSemanticFieldDamage({ definitions: 'not an array' }, model, SCHEMA)).toEqual([]);
    expect(findSemanticFieldDamage({}, model, SCHEMA)).toEqual([]);
    expect(findSemanticFieldDamage([1, 2], model, SCHEMA)).toEqual([]);
  });

  it('tolerates a presentation field that degraded to its registered fallback', async () => {
    // A damaged presentation field is allowed to fall back with a warning, so the stored value differs
    // from the declaration on purpose. Calling that damage would turn an accepted degradation into a
    // system fault and stop a compilation the specification says must succeed.
    const declared = [{ id: 'item.a', kind: 'item', iconRef: 5 }];
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc(declared)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_PRESENTATION_FALLBACK');

    const model = harness.registry.getSnapshot().model;
    if (!model) throw new Error('expected an activated model');
    expect(model.definitions['item.a']?.value['iconRef']).not.toBe(5);
    expect(damage(declared, model)).toEqual([]);
  });

  it('still reports a semantic field that changed while a presentation field degraded', async () => {
    const declared = [{ id: 'item.a', kind: 'item', iconRef: 5, slotCount: 2 }];
    const harness = createHarness();
    expect((await harness.compiler.compileAndActivate(candidate(doc(declared)))).ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    if (!model) throw new Error('expected an activated model');

    const altered = withDefinitionValue(model, 'item.a', (value) => ({ ...value, slotCount: 3 }));
    expect(damage(declared, altered))
      .toEqual([{ definitionId: 'item.a', detail: 'field slotCount changed value' }]);
  });
});

describe('every way the model can understate its candidate is detected', () => {
  it('detects a dropped field', async () => {
    const model = await activatedModel(DEFINITIONS);
    const stripped = withDefinitionValue(model, 'item.a', (value) => omit(value, 'traits'));
    expect(damage(DEFINITIONS, stripped))
      .toEqual([{ definitionId: 'item.a', detail: 'field traits was dropped' }]);
  });

  it('detects a changed value', async () => {
    const model = await activatedModel(DEFINITIONS);
    const altered = withDefinitionValue(model, 'item.a', (value) => ({ ...value, slotCount: 3 }));
    expect(damage(DEFINITIONS, altered))
      .toEqual([{ definitionId: 'item.a', detail: 'field slotCount changed value' }]);
  });

  it('detects a definition that vanished from the activated set', async () => {
    const model = await activatedModel(DEFINITIONS);
    const definitions = omit(model.definitions as Record<string, unknown>, 'item.a');
    const resolved = omit(model.resolvedDefinitions as Record<string, unknown>, 'item.a');
    const damaged = { ...model, definitions, resolvedDefinitions: resolved } as unknown as CompiledModel;
    expect(damage(DEFINITIONS, damaged))
      .toEqual([{ definitionId: 'item.a', detail: 'candidate definition is absent from the activated model' }]);
  });

  it('detects an activated definition with no resolved form', async () => {
    const model = await activatedModel(DEFINITIONS);
    const resolved = omit(model.resolvedDefinitions as Record<string, unknown>, 'item.a');
    const damaged = { ...model, resolvedDefinitions: resolved } as unknown as CompiledModel;
    expect(damage(DEFINITIONS, damaged))
      .toEqual([{ definitionId: 'item.a', detail: 'activated definition has no resolved form' }]);
  });

  it('detects transaction intent leaking into the model', async () => {
    const first = createHarness();
    expect((await first.compiler.compileAndActivate(candidate(doc(DEFINITIONS)))).ok).toBe(true);
    const overriding = DEFINITIONS.map((definition) => ({ ...definition, override: definition['id'] }));
    expect((await first.compiler.compileAndActivate(candidate(doc(overriding)))).ok).toBe(true);
    const model = first.registry.getSnapshot().model;
    if (!model) throw new Error('expected an activated model');

    // A faithful activation strips the intent, so the real model reports nothing.
    expect(damage(overriding, model)).toEqual([]);
    const leaked = withDefinitionValue(model, 'item.a', (value) => ({ ...value, override: 'item.a' }));
    expect(damage(overriding, leaked))
      .toEqual([{ definitionId: 'item.a', detail: 'transaction intent override leaked into the model' }]);
  });
});

describe('the check runs before anything is published', () => {
  it('leaves the real pipeline clean, so the gate never fires on a healthy compilation', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc(DEFINITIONS)));
    expect(result.ok).toBe(true);
    // No emergency envelope may be written when nothing is actually damaged.
    expect(harness.emergencySink.getAll()).toEqual([]);
    expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(true);
  });
});

/** Replace one definition's stored value, producing a model that understates its candidate. */
function withDefinitionValue(
  model: CompiledModel,
  id: string,
  project: (value: Record<string, unknown>) => Record<string, unknown>,
): CompiledModel {
  const original = model.definitions[id];
  if (!original) throw new Error(`missing definition ${id}`);
  const definitions = {
    ...(model.definitions as Record<string, unknown>),
    [id]: { ...original, value: project({ ...original.value }) },
  };
  return { ...model, definitions } as unknown as CompiledModel;
}

function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value)) {
    if (name === key) continue;
    copy[name] = member;
  }
  return copy;
}
