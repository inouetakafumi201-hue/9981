/**
 * Feature: wakeup-ugc, Property 3: Source-route equivalence and no bypass.
 *
 * 同一基线下，等价的手写、编辑器与自然语言候选产生等价的语义诊断与规范化输出；
 * 只改变来源种类不能让输出被标记为已验证、不能抑制错误、也不能激活它。
 *
 * **Validates: Requirement 3**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { arbitraryValidCandidate, candidateForPattern, requestFrom, sourceKindArbitrary } from '../../testing/generators';
import { diagnosticsEquivalent, sortDiagnostics } from '../../diagnostics/sort';
import { ALL_ADAPTERS } from '../../adapter/adapters';

describe('Feature: wakeup-ugc, Property 3: source-route equivalence', () => {
  it('gives equivalent canonical identity for equivalent bytes from any source kind', () => {
    fc.assert(
      fc.property(arbitraryValidCandidate(), (generated) => {
        const harness = createHarness();
        const identities = ALL_ADAPTERS.map((adapter) => {
          const report = harness.facade.validate(requestFrom(generated.text, adapter.sourceKind));
          return {
            candidate: report.candidateFingerprint,
            request: report.changeRequestFingerprint,
            status: report.status,
          };
        });
        expect(new Set(identities.map((entry) => entry.candidate)).size).toBe(1);
        // 来源种类不参与请求绑定，因此请求身份也必须相同。
        expect(new Set(identities.map((entry) => entry.request)).size).toBe(1);
        expect(new Set(identities.map((entry) => entry.status)).size).toBe(1);
      }),
      { numRuns: 30 },
    );
  });

  it('gives equivalent diagnostics in the same order for equivalent invalid candidates', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('json-syntax' as const, 'duplicate-member' as const, 'prohibited-construct' as const, 'missing-schema-version' as const),
        (pattern) => {
          const harness = createHarness();
          const generated = candidateForPattern(pattern);
          const perSource = ALL_ADAPTERS.map((adapter) =>
            sortDiagnostics(harness.facade.validate(requestFrom(generated.text, adapter.sourceKind)).diagnostics),
          );
          const reference = perSource[0];
          if (reference === undefined) return;
          for (const other of perSource.slice(1)) {
            // 忽略合法不同的来源身份，但不忽略 code/severity/scope/path/reason class/顺序。
            expect(diagnosticsEquivalent(reference, other)).toBe(true);
          }
        },
      ),
      { numRuns: 4 },
    );
  });

  it('changing only the source kind never suppresses an error or grants activation', () => {
    fc.assert(
      fc.property(sourceKindArbitrary(), (sourceKind) => {
        const harness = createHarness({
          validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/x', condition: 'unknown-field' }] },
        });
        const report = harness.facade.validate(requestFrom(candidateForPattern('unknown-field').text, sourceKind));
        expect(report.status).toBe('rejected');
        expect(report.validated).toBeNull();
        expect(report.diagnostics.some((entry) => entry.severity === 'error')).toBe(true);
        expect(harness.registry.calls.activate).toBe(0);
      }),
      { numRuns: 8 },
    );
  });

  it('applies the same quota accounting to every source kind', () => {
    const usage = ALL_ADAPTERS.map((adapter) => {
      const harness = createHarness();
      const report = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","id":"a:b"}', adapter.sourceKind));
      return `${String(report.budget.inputBytes.used)}|${String(report.budget.astNodes.used)}|${String(report.budget.outputBytes.used)}`;
    });
    expect(new Set(usage).size).toBe(1);
  });

  it('invalidates a prior validation result once the candidate is edited', () => {
    const harness = createHarness();
    const first = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","id":"a:b"}', 'editor'));
    const edited = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","id":"a:c"}', 'editor'));
    expect(edited.candidateFingerprint).not.toBe(first.candidateFingerprint);
    expect(edited.changeRequestFingerprint).not.toBe(first.changeRequestFingerprint);
  });
});
