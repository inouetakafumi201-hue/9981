/**
 * L2 单元测试：三种网关契约与动作契约的固定边界（Requirements 6.1–6.10）。
 */

import { describe, it, expect } from 'vitest';
import { baseDefinition, capabilityIdentity, singleDefinitionPackage, typedRef } from '../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../src/l2/model/definition.js';
import type { GatewayContract, ActionContract } from '../../../src/l2/model/family-contracts.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { validateStructure, hasCode } from '../helpers.js';

function gateway(id: string, contract: GatewayContract): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'rule',
    semanticFamily: { familyId: 'gateway' },
    typeIdentity: capabilityIdentity(`gw-${id}`),
    familyContract: contract,
  });
}

function action(id: string, contract: ActionContract): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'action',
    semanticFamily: { familyId: 'action' },
    typeIdentity: capabilityIdentity(`act-${id}`),
    familyContract: contract,
  });
}

describe('三种网关契约', () => {
  it('resource-conversion 网关缺输入/输出被拒绝', () => {
    const contract: GatewayContract = {
      contractKind: 'gateway',
      gatewayKind: 'resource-conversion',
      resourceConversion: { inputResourceRefs: [], outputEffectRefs: [], deterministicSuccess: true },
    };
    const result = validateStructure(singleDefinitionPackage('pkg', gateway('g1', contract)));
    expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.GATEWAY_MISSING_CONTRACT_FIELD)).toBe(true);
  });

  it('gatewayKind 与载荷不一致被判为歧义', () => {
    const contract: GatewayContract = {
      contractKind: 'gateway',
      gatewayKind: 'check',
      condition: {
        conditionExprRef: typedRef('e', 'expr', { defKind: 'expr', required: false }),
        successEffectRefs: [],
        failureEffectRefs: [],
      },
    };
    const result = validateStructure(singleDefinitionPackage('pkg', gateway('g2', contract)));
    expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.GATEWAY_KIND_AMBIGUOUS)).toBe(true);
  });

  it('内嵌具名玩法实体被拒绝', () => {
    const contract: GatewayContract = {
      contractKind: 'gateway',
      gatewayKind: 'condition',
      condition: {
        conditionExprRef: typedRef('e', 'expr', { defKind: 'expr', required: false }),
        successEffectRefs: [typedRef('s', 'effect', { defKind: 'rule', required: false })],
        failureEffectRefs: [typedRef('f', 'effect', { defKind: 'rule', required: false })],
      },
      namedGameplayEntity: '军火商店',
    };
    const result = validateStructure(singleDefinitionPackage('pkg', gateway('g3', contract)));
    expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.GATEWAY_NAMED_GAMEPLAY_ENTITY)).toBe(true);
  });
});

describe('动作契约', () => {
  it('多 AP 原子成本被拒绝', () => {
    const contract: ActionContract = {
      contractKind: 'action',
      costCategory: 'paid',
      apCost: 3,
      actorRequirements: [],
      targetRequirements: [],
      effectRefs: [],
      interruptionConditionRefs: [],
      completionState: 'done',
      availableAsDecisionBranch: true,
      requiresHookIntegration: false,
    };
    const result = validateStructure(singleDefinitionPackage('pkg', action('a1', contract)));
    expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST)).toBe(true);
  });

  it('Attached_Action 无宿主 / 可作独立分支被拒绝', () => {
    const contract: ActionContract = {
      contractKind: 'action',
      costCategory: 'attached',
      apCost: 0,
      actorRequirements: [],
      targetRequirements: [],
      effectRefs: [],
      interruptionConditionRefs: [],
      completionState: 'done',
      availableAsDecisionBranch: true,
      requiresHookIntegration: false,
    };
    const result = validateStructure(singleDefinitionPackage('pkg', action('a2', contract)));
    expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.ACTION_ATTACHED_WITHOUT_HOST)).toBe(true);
    expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.ACTION_ATTACHED_AS_DECISION_BRANCH)).toBe(true);
  });
});
