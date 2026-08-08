/**
 * Feature: l2-base-layer-spec, Property 5: 独立组合的交换性与类型保持
 *
 * Validates Requirements 3.2, 3.11, 8.3, 8.8–8.9.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fingerprint } from '../../../src/l2/model/ordering.js';
import { baseDefinition, capabilityIdentity, multiDefinitionPackage, typedRef } from '../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import type { CompositionComponent } from '../../../src/l2/model/reference.js';
import { buildReferenceGraph } from '../../../src/l2/resolution/reference-graph.js';
import { resolveDefinition } from '../../../src/l2/resolution/definition-resolver.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';

function component(componentId: string, targetId: string): CompositionComponent {
  return {
    componentId,
    role: 'slot',
    optional: true,
    typeDefining: false,
    dependsOn: [],
    target: typedRef(targetId, 'slot', { defKind: 'node' }),
  };
}

function slotTarget(id: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'node',
    semanticFamily: { familyId: 'item' },
    typeIdentity: capabilityIdentity(`slot-${id}`),
  });
}

describe('Property 5: 独立组合的交换性与类型保持', () => {
  it('独立组件以任意顺序解析产生等价定义', () => {
    fc.assert(
      fc.property(arbId, fc.shuffledSubarray(['m1', 'm2', 'm3'], { minLength: 3, maxLength: 3 }), (idRaw, order) => {
        const id = `h${idRaw}`;
        const targets = ['t1', 't2', 't3'].map((t) => slotTarget(`${id}-${t}`));
        const components = order.map((cid, index) => component(cid, `${id}-t${index + 1}`));
        // 用不同顺序构造两个宿主定义。
        const hostA = baseDefinition({
          id,
          defKind: 'entity',
          semanticFamily: { familyId: 'item' },
          typeIdentity: capabilityIdentity(`host-${id}`),
          composition: components,
        });
        const reversed = [...components].reverse();
        const hostB = baseDefinition({
          id,
          defKind: 'entity',
          semanticFamily: { familyId: 'item' },
          typeIdentity: capabilityIdentity(`host-${id}`),
          composition: reversed,
        });

        const pkgA = multiDefinitionPackage('pkg', [hostA, ...targets]);
        const pkgB = multiDefinitionPackage('pkg', [hostB, ...targets]);
        const defsA = new Map(pkgA.definitions.map((d) => [d.id, d] as const));
        const defsB = new Map(pkgB.definitions.map((d) => [d.id, d] as const));
        const graphA = buildReferenceGraph({ package: pkgA, activeNodes: new Map() }).graph;
        const graphB = buildReferenceGraph({ package: pkgB, activeNodes: new Map() }).graph;
        const rA = resolveDefinition({ definitionId: id, definitions: defsA, graph: graphA, packageId: 'pkg' });
        const rB = resolveDefinition({ definitionId: id, definitions: defsB, graph: graphB, packageId: 'pkg' });
        expect(rA.resolved).toBeDefined();
        expect(rB.resolved).toBeDefined();
        // 解析器对组件按 componentId 规范化排序，因此顺序无关 → 等价。
        expect(fingerprint(rA.resolved!.nestedCapabilities)).toBe(fingerprint(rB.resolved!.nestedCapabilities));
      }),
      { numRuns: 150 },
    );
  });

  it('移除非类型决定的可选能力保持宿主 Type_Identity', () => {
    fc.assert(
      fc.property(arbId, (idRaw) => {
        const id = `h${idRaw}`;
        const target = slotTarget(`${id}-t`);
        const withOptional = baseDefinition({
          id,
          defKind: 'entity',
          semanticFamily: { familyId: 'item' },
          typeIdentity: capabilityIdentity(`host-${id}`),
          composition: [component('opt', `${id}-t`)],
        });
        const withoutOptional = baseDefinition({
          id,
          defKind: 'entity',
          semanticFamily: { familyId: 'item' },
          typeIdentity: capabilityIdentity(`host-${id}`),
          composition: [],
        });
        const pkgA = multiDefinitionPackage('pkg', [withOptional, target]);
        const pkgB = multiDefinitionPackage('pkg', [withoutOptional]);
        const rA = resolveDefinition({
          definitionId: id,
          definitions: new Map(pkgA.definitions.map((d) => [d.id, d] as const)),
          graph: buildReferenceGraph({ package: pkgA, activeNodes: new Map() }).graph,
          packageId: 'pkg',
        });
        const rB = resolveDefinition({
          definitionId: id,
          definitions: new Map(pkgB.definitions.map((d) => [d.id, d] as const)),
          graph: buildReferenceGraph({ package: pkgB, activeNodes: new Map() }).graph,
          packageId: 'pkg',
        });
        expect(fingerprint(rA.resolved!.typeIdentity)).toBe(fingerprint(rB.resolved!.typeIdentity));
      }),
      { numRuns: 150 },
    );
  });
});
