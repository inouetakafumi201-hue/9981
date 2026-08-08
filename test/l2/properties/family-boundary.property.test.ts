/**
 * Feature: l2-base-layer-spec, Property 2: 语义族三判据与层级边界
 *
 * Validates Requirements 2.1–2.8, 4.1–4.6, 5.2, 5.8, 16.3.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import {
  arbId,
  validActionDefinition,
  invalidDefKind,
  l1MechanismRedefinition,
  gameplaySpecificRuleCase,
  unregisteredFamilyCase,
  deprecatedTermCase,
} from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';
import { qualifyProposedFamily } from '../../../src/l2/compiler/source-classifier.js';
import type { FamilyEligibilityEvidence } from '../../../src/l2/model/source.js';

describe('Property 2: 语义族三判据与层级边界', () => {
  it('已知族的最小合法定义通过结构验证', () => {
    fc.assert(
      fc.property(arbId, (id) => {
        const pkg = singleDefinitionPackage(`pkg-${id}`, validActionDefinition(id));
        const result = validateStructure(pkg);
        expect(result.diagnostics.filter((d) => d.severity === 'Error')).toHaveLength(0);
      }),
      { numRuns: 150 },
    );
  });

  it('三判据全部成立当且仅当接受登记', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (enumerable, composable, gameplayIndependent) => {
          const evidence: FamilyEligibilityEvidence = {
            conceptId: 'candidate-family',
            enumerable,
            composable,
            gameplayIndependent,
            enumerationRationale: 'r1',
            compositionRationale: 'r2',
            independenceRationale: 'r3',
            sources: [],
          };
          const verdict = qualifyProposedFamily(evidence);
          expect(verdict.accepted).toBe(enumerable && composable && gameplayIndependent);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('各类越层/术语/未登记定义都产生对应结构化拒绝', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.constantFrom(
          invalidDefKind,
          l1MechanismRedefinition,
          gameplaySpecificRuleCase,
          unregisteredFamilyCase,
          deprecatedTermCase,
        ),
        (id, builder) => {
          const { definition, expectedCode } = builder(id);
          const pkg = singleDefinitionPackage(`pkg-${id}`, definition);
          const result = validateStructure(pkg);
          expect(hasCode(result.diagnostics, expectedCode)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
