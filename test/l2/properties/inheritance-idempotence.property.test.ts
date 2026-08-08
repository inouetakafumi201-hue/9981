/**
 * Feature: l2-base-layer-spec, Property 4: 继承与解析幂等
 *
 * Validates Requirements 3.1–3.10, 4.5–4.7.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { fingerprint } from '../../../src/l2/model/ordering.js';
import { baseDefinition, capabilityIdentity, multiDefinitionPackage } from '../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import { buildReferenceGraph } from '../../../src/l2/resolution/reference-graph.js';
import { resolveDefinition } from '../../../src/l2/resolution/definition-resolver.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';

function abstractBase(id: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'entity',
    abstract: true,
    semanticFamily: { familyId: 'item' },
    typeIdentity: capabilityIdentity(`base-cap-${id}`),
  });
}

function childOf(id: string, parentId: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'entity',
    semanticFamily: { familyId: 'item' },
    typeIdentity: capabilityIdentity(`base-cap-${parentId}`, `child-cap-${id}`),
    extends: [{ refId: parentId, jsonPath: `/definitions/${id}/extends/0` }],
  });
}

describe('Property 4: 继承与解析幂等', () => {
  it('重复解析同一有效定义产生等价结果', () => {
    fc.assert(
      fc.property(arbId, arbId, (parentIdRaw, childIdRaw) => {
        const parentId = `p${parentIdRaw}`;
        const childId = `c${childIdRaw}`;
        fc.pre(parentId !== childId);
        const parent = abstractBase(parentId);
        const child = childOf(childId, parentId);
        const pkg = multiDefinitionPackage('pkg', [parent, child]);
        const definitions = new Map(pkg.definitions.map((d) => [d.id, d] as const));
        const { graph } = buildReferenceGraph({ package: pkg, activeNodes: new Map() });

        const first = resolveDefinition({ definitionId: childId, definitions, graph, packageId: 'pkg' });
        const second = resolveDefinition({ definitionId: childId, definitions, graph, packageId: 'pkg' });
        expect(first.resolved).toBeDefined();
        expect(second.resolved).toBeDefined();
        expect(fingerprint(first.resolved)).toBe(fingerprint(second.resolved));
      }),
      { numRuns: 200 },
    );
  });

  it('继承循环被稳定拒绝', () => {
    fc.assert(
      fc.property(arbId, arbId, (aRaw, bRaw) => {
        const a = `a${aRaw}`;
        const b = `b${bRaw}`;
        fc.pre(a !== b);
        const defA = baseDefinition({
          id: a,
          defKind: 'entity',
          semanticFamily: { familyId: 'item' },
          typeIdentity: capabilityIdentity(`ca-${a}`),
          extends: [{ refId: b, jsonPath: `/x` }],
        });
        const defB = baseDefinition({
          id: b,
          defKind: 'entity',
          semanticFamily: { familyId: 'item' },
          typeIdentity: capabilityIdentity(`cb-${b}`),
          extends: [{ refId: a, jsonPath: `/y` }],
        });
        const pkg = multiDefinitionPackage('pkg', [defA, defB]);
        const definitions = new Map(pkg.definitions.map((d) => [d.id, d] as const));
        const { graph } = buildReferenceGraph({ package: pkg, activeNodes: new Map() });
        const result = resolveDefinition({ definitionId: a, definitions, graph, packageId: 'pkg' });
        expect(result.resolved).toBeUndefined();
        expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.INHERIT_CYCLE)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
