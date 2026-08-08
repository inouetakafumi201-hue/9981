/**
 * Feature: l2-base-layer-spec, Property 13: 空间附属关系与生命周期
 *
 * Validates Requirements 7.3–7.6, 7.9, 7.12–7.13.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { baseDefinition, capabilityIdentity, singleDefinitionPackage, typedRef } from '../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import type { MicroSceneContract } from '../../../src/l2/model/family-contracts.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';

function microScene(id: string, overrides: Partial<MicroSceneContract>): CandidateDefinition {
  const contract: MicroSceneContract = {
    contractKind: 'micro-scene',
    parent: typedRef(`${id}-parent`, 'node', { defKind: 'node', semanticFamily: 'natural-scene' }),
    creator: { creatorEntityRef: 'e:1', immutable: true },
    occupancyContractRef: typedRef(`${id}-occ`, 'rule', { defKind: 'rule' }),
    lifecycleDeterminants: ['valid-parent', 'occupancy'],
    ...overrides,
  };
  return baseDefinition({
    id,
    defKind: 'node',
    semanticFamily: { familyId: 'micro-scene' },
    typeIdentity: capabilityIdentity(`ms-${id}`),
    familyContract: contract,
  });
}

describe('Property 13: 空间附属关系与生命周期', () => {
  it('合法微型场景（唯一父级 + 双生命周期依据 + 不可变 creator）通过', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `m${idRaw}`;
        const pkg = singleDefinitionPackage('pkg', microScene(id, {}));
        const result = validateStructure(pkg);
        const spatialErrors = result.diagnostics.filter(
          (d) => d.severity === 'Error' && d.code.startsWith('SPACE_'),
        );
        expect(spatialErrors).toHaveLength(0);
      }),
      { numRuns: 150 },
    );
  });

  it('使用 owner 字段作为归属依据被拒绝', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `m${idRaw}`;
        const pkg = singleDefinitionPackage('pkg', microScene(id, { ownerField: 'ownerEntity' }));
        const result = validateStructure(pkg);
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_OWNER_SEMANTICS)).toBe(true);
      }),
      { numRuns: 120 },
    );
  });

  it('可变 creator 被拒绝', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `m${idRaw}`;
        const pkg = singleDefinitionPackage('pkg', microScene(id, { creator: { creatorEntityRef: 'e:1', immutable: false } }));
        const result = validateStructure(pkg);
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SPACE_CREATOR_MUTABLE)).toBe(true);
      }),
      { numRuns: 120 },
    );
  });

  it('生命周期依据缺 occupancy 被拒绝', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `m${idRaw}`;
        const pkg = singleDefinitionPackage('pkg', microScene(id, { lifecycleDeterminants: ['valid-parent'] }));
        const result = validateStructure(pkg);
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_MISSING_OCCUPANCY)).toBe(true);
      }),
      { numRuns: 120 },
    );
  });
});
