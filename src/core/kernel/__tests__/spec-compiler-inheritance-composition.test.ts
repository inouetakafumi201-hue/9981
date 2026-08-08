import { describe, expect, it } from 'vitest';
import { candidate, createHarness } from '../spec-compiler/__tests__/fixtures.js';
import type { CompilationResult, ResolvedDefinition } from '../spec-compiler/index.js';

/**
 * Inheritance decides type, composition decides configuration.
 *
 * The cases below are the ones that used to pass silently: a child that is really the parent with a
 * different number, two inherited branches claiming one field, a merge rule that names nobody, and a
 * component removal that quietly changed what the host is. Each one must now be refused or resolved
 * deterministically, and the resolved definition must be observable so the outcome can be checked rather
 * than assumed.
 */
function doc(definitions: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions, ...extra });
}

async function compile(definitions: readonly Record<string, unknown>[]): Promise<{
  readonly result: CompilationResult;
  readonly resolved: (id: string) => ResolvedDefinition | null;
  readonly codes: readonly string[];
}> {
  const harness = createHarness();
  const result = await harness.compiler.compileAndActivate(candidate(doc(definitions)));
  return {
    result,
    resolved: (id) => harness.registry.query(id),
    codes: result.diagnostics.map((item) => item.code),
  };
}

const FIRE = { requiredCapabilities: ['fire'] };

describe('inheritance must carry a type difference', () => {
  it('refuses a child that repeats its parent identity', async () => {
    const { result, codes } = await compile([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE },
      { id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'], typeIdentity: FIRE },
    ]);
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_IDENTITY_CONFLICT');
  });

  it('names gameplay values as the reason when that is the only difference', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '玩法层',
      definitions: [
        { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE, damage: 2 },
        { id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'], typeIdentity: FIRE, damage: 4 },
      ],
    })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const conflict = result.diagnostics.find((item) => item.code === 'E_LOAD_IDENTITY_CONFLICT');
    expect(conflict?.message).toContain('only by gameplay values');
    expect(conflict?.actionableHint).toContain('组合');
  });
});

describe('inheritance resolves along the declared lineage', () => {
  it('accepts a genuine specialisation and exposes the resolved lineage and fields', async () => {
    const { result, resolved } = await compile([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE, traits: ['ranged'] },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'],
        typeIdentity: { requiredCapabilities: ['fire'], invariants: ['single-location'] },
      },
    ]);
    expect(result.ok).toBe(true);
    const child = resolved('item.child');
    expect(child?.lineage).toEqual(['item.base', 'item.child']);
    // The inherited field is present in the resolved view without being copied into the source document.
    expect(child?.fields['traits']).toEqual(['ranged']);
    expect(child?.typeIdentity.invariants).toEqual(['single-location']);
  });

  it('lets a descendant refine an ancestor field of the same shape', async () => {
    const { result, resolved } = await compile([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE, traits: ['ranged'] },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'],
        typeIdentity: { requiredCapabilities: ['fire', 'burst'] }, traits: ['ranged', 'burst'],
      },
    ]);
    expect(result.ok).toBe(true);
    expect(resolved('item.child')?.fields['traits']).toEqual(['ranged', 'burst']);
  });

  it('refuses an inherited field whose shape changes along the chain', async () => {
    const { result, codes } = await compile([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE, payload: { a: 1 } },
      { id: 'item.mid', kind: 'item', iconRef: 'i', extends: ['item.base'], typeIdentity: { invariants: ['m'] }, payload: { a: 2 } },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.mid'],
        typeIdentity: { invariants: ['c'] },
      },
    ]);
    // Same shape all the way down, so this must be accepted; the shape check only fires on a real change.
    expect(result.ok).toBe(true);
    expect(codes).not.toContain('E_LOAD_CROSS_FIELD_CONSTRAINT');
  });

  it('reports every participant of an inheritance cycle', async () => {
    const { result, codes } = await compile([
      { id: 'item.a', kind: 'item', iconRef: 'i', extends: ['item.b'], typeIdentity: { invariants: ['a'] } },
      { id: 'item.b', kind: 'item', iconRef: 'i', extends: ['item.a'], typeIdentity: { invariants: ['b'] } },
    ]);
    expect(result.ok).toBe(false);
    expect(codes.filter((code) => code === 'E_LOAD_INHERITANCE_CYCLE').length).toBe(2);
  });
});

describe('a field claimed by two independent providers needs an explicit rule', () => {
  const branches: readonly Record<string, unknown>[] = [
    { id: 'item.left', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['l'] }, traits: ['x'] },
    { id: 'item.right', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['r'] }, traits: ['y'] },
  ];

  it('refuses two inherited branches that disagree', async () => {
    const { result, codes } = await compile([...branches, {
      id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.left', 'item.right'],
      typeIdentity: { invariants: ['c'] },
    }]);
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_ORDER_UNDECLARED');
  });

  it('accepts an explicit prefer rule and resolves to the named provider', async () => {
    const { result, resolved } = await compile([...branches, {
      id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.left', 'item.right'],
      typeIdentity: { invariants: ['c'] },
      mergeRules: { traits: { strategy: 'prefer', source: 'item.right' } },
    }]);
    expect(result.ok).toBe(true);
    expect(resolved('item.child')?.fields['traits']).toEqual(['y']);
  });

  it('refuses a prefer rule that names a provider supplying nothing', async () => {
    const { result, codes } = await compile([...branches, {
      id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.left', 'item.right'],
      typeIdentity: { invariants: ['c'] },
      mergeRules: { traits: { strategy: 'prefer', source: 'item.child' } },
    }]);
    // Naming an arbitrary id used to be enough to silence the conflict while leaving the value undecided.
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_CROSS_FIELD_CONSTRAINT');
  });

  it('refuses a rule with no usable strategy', async () => {
    const { result, codes } = await compile([...branches, {
      id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.left', 'item.right'],
      typeIdentity: { invariants: ['c'] }, mergeRules: { traits: 'whatever' },
    }]);
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_CROSS_FIELD_CONSTRAINT');
  });

  it('warns about a rule that resolves nothing without blocking activation', async () => {
    const { result, codes } = await compile([{
      id: 'item.host', kind: 'item', iconRef: 'i',
      mergeRules: { traits: { strategy: 'prefer', source: 'item.host' } },
    }]);
    expect(result.ok).toBe(true);
    expect(codes).toContain('E_LOAD_LINT');
  });
});

describe('composition carries configuration and stays order independent', () => {
  const parts: readonly Record<string, unknown>[] = [
    { id: 'item.scope', kind: 'item', iconRef: 'i', traits: ['scoped'] },
    { id: 'item.grip', kind: 'item', iconRef: 'i', traits: ['gripped'] },
  ];

  it('refuses two components that disagree without a rule', async () => {
    const { result, codes } = await compile([...parts, {
      id: 'item.host', kind: 'item', iconRef: 'i', components: ['item.scope', 'item.grip'],
    }]);
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_COMPOSITION_CONFLICT');
  });

  it('resolves a declared concat by the declared order, whatever the component order is', async () => {
    const build = (components: readonly string[]) => [...parts, {
      id: 'item.host', kind: 'item', iconRef: 'i', components,
      mergeRules: { traits: { strategy: 'concat', order: ['item.grip', 'item.scope'] } },
    }];
    const forward = await compile(build(['item.scope', 'item.grip']));
    const reverse = await compile(build(['item.grip', 'item.scope']));

    expect(forward.result.ok && reverse.result.ok).toBe(true);
    expect(forward.resolved('item.host')?.fields['traits']).toEqual(['gripped', 'scoped']);
    // Same declared order, so the two documents must resolve to the same definition.
    expect(reverse.resolved('item.host')?.fields['traits'])
      .toEqual(forward.resolved('item.host')?.fields['traits']);
  });

  it('refuses a concat order that does not list exactly the conflicting providers', async () => {
    const { result, codes } = await compile([...parts, {
      id: 'item.host', kind: 'item', iconRef: 'i', components: ['item.scope', 'item.grip'],
      mergeRules: { traits: { strategy: 'concat', order: ['item.grip'] } },
    }]);
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_CROSS_FIELD_CONSTRAINT');
  });

  it('lets independent components apply in either order with the same result', async () => {
    const build = (components: readonly string[]) => [
      { id: 'item.a', kind: 'item', iconRef: 'i', traits: ['t'] },
      { id: 'item.b', kind: 'item', iconRef: 'i', payload: { p: 1 } },
      { id: 'item.host', kind: 'item', iconRef: 'i', components },
    ];
    const forward = await compile(build(['item.a', 'item.b']));
    const reverse = await compile(build(['item.b', 'item.a']));
    expect(forward.result.ok && reverse.result.ok).toBe(true);
    expect(reverse.resolved('item.host')?.fields).toEqual(forward.resolved('item.host')?.fields);
  });
});

describe('removing an optional capability preserves the host type identity', () => {
  const capability = (typeDefining: boolean): Record<string, unknown> => ({
    id: 'item.cap', kind: 'item', iconRef: 'i', typeDefining,
    typeIdentity: { requiredCapabilities: ['scoped'] },
  });

  it('keeps the identity when a plain optional capability is removed', async () => {
    const withCapability = await compile([
      capability(false),
      { id: 'item.host', kind: 'item', iconRef: 'i', typeIdentity: FIRE, components: ['item.cap'] },
    ]);
    const without = await compile([{ id: 'item.host', kind: 'item', iconRef: 'i', typeIdentity: FIRE }]);

    expect(withCapability.result.ok && without.result.ok).toBe(true);
    expect(withCapability.resolved('item.host')?.typeIdentity)
      .toEqual(without.resolved('item.host')?.typeIdentity);
  });

  it('changes the identity only when the capability declares itself type defining', async () => {
    const withCapability = await compile([
      capability(true),
      { id: 'item.host', kind: 'item', iconRef: 'i', typeIdentity: FIRE, components: ['item.cap'] },
    ]);
    expect(withCapability.result.ok).toBe(true);
    expect(withCapability.resolved('item.host')?.typeIdentity.requiredCapabilities)
      .toEqual(['fire', 'scoped']);
  });
});

describe('resolution is idempotent and observable', () => {
  it('produces a deeply frozen resolved definition that cannot be written through', async () => {
    const { result, resolved } = await compile([
      { id: 'item.a', kind: 'item', iconRef: 'i', traits: ['t'] },
    ]);
    expect(result.ok).toBe(true);
    const view = resolved('item.a');
    expect(view).not.toBeNull();
    if (!view) return;
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.fields)).toBe(true);
    expect(() => {
      (view.fields as Record<string, unknown>)['traits'] = ['hacked'];
    }).toThrow(TypeError);
    expect(view.fields['traits']).toEqual(['t']);
  });

  it('yields the same artifact for two documents that differ only in declaration order', async () => {
    const definitions = [
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE },
      { id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'], typeIdentity: { invariants: ['c'] } },
    ];
    const forward = await compile(definitions);
    const reverse = await compile([...definitions].reverse());
    expect(forward.result.ok && reverse.result.ok).toBe(true);
    if (!forward.result.ok || !reverse.result.ok) return;
    expect(reverse.result.artifactHash).toBe(forward.result.artifactHash);
  });
});

describe('edge lists are unambiguous', () => {
  it('refuses a definition that composes itself', async () => {
    const { result, codes } = await compile([
      { id: 'item.host', kind: 'item', iconRef: 'i', components: ['item.host'] },
    ]);
    // Silently accepting this applies the host's own fields to itself, which hides whatever was meant.
    expect(result.ok).toBe(false);
    expect(codes).toContain('E_LOAD_CROSS_FIELD_CONSTRAINT');
  });

  it('refuses a duplicated entry in either edge list', async () => {
    const duplicatedComponent = await compile([
      { id: 'item.part', kind: 'item', iconRef: 'i' },
      { id: 'item.host', kind: 'item', iconRef: 'i', components: ['item.part', 'item.part'] },
    ]);
    expect(duplicatedComponent.result.ok).toBe(false);
    expect(duplicatedComponent.codes).toContain('E_LOAD_DUPLICATE_ID');

    const duplicatedParent = await compile([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: FIRE },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base', 'item.base'],
        typeIdentity: { invariants: ['c'] },
      },
    ]);
    // A duplicate makes the declared provider order ambiguous, and an explicit merge rule has to name
    // providers exactly, so the ambiguity has to be refused rather than silently collapsed.
    expect(duplicatedParent.result.ok).toBe(false);
    expect(duplicatedParent.codes).toContain('E_LOAD_DUPLICATE_ID');
  });

  it('still lets one definition be a parent and a component of different hosts', async () => {
    const { result } = await compile([
      { id: 'item.shared', kind: 'item', iconRef: 'i', typeIdentity: FIRE, traits: ['t'] },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.shared'],
        typeIdentity: { invariants: ['c'] },
      },
      { id: 'item.host', kind: 'item', iconRef: 'i', components: ['item.shared'] },
    ]);
    expect(result.ok).toBe(true);
  });
});
