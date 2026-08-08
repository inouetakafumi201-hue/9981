/**
 * L2 集成测试：端到端装载与动作链（Requirements 1–16 的串联）。
 *
 * 来源编译 → JSON 解析 → 验证 → 引用解析 → 原子注册 → 只读投影 → UI/AI → 统一动作提交。
 * 验证有效包完整激活、非法包零变更、真实动作链只走 OpRegistry.invoke。
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../../src/l2/compiler/specification-compiler.js';
import { parsePackage } from '../../../src/l2/codec/json-codec.js';
import { activate, emptyRegistry, query } from '../../../src/l2/registry/definition-registry.js';
import { createProjection } from '../../../src/l2/registry/read-only-projection.js';
import { uiDescriptor, submitUiAction } from '../../../src/l2/adapters/ui-adapter.js';
import { FaultInjectableKernel } from '../../../src/l2/testing/test-interface.js';
import { createKernelContractFromOpRegistry } from '../../../src/l2/kernel/op-registry-adapter.js';
import type { AuthorizationScope, RuntimeSemanticState, ActionRequest } from '../../../src/l2/model/projection.js';
import type { SourceStatement } from '../../../src/l2/model/source.js';

const packageJson = JSON.stringify({
  packageId: 'pkg-e2e',
  schemaVersion: 'l2-declarative/1',
  dependencies: [],
  sourceRecords: [
    { sourceFile: 'docs/x.md', sourceLocation: { sourceFile: 'docs/x.md', section: 's' }, precedence: 'finalized-l2-contract', classification: 'Normative_Contract', owningLayer: '基类层', statementFingerprint: 'pkg' },
  ],
  definitions: [
    {
      id: 'act-strike',
      defKind: 'action',
      abstract: false,
      semanticFamily: { familyId: 'action' },
      typeIdentity: { requiredCapabilities: ['strike'], legalRelationships: [], invariants: [], substitutionCompatibility: [] },
      composition: [],
      parameterSchema: { fields: [], crossFieldConstraints: [] },
      tags: ['offensive'],
      actionRefs: [],
      ruleRefs: [],
      familyContract: {
        contractKind: 'action',
        costCategory: 'paid',
        apCost: 1,
        actorRequirements: [],
        targetRequirements: [{ requirementId: 't', targetKind: 'entity', interactionIntent: 'hostile-interaction' }],
        effectRefs: [],
        interruptionConditionRefs: [],
        completionState: 'struck',
        availableAsDecisionBranch: true,
        requiresHookIntegration: false,
        interactionIntent: 'hostile-interaction',
        attackShape: 'single-target',
        opMapping: { opId: 'prop.add', argumentMapping: [{ opArgument: 'target', source: 'target' }] },
      },
      presentation: { displayName: '打击', accessibleLabel: '发起打击' },
      sourceRecords: [
        { sourceFile: 'docs/x.md', sourceLocation: { sourceFile: 'docs/x.md', section: 's' }, precedence: 'finalized-l2-contract', classification: 'Normative_Contract', owningLayer: '基类层', statementFingerprint: 'act' },
      ],
    },
  ],
});

const runtime: RuntimeSemanticState = {
  turn: 1,
  entities: [
    { entityId: 'e:1', properties: [{ name: 'ap', value: 2, resourceRole: 'ap', playerVisible: true }], statusIds: [] },
    { entityId: 'e:2', properties: [{ name: 'hp', value: 4, resourceRole: 'hp', playerVisible: true }], statusIds: [] },
  ],
  beliefSlices: [],
  visibility: [{ agentId: 'e:1', visibleEntityIds: ['e:1', 'e:2'], visibleNodeIds: [] }],
};

const scope: AuthorizationScope = {
  scopeId: 's', consumer: 'ui', agentId: 'e:1', authorizedBeliefAgentIds: [], visibleEntityIds: ['e:1', 'e:2'], visibleNodeIds: [], authorizedResourceRoles: ['hp', 'ap'],
};

describe('端到端装载与动作链', () => {
  it('完整管线：编译 → 解析 → 激活 → 投影 → UI → 提交', () => {
    // 1. 来源编译（Q-01~Q-05 保持未决）。
    const qStatement: SourceStatement = {
      claimKey: 'Q-01', text: '特殊谱型待定', markers: [], declaredMechanics: [], deprecatedMechanic: false,
      gameplayProfileCoupled: false, presentationOnly: false, numericExamples: [],
      record: { sourceFile: 'docs/L0_规范宪法.md', sourceLocation: { sourceFile: 'docs/L0_规范宪法.md', section: 'Q-01' }, precedence: 'unresolved-l2-content', decisionId: 'Q-01', classification: 'Unresolved_Item', owningLayer: '玩法层', statementFingerprint: 'q01' },
    };
    const compiled = compile([qStatement]);
    expect(compiled.rejected).toBe(false);
    if (!compiled.rejected) {
      // Q-01 仍未决，未晋升为规范契约。
      expect(compiled.value.normativeContracts.length).toBe(0);
    }

    // 2. 解析。
    const parsed = parsePackage(packageJson, { sourceLocation: { sourceFile: 'x', section: 's' }, packageId: 'pkg-e2e' });
    expect(parsed.rejected).toBe(false);
    if (parsed.rejected) {
      return;
    }

    // 3. 原子激活。
    const activation = activate(emptyRegistry(), parsed.value);
    expect(activation.rejected).toBe(false);
    if (activation.rejected) {
      return;
    }
    const registry = activation.value.registry;
    expect(query(registry, 'act-strike')).toBeDefined();

    // 4. 只读投影。
    const projection = createProjection(registry, runtime, scope);
    expect(projection.entities.length).toBe(2);

    // 5. UI 描述符。
    const descriptor = uiDescriptor({ active: registry, runtimeState: runtime, query: { actorId: 'e:1', includeUnavailable: true }, scope, actionIds: ['act-strike'] });
    expect(descriptor.rejected).toBe(false);
    if (!descriptor.rejected) {
      const action = descriptor.value.paidActions.find((a) => a.actionId === 'act-strike');
      // 2026-08-08 权威变更：attackShape 字段已从 ActionDescriptor 删除（见 src/l2/model/projection.ts）。
      // 本断言随之移除；攻击形状语义已被武器属性（散射/扫射/连发）覆盖，不再由投影层承载。
      expect(action?.interactionIntent).toBe('hostile-interaction');
    }

    // 6. 统一提交经真实 OpRegistry 适配器包装的 KernelContract。
    const invokes: string[] = [];
    const fakeOpRegistry = {
      has: (name: string) => name === 'prop.add',
      invoke: <A, T>(name: string, _args: A) => {
        invokes.push(name);
        return { ok: true as const, value: undefined as unknown as T };
      },
    };
    let fp = 0;
    const kernel = createKernelContractFromOpRegistry({
      opRegistry: fakeOpRegistry,
      runtimeState: () => runtime,
      hookIntegrationAvailable: () => true,
      semanticStateFingerprint: () => `s:${fp}`,
      recordCause: () => {
        fp += 1;
      },
    });
    const request: ActionRequest = { requestId: 'r', actionId: 'act-strike', actorId: 'e:1', targetIds: ['e:2'], parameters: {} };
    const result = submitUiAction({ active: registry, kernel, request, scope, callerId: 'ui' });
    expect(result.rejected).toBe(false);
    // 真实动作链只走 OpRegistry.invoke 一次。
    expect(invokes).toEqual(['prop.add']);
  });

  it('非法包零变更', () => {
    const badJson = JSON.stringify({
      packageId: 'pkg-bad', schemaVersion: 'l2-declarative/1', dependencies: [], sourceRecords: [],
      definitions: [{ id: 'x', defKind: 'action', abstract: false, semanticFamily: { familyId: 'made-up' }, typeIdentity: { requiredCapabilities: [], legalRelationships: [], invariants: [], substitutionCompatibility: [] }, composition: [], parameterSchema: { fields: [], crossFieldConstraints: [] }, tags: [], actionRefs: [], ruleRefs: [], sourceRecords: [] }],
    });
    const parsed = parsePackage(badJson, { sourceLocation: { sourceFile: 'x', section: 's' }, packageId: 'pkg-bad' });
    // 解析通过（形状合法），但激活时验证拒绝（未登记族、缺来源）。
    const registry = emptyRegistry();
    if (!parsed.rejected) {
      const activation = activate(registry, parsed.value);
      expect(activation.rejected).toBe(true);
    }
    expect(registry.definitions.size).toBe(0);
  });
});
