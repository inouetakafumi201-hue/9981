/**
 * Feature: l2-base-layer-spec, Property 8: 引用图完整性与确定性拒绝
 *
 * Validates Requirements 3.5, 4.6–4.8, 7.8–7.9, 8.13, 10.11–10.12, 12.1–12.5, 12.10–12.12.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { fingerprint } from '../../../src/l2/model/ordering.js';
import { baseDefinition, capabilityIdentity, multiDefinitionPackage, typedRef } from '../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import { buildReferenceGraph } from '../../../src/l2/resolution/reference-graph.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';

function refHolder(id: string, targetId: string, expectAbstract: boolean): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'rule',
    semanticFamily: { familyId: 'gateway' },
    typeIdentity: capabilityIdentity(`c-${id}`),
    otherRefs: [typedRef(targetId, 'rule', { defKind: 'rule', allowAbstract: expectAbstract, jsonPath: `/definitions/${id}/otherRefs/0` })],
  });
}

describe('Property 8: 引用图完整性与确定性拒绝', () => {
  it('缺失必需引用产生带路径的 REF_MISSING_TARGET', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `h${idRaw}`;
        const holder = refHolder(id, `${id}-missing`, false);
        const pkg = multiDefinitionPackage('pkg', [holder]);
        const { diagnostics } = buildReferenceGraph({ package: pkg, activeNodes: new Map() });
        const missing = diagnostics.find((d) => d.code === DIAGNOSTIC_CODES.REF_MISSING_TARGET);
        expect(missing).toBeDefined();
        expect(missing!.jsonPath).toContain('otherRefs');
      }),
      { numRuns: 200 },
    );
  });

  it('引用抽象定义作为实例目标被拒绝（不允许抽象时）', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `h${idRaw}`;
        const target = baseDefinition({
          id: `${id}-t`,
          defKind: 'rule',
          abstract: true,
          semanticFamily: { familyId: 'gateway' },
          typeIdentity: capabilityIdentity(`t-${id}`),
        });
        const holder = refHolder(id, `${id}-t`, false);
        const pkg = multiDefinitionPackage('pkg', [holder, target]);
        const { diagnostics } = buildReferenceGraph({ package: pkg, activeNodes: new Map() });
        expect(diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.REF_ABSTRACT_TARGET)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('引用图诊断顺序确定（同输入不同构造顺序 → 相同诊断指纹）', () => {
    fc.assert(
      fc.property(arbId, arbId, (aRaw, bRaw) => {
        const a = `x${aRaw}`;
        const b = `y${bRaw}`;
        fc.pre(a !== b);
        const h1 = refHolder(a, `${a}-missing`, false);
        const h2 = refHolder(b, `${b}-missing`, false);
        const pkgAB = multiDefinitionPackage('pkg', [h1, h2]);
        const pkgBA = multiDefinitionPackage('pkg', [h2, h1]);
        const dAB = buildReferenceGraph({ package: pkgAB, activeNodes: new Map() }).diagnostics;
        const dBA = buildReferenceGraph({ package: pkgBA, activeNodes: new Map() }).diagnostics;
        expect(fingerprint(dAB)).toBe(fingerprint(dBA));
      }),
      { numRuns: 150 },
    );
  });
});
