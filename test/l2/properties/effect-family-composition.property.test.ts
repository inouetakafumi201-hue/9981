/**
 * Feature: l2-base-layer-spec, Property 14: 动作与效果类的无玩法值组合
 *
 * Validates Requirements 6.1–6.5, 8.1–8.7, 9.1–9.10, 10.1, 10.4–10.6.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { baseDefinition, capabilityIdentity, singleDefinitionPackage, typedRef, validDamageContract, validStatusContract } from '../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import type { StatusContract } from '../../../src/l2/model/family-contracts.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';

describe('Property 14: 动作与效果类的无玩法值组合', () => {
  it('伤害分配具体数值被拒绝，纯接口通过', () => {
    fc.assert(
      fc.property(arbId, fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined }), (idRaw, amount) => {
        const id = `d${idRaw}`;
        const contract = validDamageContract(`${id}-p`);
        const withAmount = amount === undefined ? contract : { ...contract, amount };
        const def: CandidateDefinition = baseDefinition({
          id,
          defKind: 'rule',
          semanticFamily: { familyId: 'damage' },
          typeIdentity: capabilityIdentity(`dmg-${id}`),
          familyContract: withAmount,
        });
        const result = validateStructure(singleDefinitionPackage('pkg', def));
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.DAMAGE_ASSIGNS_AMOUNT)).toBe(amount !== undefined);
      }),
      { numRuns: 200 },
    );
  });

  it('状态交互无 interaction-rule 被拒绝', () => {
    fc.assert(
      fc.property(arbId, fc.boolean(), (idRaw, withRule) => {
        const id = `s${idRaw}`;
        const base = validStatusContract(`${id}-e`) as StatusContract;
        const contract: StatusContract = {
          ...base,
          interactions: [
            {
              interactionId: 'i1',
              counterpartRef: typedRef(`${id}-other`, 'status', { defKind: 'attachment', semanticFamily: 'status' }),
              ...(withRule ? { interactionRuleRef: typedRef(`${id}-rule`, 'rule', { defKind: 'rule' }) } : {}),
            },
          ],
        };
        const def: CandidateDefinition = baseDefinition({
          id,
          defKind: 'attachment',
          semanticFamily: { familyId: 'status' },
          typeIdentity: capabilityIdentity(`st-${id}`),
          familyContract: contract,
        });
        const result = validateStructure(singleDefinitionPackage('pkg', def));
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.STATUS_INTERACTION_WITHOUT_RULE)).toBe(!withRule);
      }),
      { numRuns: 200 },
    );
  });

  it('L1 运行时迁移伪装成状态被拒绝', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `r${idRaw}`;
        const base = validStatusContract(`${id}-e`) as StatusContract;
        const contract: StatusContract = { ...base, representsL1RuntimeTransition: true, reusableGameplaySemantics: false };
        const def: CandidateDefinition = baseDefinition({
          id,
          defKind: 'attachment',
          semanticFamily: { familyId: 'status' },
          typeIdentity: capabilityIdentity(`st-${id}`),
          familyContract: contract,
        });
        const result = validateStructure(singleDefinitionPackage('pkg', def));
        expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.LAYER_L1_RUNTIME_STATE)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
