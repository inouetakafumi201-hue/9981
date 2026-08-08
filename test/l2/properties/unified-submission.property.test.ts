/**
 * Feature: l2-base-layer-spec, Property 12: 统一动作提交与单一写入通道
 *
 * Validates Requirements 6.1–6.10, 10.9, 13.6–13.7, 14.7.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { submit } from '../../../src/l2/registry/action-submitter.js';
import { FaultInjectableKernel } from '../../../src/l2/testing/test-interface.js';
import { singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { arbId, validActionDefinition } from '../../../src/l2/testing/definition-generators.js';
import type { ActionRequest, AuthorizationScope, CallerContext, RuntimeSemanticState } from '../../../src/l2/model/projection.js';
import { EMPTY_RUNTIME_SEMANTIC_STATE } from '../../../src/l2/model/projection.js';

const scope: AuthorizationScope = {
  scopeId: 's',
  consumer: 'ai',
  agentId: 'e:1',
  authorizedBeliefAgentIds: [],
  visibleEntityIds: ['e:1', 'e:2'],
  visibleNodeIds: [],
  authorizedResourceRoles: ['hp', 'ap'],
};

function request(actionId: string): ActionRequest {
  return { requestId: 'r1', actionId, actorId: 'e:1', targetIds: ['e:2'], parameters: {} };
}

const runtime: RuntimeSemanticState = EMPTY_RUNTIME_SEMANTIC_STATE;

describe('Property 12: 统一动作提交与单一写入通道', () => {
  it('有效请求只经 OpRegistry.invoke 调用一次', () => {
    fc.assert(
      fc.property(arbId, fc.constantFrom<CallerContext['kind']>('ai', 'ui', 'other'), (idSeed, kind) => {
        const definition = validActionDefinition(`a${idSeed}`);
        const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', definition));
        expect(activation.rejected).toBe(false);
        if (activation.rejected) {
          return;
        }
        const kernel = new FaultInjectableKernel(runtime, new Set(['prop.add']));
        const caller: CallerContext = { callerId: 'c', kind, scope };
        const result = submit({ active: activation.value.registry, kernel, request: request(definition.id), caller });
        expect(result.rejected).toBe(false);
        expect(kernel.invocations()).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  it('Hook 接线不可用时依赖 Hook 的动作被拒绝且零写入', () => {
    fc.assert(
      fc.property(arbId, (idSeed) => {
        const definition = validActionDefinition(`h${idSeed}`);
        // 标记该动作需要 Hook 接线。
        const contract = definition.familyContract;
        const hookedDefinition = {
          ...definition,
          familyContract: contract?.contractKind === 'action' ? { ...contract, requiresHookIntegration: true } : contract,
        };
        const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', hookedDefinition));
        expect(activation.rejected).toBe(false);
        if (activation.rejected) {
          return;
        }
        const kernel = new FaultInjectableKernel(runtime, new Set(['prop.add']), { hookAvailable: false });
        const caller: CallerContext = { callerId: 'c', kind: 'ui', scope };
        const before = kernel.semanticStateFingerprint();
        const result = submit({ active: activation.value.registry, kernel, request: request(hookedDefinition.id), caller });
        expect(result.rejected).toBe(true);
        expect(kernel.invocations()).toBe(0);
        expect(kernel.semanticStateFingerprint()).toBe(before);
      }),
      { numRuns: 150 },
    );
  });

  it('目标越权时零写入且状态不变', () => {
    const definition = validActionDefinition('t1');
    const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', definition));
    expect(activation.rejected).toBe(false);
    if (activation.rejected) {
      return;
    }
    const kernel = new FaultInjectableKernel(runtime, new Set(['prop.add']));
    const caller: CallerContext = { callerId: 'c', kind: 'ai', scope };
    const outOfScope: ActionRequest = { requestId: 'r', actionId: definition.id, actorId: 'e:1', targetIds: ['e:99'], parameters: {} };
    const before = kernel.semanticStateFingerprint();
    const result = submit({ active: activation.value.registry, kernel, request: outOfScope, caller });
    expect(result.rejected).toBe(true);
    expect(kernel.invocations()).toBe(0);
    expect(kernel.semanticStateFingerprint()).toBe(before);
  });
});
