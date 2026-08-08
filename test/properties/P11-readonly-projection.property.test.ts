// Feature: l2-base-layer-spec, Property 11: 只读投影不可变且受作用域限制
//
// 性质原文（design.md「Correctness Properties / Property 11」）：
//   For any authorization scope and any attempt by AI、UI 或测试消费方经
//   `Read_Only_Semantic_Projection` 或 `Presentation_Descriptor` 改写 Semantic_State，投影必须只包含
//   授权的认知与可见信息，写入必须返回 Structured_Rejection，且请求前 Semantic_State 保持等价。
//   替换 UI 渲染实现不得改变语义动作标识或验证结果。
//
// Validates: Requirements 10.7
// Additional coverage: Requirements 10.8–10.9, 14.1, 14.7–14.10
//
// 状态：✅ **全部运行，无跳过**。
//
// 测试接线说明（须知）：`attemptWrite` 通过构造一个携带 `semanticFieldWrites` 的 `ActionRequest`
// 并调用 `registry/action-submitter.ts` 的 `submit` 驱动统一拒绝入口。`submit` 是 design.md 中
// "经投影/描述符的写入尝试"的唯一实际入口——投影与描述符类型本身没有 setter，运行时唯一可观察的
// "写入尝试"形式就是携带 `semanticFieldWrites` 的动作请求。
//
// Bug 记录（两处均已修复，保留成因以免重蹈覆辙）：
//   1. 授权裁剪只做了一半。`read-only-projection.ts` 的 `projectVisibility` 只按
//      `authorizedAgents` 过滤"哪些 agent 的可见性条目会出现"，条目内部的
//      `visibleEntityIds`/`visibleNodeIds` 原样复制自运行时状态。结果：scope 未授权的实体/节点
//      标识仍会透过 visibility 条目泄漏，违反 Requirements 10.7。
//      修复：条目内容再按 `scope.visibleEntityIds` / `scope.visibleNodeIds` 求交集。
//      教训：授权裁剪必须同时作用于"哪些条目可见"和"条目内部列出了什么"，只做前者等于没做。
//   2. `PresentationDescriptor` 从不冻结。`adapters/ui-adapter.ts` 的 `uiDescriptor` 构造描述符
//      后直接返回，全文件不含任何 `deepFreeze` / `Object.freeze`，描述符成了调用方可写的别名。
//      修复：返回前 `deepFreeze`。`warnings` 的全部 push 都发生在描述符构造之前，冻结不截断诊断。
//      教训："深度不可变返回值"这条契约必须逐个出口落实；投影做了不代表描述符也做了。
//
// 被测实现：src/l2/registry/{read-only-projection,action-submitter}.ts、
//           src/l2/adapters/ui-adapter.ts、src/l2/registry/definition-registry.ts

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { isDeeplyFrozen } from '../../src/l2/model/immutable.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { RESOURCE_SEMANTIC_ROLES } from '../../src/l2/model/family-contracts.js';
import type { ResourceSemanticRole } from '../../src/l2/model/family-contracts.js';
import type {
  AuthorizationScope,
  CallerContext,
  PresentationDescriptor,
  ProjectionConsumer,
  ReadOnlySemanticProjection,
  RuntimeSemanticState,
  SemanticFieldWrite,
  UiQuery,
} from '../../src/l2/model/projection.js';
import { activate, emptyRegistry, type ActiveRegistry } from '../../src/l2/registry/definition-registry.js';
import { createProjection } from '../../src/l2/registry/read-only-projection.js';
import { submit } from '../../src/l2/registry/action-submitter.js';
import { uiDescriptor as realUiDescriptor } from '../../src/l2/adapters/ui-adapter.js';
import { FaultInjectableKernel } from '../../src/l2/testing/test-interface.js';
import { baseDefinition, singleDefinitionPackage, validActionContract } from '../../src/l2/testing/builders.js';

export interface ProjectionPort {
  project(scope: AuthorizationScope): ReadOnlySemanticProjection;
  uiDescriptor(query: UiQuery, scope: AuthorizationScope): Result<PresentationDescriptor>;
  attemptWrite(writes: readonly SemanticFieldWrite[], scope: AuthorizationScope): Result<unknown>;
  semanticState(): RuntimeSemanticState;
}

const ACTION_ID = 'gen-p11-action';
const ALL_ENTITY_IDS = ['gen-entity-a', 'gen-entity-b', 'gen-entity-secret'] as const;
const ALL_AGENT_IDS = ['gen-agent-a', 'gen-agent-b'] as const;
const ALL_NODE_IDS = ['gen-node-a', 'gen-node-b'] as const;

/** 真实适配器：装配一个含单个 Action_Family 定义的活动注册表 + 运行时状态 + Kernel double。 */
class RealProjectionPort implements ProjectionPort {
  private readonly active: ActiveRegistry;
  private readonly kernel: FaultInjectableKernel;
  private readonly runtime: RuntimeSemanticState;

  constructor() {
    const definition = baseDefinition({
      id: ACTION_ID,
      defKind: 'action',
      semanticFamily: { familyId: 'action' },
      familyContract: validActionContract('gen-p11-effect'),
    });
    const pkg = singleDefinitionPackage('pkg-p11', definition);
    const activation = activate(emptyRegistry(), pkg);
    if (!isOk(activation)) {
      throw new Error(`测试基线包激活失败（测试构造缺陷）：${JSON.stringify(activation.diagnostics)}`);
    }
    this.active = activation.value.registry;
    this.runtime = {
      turn: 1,
      entities: [
        {
          entityId: ALL_ENTITY_IDS[0],
          properties: [
            { name: 'hp', value: 5, resourceRole: 'hp', playerVisible: true },
            { name: 'stamina', value: 3, resourceRole: 'stamina', playerVisible: true },
          ],
          statusIds: [],
        },
        {
          entityId: ALL_ENTITY_IDS[1],
          properties: [],
          statusIds: [],
        },
        {
          entityId: ALL_ENTITY_IDS[2],
          properties: [{ name: 'secret', value: 42, resourceRole: 'ap', playerVisible: false }],
          statusIds: [],
        },
      ],
      beliefSlices: ALL_AGENT_IDS.map((agentId) => ({ agentId, facts: [{ factId: `fact-${agentId}`, subject: agentId, value: 1 }] })),
      visibility: ALL_AGENT_IDS.map((agentId) => ({
        agentId,
        visibleEntityIds: [...ALL_ENTITY_IDS],
        visibleNodeIds: [...ALL_NODE_IDS],
      })),
    };
    this.kernel = new FaultInjectableKernel(this.runtime, new Set(['prop.add']));
  }

  project(scope: AuthorizationScope): ReadOnlySemanticProjection {
    return createProjection(this.active, this.runtime, scope);
  }

  uiDescriptor(query: UiQuery, scope: AuthorizationScope): Result<PresentationDescriptor> {
    return realUiDescriptor({
      active: this.active,
      runtimeState: this.runtime,
      query,
      scope,
      actionIds: [ACTION_ID],
    });
  }

  attemptWrite(writes: readonly SemanticFieldWrite[], scope: AuthorizationScope): Result<unknown> {
    const caller: CallerContext = { callerId: 'gen-p11-caller', kind: 'other', scope };
    return submit({
      active: this.active,
      kernel: this.kernel,
      request: {
        requestId: 'gen-p11-write-attempt',
        actionId: ACTION_ID,
        actorId: ALL_ENTITY_IDS[0],
        targetIds: [],
        parameters: {},
        semanticFieldWrites: writes,
      },
      caller,
    });
  }

  semanticState(): RuntimeSemanticState {
    return this.runtime;
  }
}

interface ScopeCase {
  readonly consumer: ProjectionConsumer;
  readonly visibleEntityCount: number;
  readonly authorizedAgentCount: number;
  readonly visibleNodeCount: number;
  readonly authorizedRoles: readonly ResourceSemanticRole[];
  readonly rendererIdOrdinal: number;
  /** 写入尝试的目标是否落在授权范围外。 */
  readonly writeOutOfScope: boolean;
  readonly writeCount: number;
}

function buildScope(testCase: ScopeCase): AuthorizationScope {
  return {
    scopeId: `generated-scope-${testCase.consumer}`,
    consumer: testCase.consumer,
    agentId: ALL_AGENT_IDS[0],
    authorizedBeliefAgentIds: ALL_AGENT_IDS.slice(0, testCase.authorizedAgentCount),
    visibleEntityIds: ALL_ENTITY_IDS.slice(0, testCase.visibleEntityCount),
    visibleNodeIds: ALL_NODE_IDS.slice(0, testCase.visibleNodeCount),
    authorizedResourceRoles: testCase.authorizedRoles,
  };
}

function buildWrites(testCase: ScopeCase): readonly SemanticFieldWrite[] {
  const target = testCase.writeOutOfScope ? 'gen-entity-secret' : ALL_ENTITY_IDS[0];
  return Array.from({ length: testCase.writeCount }, (_, index) => ({
    path: `/entities/${target}/properties/${index}/value`,
    value: index + 1,
  }));
}

const arbScopeCase: fc.Arbitrary<ScopeCase> = fc.record({
  consumer: fc.constantFrom<ProjectionConsumer>('ai', 'ui', 'test', 'other'),
  visibleEntityCount: fc.integer({ min: 0, max: ALL_ENTITY_IDS.length - 1 }),
  authorizedAgentCount: fc.integer({ min: 0, max: ALL_AGENT_IDS.length }),
  visibleNodeCount: fc.integer({ min: 0, max: ALL_NODE_IDS.length }),
  authorizedRoles: fc.subarray([...RESOURCE_SEMANTIC_ROLES]),
  rendererIdOrdinal: fc.integer({ min: 0, max: 3 }),
  writeOutOfScope: fc.boolean(),
  writeCount: fc.integer({ min: 1, max: 3 }),
});

/** 完整断言体，驱动真实 `read-only-projection.ts` + `ui-adapter.ts` + `action-submitter.ts` 实现。 */
export function runReadOnlyProjectionProperty(makePort: () => ProjectionPort): void {
  fc.assert(
    fc.property(arbScopeCase, (testCase) => {
      const port = makePort();
      const scope = buildScope(testCase);

      const stateBefore = fingerprint(port.semanticState());
      const projection = port.project(scope);

      // ── 1. 投影只包含授权的认知与可见信息（Requirements 10.7、14.1） ──────────
      expect(projection.scopeId).toBe(scope.scopeId);
      expect(projection.consumer).toBe(scope.consumer);
      const visibleEntityIds = new Set(scope.visibleEntityIds);
      for (const entity of projection.entities) {
        expect(visibleEntityIds.has(entity.entityId)).toBe(true);
      }
      const authorizedAgents = new Set(scope.authorizedBeliefAgentIds);
      for (const slice of projection.beliefSlices) {
        expect(authorizedAgents.has(slice.agentId)).toBe(true);
      }
      // `read-only-projection.ts` 的 `projectVisibility` 把"授权认知 agent"定义为
      // scope 自身的 agentId 加上 authorizedBeliefAgentIds 的并集（调用方总能看见自己的
      // 可见性条目），而不是仅 authorizedBeliefAgentIds。oracle 须与之一致。
      const authorizedVisibilityAgents = new Set(
        [scope.agentId, ...scope.authorizedBeliefAgentIds].filter((id): id is string => id !== undefined),
      );
      for (const entry of projection.visibility) {
        expect(authorizedVisibilityAgents.has(entry.agentId)).toBe(true);
        // 注：VisibilityEntry.visibleNodeIds / visibleEntityIds 是否按
        // scope.visibleNodeIds / visibleEntityIds 裁剪，见下方被 skip 的
        // `runVisibilityEntryClippingClause`（Bug 记录：projectVisibility 未裁剪该字段）。
      }
      const authorizedRoles = new Set(scope.authorizedResourceRoles);
      for (const entity of projection.entities) {
        for (const property of entity.properties) {
          if (property.resourceRole !== undefined) {
            expect(authorizedRoles.has(property.resourceRole)).toBe(true);
          }
        }
      }

      // ── 2. 投影深度不可变，且不是活动对象的可写别名 ──────────────────────────
      expect(isDeeplyFrozen(projection)).toBe(true);
      expect(() => {
        (projection as unknown as Record<string, unknown>)['turn'] = -1;
      }).toThrow();
      expect(projection.turn).toBeGreaterThanOrEqual(0);
      expect(fingerprint(port.semanticState())).toBe(stateBefore);

      // ── 3. 经投影 / 描述符的写入尝试必须被拒绝且保持请求前状态 ────────────────
      const writes = buildWrites(testCase);
      const writeResult = port.attemptWrite(writes, scope);
      expect(isRejection(writeResult)).toBe(true);
      if (isRejection(writeResult)) {
        expect(writeResult.diagnostics.some(isErrorDiagnostic)).toBe(true);
        const codes = writeResult.diagnostics.map((diagnostic) => diagnostic.code);
        const rejectedByProjectionGuard =
          codes.includes(DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED) ||
          codes.includes(DIAGNOSTIC_CODES.PROJECTION_SCOPE_VIOLATION);
        expect(rejectedByProjectionGuard).toBe(true);
      }
      expect(fingerprint(port.semanticState())).toBe(stateBefore);

      // ── 4. 替换 UI 渲染实现不改变语义动作标识与验证结果（Requirements 14.8） ──
      const rendererA: UiQuery = {
        actorId: ALL_ENTITY_IDS[0],
        includeUnavailable: true,
        rendererId: `generated-renderer-${testCase.rendererIdOrdinal}`,
      };
      const rendererB: UiQuery = {
        actorId: ALL_ENTITY_IDS[0],
        includeUnavailable: true,
        rendererId: `generated-renderer-${testCase.rendererIdOrdinal + 1}`,
      };
      const descriptorA = port.uiDescriptor(rendererA, scope);
      const descriptorB = port.uiDescriptor(rendererB, scope);
      expect(isOk(descriptorA)).toBe(isOk(descriptorB));
      if (isOk(descriptorA) && isOk(descriptorB)) {
        // 注：PresentationDescriptor 是否深度冻结，见下方被 skip 的
        // `runDescriptorImmutabilityClause`（Bug 记录：uiDescriptor 从不调用 deepFreeze）。
        const actionIdsOf = (descriptor: PresentationDescriptor): readonly string[] => [
          ...descriptor.paidActions.map((action) => action.actionId),
          ...descriptor.attachedActions.map((action) => action.actionId),
        ];
        expect(actionIdsOf(descriptorB.value)).toEqual(actionIdsOf(descriptorA.value));
        const validationFacetsOf = (descriptor: PresentationDescriptor): readonly unknown[] => [
          ...descriptor.paidActions.map((a) => [a.actionId, a.available, a.unavailabilityReason]),
          ...descriptor.attachedActions.map((a) => [a.actionId, a.available, a.unavailabilityReason]),
        ];
        expect(validationFacetsOf(descriptorB.value)).toEqual(validationFacetsOf(descriptorA.value));
        // Paid_Action 与 Attached_Action 是两个独立动作组（Requirements 14.6）。
        const paidIds = new Set(descriptorA.value.paidActions.map((action) => action.actionId));
        for (const attached of descriptorA.value.attachedActions) {
          expect(paidIds.has(attached.actionId)).toBe(false);
        }
        // 描述符只暴露授权的资源语义角色。
        for (const resource of descriptorA.value.resources) {
          expect(authorizedRoles.has(resource.role)).toBe(true);
        }
      }
      expect(fingerprint(port.semanticState())).toBe(stateBefore);
    }),
    { numRuns: 100 },
  );
}

/**
 * 被 skip 的子句：`VisibilityEntry.visibleEntityIds` / `visibleNodeIds` 必须按
 * `scope.visibleEntityIds` / `scope.visibleNodeIds` 裁剪（design.md 「投影...按授权的认知与
 * 可见范围裁剪」；Requirements 10.7、14.1）。
 *
 * 现状：`read-only-projection.ts` 的 `projectVisibility` 只按 `authorizedAgents` 过滤
 * **哪些 agent 的可见性条目**会出现在投影里，但每个条目内部的 `visibleEntityIds` /
 * `visibleNodeIds` 原样复制自运行时状态，完全不做二次裁剪。若运行时状态里某个已授权 agent
 * 的可见性条目声称能看到 `scope.visibleNodeIds` 之外的节点，投影会原样透出。这不是"模块
 * 缺失"，是既有 `projectVisibility` 函数未覆盖该裁剪维度——因此如实记录为 SKIP。
 */
export function runVisibilityEntryClippingClause(makePort: () => ProjectionPort): void {
  fc.assert(
    fc.property(arbScopeCase, (testCase) => {
      const port = makePort();
      const scope = buildScope(testCase);
      const projection = port.project(scope);

      const visibleEntityIds = new Set(scope.visibleEntityIds);
      const visibleNodeIds = new Set(scope.visibleNodeIds);
      for (const entry of projection.visibility) {
        for (const entityId of entry.visibleEntityIds) {
          expect(visibleEntityIds.has(entityId)).toBe(true);
        }
        for (const nodeId of entry.visibleNodeIds) {
          expect(visibleNodeIds.has(nodeId)).toBe(true);
        }
      }
    }),
    { numRuns: 100 },
  );
}

/**
 * 被 skip 的子句：`PresentationDescriptor` 必须深度不可变（design.md
 * 「投影...深度不可变值返回」适用于全部只读投影产出，Property 11 明确覆盖
 * `Presentation_Descriptor`；Requirements 14.1）。
 *
 * 现状：`adapters/ui-adapter.ts` 的 `uiDescriptor` 构造描述符对象后直接 `return ok(descriptor,
 * warnings)`，全文件不含任何 `deepFreeze` / `Object.freeze` 调用（已用 grep 确认零匹配）。
 * 这不是"模块缺失"，是既有 `uiDescriptor` 函数未覆盖不可变性这一步——因此如实记录为 SKIP。
 */
export function runDescriptorImmutabilityClause(makePort: () => ProjectionPort): void {
  fc.assert(
    fc.property(arbScopeCase, (testCase) => {
      const port = makePort();
      const scope = buildScope(testCase);
      const query: UiQuery = { actorId: ALL_ENTITY_IDS[0], includeUnavailable: true };
      const descriptor = port.uiDescriptor(query, scope);
      expect(isOk(descriptor)).toBe(true);
      if (isOk(descriptor)) {
        expect(isDeeplyFrozen(descriptor.value)).toBe(true);
      }
    }),
    { numRuns: 100 },
  );
}

function loadProjectionPort(): ProjectionPort {
  return new RealProjectionPort();
}

describe('Property 11: 只读投影不可变且受作用域限制', () => {
  it('投影不可变、授权裁剪与写入拒绝（fast-check，100 次生成）', () => {
    runReadOnlyProjectionProperty(loadProjectionPort);
  });

  it('可见性条目内容必须落在授权范围内（fast-check，100 次生成）', () => {
    runVisibilityEntryClippingClause(loadProjectionPort);
  });

  it('描述符必须深度不可变（fast-check，100 次生成）', () => {
    runDescriptorImmutabilityClause(loadProjectionPort);
  });
});
