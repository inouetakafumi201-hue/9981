/**
 * Feature: l2-base-layer-spec, Property 3: 数值分类、归属与范围
 *
 * Validates Requirements 2.5, 5.1–5.8, 5.11–5.12, 8.4, 9.1, 9.6, 15.8.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { GAMEPLAY_VALUE_RANGE, GAMEPLAY_VALUE_RANGE_SOURCE } from '../../../src/l2/model/constitution.js';
import { baseDefinition, capabilityIdentity, singleDefinitionPackage, validActionContract } from '../../../src/l2/testing/builders.js';
import type { ParameterField } from '../../../src/l2/model/schema.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';

function withField(id: string, field: ParameterField): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'action',
    semanticFamily: { familyId: 'action' },
    typeIdentity: capabilityIdentity(`c-${id}`),
    familyContract: validActionContract(`${id}-effect`),
    parameterSchema: { fields: [field], crossFieldConstraints: [] },
  });
}

describe('Property 3: 数值分类、归属与范围', () => {
  it('玩家可见玩法数值范围越界被拒绝，界内通过', () => {
    fc.assert(
      fc.property(arbId, fc.integer({ min: -3, max: 12 }), (id, max) => {
        const field: ParameterField = {
          name: 'power',
          dataType: 'number',
          required: false,
          classification: 'Gameplay_Value',
          gameplayValueKind: 'duration',
          playerVisible: true,
          range: { min: 1, max },
        };
        const pkg = singleDefinitionPackage(`pkg-${id}`, withField(id, field));
        const result = validateStructure(pkg);
        const outOfRange = max > GAMEPLAY_VALUE_RANGE.max;
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE)).toBe(outOfRange);
      }),
      { numRuns: 200 },
    );
  });

  it('未分类字段一律被拒绝', () => {
    fc.assert(
      fc.property(arbId, (id) => {
        const field = {
          name: 'x',
          dataType: 'number',
          required: false,
          classification: 'nope',
        } as unknown as ParameterField;
        const pkg = singleDefinitionPackage(`pkg-${id}`, withField(id, field));
        const result = validateStructure(pkg);
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('结构边界缺来源/理由被拒绝；带齐则通过', () => {
    fc.assert(
      fc.property(arbId, fc.boolean(), fc.boolean(), (id, hasSource, hasRationale) => {
        const field: ParameterField = {
          name: 'cap',
          dataType: 'integer',
          required: false,
          classification: 'Structural_Bound',
          ...(hasSource ? { authoritativeSource: GAMEPLAY_VALUE_RANGE_SOURCE } : {}),
          ...(hasRationale ? { structuralRationale: '容量结构上限' } : {}),
        };
        const pkg = singleDefinitionPackage(`pkg-${id}`, withField(id, field));
        const result = validateStructure(pkg);
        const missingSource = hasCode(result.diagnostics, DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE);
        const missingRationale = hasCode(result.diagnostics, DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_RATIONALE);
        expect(missingSource).toBe(!hasSource);
        expect(missingRationale).toBe(!hasRationale);
      }),
      { numRuns: 200 },
    );
  });

  it('内部度量不套用玩法数值范围（大数值也不因 1–5 被拒绝）', () => {
    fc.assert(
      fc.property(arbId, fc.integer({ min: 6, max: 1000 }), (id, max) => {
        const field: ParameterField = {
          name: 'turnCount',
          dataType: 'integer',
          required: false,
          classification: 'Internal_Metric',
          internalMetricSchema: { metric: 'turn', integral: true, range: { min: 0, max } },
        };
        const pkg = singleDefinitionPackage(`pkg-${id}`, withField(id, field));
        const result = validateStructure(pkg);
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE)).toBe(false);
      }),
      { numRuns: 150 },
    );
  });
});
