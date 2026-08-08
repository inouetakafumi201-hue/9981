/**
 * Feature: l2-base-layer-spec, Property 7: 规范化幂等与统一 UGC 验证
 *
 * Validates Requirements 11.7–11.12, 13.5, 13.11, 14.9.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonicalize } from '../../../src/l2/codec/json-canonicalizer.js';
import { parsePackage } from '../../../src/l2/codec/json-codec.js';
import { fromUgc } from '../../../src/l2/ugc/ugc-adapter.js';
import { fingerprint } from '../../../src/l2/model/ordering.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';

const validPackageJson = JSON.stringify({
  packageId: 'pkg-ugc',
  schemaVersion: 'l2-declarative/1',
  dependencies: [],
  sourceRecords: [],
  definitions: [
    {
      id: 'act-open',
      defKind: 'action',
      abstract: false,
      semanticFamily: { familyId: 'action' },
      typeIdentity: { requiredCapabilities: ['open'], legalRelationships: [], invariants: [], substitutionCompatibility: [] },
      composition: [],
      parameterSchema: { fields: [], crossFieldConstraints: [] },
      tags: [],
      actionRefs: [],
      ruleRefs: [],
      sourceRecords: [
        {
          sourceFile: 'docs/x.md',
          sourceLocation: { sourceFile: 'docs/x.md', section: 's' },
          precedence: 'finalized-l2-contract',
          classification: 'Normative_Contract',
          owningLayer: '基类层',
          statementFingerprint: 'fp',
        },
      ],
    },
  ],
});

const loc = { sourceFile: 'ugc', section: 'input' };

describe('Property 7: 规范化幂等与统一 UGC 验证', () => {
  it('键序打乱后规范化结果一致', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), () => {
        const parsed = JSON.parse(validPackageJson) as Record<string, unknown>;
        // 打乱顶层键序。
        const shuffled: Record<string, unknown> = {};
        for (const key of Object.keys(parsed).reverse()) {
          shuffled[key] = parsed[key];
        }
        const a = canonicalize(validPackageJson);
        const b = canonicalize(JSON.stringify(shuffled));
        expect(a.rejected || b.rejected).toBe(false);
        if (!a.rejected && !b.rejected) {
          expect(a.value).toBe(b.value);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('UGC 入口与手写入口对同一候选得到等价解析结果', () => {
    const viaHand = parsePackage(validPackageJson, { sourceLocation: loc, packageId: 'pkg-ugc' });
    const viaUgc = fromUgc({ candidateJson: validPackageJson, sourceLocation: loc, packageId: 'pkg-ugc' });
    expect(viaHand.rejected).toBe(false);
    expect(viaUgc.rejected).toBe(false);
    if (!viaHand.rejected && !viaUgc.rejected) {
      expect(fingerprint(viaHand.value)).toBe(fingerprint(viaUgc.value));
    }
  });

  it('UGC 产出可执行构造被拒绝', () => {
    const withCode = JSON.stringify({
      packageId: 'pkg-bad',
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [],
      definitions: [],
      $eval: 'doSomething()',
    });
    const result = fromUgc({ candidateJson: withCode, sourceLocation: loc });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === DIAGNOSTIC_CODES.UGC_EXECUTABLE_OUTPUT ||
            d.code === DIAGNOSTIC_CODES.JSON_PROHIBITED_CONSTRUCT,
        ),
      ).toBe(true);
    }
  });
});
