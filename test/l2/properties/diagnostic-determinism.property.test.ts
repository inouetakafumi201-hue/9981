/**
 * Feature: l2-base-layer-spec, Property 9: 诊断完整性与确定性
 *
 * Validates Requirements 1.3, 1.12, 13.1–13.3, 13.8–13.12.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fingerprint } from '../../../src/l2/model/ordering.js';
import { isCompleteDiagnostic, assessRejection, structuredRejectionUnchecked } from '../../../src/l2/model/diagnostic-factory.js';
import { multiDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { arbId, INVALID_CASE_BUILDERS } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure } from '../helpers.js';
import { warningDiagnostic } from '../../../src/l2/model/diagnostic-factory.js';

describe('Property 9: 诊断完整性与确定性', () => {
  it('多个独立错误全部被收集且每条诊断字段完整', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: INVALID_CASE_BUILDERS.length - 1 }), { minLength: 2, maxLength: 4 }),
        arbId,
        (indices, idSeed) => {
          const definitions = indices.map((index, k) => INVALID_CASE_BUILDERS[index]!(`${idSeed}${k}`).definition);
          const pkg = multiDefinitionPackage('pkg', definitions);
          const result = validateStructure(pkg);
          // 每个无效定义至少贡献一条 Error。
          const errorDefs = new Set(
            result.diagnostics.filter((d) => d.severity === 'Error').map((d) => d.definitionId),
          );
          for (const definition of definitions) {
            expect(errorDefs.has(definition.id)).toBe(true);
          }
          // 每条诊断字段完整。
          for (const diagnostic of result.diagnostics) {
            expect(isCompleteDiagnostic(diagnostic)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('输入定义重排不改变诊断集合与顺序', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: INVALID_CASE_BUILDERS.length - 1 }), { minLength: 2, maxLength: 4 }),
        arbId,
        (indices, idSeed) => {
          const definitions = indices.map((index, k) => INVALID_CASE_BUILDERS[index]!(`${idSeed}${k}`).definition);
          const forward = validateStructure(multiDefinitionPackage('pkg', definitions));
          const reversed = validateStructure(multiDefinitionPackage('pkg', [...definitions].reverse()));
          expect(fingerprint(forward.diagnostics)).toBe(fingerprint(reversed.diagnostics));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('不含 Error 的拒绝被判为无效验证结果', () => {
    const onlyWarning = warningDiagnostic({
      code: 'PRESENTATION_FALLBACK_APPLIED',
      reason: 'w',
      correctionSuggestion: 's',
    });
    const rejection = structuredRejectionUnchecked([onlyWarning]);
    const assessment = assessRejection(rejection);
    expect(assessment.valid).toBe(false);
    expect(assessment.diagnostic).toBeDefined();
  });
});
