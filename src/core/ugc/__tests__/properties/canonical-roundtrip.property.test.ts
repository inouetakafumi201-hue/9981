/**
 * Feature: wakeup-ugc, Property 11: Canonical round-trip and idempotence.
 *
 * 对任意合法当前 Schema 候选，parse–canonicalize–parse 产生等价定义，重复规范化字节相同。
 * 空白/对象键/无序集合排列归一相同；语义数组顺序仍可观察。
 *
 * **Validates: Requirement 11**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { requestFrom } from '../../testing/generators';

/** 从报告取规范化 JSON：产物的 upstream payload 里保存了 canonical 文本（harness 约定）。 */
function canonicalOf(harness: ReturnType<typeof createHarness>, text: string): { fingerprint: string | null; status: string } {
  const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
  return { fingerprint: report.candidateFingerprint, status: report.status };
}

describe('Feature: wakeup-ugc, Property 11: canonical round-trip and idempotence', () => {
  it('normalises whitespace differences to the same identity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (spaces) => {
        const harness = createHarness();
        const pad = ' '.repeat(spaces);
        const compact = canonicalOf(harness, '{"schemaVersion":"1.0.0","id":"a:b","n":3}');
        const spaced = canonicalOf(harness, `{${pad}"schemaVersion"${pad}:${pad}"1.0.0"${pad},"id":"a:b","n":${pad}3${pad}}`);
        expect(spaced.fingerprint).toBe(compact.fingerprint);
      }),
      { numRuns: 9 },
    );
  });

  it('normalises object key order to the same identity', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 2, maxLength: 5 }), fc.integer({ min: 0, max: 50 }), (keys, seed) => {
        const harness = createHarness();
        const entries = keys.map((key, index) => `"${key}":${String(index)}`);
        const rotate = seed % entries.length;
        const a = `{"schemaVersion":"1.0.0",${entries.join(',')}}`;
        const b = `{${[...entries.slice(rotate), ...entries.slice(0, rotate)].join(',')},"schemaVersion":"1.0.0"}`;
        expect(canonicalOf(harness, b).fingerprint).toBe(canonicalOf(harness, a).fingerprint);
      }),
      { numRuns: 30 },
    );
  });

  it('is byte-idempotent: validating the same candidate twice gives the same identity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.stringMatching(/^[a-z]{2,6}$/), (n, tag) => {
        const harness = createHarness();
        const text = `{"schemaVersion":"1.0.0","id":"w:${tag}","n":${String(n)}}`;
        expect(canonicalOf(harness, text).fingerprint).toBe(canonicalOf(harness, text).fingerprint);
      }),
      { numRuns: 25 },
    );
  });

  it('preserves a differing semantic array order as a different identity', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 9 }), { minLength: 2, maxLength: 6 }), (values) => {
        const harness = createHarness();
        const ascending = [...values].sort((left, right) => left - right);
        const descending = [...ascending].reverse();
        if (ascending.join() === descending.join()) return;
        const a = canonicalOf(harness, `{"schemaVersion":"1.0.0","seq":[${ascending.join(',')}]}`);
        const b = canonicalOf(harness, `{"schemaVersion":"1.0.0","seq":[${descending.join(',')}]}`);
        expect(b.fingerprint).not.toBe(a.fingerprint);
      }),
      { numRuns: 25 },
    );
  });

  it('normalises equivalent numeric spellings to the same identity', () => {
    const harness = createHarness();
    const forms = ['{"schemaVersion":"1.0.0","n":1}', '{"schemaVersion":"1.0.0","n":1.0}', '{"schemaVersion":"1.0.0","n":1e0}'];
    const fingerprints = forms.map((text) => canonicalOf(harness, text).fingerprint);
    expect(new Set(fingerprints).size).toBe(1);
  });
});
