/**
 * Feature: wakeup-ugc, Property 14: Diagnostic completeness and determinism.
 *
 * 对任意含独立可发现错误的候选，报告包含剩余配额允许的所有错误、scope 正确的字段、稳定代码、
 * 可行动 hint、确定性排序与显式的 skipped-check 根链接。每个拒绝都含错误；警告永不掩盖语义失败。
 *
 * **Validates: Requirement 14**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { requestFrom, validCandidateText } from '../../testing/generators';

describe('Feature: wakeup-ugc, Property 14: diagnostic completeness and determinism', () => {
  it('reports every independently discoverable error in one result', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (count) => {
        const errors = Array.from({ length: count }, (_value, index) => ({
          definitionId: `def:${String(index)}`,
          jsonPath: `/field${String(index)}`,
          condition: 'unknown-field' as const,
        }));
        const harness = createHarness({ validator: { errors } });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
        expect(report.status).toBe('rejected');
        expect(report.diagnostics.filter((entry) => entry.code === 'E_LOAD_UNKNOWN_FIELD')).toHaveLength(count);
      }),
      { numRuns: 12 },
    );
  });

  it('produces a byte-identical ordering regardless of the input error order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{2,6}$/), { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 0, max: 100 }),
        (fields, seed) => {
          const build = (order: readonly string[]) =>
            createHarness({
              validator: {
                errors: order.map((field) => ({ definitionId: `def:${field}`, jsonPath: `/${field}`, condition: 'unknown-field' as const })),
              },
            });
          const signature = (order: readonly string[]) =>
            build(order)
              .facade.validate(requestFrom(validCandidateText(), 'hand-authored'))
              .diagnostics.map((entry) => `${entry.code}|${entry.at?.def ?? '-'}|${entry.path ?? '-'}`)
              .join('#');

          const rotate = seed % fields.length;
          const permuted = [...fields.slice(rotate), ...fields.slice(0, rotate)];
          expect(signature(permuted)).toBe(signature(fields));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('fills scope-correct fields for every diagnostic', () => {
    const harness = createHarness({ validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/x', condition: 'unknown-field' }] } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    for (const diagnostic of report.diagnostics) {
      expect(diagnostic.scope).toBeDefined();
      expect(diagnostic.reason).toBeTruthy();
      expect(diagnostic.correctionSuggestion).toBeTruthy();
      if (diagnostic.scope === 'definition') {
        expect(diagnostic.at?.def).toBeTruthy();
        expect(diagnostic.path).toBeTruthy();
      }
      if (diagnostic.scope === 'document' || diagnostic.scope === 'change-set') {
        // 非 definition scope 的定位必须是显式 null，不得编造定义标识（需求 14.4）。
        expect(diagnostic.at).toBeNull();
      }
    }
  });

  it('gives every rejection at least one error-severity diagnostic', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('{', '{"schemaVersion":', '{"a":1,"a":2}', '{"schemaVersion":"9.9.9"}'),
        (text) => {
          const harness = createHarness();
          const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
          if (report.status === 'rejected') {
            expect(report.diagnostics.some((entry) => entry.severity === 'error' || entry.severity === 'fatal')).toBe(true);
          }
        },
      ),
      { numRuns: 4 },
    );
  });

  it('links every skipped check to a concrete blocking diagnostic', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestFrom('{"schemaVersion":', 'hand-authored'));
    expect(report.skippedChecks.length).toBeGreaterThan(0);
    const rootIds = new Set(report.diagnostics.map((entry) => entry.rootCauseId).filter(Boolean));
    for (const skipped of report.skippedChecks) {
      expect(skipped.blockedByDiagnosticId).not.toBe('unknown');
      expect(rootIds.has(skipped.blockedByDiagnosticId)).toBe(true);
    }
  });

  it('never downgrades a semantic failure to a warning', () => {
    const harness = createHarness({ schema: { gaps: [{ definitionId: 'weapon:shotgun', jsonPath: '/rule', missingAsset: 'r', expectedTypeTag: 'icon', sourceSpan: null }], classify: () => 'semantic' } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    const semantic = report.diagnostics.find((entry) => entry.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED');
    expect(semantic?.severity).toBe('error');
  });
});
