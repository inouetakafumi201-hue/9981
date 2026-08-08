/**
 * Feature: l2-base-layer-spec, Property 11: 只读投影不可变且受作用域限制
 *
 * Validates Requirements 10.7–10.9, 14.1, 14.7–14.10.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { createProjection } from '../../../src/l2/registry/read-only-projection.js';
import { isDeeplyFrozen } from '../../../src/l2/model/immutable.js';
import { singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { arbId, validActionDefinition } from '../../../src/l2/testing/definition-generators.js';
import type { AuthorizationScope, RuntimeSemanticState } from '../../../src/l2/model/projection.js';

function runtimeState(): RuntimeSemanticState {
  return {
    turn: 3,
    entities: [
      {
        entityId: 'e:1',
        properties: [
          { name: 'hp', value: 4, resourceRole: 'hp', playerVisible: true },
          { name: 'secret', value: 9, playerVisible: false },
        ],
        statusIds: ['s:1'],
      },
      {
        entityId: 'e:2',
        properties: [{ name: 'hp', value: 5, resourceRole: 'hp', playerVisible: true }],
        statusIds: [],
      },
    ],
    beliefSlices: [
      { agentId: 'e:1', facts: [{ factId: 'f1', subject: 'e:2', value: 'seen' }] },
      { agentId: 'e:9', facts: [{ factId: 'f2', subject: 'e:1', value: 'hidden' }] },
    ],
    visibility: [
      { agentId: 'e:1', visibleEntityIds: ['e:1', 'e:2'], visibleNodeIds: ['n:1'] },
      { agentId: 'e:9', visibleEntityIds: ['e:1'], visibleNodeIds: [] },
    ],
  };
}

const scope: AuthorizationScope = {
  scopeId: 'scope-1',
  consumer: 'ai',
  agentId: 'e:1',
  authorizedBeliefAgentIds: ['e:1'],
  visibleEntityIds: ['e:1', 'e:2'],
  visibleNodeIds: ['n:1'],
  authorizedResourceRoles: ['hp'],
};

describe('Property 11: 只读投影不可变且受作用域限制', () => {
  it('投影深度冻结且不含越权认知', () => {
    fc.assert(
      fc.property(arbId, (idSeed) => {
        const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', validActionDefinition(`a${idSeed}`)));
        expect(activation.rejected).toBe(false);
        if (activation.rejected) {
          return;
        }
        const projection = createProjection(activation.value.registry, runtimeState(), scope);
        expect(isDeeplyFrozen(projection)).toBe(true);
        // 越权 belief（e:9）不出现。
        expect(projection.beliefSlices.every((slice) => slice.agentId === 'e:1')).toBe(true);
      }),
      { numRuns: 120 },
    );
  });

  it('尝试写入投影嵌套对象抛错，语义状态指纹不变', () => {
    const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', validActionDefinition('a1')));
    expect(activation.rejected).toBe(false);
    if (activation.rejected) {
      return;
    }
    const projection = createProjection(activation.value.registry, runtimeState(), scope);
    const before = projection.semanticStateFingerprint;
    expect(() => {
      (projection.entities as unknown as { push: (x: unknown) => void }).push({});
    }).toThrow();
    expect(projection.semanticStateFingerprint).toBe(before);
  });
});
