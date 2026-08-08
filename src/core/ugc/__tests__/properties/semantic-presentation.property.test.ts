/**
 * Feature: wakeup-ugc, Property 10: Semantic rejection and presentation-only fallback.
 *
 * 对任意缺失或非法语义字段，验证拒绝且不改变最后有效定义。对任意合格的缺失表现资源，
 * 只有当类型兼容且回退前后语义指纹相等时回退才被接受，并附带一条指明两个资产的警告。
 *
 * **Validates: Requirement 10**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';

function gap(jsonPath: string) {
  return {
    definitionId: 'weapon:shotgun',
    jsonPath,
    missingAsset: `asset${jsonPath}`,
    expectedTypeTag: 'icon',
    sourceSpan: null,
  } as const;
}

describe('Feature: wakeup-ugc, Property 10: semantic rejection and presentation fallback', () => {
  it('accepts an eligible presentation fallback with a warning and unchanged semantics', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z]{2,8}$/), (path) => {
        const harness = createHarness({ schema: { gaps: [gap(path)] } });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
        expect(report.status).toBe('validated');
        const warnings = report.diagnostics.filter((entry) => entry.code === 'E_LOAD_PRESENTATION_FALLBACK');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.severity).toBe('warn');
        // 警告必须同时指明缺失资产与选用的回退资产（需求 10.5）。
        expect(warnings[0]?.expected).toBe(`asset${path}`);
        expect(warnings[0]?.actual).toBe('icon:placeholder');
        expect(warnings[0]?.at?.def).toBe('weapon:shotgun');
        expect(warnings[0]?.path).toBe(path);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects whenever the fallback would change the semantic fingerprint', () => {
    const harness = createHarness({ schema: { gaps: [gap('/icon')], pollutesSemantics: true } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('rejects a damaged semantic field without copying an old value or inventing a default', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z]{2,8}$/), (path) => {
        const harness = createHarness({ schema: { gaps: [gap(path)], classify: () => 'semantic' } });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
        expect(report.status).toBe('rejected');
        expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
        // 语义损坏不产生任何警告级"降级"，只产生错误（需求 10.11）。
        expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_PRESENTATION_FALLBACK')).toBe(false);
      }),
      { numRuns: 15 },
    );
  });

  it('rejects a type-incompatible fallback', () => {
    const harness = createHarness({ schema: { gaps: [gap('/icon')], fallback: { assetId: 'sound:beep', typeTag: 'sound' } } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
  });

  it('rejects a purported presentation field the schema cannot prove non-semantic', () => {
    const harness = createHarness({ schema: { gaps: [gap('/name')], provesNonSemantic: false } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
  });

  it('records the equal before/after fingerprint on every accepted fallback decision', () => {
    const harness = createHarness({ schema: { gaps: [gap('/icon'), gap('/badge')] } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('validated');
    for (const decision of report.validated?.presentationDecisions ?? []) {
      expect(decision.semanticFingerprintBefore).toBe(decision.semanticFingerprintAfter);
    }
    expect(report.validated?.presentationDecisions.length).toBe(2);
  });
});
