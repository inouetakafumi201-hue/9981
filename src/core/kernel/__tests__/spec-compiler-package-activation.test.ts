import { describe, expect, it } from 'vitest';
import { candidate, createHarness } from '../spec-compiler/__tests__/fixtures';
import type { Harness } from '../spec-compiler/__tests__/fixtures';

/**
 * Activation is a change set applied atomically to the whole active specification.
 *
 * The regression these cases guard is subtle and was real: a candidate could reference a definition that
 * only existed in the previously activated document, pass validation against it, and then publish a model
 * that no longer contained the target. Validating against a state the commit discards is worse than not
 * validating at all, because the result looks verified. Everything here therefore checks the state that
 * actually gets published, and checks that a refused change leaves that state byte-identical.
 */
function doc(definitions: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions, ...extra });
}

const RULE = { id: 'rule.damage.basic', kind: 'rule', iconRef: 'icon:rule' };
const WEAPON = { id: 'item.shotgun', kind: 'item', iconRef: 'i', damageProfile: 'rule.damage.basic' };

async function activate(
  harness: Harness,
  definitions: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<Harness['compiler']['compileAndActivate']>>> {
  return harness.compiler.compileAndActivate(candidate(doc(definitions, extra)));
}

describe('a later package joins the active set instead of replacing it', () => {
  it('keeps a cross-package reference resolvable in the published model', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE])).ok).toBe(true);
    expect((await activate(harness, [WEAPON])).ok).toBe(true);

    const model = harness.registry.getSnapshot().model;
    // Both definitions must be present, otherwise the published weapon points at nothing.
    expect(Object.keys(model?.definitions ?? {}).sort()).toEqual(['item.shotgun', 'rule.damage.basic']);
    expect(model?.dependencyGraph['item.shotgun']).toEqual(['rule.damage.basic']);
    expect(model?.inboundGraph['rule.damage.basic']).toEqual(['item.shotgun']);
    expect(harness.registry.dependents('rule.damage.basic')).toEqual(['item.shotgun']);
    expect(harness.registry.dependencies('item.shotgun')).toEqual(['rule.damage.basic']);
  });

  it('records every activated package so dependencies stay checkable', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE], { packageId: 'pkg.base' })).ok).toBe(true);
    expect((await activate(harness, [WEAPON], { packageId: 'pkg.weapons', dependencies: ['pkg.base'] })).ok).toBe(true);
    expect(Object.keys(harness.registry.packages()).sort()).toEqual(['pkg.base', 'pkg.weapons']);
    expect(harness.registry.packages()['pkg.weapons']?.dependencies).toEqual(['pkg.base']);
  });
});

describe('package dependencies must exist and must not form a cycle', () => {
  it('refuses a dependency on a package that was never activated', async () => {
    const harness = createHarness();
    const result = await activate(harness, [RULE], { dependencies: ['pkg.absent'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_REF_MISSING');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('refuses a dependency cycle between packages', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE], { packageId: 'pkg.a' })).ok).toBe(true);
    expect((await activate(harness, [WEAPON], { packageId: 'pkg.b', dependencies: ['pkg.a'] })).ok).toBe(true);

    // pkg.a now depends back on pkg.b, closing the loop.
    const result = await activate(harness, [
      { ...RULE, override: 'rule.damage.basic' },
    ], { packageId: 'pkg.a', dependencies: ['pkg.b'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_CYCLE_DEP');
    expect(harness.registry.getSnapshot().generation).toBe(2);
  });
});

describe('an inheritance cycle is found even when only one member is new', () => {
  it('refuses a cycle closed by an override of an already active definition', async () => {
    const harness = createHarness();
    expect((await activate(harness, [
      { id: 'item.a', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['a'] }, extends: ['item.b'] },
      { id: 'item.b', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['b'] } },
    ])).ok).toBe(true);

    const result = await activate(harness, [{
      id: 'item.b', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['b'] },
      extends: ['item.a'], override: 'item.b',
    }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The other member lives in a document this change never mentions, so a candidate-only walk misses it.
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_INHERITANCE_CYCLE');
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });
});

describe('removal is part of the same atomic change', () => {
  it('refuses a removal that leaves an inbound reference unresolved', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE, WEAPON])).ok).toBe(true);
    const before = harness.registry.canonicalSnapshot();

    const result = await activate(harness, [], { removals: ['rule.damage.basic'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const dangling = result.diagnostics.find((item) => item.code === 'E_LOAD_UNDEFINED_REF');
    expect(dangling?.path).toBe('/removals/0');
    expect(dangling?.relatedSources?.length).toBe(1);
    // Byte equality, not just object identity: the published state must be indistinguishable.
    expect(harness.registry.canonicalSnapshot()).toEqual(before);
  });

  it('accepts a removal that redirects the inbound reference in the same change', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE, WEAPON])).ok).toBe(true);

    const result = await activate(harness, [
      { id: 'rule.damage.alt', kind: 'rule', iconRef: 'icon:alt' },
      { ...WEAPON, damageProfile: 'rule.damage.alt', override: 'item.shotgun' },
    ], { removals: ['rule.damage.basic'] });

    expect(result.ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    expect(model?.definitions['rule.damage.basic']).toBeUndefined();
    expect(model?.definitions['rule.damage.alt']).toBeDefined();
    expect(model?.dependencyGraph['item.shotgun']).toEqual(['rule.damage.alt']);
    expect(model?.inboundGraph['rule.damage.basic']).toBeUndefined();
  });

  it('refuses removing something that is not active', async () => {
    const harness = createHarness();
    const result = await activate(harness, [], { removals: ['rule.ghost'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_REF_MISSING');
  });

  it('refuses removing and redefining the same identifier in one change', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE])).ok).toBe(true);
    const result = await activate(harness, [{ ...RULE, override: 'rule.damage.basic' }], {
      removals: ['rule.damage.basic'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_CROSS_FIELD_CONSTRAINT');
  });
});

describe('an override is revalidated against everything that depends on it', () => {
  it('refuses an override that makes an existing dependent reference illegal', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE, WEAPON])).ok).toBe(true);
    const before = harness.registry.canonicalSnapshot();

    // The replacement becomes abstract, so the weapon's reference to it is no longer instantiable.
    const result = await activate(harness, [{ ...RULE, abstract: true, override: 'rule.damage.basic' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_REF_ABSTRACT');
    expect(harness.registry.canonicalSnapshot()).toEqual(before);
  });

  it('refuses an override that changes a parent kind out from under a child', async () => {
    const harness = createHarness();
    expect((await activate(harness, [
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['b'] } },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'],
        typeIdentity: { invariants: ['c'] },
      },
    ])).ok).toBe(true);

    const result = await activate(harness, [
      { id: 'item.base', kind: 'rule', iconRef: 'i', override: 'item.base' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.diagnostics.map((item) => item.code);
    expect(codes.some((code) => code === 'E_LOAD_OVERRIDE_INVALID' || code === 'E_REF_KIND')).toBe(true);
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });

  it('still requires an explicit self-targeted override for an active identifier', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE])).ok).toBe(true);
    const result = await activate(harness, [RULE]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_OVERRIDE_INVALID');
  });

  it('drops the override intent from the published definition', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE])).ok).toBe(true);
    expect((await activate(harness, [{ ...RULE, override: 'rule.damage.basic' }])).ok).toBe(true);
    const stored = harness.registry.getSnapshot().model?.definitions['rule.damage.basic'];
    // Override is transaction intent. Keeping it would make the model describe how it was written.
    expect(stored?.value['override']).toBeUndefined();
  });
});

describe('a registry holds one layer', () => {
  it('refuses a change set that switches the owning layer', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE])).ok).toBe(true);
    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '玩法层',
      definitions: [{ id: 'item.a', kind: 'item', iconRef: 'i', damage: 3 }],
    })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Otherwise a play-layer document could merge concrete values into a class-layer specification.
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_LAYER_OWNERSHIP');
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });
});

describe('the canonical snapshot is the comparison surface', () => {
  it('is byte-identical across two hosts that activated the same content', async () => {
    const first = createHarness();
    const second = createHarness();
    await activate(first, [RULE]);
    await activate(first, [WEAPON]);
    await activate(second, [RULE]);
    await activate(second, [WEAPON]);
    expect(second.registry.canonicalSnapshot().canonicalModel)
      .toBe(first.registry.canonicalSnapshot().canonicalModel);
  });

  it('is unchanged by an infrastructure failure during publication', async () => {
    const harness = createHarness();
    expect((await activate(harness, [RULE])).ok).toBe(true);
    const before = harness.registry.canonicalSnapshot();

    harness.artifactStore.injectFailure('publish');
    const result = await activate(harness, [WEAPON]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.halted).toBe('infrastructure');
    expect(harness.registry.canonicalSnapshot()).toEqual(before);
  });

  it('reports a manifest that disagrees with what was published as partial activation', async () => {
    const harness = createHarness();
    harness.artifactStore.publishLeaksPartialState = true;
    harness.artifactStore.injectFailure('publish');
    const result = await activate(harness, [RULE]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(harness.artifactStore.verifyNoPartialGeneration().ok).toBe(false);
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });
});
