/**
 * Feature: l2-base-layer-spec, Property 6: JSON 语义往返
 *
 * Validates Requirements 11.1–11.6, 11.10, 15.3.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonicalize, parseCanonical, canonicalizeValue } from '../../../src/l2/codec/json-canonicalizer.js';
import { fingerprint } from '../../../src/l2/model/ordering.js';
import type { JsonValue } from '../../../src/l2/model/json.js';

/** 生成合法 JsonValue（有限数字、无 undefined）。 */
const arbJsonValue: fc.Arbitrary<JsonValue> = fc.letrec<{ v: JsonValue }>((tie) => ({
  v: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    fc.string(),
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('v'), { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('v'), { maxKeys: 4 }),
  ),
})).v;

describe('Property 6: JSON 语义往返', () => {
  it('parse → canonicalize → parse 保持语义等价', () => {
    fc.assert(
      fc.property(arbJsonValue, (value) => {
        const text = JSON.stringify(value);
        const canonical = canonicalize(text);
        expect(canonical.rejected).toBe(false);
        if (canonical.rejected) {
          return;
        }
        const reparsed = parseCanonical(canonical.value);
        expect(reparsed.rejected).toBe(false);
        if (reparsed.rejected) {
          return;
        }
        // 语义等价：再次规范化两侧字节一致。
        expect(canonicalizeValue(reparsed.value)).toBe(canonical.value);
        expect(fingerprint(reparsed.value)).toBe(fingerprint(value));
      }),
      { numRuns: 300 },
    );
  });

  it('规范化输出可再次解析且再规范化幂等', () => {
    fc.assert(
      fc.property(arbJsonValue, (value) => {
        const once = canonicalizeValue(value);
        const twice = canonicalize(once);
        expect(twice.rejected).toBe(false);
        if (!twice.rejected) {
          expect(twice.value).toBe(once);
        }
      }),
      { numRuns: 300 },
    );
  });
});
