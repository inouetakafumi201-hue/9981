import { describe, expect, it } from 'vitest';
import type { DefKind } from '../state/def';
import {
  DEFAULT_TECHNICAL_QUOTAS,
  SchemaContractError,
  SchemaRegistry,
  assertSchemaNumericContract,
  collectNumericSchemaIssues,
} from '../spec-compiler/index';
import type { DefinitionSchema, FieldRule, SchemaVersion } from '../spec-compiler/index';
import { buildSchemaVersion, candidate, createHarness, familySource } from '../spec-compiler/__tests__/fixtures';

/**
 * Parameter_Field classification.
 *
 * Every numeric field must be exactly one of gameplay value, structural bound, constitutional constant or
 * internal metric, and the classification has to carry the obligations that come with it. These cases are
 * written to fail if any branch is relaxed: an unclassified number, an unsourced bound, a bound that does
 * not list the field it governs, or a metric with no schema of its own must all be refused.
 */
function schemaWith(rule: FieldRule): DefinitionSchema {
  return { kind: 'rule', semanticFamily: 'damage', fields: { probe: rule } };
}

function versionWith(rule: FieldRule): SchemaVersion {
  const base = buildSchemaVersion('1.0.0');
  const schemas = new Map<DefKind, DefinitionSchema>(base.definitionSchemas);
  schemas.set('rule', schemaWith(rule));
  return { ...base, definitionSchemas: schemas };
}

function doc(definitions: readonly Record<string, unknown>[], targetLayer = '基类层'): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer, definitions });
}

describe('Parameter_Field: the four classifications are the only accepted ones', () => {
  it('refuses to register a numeric field with no classification', () => {
    expect(() => assertSchemaNumericContract(schemaWith({ type: 'number' })))
      .toThrow(SchemaContractError);
  });

  it('accepts each of the four classifications when its obligations are met', () => {
    const provenance = {
      sourceId: 'doc:constitution', owningLayer: '基类层' as const,
      affectedFields: ['probe'], rationale: '结构性约束。',
    };
    const rules: readonly FieldRule[] = [
      { type: 'number', numericOwnership: 'gameplay-value' },
      { type: 'number', numericOwnership: 'structural-bound', boundProvenance: provenance },
      { type: 'number', numericOwnership: 'constitutional-constant', boundProvenance: provenance },
      { type: 'number', numericOwnership: 'internal-metric', integer: true },
    ];
    for (const rule of rules) expect(collectNumericSchemaIssues(rule, 'probe', 'probe')).toEqual([]);
  });
});

describe('Parameter_Field: a normative bound must be sourced', () => {
  const cases: readonly { readonly label: string; readonly rule: FieldRule }[] = [
    {
      label: 'structural bound with no provenance at all',
      rule: { type: 'number', numericOwnership: 'structural-bound' },
    },
    {
      label: 'constitutional constant with an empty rationale',
      rule: {
        type: 'number', numericOwnership: 'constitutional-constant',
        boundProvenance: { sourceId: 'doc:x', owningLayer: '基类层', affectedFields: ['probe'], rationale: '  ' },
      },
    },
    {
      label: 'bound that does not list the field it governs',
      rule: {
        type: 'number', numericOwnership: 'structural-bound',
        boundProvenance: { sourceId: 'doc:x', owningLayer: '基类层', affectedFields: ['other'], rationale: 'r' },
      },
    },
    {
      label: 'bound with an empty source identifier',
      rule: {
        type: 'number', numericOwnership: 'structural-bound',
        boundProvenance: { sourceId: '', owningLayer: '基类层', affectedFields: ['probe'], rationale: 'r' },
      },
    },
    {
      label: 'technical quota that is not engine owned',
      rule: {
        type: 'number', numericOwnership: 'technical-quota',
        boundProvenance: { sourceId: 'doc:x', owningLayer: '基类层', affectedFields: ['probe'], rationale: 'r' },
      },
    },
    {
      label: 'internal metric with no unit, integer flag or range',
      rule: { type: 'number', numericOwnership: 'internal-metric' },
    },
    {
      label: 'gameplay value whose declared maximum leaves the constitutional range',
      rule: { type: 'number', numericOwnership: 'gameplay-value', maximum: 9 },
    },
  ];

  for (const testCase of cases) {
    it(`refuses ${testCase.label}`, () => {
      expect(collectNumericSchemaIssues(testCase.rule, 'probe', 'probe').length).toBeGreaterThan(0);
      expect(() => new SchemaRegistry().register(versionWith(testCase.rule))).toThrow(SchemaContractError);
    });
  }
});

describe('Parameter_Field: nested rules are classified too', () => {
  it('finds an unclassified number inside an array item', () => {
    const rule: FieldRule = { type: 'array', item: { type: 'number' } };
    expect(collectNumericSchemaIssues(rule, 'probe', 'probe').length).toBeGreaterThan(0);
  });

  it('finds an unsourced bound inside a nested object', () => {
    const rule: FieldRule = {
      type: 'object',
      properties: { depth: { type: 'number', numericOwnership: 'structural-bound' } },
    };
    const issues = collectNumericSchemaIssues(rule, 'probe', 'probe');
    expect(issues.some((issue) => issue.includes('probe/depth'))).toBe(true);
  });
});

describe('Parameter_Field: classification decides the runtime check', () => {
  it('keeps a concrete gameplay value out of the class layer', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      doc([{ id: 'item.a', kind: 'item', iconRef: 'i', damage: 3 }])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_LAYER_OWNERSHIP');
  });

  it('bounds a play-layer gameplay value by the constitutional range', async () => {
    for (const [value, expected] of [[1, true], [5, true], [0, false], [6, false]] as const) {
      const harness = createHarness();
      const result = await harness.compiler.compileAndActivate(candidate(
        doc([{ id: 'item.a', kind: 'item', iconRef: 'i', damage: value }], '玩法层')));
      expect(result.ok, `damage ${value}`).toBe(expected);
      if (!result.ok) {
        expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_GAMEPLAY_VALUE_RANGE');
      }
    }
  });

  it('lets an internal metric leave the 1-5 range because its schema decides instead', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      doc([{ id: 'item.a', kind: 'item', iconRef: 'i', turnIndex: 40 }])));
    expect(result.ok).toBe(true);
  });

  it('still applies the internal metric schema it declared', async () => {
    const harness = createHarness();
    const result = await harness.compiler.compileAndActivate(candidate(
      doc([{ id: 'item.a', kind: 'item', iconRef: 'i', turnIndex: 1.5 }])));
    expect(result.ok).toBe(false);
  });
});

describe('implementation constants are host configuration, not normative constants', () => {
  it('takes the identifier length ceiling from the injected quotas', async () => {
    const long = `item.${'a'.repeat(40)}`;
    const permissive = await createHarness().compiler.compileAndActivate(candidate(
      doc([{ id: long, kind: 'item', iconRef: 'i' }])));
    expect(permissive.ok).toBe(true);

    const strict = createHarness({ quotas: { identifierLength: 10 } });
    const result = await strict.compiler.compileAndActivate(candidate(
      doc([{ id: long, kind: 'item', iconRef: 'i' }])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The ceiling has to be the host's, otherwise it would be an unsourced constant baked into the layer.
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_IDENTIFIER_INVALID');
  });

  it('exposes the default quotas as plain host resource limits', () => {
    expect(DEFAULT_TECHNICAL_QUOTAS.identifierLength).toBeGreaterThan(0);
    expect(DEFAULT_TECHNICAL_QUOTAS.packageDependencyEdges).toBeGreaterThan(0);
    // Frozen so a caller cannot mutate the shared defaults into a different contract.
    expect(Object.isFrozen(DEFAULT_TECHNICAL_QUOTAS)).toBe(true);
  });

  it('registers the fixture schema through the contract check without complaint', () => {
    const registry = new SchemaRegistry();
    expect(() => registry.register(buildSchemaVersion('1.0.0'))).not.toThrow();
    expect(familySource().owningLayer).toBe('基类层');
  });
});
