/**
 * L2 集成测试：AI/UI 消费者与渲染替换（Requirements 10.3–10.10、14.1–14.11、15.14–15.16）。
 */

import { describe, it, expect } from 'vitest';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { uiDescriptor, submitUiAction } from '../../../src/l2/adapters/ui-adapter.js';
import { aiView, submitAiAction, evaluate } from '../../../src/l2/adapters/ai-adapter.js';
import { FaultInjectableKernel } from '../../../src/l2/testing/test-interface.js';
import { baseDefinition, capabilityIdentity, multiDefinitionPackage, validActionContract } from '../../../src/l2/testing/builders.js';
import { validActionDefinition } from '../../../src/l2/testing/definition-generators.js';
import { isDeeplyFrozen } from '../../../src/l2/model/immutable.js';
import type { AuthorizationScope, RuntimeSemanticState, ActionRequest } from '../../../src/l2/model/projection.js';

const runtime: RuntimeSemanticState = {
  turn: 1,
  entities: [
    { entityId: 'e:1', properties: [{ name: 'hp', value: 4, resourceRole: 'hp', playerVisible: true }, { name: 'ap', value: 2, resourceRole: 'ap', playerVisible: true }], statusIds: [] },
    { entityId: 'e:2', properties: [{ name: 'hp', value: 3, resourceRole: 'hp', playerVisible: true }], statusIds: [] },
  ],
  beliefSlices: [],
  visibility: [{ agentId: 'e:1', visibleEntityIds: ['e:1', 'e:2'], visibleNodeIds: [] }],
};

const scope: AuthorizationScope = {
  scopeId: 's',
  consumer: 'ui',
  agentId: 'e:1',
  authorizedBeliefAgentIds: [],
  visibleEntityIds: ['e:1', 'e:2'],
  visibleNodeIds: [],
  authorizedResourceRoles: ['hp', 'ap'],
};

function registryWithAction() {
  const activation = activate(emptyRegistry(), multiDefinitionPackage('pkg', [validActionDefinition('act1')]));
  if (activation.rejected) {
    throw new Error('activation failed');
  }
  return activation.value.registry;
}

describe('UI 适配', () => {
  it('资源角色 HP/AP 独立暴露，不依赖字段名猜测', () => {
    const registry = registryWithAction();
    const result = uiDescriptor({
      active: registry,
      runtimeState: runtime,
      query: { actorId: 'e:1', includeUnavailable: true },
      scope,
      actionIds: ['act1'],
    });
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      const roles = result.value.resources.map((r) => r.role).sort();
      expect(roles).toEqual(['ap', 'hp']);
      expect(result.value.paidActions.some((a) => a.actionId === 'act1')).toBe(true);
    }
  });

  it('更换 rendererId 不改变动作标识与可用性', () => {
    const registry = registryWithAction();
    const a = uiDescriptor({ active: registry, runtimeState: runtime, query: { actorId: 'e:1', includeUnavailable: true, rendererId: 'r-A' }, scope, actionIds: ['act1'] });
    const b = uiDescriptor({ active: registry, runtimeState: runtime, query: { actorId: 'e:1', includeUnavailable: true, rendererId: 'r-B' }, scope, actionIds: ['act1'] });
    expect(a.rejected || b.rejected).toBe(false);
    if (!a.rejected && !b.rejected) {
      expect(a.value.paidActions.map((x) => x.actionId)).toEqual(b.value.paidActions.map((x) => x.actionId));
    }
  });

  it('UI 与 AI 提交走同一通道，均调用一次 invoke', () => {
    const registry = registryWithAction();
    const request: ActionRequest = { requestId: 'r', actionId: 'act1', actorId: 'e:1', targetIds: ['e:2'], parameters: {} };
    const uiKernel = new FaultInjectableKernel(runtime, new Set(['prop.add']));
    const aiKernel = new FaultInjectableKernel(runtime, new Set(['prop.add']));
    const uiResult = submitUiAction({ active: registry, kernel: uiKernel, request, scope, callerId: 'ui' });
    const aiResult = submitAiAction({ active: registry, kernel: aiKernel, request, scope, policyId: 'p', callerId: 'ai' });
    expect(uiResult.rejected).toBe(false);
    expect(aiResult.rejected).toBe(false);
    expect(uiKernel.invocations()).toBe(1);
    expect(aiKernel.invocations()).toBe(1);
  });
});

describe('AI 适配', () => {
  it('AI 视图返回深度不可变投影', () => {
    const aiPolicy = baseDefinition({
      id: 'ai-guard',
      defKind: 'policy',
      semanticFamily: { familyId: 'ai-behavior' },
      typeIdentity: capabilityIdentity('guard'),
      familyContract: {
        contractKind: 'ai-behavior',
        policyCategory: 'npc-behavior',
        states: [],
        transitions: [],
        perceptionParameterSchema: { fields: [], crossFieldConstraints: [] },
        fallbackStateRef: { refId: 'act1', role: 'rule', expected: { defKind: 'action', allowAbstract: false }, required: false, jsonPath: '/x' },
        requiredActionRefs: [{ refId: 'act1', role: 'action', expected: { defKind: 'action', allowAbstract: false }, required: false, jsonPath: '/y' }],
        requiredActionTags: [],
        neutralFallbackEvaluation: 0,
      },
    });
    const activation = activate(emptyRegistry(), multiDefinitionPackage('pkg', [validActionDefinition('act1'), aiPolicy]));
    expect(activation.rejected).toBe(false);
    if (activation.rejected) {
      return;
    }
    const view = aiView({ active: activation.value.registry, runtimeState: runtime, policyId: 'ai-guard', scope });
    expect(view.rejected).toBe(false);
    if (!view.rejected) {
      expect(isDeeplyFrozen(view.value.projection)).toBe(true);
      expect(view.value.policyCategory).toBe('npc-behavior');
    }
  });

  it('无效评估回退到中性值', () => {
    expect(evaluate(null, 0).usedFallback).toBe(true);
    expect(evaluate(Number.NaN, 2).value).toBe(2);
    expect(evaluate(3, 0)).toMatchObject({ usedFallback: false, value: 3 });
  });
});
