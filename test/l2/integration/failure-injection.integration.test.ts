/**
 * L2 集成测试：受控故障注入（Requirements 11.2–11.4、11.10–11.12、13.1–13.12、15.6–15.13）。
 *
 * 系统性验证失败路径没有部分激活、效果写入或静默语义降级。
 */

import { describe, it, expect } from 'vitest';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { withFault, FaultInjectableKernel, FAULT_KINDS } from '../../../src/l2/testing/test-interface.js';
import { singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { validActionDefinition, INVALID_CASE_BUILDERS } from '../../../src/l2/testing/definition-generators.js';
import { EMPTY_RUNTIME_SEMANTIC_STATE } from '../../../src/l2/model/projection.js';
import type { ActionRequest, AuthorizationScope, CallerContext } from '../../../src/l2/model/projection.js';

const scope: AuthorizationScope = {
  scopeId: 's',
  consumer: 'ai',
  agentId: 'e:1',
  authorizedBeliefAgentIds: [],
  visibleEntityIds: ['e:2'],
  visibleNodeIds: [],
  authorizedResourceRoles: [],
};
const caller: CallerContext = { callerId: 'c', kind: 'ai', scope };
const request: ActionRequest = { requestId: 'r', actionId: 'act1', actorId: 'e:1', targetIds: ['e:2'], parameters: {} };

describe('故障注入', () => {
  it('每种运行时故障都使写入为零或状态不变', () => {
    // 该动作要求 Hook 接线，使 hook-unavailable 故障也能触发拒绝；
    // 其余故障在 Hook 可用时进入 invoke 后由内核回滚/拒绝。
    const base = validActionDefinition('act1');
    const hooked = {
      ...base,
      familyContract:
        base.familyContract?.contractKind === 'action'
          ? { ...base.familyContract, requiresHookIntegration: true }
          : base.familyContract,
    };
    const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', hooked));
    expect(activation.rejected).toBe(false);
    if (activation.rejected) {
      return;
    }
    for (const kind of FAULT_KINDS) {
      const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']));
      const { result, before, after } = withFault(kernel, { kind }, activation.value.registry, request, caller);
      expect(result.rejected).toBe(true);
      // 失败路径：状态指纹不变（op-not-found/hook 直接零写入；invariant/abort 由内核回滚）。
      expect(after).toBe(before);
    }
  });

  it('激活期任一非法定义导致零候选变更', () => {
    const registry = emptyRegistry();
    for (const builder of INVALID_CASE_BUILDERS) {
      const bad = builder('bad').definition;
      const result = activate(registry, singleDefinitionPackage('pkg', bad));
      expect(result.rejected).toBe(true);
      expect(registry.definitions.size).toBe(0);
    }
  });

  it('注入解析故障后再无故障提交恢复正常写入', () => {
    const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg', validActionDefinition('act1')));
    if (activation.rejected) {
      throw new Error('activation failed');
    }
    const kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']));
    const faulted = withFault(kernel, { kind: 'transaction-aborted' }, activation.value.registry, request, caller);
    expect(faulted.result.rejected).toBe(true);
    // 清除故障后提交成功写入一次。
    const clean = withFault(kernel, undefined, activation.value.registry, request, caller);
    expect(clean.result.rejected).toBe(false);
    expect(kernel.invocations()).toBe(1);
  });
});
