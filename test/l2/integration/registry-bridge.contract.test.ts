/**
 * L2 契约测试：注册表桥（Registry Bridge）—— 真实 L1 `OpRegistry`/`DefRegistry` 到 L2
 * 稳定端口的生产装配点契约（`docs/工程治理/04_整合层_装载运行期_规划设计.md` §2.6、§五 Q-5；
 * 缺漏现状见 `docs/工程治理/05_玩法层彻查CEME_立项轮廓.md` §四·补）。
 *
 * 与 P12-unified-submission-single-write-channel、end-to-end.integration.test.ts 同一精神：
 * 真实动作链只走真实 `OpRegistry.invoke` 一次；本测试的执行体是真实引擎实例（真实 Op、
 * 真实事务提交、真实状态落地），不是 Kernel double。
 *
 * 断言面：
 * - `invoke` 只在真实 `OpRegistry.invoke` 走一次（单通道，无本地旁路）。
 * - `hasOp` 反映真实 `registry.has`；Def 视图解析反映真实解析器（含继承展开）。
 * - 错误 map 后 `code/detail` 原样透传（不重写、不吞）；`classifyKernelErrorCode` 归类正确。
 * - `hookIntegrationAvailable` 不伪造；为 false 时依赖 Hook 的动作被拒（`action-submitter` 门禁）。
 * - 因果链经 `recordCause` 交给记录通道，不被丢弃。
 */

import { describe, it, expect } from 'vitest';
import { OpRegistry } from '../../../src/core/kernel/ops/registry.js';
import { WorldStateHolder } from '../../../src/core/kernel/ops/transaction.js';
import { createEmptyWorldState } from '../../../src/core/kernel/state/world-state.js';
import { DefRegistry } from '../../../src/core/kernel/state/def.js';
import { registerPropOps } from '../../../src/core/kernel/ops/prop-ops.js';
import { createRegistryBridge } from '../../../src/l2/kernel/registry-bridge.js';
import type { RegistryBridgeOpRegistry } from '../../../src/l2/kernel/registry-bridge.js';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { submit } from '../../../src/l2/registry/action-submitter.js';
import {
  baseDefinition,
  capabilityIdentity,
  singleDefinitionPackage,
} from '../../../src/l2/testing/builders.js';
import { classifyKernelErrorCode } from '../../../src/l2/kernel/kernel-contract.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { EMPTY_RUNTIME_SEMANTIC_STATE } from '../../../src/l2/model/projection.js';
import type { ActionRequest, AuthorizationScope, CallerContext, OpCause } from '../../../src/l2/model/projection.js';

// ───────────────────────────────────────────────────────────────────────────
// 真实引擎夹具：真实 OpRegistry（真实事务/不变量/Hook 接线）+ 真实 DefRegistry
// ───────────────────────────────────────────────────────────────────────────

interface Harness {
  readonly bridge: ReturnType<typeof createRegistryBridge>;
  readonly holder: WorldStateHolder;
  readonly defRegistry: DefRegistry;
  /** 至今为止经由真实 `OpRegistry.invoke` 的调用序列。 */
  readonly invocations: readonly string[];
}

function makeHarness(options?: { readonly hookAvailable?: boolean; readonly veto?: boolean }): Harness {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:bridge'));
  const hooks =
    options?.veto === true
      ? {
          dispatchBefore: (opName: string) =>
            opName === 'bridge.veto' ? { cancelled: true as const, reason: 'veto-test' } : { cancelled: false as const },
        }
      : {};
  const registry = new OpRegistry(holder, hooks);
  const defRegistry = new DefRegistry();
  registerPropOps(registry, defRegistry);
  // 结构性 Op 会套上真实 before-veto 分发；默认 Hook 不否决它。
  registry.register('bridge.veto', (_args, _ctx) => ({ ok: true as const, value: undefined }), { structural: true });

  const invocations: string[] = [];
  const opRegistry: RegistryBridgeOpRegistry = {
    has: (name: string) => registry.has(name),
    invoke: <A, T>(name: string, args: A) => {
      invocations.push(name);
      return registry.invoke<A, T>(name, args);
    },
  };
  const bridge = createRegistryBridge({
    opRegistry,
    defRegistry,
    runtimeState: () => EMPTY_RUNTIME_SEMANTIC_STATE,
    hookIntegrationAvailable: () => options?.hookAvailable ?? true,
  });
  return { bridge, holder, defRegistry, invocations };
}

/** 动作包：`act-gain-ap` 映射到真实 `prop.add`（常量参数写 `world.props.ap`，delta +1）。 */
function actionPackage(options?: { readonly requiresHookIntegration?: boolean; readonly opId?: string }) {
  const definition = baseDefinition({
    id: 'act-gain-ap',
    defKind: 'action',
    semanticFamily: { familyId: 'action' },
    typeIdentity: capabilityIdentity('act-gain-ap'),
    familyContract: {
      contractKind: 'action',
      costCategory: 'paid',
      apCost: 1,
      actorRequirements: [],
      targetRequirements: [],
      effectRefs: [],
      interruptionConditionRefs: [],
      completionState: 'done',
      availableAsDecisionBranch: true,
      requiresHookIntegration: options?.requiresHookIntegration ?? false,
      opMapping: {
        opId: options?.opId ?? 'prop.add',
        argumentMapping: [
          { opArgument: 'path', source: 'constant', constant: 'world.props.ap' },
          { opArgument: 'delta', source: 'constant', constant: 1 },
        ],
      },
    },
  });
  const activation = activate(emptyRegistry(), singleDefinitionPackage('pkg-bridge', definition));
  if (activation.rejected) {
    throw new Error(`测试夹具包激活失败（测试构造缺陷）：${JSON.stringify(activation.diagnostics)}`);
  }
  return activation.value.registry;
}

const scope: AuthorizationScope = {
  scopeId: 'bridge-scope',
  consumer: 'ui',
  agentId: 'e:1',
  authorizedBeliefAgentIds: [],
  visibleEntityIds: [],
  visibleNodeIds: [],
  authorizedResourceRoles: [],
};
const caller: CallerContext = { callerId: 'bridge-caller', kind: 'ui', scope };
const request: ActionRequest = { requestId: 'r1', actionId: 'act-gain-ap', actorId: 'e:1', targetIds: [], parameters: {} };

describe('注册表桥契约（真实 L1 装配）', () => {
  it('真实动作链只走真实 OpRegistry.invoke 一次，状态真实提交到 holder', () => {
    const { bridge, holder, invocations } = makeHarness();
    const active = actionPackage();

    const result = submit({ active, kernel: bridge.kernel, request, caller });
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.value.opId).toBe('prop.add');
      expect(result.value.journalEntries.some((entry) => entry === 'op=prop.add')).toBe(true);
    }
    // 单通道：一次动作恰好一次真实 invoke，无本地旁路。
    expect(invocations).toEqual(['prop.add']);
    // 真实 L1 事务提交落地：世界状态里 world.props.ap 已 +1。
    expect(holder.getState().world.props.ap).toBe(1);
  });

  it('hasOp 反映真实 registry.has，Def 视图解析反映真实解析器（含继承展开）', () => {
    const { bridge, defRegistry } = makeHarness();

    expect(bridge.kernel.hasOp('prop.add')).toBe(true);
    expect(bridge.kernel.hasOp('no.such.op')).toBe(false);

    defRegistry.register({ id: 'e:base', kind: 'entity', props: { hp: 3 } });
    defRegistry.register({ id: 'e:leaf', kind: 'entity', extends: ['e:base'], props: { ap: 2 } });

    const view = bridge.defs.resolve('e:leaf');
    expect(view).not.toBeNull();
    if (view !== null) {
      expect(view.id).toBe('e:leaf');
      expect(view.kind).toBe('entity');
      expect(view.abstract).toBe(false);
      // 继承已由真实 DefRegistry 解析器展开（hp 来自父定义）。
      expect(view.props).toEqual({ hp: 3, ap: 2 });
      // 视图只读：冻结副本，改动它不影响注册表内部。
      expect(Object.isFrozen(view)).toBe(true);
      expect(Object.isFrozen(view.props)).toBe(true);
    }
    expect(bridge.defs.has('e:base')).toBe(true);
    expect(bridge.defs.has('missing')).toBe(false);
    expect(bridge.defs.resolve('missing')).toBeNull();
  });

  it('L1 错误 code/detail 原样透传，classifyKernelErrorCode 归类正确', () => {
    const { bridge } = makeHarness();
    const cause: OpCause = { requestId: 'r', callerId: 'c', callerKind: 'ui', actionId: 'a' };

    // 未注册 Op → E_OP_NOT_FOUND 透传 + op-not-found。
    const notFound = bridge.kernel.invoke('no.such.op', {}, cause);
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) {
      expect(notFound.code).toBe('E_OP_NOT_FOUND');
      expect(notFound.detail).toContain('no.such.op');
      expect(notFound.kind).toBe('op-not-found');
    }

    // 真实 prop.add 拒绝非有限增量 → E_INV_* 透传 + invariant-violation。
    const invalid = bridge.kernel.invoke('prop.add', { path: 'world.props.ap', delta: Number.NaN }, cause);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.code).toBe('E_INV_NAN_OR_INFINITY');
      expect(invalid.detail).toContain('world.props.ap');
      expect(invalid.kind).toBe('invariant-violation');
    }

    expect(classifyKernelErrorCode('E_OP_NOT_FOUND')).toBe('op-not-found');
    expect(classifyKernelErrorCode('E_OP_VETOED')).toBe('vetoed');
    expect(classifyKernelErrorCode('E_OP_INVALID_ARGS')).toBe('invalid-args');
    expect(classifyKernelErrorCode('E_INV_DANGLING')).toBe('invariant-violation');
    expect(classifyKernelErrorCode('E_REF_MISSING')).toBe('transaction-aborted');
  });

  it('结构性 Op 被真实 Hook 否决时 E_OP_VETOED 原样透传', () => {
    const { bridge } = makeHarness({ veto: true });
    const cause: OpCause = { requestId: 'r', callerId: 'c', callerKind: 'ui', actionId: 'a' };

    const result = bridge.kernel.invoke('bridge.veto', {}, cause);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('E_OP_VETOED');
      expect(result.detail).toBe('veto-test');
      expect(result.kind).toBe('vetoed');
    }
  });

  it('hookIntegrationAvailable 不伪造：false 时依赖 Hook 的动作被拒且零 invoke', () => {
    const { bridge, invocations } = makeHarness({ hookAvailable: false });
    const active = actionPackage({ requiresHookIntegration: true });

    expect(bridge.kernel.hookIntegrationAvailable()).toBe(false);
    const result = submit({ active, kernel: bridge.kernel, request, caller });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.RUNTIME_HOOK_INTEGRATION_UNAVAILABLE)).toBe(true);
    }
    // 门禁在到达 Op 前拦截：真实 invoke 调用数为 0。
    expect(invocations).toHaveLength(0);
  });

  it('hook 可用时依赖 Hook 的动作正常执行（不伪造 false，也不伪造 true）', () => {
    const { bridge, holder, invocations } = makeHarness({ hookAvailable: true });
    const active = actionPackage({ requiresHookIntegration: true });

    const result = submit({ active, kernel: bridge.kernel, request, caller });
    expect(result.rejected).toBe(false);
    expect(invocations).toEqual(['prop.add']);
    expect(holder.getState().world.props.ap).toBe(1);
  });

  it('映射到未注册 Op 的动作被拒且零 invoke（RUNTIME_OP_MAPPING_MISSING）', () => {
    const { bridge, invocations } = makeHarness();
    const active = actionPackage({ opId: 'no.such.op' });

    const result = submit({ active, kernel: bridge.kernel, request, caller });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.RUNTIME_OP_MAPPING_MISSING)).toBe(true);
    }
    expect(invocations).toHaveLength(0);
  });

  it('因果链经 recordCause 交给记录通道，不被丢弃', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:bridge'));
    const registry = new OpRegistry(holder);
    const defRegistry = new DefRegistry();
    registerPropOps(registry, defRegistry);
    const recorded: OpCause[] = [];
    const bridge = createRegistryBridge({
      opRegistry: {
        has: (name) => registry.has(name),
        invoke: <A, T>(name: string, args: A) => registry.invoke<A, T>(name, args),
      },
      defRegistry,
      runtimeState: () => EMPTY_RUNTIME_SEMANTIC_STATE,
      hookIntegrationAvailable: () => true,
      recordCause: (_opId, cause) => recorded.push(cause),
    });

    const cause: OpCause = { requestId: 'r', callerId: 'c', callerKind: 'ui', actionId: 'a' };
    const result = bridge.kernel.invoke('prop.add', { path: 'world.props.ap', delta: 1 }, cause);
    expect(result.ok).toBe(true);
    expect(recorded).toEqual([cause]);
  });
});
