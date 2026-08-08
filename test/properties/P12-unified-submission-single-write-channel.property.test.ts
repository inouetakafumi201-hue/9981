// Feature: l2-base-layer-spec, Property 12: 统一动作提交与单一写入通道
//
// 性质原文（design.md「Correctness Properties / Property 12」）：
//   For any valid action request from AI、UI 或其他调用方，按已解析 Action_Family 验证后产生的写
//   请求必须映射到该动作引用的结构化 Op，并且仅由 `OpRegistry.invoke` 执行；任一动作或网关前置
//   条件失败、不可用请求或未满足的 Hook 接线前置条件都不得调用效果 Op，并保持适用的操作前状态。
//
// Validates: Requirements 6.1
// Additional coverage: Requirements 6.2–6.10, 10.9, 13.6–13.7, 14.6–14.7, 15.13
//
// 状态：✅ 运行中（两个子句均已解除阻塞）。
//   子句 A——「仅由 `OpRegistry.invoke` 执行、L2 内不存在第二写入通道」，由 L0「四、引擎层铁律 /
//      4.1 Op 通道铁律」强制；`src/l2/kernel/{kernel-contract,op-registry-adapter}.ts` 已完整验证。
//   子句 B——「按已解析 Action_Family 验证 → 映射结构化 Op → 前置条件/网关/Hook 失败不调用效果
//      Op 并保持操作前状态」。本文件最初编写时 `src/l2/registry/action-submitter.ts` 尚不存在，
//      整体标记为 SKIPPED。复核时发现该模块已落地，遂把 `loadSubmissionHarness()` 从"抛出阻塞
//      原因"改为真实夹具（见下方 `RealSubmissionHarness`）。断言体本身未作任何改动或放宽。
//
// 自主设计判断（须知，历史留存）：本文件保留两个独立 `describe`/`it`（而非"一性质一
// fc.assert"），因为子句 A 是静态扫描 + Kernel double 行为验证，子句 B 是真实 registry + submit
// 集成验证，二者的被测对象与生成器完全不同，合并为一个 `fc.assert` 反而会削弱各自的收缩能力。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  classifyKernelErrorCode,
  KERNEL_ERROR_KINDS,
} from '../../src/l2/kernel/kernel-contract.js';
import type { KernelContract, KernelErrorKind } from '../../src/l2/kernel/kernel-contract.js';
import { createKernelContractFromOpRegistry } from '../../src/l2/kernel/op-registry-adapter.js';
import type { OpRegistry } from '../../src/core/kernel/ops/registry.js';
import type { Result as L1Result } from '../../src/core/kernel/ops/result.js';
import type { ErrCode } from '../../src/core/kernel/state/error-codes.js';
import type { JsonValue } from '../../src/l2/model/json.js';
import { EMPTY_RUNTIME_SEMANTIC_STATE } from '../../src/l2/model/projection.js';
import type {
  ActionRequest,
  CallerContext,
  CallerKind,
  OpCause,
  OpResult,
  RuntimeSemanticState,
} from '../../src/l2/model/projection.js';
import type { StructuredRejection } from '../../src/l2/model/diagnostic.js';
import { isOk } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import type { CandidateDefinition } from '../../src/l2/model/definition.js';
import { activate, emptyRegistry, type ActiveRegistry } from '../../src/l2/registry/definition-registry.js';
import { submit } from '../../src/l2/registry/action-submitter.js';
import { FaultInjectableKernel } from '../../src/l2/testing/test-interface.js';
import { baseDefinition, multiDefinitionPackage, typedRef } from '../../src/l2/testing/builders.js';

// ───────────────────────────────────────────────────────────────────────────
// 运行中子句 A：L2 侧不存在第二写入通道（静态 + 行为双重验证）
// ───────────────────────────────────────────────────────────────────────────

const L2_ROOT = fileURLToPath(new URL('../../src/l2/', import.meta.url));

/** 唯一允许绑定 L1 `OpRegistry` 的 L2 文件（design.md「运行时写入边界」）。 */
const SOLE_KERNEL_BINDING = 'kernel/op-registry-adapter.ts';

function collectTypeScriptFiles(directory: string, accumulated: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      collectTypeScriptFiles(absolute, accumulated);
      continue;
    }
    if (entry.endsWith('.ts')) {
      accumulated.push(absolute);
    }
  }
  return accumulated;
}

const L2_FILES: readonly string[] = Object.freeze(
  collectTypeScriptFiles(L2_ROOT).map((absolute) => relative(L2_ROOT, absolute).split('\\').join('/')),
);

/** L1 写入通道的导入形态。 */
const L1_REGISTRY_IMPORT = /from\s+'[^']*core\/kernel\/ops\/registry(?:\.js)?'/u;
/** 对 OpRegistry 实例的直接写调用。 */
const OP_REGISTRY_INVOKE_CALL = /\bopRegistry\s*\.\s*invoke\s*\(/u;
/** 在 L2 内自行实例化 L1 写入通道。 */
const OP_REGISTRY_CONSTRUCTION = /\bnew\s+OpRegistry\s*\(/u;

interface InvokeCall {
  readonly name: string;
  readonly args: unknown;
}

interface OpRegistryDouble {
  readonly invokeCalls: InvokeCall[];
  readonly hasCalls: string[];
  readonly registry: Pick<OpRegistry, 'invoke' | 'has'>;
}

function makeOpRegistryDouble(
  registeredOps: ReadonlySet<string>,
  failureCode: ErrCode | undefined,
): OpRegistryDouble {
  const invokeCalls: InvokeCall[] = [];
  const hasCalls: string[] = [];
  const registry: Pick<OpRegistry, 'invoke' | 'has'> = {
    has(name: string): boolean {
      hasCalls.push(name);
      return registeredOps.has(name);
    },
    invoke<A, T>(name: string, args: A): L1Result<T> {
      invokeCalls.push({ name, args });
      if (!registeredOps.has(name)) {
        return { ok: false, code: 'E_OP_NOT_FOUND', detail: `未注册的 Op: ${name}` };
      }
      if (failureCode !== undefined) {
        return { ok: false, code: failureCode, detail: '注入的 L1 失败' };
      }
      return { ok: true, value: undefined as unknown as T };
    },
  };
  return { invokeCalls, hasCalls, registry };
}

/** 预先计算：L2 内绑定 L1 写入通道的文件集合。 */
const KERNEL_BINDING_FILES: readonly string[] = Object.freeze(
  L2_FILES.filter((file) => L1_REGISTRY_IMPORT.test(readFileSync(join(L2_ROOT, file), 'utf8'))),
);

const OP_ID_POOL = ['prop.add', 'prop.set', 'entity.create', 'relation.link'] as const;
const INJECTED_ERROR_CODES: readonly ErrCode[] = ['E_OP_VETOED', 'E_OP_INVALID_ARGS', 'E_INV_DANGLING'];

describe('Property 12: 统一动作提交与单一写入通道', () => {
  it('唯一写入通道不变量：L2 内不存在第二写入分支（fast-check，100 次生成）', () => {
    // 前置事实断言：L2 里恰好只有一个文件绑定 L1 `OpRegistry`。
    expect([...KERNEL_BINDING_FILES]).toEqual([SOLE_KERNEL_BINDING]);
    expect(L2_FILES.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...L2_FILES),
        fc.constantFrom(...OP_ID_POOL),
        fc.boolean(),
        fc.option(fc.constantFrom(...INJECTED_ERROR_CODES), { nil: undefined }),
        fc.boolean(),
        fc.dictionary(fc.constantFrom('target', 'amount', 'path'), fc.integer({ min: 1, max: 5 }), {
          maxKeys: 3,
        }),
        (l2File, opId, opRegistered, injectedFailure, hookAvailable, rawArgs) => {
          // ── 静态面：除唯一绑定点外，任何 L2 源文件都不得触达 L1 写入通道 ──────
          const text = readFileSync(join(L2_ROOT, l2File), 'utf8');
          if (l2File !== SOLE_KERNEL_BINDING) {
            expect(L1_REGISTRY_IMPORT.test(text)).toBe(false);
            expect(OP_REGISTRY_INVOKE_CALL.test(text)).toBe(false);
          }
          // 任何 L2 文件都不得自行实例化 L1 写入通道（那会绕开注入边界另开一条写路径）。
          expect(OP_REGISTRY_CONSTRUCTION.test(text)).toBe(false);

          // ── 行为面：契约只有一个方法会产生 L1 写入 ─────────────────────────
          const registeredOps: ReadonlySet<string> = new Set(opRegistered ? [opId] : []);
          const double = makeOpRegistryDouble(registeredOps, injectedFailure);
          const recordedCauses: { readonly opId: string; readonly cause: OpCause }[] = [];
          const runtimeState: RuntimeSemanticState = EMPTY_RUNTIME_SEMANTIC_STATE;

          const contract: KernelContract = createKernelContractFromOpRegistry({
            opRegistry: double.registry,
            runtimeState: () => runtimeState,
            hookIntegrationAvailable: () => hookAvailable,
            recordCause: (recordedOpId, cause) => recordedCauses.push({ opId: recordedOpId, cause }),
          });

          const readMethods = Object.keys(contract).filter((key) => key !== 'invoke');
          expect(readMethods.sort()).toEqual(
            ['hasOp', 'hookIntegrationAvailable', 'runtimeState', 'semanticStateFingerprint'].sort(),
          );
          for (const method of readMethods) {
            const callable = (contract as unknown as Record<string, (arg?: unknown) => unknown>)[method]!;
            callable.call(contract, opId);
          }
          // 读方法一次也不触发写入。
          expect(double.invokeCalls).toHaveLength(0);
          expect(contract.hookIntegrationAvailable()).toBe(hookAvailable);
          expect(contract.hasOp(opId)).toBe(opRegistered);

          const fingerprintBefore = contract.semanticStateFingerprint();
          const args: Readonly<Record<string, JsonValue>> = { ...rawArgs };
          const cause: OpCause = {
            requestId: 'generated-request',
            callerId: 'generated-caller',
            callerKind: 'other',
            actionId: 'generated-action',
          };

          const result = contract.invoke(opId, args, cause);

          // 一次语义写入请求恰好转发一次 L1 `OpRegistry.invoke`，参数与 opId 原样透传。
          expect(double.invokeCalls).toHaveLength(1);
          expect(double.invokeCalls[0]!.name).toBe(opId);
          expect(double.invokeCalls[0]!.args).toBe(args);
          // 因果链被交给记录通道，不会被丢弃。
          expect(recordedCauses).toHaveLength(1);
          expect(recordedCauses[0]!.opId).toBe(opId);
          expect(recordedCauses[0]!.cause).toBe(cause);

          const expectedOk = opRegistered && injectedFailure === undefined;
          expect(result.ok).toBe(expectedOk);
          if (result.ok) {
            expect(result.semanticStateFingerprintAfter).toBe(fingerprintBefore);
            expect(result.journalEntries.some((entry) => entry === `op=${opId}`)).toBe(true);
          } else {
            const expectedCode: ErrCode = opRegistered ? injectedFailure! : 'E_OP_NOT_FOUND';
            // L1 错误代码与细节原样透传，不被重写或吞掉。
            expect(result.code).toBe(expectedCode);
            const expectedKind: KernelErrorKind = classifyKernelErrorCode(expectedCode);
            expect(result.kind).toBe(expectedKind);
            expect(KERNEL_ERROR_KINDS.includes(result.kind)).toBe(true);
            // 失败路径保持操作前语义状态（Requirements 13.6–13.7）。
            expect(result.semanticStateFingerprintAfter).toBe(fingerprintBefore);
          }
          expect(contract.semanticStateFingerprint()).toBe(fingerprintBefore);

          // 再次调用只增加一次转发：不存在"一次请求多次写入"或旁路写入。
          contract.invoke(opId, args, cause);
          expect(double.invokeCalls).toHaveLength(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 子句 B：统一 submit 路径与前置条件失败不调用效果 Op
// ───────────────────────────────────────────────────────────────────────────
//
// 编写历史说明（须知）：本子句最初编写时 `src/l2/registry/action-submitter.ts` 尚不存在，
// 标记为 SKIPPED。复核时发现该模块已落地（`submit` 实现见 design.md「运行时拒绝与唯一写入
// 通道」伪代码的忠实翻译），因此把 `loadSubmissionHarness()` 从"抛出阻塞原因"改为真实适配器。
// 断言体本身未作任何改动或放宽。

export interface ActionSubmitterPort {
  submit(request: ActionRequest, actor: CallerContext): Result<OpResult>;
}

/** 供被阻塞性质使用的可观测环境：submit 必须只能经由该 kernel 契约写入。 */
export interface SubmissionHarness {
  readonly submitter: ActionSubmitterPort;
  /** 至今为止经由 L1 `OpRegistry.invoke` 的调用次数。 */
  effectOpInvocationCount(): number;
  /** 当前语义状态指纹。 */
  semanticStateFingerprint(): string;
  /** 该动作是否应当被接受（由夹具按已解析 Action_Family 事先决定）。 */
  expectedAcceptance(request: ActionRequest, actor: CallerContext): boolean;
}

const arbCallerKind: fc.Arbitrary<CallerKind> = fc.constantFrom<CallerKind>('ai', 'ui', 'other');

/** 完整断言体，驱动真实 `registry/action-submitter.ts` 的 `submit` 实现。 */
export function runUnifiedSubmissionProperty(makeHarness: () => SubmissionHarness): void {
  fc.assert(
    fc.property(
      arbCallerKind,
      fc.constantFrom('gen-action-paid', 'gen-action-attached', 'gen-action-gated', 'gen-action-unknown'),
      fc.array(fc.constantFrom('gen-target-a', 'gen-target-b', 'gen-target-out-of-scope'), {
        maxLength: 2,
      }),
      fc.dictionary(fc.constantFrom('amount', 'doorId'), fc.integer({ min: 1, max: 5 }), { maxKeys: 2 }),
      (callerKind, actionId, targetIds, parameters) => {
        const harness = makeHarness();
        const request: ActionRequest = {
          requestId: `generated-request-${actionId}`,
          actionId,
          actorId: 'generated-actor',
          targetIds,
          parameters,
        };
        const actor: CallerContext = {
          callerId: `generated-${callerKind}-caller`,
          kind: callerKind,
          scope: {
            scopeId: 'generated-scope',
            consumer: callerKind === 'other' ? 'other' : callerKind,
            agentId: 'generated-actor',
            authorizedBeliefAgentIds: ['generated-actor'],
            visibleEntityIds: ['generated-actor', 'gen-target-a', 'gen-target-b'],
            visibleNodeIds: ['gen-node-a'],
            authorizedResourceRoles: ['hp', 'stamina', 'ap'],
          },
        };

        const fingerprintBefore = harness.semanticStateFingerprint();
        const invocationsBefore = harness.effectOpInvocationCount();
        const shouldAccept = harness.expectedAcceptance(request, actor);

        const result = harness.submitter.submit(request, actor);

        if (shouldAccept) {
          // 有效请求：恰好一次结构化 Op 写入，且只经 OpRegistry.invoke。
          expect(result.rejected).toBe(false);
          expect(harness.effectOpInvocationCount()).toBe(invocationsBefore + 1);
        } else {
          // 前置条件 / 网关 / 可用性 / Hook 接线失败：零效果 Op，语义状态不变。
          expect(result.rejected).toBe(true);
          const rejection = result as StructuredRejection;
          expect(rejection.diagnostics.some((d) => d.severity === 'Error')).toBe(true);
          expect(harness.effectOpInvocationCount()).toBe(invocationsBefore);
          expect(harness.semanticStateFingerprint()).toBe(fingerprintBefore);
        }
      },
    ),
    { numRuns: 100 },
  );
}

/**
 * 真实测试夹具：装配三个 Action_Family 定义 + `FaultInjectableKernel` double + 真实 `submit`。
 *
 * - `gen-action-paid`：Paid_Action，opMapping 指向已在 kernel double 注册的 `prop.add`，
 *   `requiresHookIntegration: false` —— 目标在授权可见范围内时应被接受。
 * - `gen-action-attached`：Attached_Action，依附 `gen-action-paid` —— 按 Requirements 6.3
 *   不能作为独立请求提交，submit 必然拒绝（`RUNTIME_ACTION_UNAVAILABLE`）。
 * - `gen-action-gated`：Paid_Action，`requiresHookIntegration: true`，而 double 的
 *   `hookIntegrationAvailable()` 固定为 false —— 必然拒绝（`RUNTIME_HOOK_INTEGRATION_UNAVAILABLE`），
 *   且在到达 Op 调用前就被拦截。
 * - `gen-action-unknown`：不注册任何定义 —— 必然拒绝（`RUNTIME_ACTION_UNRESOLVED`）。
 *
 * `gen-target-out-of-scope` 不在 `actor.scope.visibleEntityIds` 内，任何请求携带它都必然拒绝
 * （`RUNTIME_TARGET_OUT_OF_SCOPE`），且该检查发生在动作类别检查之前但之后于动作解析。
 */
class RealSubmissionHarness implements SubmissionHarness {
  readonly submitter: ActionSubmitterPort;
  private readonly active: ActiveRegistry;
  private readonly kernel: FaultInjectableKernel;

  constructor() {
    const paid: CandidateDefinition = baseDefinition({
      id: 'gen-action-paid',
      defKind: 'action',
      semanticFamily: { familyId: 'action' },
      familyContract: {
        contractKind: 'action',
        costCategory: 'paid',
        apCost: 1,
        actorRequirements: [],
        targetRequirements: [],
        effectRefs: [],
        interruptionConditionRefs: [],
        completionState: 'generated-completed',
        availableAsDecisionBranch: true,
        requiresHookIntegration: false,
        opMapping: { opId: 'prop.add', argumentMapping: [{ opArgument: 'target', source: 'target' }] },
      },
    });
    const attached: CandidateDefinition = baseDefinition({
      id: 'gen-action-attached',
      defKind: 'action',
      semanticFamily: { familyId: 'action' },
      familyContract: {
        contractKind: 'action',
        costCategory: 'attached',
        apCost: 0,
        actorRequirements: [],
        targetRequirements: [],
        effectRefs: [],
        interruptionConditionRefs: [],
        completionState: 'generated-completed',
        availableAsDecisionBranch: false,
        requiresHookIntegration: false,
        hostActionRef: typedRef('gen-action-paid', 'host', { defKind: 'action', allowAbstract: false }),
      },
    });
    const gated: CandidateDefinition = baseDefinition({
      id: 'gen-action-gated',
      defKind: 'action',
      semanticFamily: { familyId: 'action' },
      familyContract: {
        contractKind: 'action',
        costCategory: 'paid',
        apCost: 1,
        actorRequirements: [],
        targetRequirements: [],
        effectRefs: [],
        interruptionConditionRefs: [],
        completionState: 'generated-completed',
        availableAsDecisionBranch: true,
        requiresHookIntegration: true,
        opMapping: { opId: 'prop.set', argumentMapping: [{ opArgument: 'target', source: 'target' }] },
      },
    });

    const pkg = multiDefinitionPackage('pkg-p12-submit', [paid, attached, gated]);
    const activation = activate(emptyRegistry(), pkg);
    if (!isOk(activation)) {
      throw new Error(`测试夹具包激活失败（测试构造缺陷）：${JSON.stringify(activation.diagnostics)}`);
    }
    this.active = activation.value.registry;
    this.kernel = new FaultInjectableKernel(EMPTY_RUNTIME_SEMANTIC_STATE, new Set(['prop.add']), {
      hookAvailable: false,
    });
    this.submitter = {
      submit: (request, actor) => submit({ active: this.active, kernel: this.kernel, request, caller: actor }),
    };
  }

  effectOpInvocationCount(): number {
    return this.kernel.invocations();
  }

  semanticStateFingerprint(): string {
    return this.kernel.semanticStateFingerprint();
  }

  expectedAcceptance(request: ActionRequest): boolean {
    if (request.targetIds.includes('gen-target-out-of-scope')) {
      return false;
    }
    return request.actionId === 'gen-action-paid';
  }
}

function loadSubmissionHarness(): SubmissionHarness {
  return new RealSubmissionHarness();
}

describe('Property 12: 统一动作提交与单一写入通道（子句 B）', () => {
  it('统一 submit 路径与失败零写入（fast-check，100 次生成）', () => {
    runUnifiedSubmissionProperty(loadSubmissionHarness);
  });
});
