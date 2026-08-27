import { describe, expect, it } from 'vitest';
import {
  KNOWN_SEMANTIC_FAMILIES,
  SemanticFamilyError,
  SemanticFamilyRegistry,
  createSemanticFamilyRegistry,
  failedCriteria,
  satisfiesClassLayerCriteria,
} from '../spec-compiler/index';
import { candidate, createHarness, familySource } from '../spec-compiler/__tests__/fixtures';

/**
 * The semantic family register is open, and being open is not the same as being unchecked.
 *
 * A definition may only claim a registered family, a new family is accepted on the strength of the three
 * criteria plus a recorded reason, and a concept tied to one gameplay profile is refused with its layer
 * ownership named. The point of these cases is that neither half can be dropped: closing the register
 * would block legitimate growth, and dropping the criteria would let anything in.
 */
const ALL_TRUE = { enumerable: true, composable: true, gameplayIndependent: true } as const;

function doc(body: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], ...body });
}

describe('the register accepts a qualifying new family', () => {
  it('is not a closed enumeration', () => {
    const registry = createSemanticFamilyRegistry(familySource());
    expect(registry.get('weapon')).not.toBeNull();
    expect(registry.get('container')).toBeNull();

    registry.register({
      id: 'container', allowedKinds: ['item'], criteria: ALL_TRUE,
      classificationReason: '容器能力可枚举、可与物品组合，且不依赖任何具体玩法。', source: familySource(),
    });
    expect(registry.get('container')?.classificationReason).toContain('可枚举');
    expect(registry.toMap().size).toBe(KNOWN_SEMANTIC_FAMILIES.length + 1);
  });

  it('keeps the known listing ordered and kind-scoped', () => {
    const registry = createSemanticFamilyRegistry(familySource());
    const ids = [...registry.toMap().keys()];
    expect([...ids].sort()).toEqual(ids);
    expect(registry.get('vehicle')?.allowedKinds).toEqual(['entity']);
    expect(registry.get('weapon')?.allowedKinds).toEqual(['item']);
  });
});

describe('the three criteria are enforced, not decorative', () => {
  it('names exactly the criteria a proposal fails', () => {
    expect(failedCriteria(ALL_TRUE)).toEqual([]);
    expect(satisfiesClassLayerCriteria(ALL_TRUE)).toBe(true);
    expect(failedCriteria({ enumerable: false, composable: true, gameplayIndependent: false }))
      .toEqual(['enumerable', 'gameplayIndependent']);
  });

  it('refuses a host registration that does not meet the criteria', () => {
    const registry = new SemanticFamilyRegistry();
    expect(() => registry.register({
      id: 'zone', allowedKinds: ['node'], criteria: { ...ALL_TRUE, gameplayIndependent: false },
      classificationReason: '只服务大逃杀。', source: familySource(),
    })).toThrow(SemanticFamilyError);
  });

  it('refuses a registration with no reason, no kinds, or a duplicate identifier', () => {
    const registry = new SemanticFamilyRegistry();
    const base = { allowedKinds: ['item'] as const, criteria: ALL_TRUE, source: familySource() };
    expect(() => registry.register({ ...base, id: 'a', classificationReason: '   ' }))
      .toThrow(SemanticFamilyError);
    expect(() => registry.register({ ...base, allowedKinds: [], id: 'b', classificationReason: 'r' }))
      .toThrow(SemanticFamilyError);
    registry.register({ ...base, id: 'c', classificationReason: 'r' });
    expect(() => registry.register({ ...base, id: 'c', classificationReason: 'r' }))
      .toThrow(SemanticFamilyError);
  });
});

describe('a candidate may extend the register through the same gate', () => {
  it('accepts a qualifying proposal and records it in the activated model', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc({
      semanticFamilies: [{
        id: 'container', allowedKinds: ['item'], criteria: ALL_TRUE,
        classificationReason: '容器能力可枚举、可组合、不含具体玩法语义。',
      }],
      definitions: [{ id: 'item.box', kind: 'item', iconRef: 'i', semanticFamily: 'container' }],
    })));

    expect(result.ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    const registered = model?.semanticFamilies['container'];
    expect(registered?.classificationReason).toContain('可枚举');
    // Provenance travels with the registration so a later reviewer can find the justification.
    expect(registered?.source.documentUri).toContain('main.spec.json');
    expect(model?.definitions['item.box']?.semanticFamily).toBe('container');
  });
});

describe('a candidate proposal is refused when it does not qualify', () => {
  const cases: readonly {
    readonly label: string;
    readonly proposal: Record<string, unknown>;
    readonly code: string;
  }[] = [
    {
      label: 'coupled to one gameplay profile',
      proposal: {
        id: 'zone', allowedKinds: ['item'], classificationReason: '只服务大逃杀的缩圈。',
        criteria: { enumerable: true, composable: true, gameplayIndependent: false },
      },
      code: 'E_LOAD_LAYER_OWNERSHIP',
    },
    {
      label: 'not enumerable',
      proposal: {
        id: 'anything', allowedKinds: ['item'], classificationReason: '范围无法界定。',
        criteria: { enumerable: false, composable: true, gameplayIndependent: true },
      },
      code: 'E_LOAD_SCHEMA_CONTRACT',
    },
    {
      label: 'not composable',
      proposal: {
        id: 'monolith', allowedKinds: ['item'], classificationReason: '无法与其他基类组合。',
        criteria: { enumerable: true, composable: false, gameplayIndependent: true },
      },
      code: 'E_LOAD_SCHEMA_CONTRACT',
    },
    {
      label: 'missing the classification reason',
      proposal: { id: 'silent', allowedKinds: ['item'], criteria: ALL_TRUE },
      code: 'E_LOAD_REQUIRED_FIELD',
    },
    {
      label: 'declaring an unregistered kind',
      proposal: { id: 'ghost', allowedKinds: ['nonesuch'], classificationReason: 'r', criteria: ALL_TRUE },
      code: 'E_LOAD_DEF_KIND',
    },
  ];

  for (const testCase of cases) {
    it(`refuses a family ${testCase.label}`, async () => {
      const harness = createHarness();
      const before = harness.registry.getSnapshot();
      const result = await harness.compiler.compileAndActivate(candidate(doc({
        semanticFamilies: [testCase.proposal],
      })));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics.map((item) => item.code)).toContain(testCase.code);
      expect(harness.registry.getSnapshot()).toBe(before);
    });
  }
});

describe('a definition may only claim a registered, kind-compatible family', () => {
  it('refuses an unregistered family name', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc({
      definitions: [{ id: 'item.a', kind: 'item', iconRef: 'i', semanticFamily: 'invented' }],
    })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.diagnostics.find((item) => item.code === 'E_LOAD_SCHEMA_CONTRACT');
    expect(diagnostic?.path).toBe('/definitions/0/semanticFamily');
    expect(diagnostic?.actionableHint).toContain('三条判据');
  });

  it('refuses a registered family that does not accept the declared kind', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc({
      // `damage` is registered for rules, so an item may not claim it.
      definitions: [{ id: 'item.a', kind: 'item', iconRef: 'i', semanticFamily: 'damage' }],
    })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_SCHEMA_CONTRACT');
  });

  it('makes a family-typed reference check meaningful instead of vacuous', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(doc({
      definitions: [
        { id: 'rule.a', kind: 'rule', iconRef: 'i' },
        { id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'rule.a' },
      ],
    })));
    expect(result.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.definitions['rule.a']?.semanticFamily).toBe('damage');
  });
});
