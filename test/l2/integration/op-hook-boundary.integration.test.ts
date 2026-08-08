/**
 * L2 集成测试：L1 Op/Hook/事务边界（Requirements 6.10、10.8–10.9、13.6–13.7、15.14）。
 *
 * 使用注入式 KernelContract double 验证：
 * - 有效动作只经 OpRegistry.invoke 一次。
 * - Hook 未接线时依赖 Hook 的动作被拒绝。
 * - 事务失败保持事务前状态。
 * - L1 不变量违规被透传为运行时拒绝。
 */

import { describe, it, expect } from 'vitest';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { submit } from '../../../src/l2/registry/action-submitter.js';
import { FaultInjectableKernel } from '../../../src/l2/testing/test-interface.js';
import { singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { validActionDefinition } from '../../../src/l2/testing/definition-generators.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { EMPTY_RUNTIME_SEMANTIC_STATE } from '../../../src/l2/model/projection.js';
import type { ActionRequest, AuthorizationScope, CallerContext } from '../../../src/l2/model/projection.js';

const scope: AuthorizationScope = {
  scopeId: 's',
  consumer: 'ui',
  agentId: 'e:1',
  authorizedBeliefAgentIds: [],
  visibleEntityIds: ['e:2'],
  visibleNodeIds: [],
  authorizedResourceRoles: [],
};
const caller: CallerContext = { callerId: 'c', kind: 'ui', scope };

function setup(mutate?: (def: ReturnType<typeof validActionDefinition>) => ReturnType<typeof validActionDefinition>) {
  const definition = mutate ? mutate(validActionDefinition('act1')) : validActionDefinition('act1');
  const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', definition));
  if (activation.rejected) {
    throw new Error('setup activation failed');
  }
  return { registry: activation.value.registry, definition };
}

const request: ActionRequest = { requestId: 'r', actionId: 'act1', actorId: 'e:1', targetIds: ['e:2'], parameters: {} };

describe('L1 Op/Hook/事务边界', () => {
  it('有效动作恰好调用一次 OpRegistry.invoke', () => {
    const { registry } = setup();
    const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']));
    const result = submit({ active: registry, kernel, request, caller });
    expect(result.rejected).toBe(false);
    expect(kernel.invocations()).toBe(1);
  });

  it('Op 未注册被拒绝且零写入', () => {
    const { registry } = setup();
    const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set([]));
    const result = submit({ active: registry, kernel, request, caller });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.RUNTIME_OP_MAPPING_MISSING)).toBe(true);
    }
    expect(kernel.invocations()).toBe(0);
  });

  it('L1 不变量违规透传为运行时拒绝并保持状态', () => {
    const { registry } = setup();
    const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']));
    const before = kernel.semanticStateFingerprint();
    kernel.setFault({ kind: 'l1-invariant-violation' });
    const result = submit({ active: registry, kernel, request, caller });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.RUNTIME_L1_INVARIANT_VIOLATION)).toBe(true);
    }
    expect(kernel.semanticStateFingerprint()).toBe(before);
  });

  it('事务中止透传为运行时拒绝', () => {
    const { registry } = setup();
    const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']));
    kernel.setFault({ kind: 'transaction-aborted' });
    const result = submit({ active: registry, kernel, request, caller });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.RUNTIME_TRANSACTION_ABORTED)).toBe(true);
    }
  });

  it('依赖 Hook 的动作在接线不可用时被拒绝', () => {
    const { registry } = setup((def) => ({
      ...def,
      familyContract:
        def.familyContract?.contractKind === 'action'
          ? { ...def.familyContract, requiresHookIntegration: true }
          : def.familyContract,
    }));
    const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']), { hookAvailable: false });
    const result = submit({ active: registry, kernel, request, caller });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.RUNTIME_HOOK_INTEGRATION_UNAVAILABLE)).toBe(true);
    }
    expect(kernel.invocations()).toBe(0);
  });
});
