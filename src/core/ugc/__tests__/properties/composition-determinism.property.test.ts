/**
 * Feature: wakeup-ugc, Property 8: Inheritance and composition determinism.
 *
 * 对任意血统与组合集合，继承环和不兼容/未声明冲突被拒绝；独立且兼容的组件可交换，
 * 而只有显式顺序依赖才可保留顺序。没有任何宿主/文件/哈希迭代顺序能决定胜者。
 *
 * **Validates: Requirement 8**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';

describe('Feature: wakeup-ugc, Property 8: inheritance and composition determinism', () => {
  it('normalises any object key permutation to the same canonical identity', () => {
    // 这是"没有哈希迭代顺序能决定结果"的直接证据：键顺序不影响规范化身份。
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 2, maxLength: 6 }),
        fc.integer({ min: 0, max: 1000 }),
        (keys, seed) => {
          const harness = createHarness();
          const entries = keys.map((key, index) => [key, index] as const);
          const rotated = [...entries.slice(seed % entries.length), ...entries.slice(0, seed % entries.length)];

          const fingerprintOf = (pairs: readonly (readonly [string, number])[]) => {
            const body = pairs.map(([key, value]) => `"${key}":${String(value)}`).join(',');
            return harness.facade.validate(requestFrom(`{"schemaVersion":"1.0.0",${body}}`, 'hand-authored'))
              .candidateFingerprint;
          };

          expect(fingerprintOf(rotated)).toBe(fingerprintOf(entries));
        },
      ),
      { numRuns: 40 },
    );
  });

  it('preserves a declared semantic array order rather than sorting it away', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 9 }), { minLength: 2, maxLength: 6 }), (values) => {
        const harness = createHarness();
        const ascending = [...values].sort((left, right) => left - right);
        const descending = [...ascending].reverse();
        if (ascending.join() === descending.join()) return;

        const a = harness.facade.validate(requestFrom(validCandidateText({ order: ascending }), 'hand-authored'));
        const b = harness.facade.validate(requestFrom(validCandidateText({ order: descending }), 'hand-authored'));
        // 顺序是语义的一部分，必须保留差异（需求 11.9、8.7）。
        expect(b.candidateFingerprint).not.toBe(a.candidateFingerprint);
      }),
      { numRuns: 30 },
    );
  });

  it('rejects an inheritance cycle reported by the upstream validator', () => {
    const harness = createHarness({
      validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/extends', condition: 'unknown-field' }] },
    });
    const report = harness.facade.validate(
      requestFrom(validCandidateText({ extends: ['weapon:shotgun'] }), 'hand-authored'),
    );
    expect(report.status).toBe('rejected');
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('never invents a merge policy when the upstream contract is unresolved', () => {
    // 需求 8.10：上游未裁决时 UGC 不发明合并策略、默认组件或冲突胜者。
    const harness = createHarness({ validator: { omitCapabilities: ['composition-conflict'] } });
    const report = harness.facade.validate(
      requestFrom(validCandidateText({ components: ['a', 'b'] }), 'hand-authored'),
    );
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_UNRESOLVED_CONTRACT')).toBe(true);
    expect(report.validated).toBeNull();
  });

  it('produces byte-identical canonical output for repeated resolution of the same composition', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{2,5}$/), { minLength: 1, maxLength: 5 }), (components) => {
        const harness = createHarness();
        const text = validCandidateText({ components });
        const first = harness.facade.validate(requestFrom(text, 'hand-authored')).candidateFingerprint;
        const second = harness.facade.validate(requestFrom(text, 'hand-authored')).candidateFingerprint;
        expect(second).toBe(first);
      }),
      { numRuns: 25 },
    );
  });
});
