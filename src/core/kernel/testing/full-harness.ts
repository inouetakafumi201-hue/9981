/**
 * 全层接线合成根（供模糊测试使用）。
 *
 * 这是本次全面对抗性属性测试新增的组件：此前没有任何测试文件把 L1-L13 全部 registerXxxOps
 * 接到同一个 OpRegistry 上——每个既有测试文件只接线自己需要的那一小部分 Op（见探索报告第7节
 * 对 e2e.test.ts 的复核）。这里把全部已注册 Op 一次性接齐，暴露给模糊测试驱动器逐步调用，
 * 目的是让"层与层组合时才会暴露的不自洽"有地方发生。
 *
 * 第二轮整合（本次）：此前这个合成根用的是裸 `new OpRegistry(holder)`，没有接
 * HookDispatcher/FlowInterpreter——意味着"结构性 Op 触发 before/after 分发、分发出去的
 * RuleDef.effects 真正被 FlowInterpreter 执行、执行中的 op 效果又回调 invokeInline"这条链路
 * 从未在模糊测试里跑过。现在改为经由 `wireHooksIntoRegistry`（决策11 打通的真实接线）构造，
 * 使模糊测试的每一次随机 Op 调用都真实经过五阶段 Hook 分发。RuleProvider 为空时
 * candidatesFor 返回空集、dispatchBefore 直接返回 `{cancelled:false}`，因此不挂任何规则时
 * 行为与此前完全一致（既有 fuzz 属性不受影响），挂上规则后才会引入 veto/effects 的真实交互。
 *
 * 不引入任何新的写入语义——本文件只是把已有的 registerXxxOps 与 wireHooksIntoRegistry
 * 按依赖顺序调用一遍。
 */
import type { OpRegistry } from '../ops/registry.js';
import { WorldStateHolder } from '../ops/transaction.js';
import { createEmptyWorldState } from '../state/world-state.js';
import { DefRegistry } from '../state/def.js';
import type { Def } from '../state/def.js';
import type { ActionDef } from '../actions/types.js';
import { ActionCatalog } from '../actions/catalog.js';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine.js';
import type { EvalContext } from '../expr/engine.js';
import { QueryEngine } from '../expr/query-engine.js';
import { makeExprStateAccess } from '../expr/state-access.js';
import { wireHooksIntoRegistry } from '../wire-hooks.js';
import type { RuleProvider } from '../events/rule-provider.js';
import type { HookDispatcher } from '../events/dispatcher.js';
import type { HookDiagnostic } from '../events/dispatcher.js';
import type { FlowInterpreter } from '../flow/interpreter.js';
import { registerPropOps } from '../ops/prop-ops.js';
import { registerStructuralOps, makeItemMove } from '../ops/structural-ops.js';
import { registerCarrierOps, makeContainerExit } from '../ops/carrier-ops.js';
import { registerStackOps } from '../ops/stack-ops.js';
import { registerRelationOps } from '../ops/relation-ops.js';
import { registerTransformOps } from '../ops/transform-ops.js';
import { registerAgentOps } from '../ops/agent-ops.js';
import { registerOutcomeOps } from '../ops/outcome-ops.js';
import { registerPrefabOps } from '../ops/prefab-ops.js';
import { registerDecisionOps, makeProcessDecisionTimeouts } from '../decision/decision-ops.js';
import { registerIntentOps } from '../decision/intent-ops.js';
import { registerPoolOps } from '../actions/pool-ops.js';
import { registerAttachOps } from '../attachment/attach-ops.js';
import { registerScheduleOps } from '../schedule/schedule-ops.js';
import { PlaypackLoader } from '../schedule/playpack.js';
import { PlaypackActivator, registerPlaypackRuntimeOps } from '../schedule/playpack-runtime.js';
import { registerRandomOps } from '../random/random-ops.js';
import { nextId } from '../state/ids.js';
import { getPath } from '../ops/path.js';

export interface FullHarness {
  holder: WorldStateHolder;
  registry: OpRegistry;
  defRegistry: DefRegistry;
  /** 兼容旧调用点的只读视图；数据仍只来自 defRegistry，不再维护第二份 Map。 */
  defs: { get(id: string): Def | undefined };
  exprEngine: ExprEngine;
  queryEngine: QueryEngine;
  ctxForSelf: (ref: { $: string }) => EvalContext;
  /** Hook 接线产物：模糊测试可以往 ruleProvider 里挂 RuleDef 来引入真实的 veto/effects 交互。 */
  ruleProvider: RuleProvider;
  hookDispatcher: HookDispatcher;
  flowInterpreter: FlowInterpreter;
  playpackLoader: PlaypackLoader;
  playpackActivator: PlaypackActivator;
  actionCatalog: ActionCatalog;
  /** Hook 分发过程中产生的诊断（深度超限、重入、instead 冲突等），供属性断言检查。 */
  hookDiagnostics: HookDiagnostic[];
}

/**
 * 构建一个接齐全部已知 Op 的 OpRegistry，供模糊测试驱动器使用。
 * 所有 Def 查询统一读取同一个 DefRegistry，避免装载玩法包后出现注册表与旁路 Map 不一致。
 */
export function createFullHarness(seedDefs: Def[] = []): FullHarness {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:fuzz'));
  const defRegistry = new DefRegistry();

  for (const definition of seedDefs) {
    defRegistry.register(definition);
  }

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const defLookup = (id: string) => defRegistry.resolve(id);
  const playpackLoader = new PlaypackLoader({ defRegistry });

  // 拓扑/状态/关系/认知四类算子的只读访问面：传 getState 回调而非状态快照，保证 Op 执行过程中
  // 每次算子求值都读到当时的 draft，而不是 EvalContext 构造时刻的旧状态。
  const stateAccess = makeExprStateAccess(() => holder.getState(), defRegistry);

  const ctxForSelf = (ref: { $: string }, vars: Record<string, import('../state/value.js').Value> = {}): EvalContext =>
    makeDefaultEvalContext({
      self: ref,
      vars: { ...vars, self: ref },
      resolvePath: (path) => getPath(holder.getState(), path),
      defRegistry,
      stateAccess,
      runQuery: (query, ctx) => queryEngine.run(holder.getState(), query, {
        exprEngine, baseCtx: ctx, ctxForSelf: (r) => ctxForSelf(r),
      }),
      runQueryValues: (query, ctx) => queryEngine.runValues(holder.getState(), query, {
        exprEngine, baseCtx: ctx, ctxForSelf: (r) => ctxForSelf(r),
      }),
      resolveNamedExpr: (id) => {
        const definition = defRegistry.resolve(id);
        if (!definition || definition.kind !== 'expr' || definition['body'] === undefined) return null;
        return { body: definition['body'] as import('../state/expr-types.js').Expr };
      },
      resolveRefDefId: (candidate) => {
        const state = holder.getState();
        return state.entities[candidate.$]?.def
          ?? state.items[candidate.$]?.def
          ?? state.nodes[candidate.$]?.def
          ?? state.links[candidate.$]?.def
          ?? null;
      },
      resolveRefValue: (candidate, path) => {
        const state = holder.getState();
        const value = state.entities[candidate.$]
          ?? state.items[candidate.$]
          ?? state.nodes[candidate.$]
          ?? state.links[candidate.$]
          ?? state.world.agents[candidate.$]
          ?? state.world.attachments[candidate.$];
        if (!value) return null;
        return path.split('.').reduce<unknown>((current, segment) => {
          if (current === null || typeof current !== 'object') return null;
          return (current as Record<string, unknown>)[segment] ?? null;
        }, value) as import('../state/value.js').Value | null;
      },
    });

  // Hook/Flow 真实接线（决策11）：结构性 Op 的 before/after 经由 HookDispatcher 分发，
  // 分发命中的 RuleDef.effects 经由 FlowInterpreter 真正执行。
  const hookDiagnostics: HookDiagnostic[] = [];
  const { registry, ruleProvider, hookDispatcher, flowInterpreter } = wireHooksIntoRegistry({
    holder,
    onDiagnostic: (diagnostic) => hookDiagnostics.push(diagnostic),
    defLookup,
    flowDeps: { exprEngine, queryEngine, defRegistry },
  });

  const itemMove = makeItemMove({
    exprEngine,
    evalCtxForSlotAccepts: (_containerId, _slotIndex) => ctxForSelf({ $: 'w:0' }),
  });
  const containerExit = makeContainerExit();

  registerPropOps(registry, defRegistry);
  registerStructuralOps(registry, { itemMove, defLookup });
  registerCarrierOps(registry, {
    exprEngine,
    evalCtxForSlotAccepts: (_containerId, _slotIndex) => ctxForSelf({ $: 'w:0' }),
    evalCtxForCarrierLiving: (_containerId) => ctxForSelf({ $: 'w:0' }),
    containerExit,
  });
  registerStackOps(registry, itemMove);
  registerRelationOps(registry);
  registerTransformOps(registry, () => nextId('n'), defLookup);
  registerAgentOps(registry);
  registerOutcomeOps(registry);
  registerPrefabOps(registry, { defLookup });
  // Decision 的 onResolve/onVoid/超时效果经 FlowInterpreter 真正执行（此前 harness 用空实现，
  // 意味着决策效果与超时处理从未真跑过）。绑定 decision 的 ctx/answers 供效果表达式读取。
  const decisionAnswerDeps = {
    defLookup: { resolve: defLookup },
    recheckPremise: () => true,
    runEffects: (effects: unknown[], decision: { ctx: Record<string, import('../state/value.js').Value>; answers: Record<string, import('../state/value.js').Value>; id: string }, ctx: import('../ops/registry.js').OpContext) => {
      flowInterpreter.run(
        effects as import('../events/effect-types.js').Effect[],
        ctx,
        undefined,
        { decision: { $: decision.id }, ctx: decision.ctx, answers: decision.answers },
      );
    },
  };
  registerDecisionOps(registry, { resolve: defLookup }, decisionAnswerDeps, () => 0);
  registerPoolOps(registry, {
    poolDefs: () => playpackLoader.loadedPlaypacks().flatMap((playpack) => playpack.pools ?? []),
    exprEngine,
  });
  registerIntentOps(registry, {
    defLookup,
    now: () => 0,
    runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, undefined, vars).result,
  });
  registerAttachOps(registry, {
    defLookup,
    runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, undefined, vars).result,
  });
  registerScheduleOps(registry, {
    defLookup,
    runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, undefined, vars ?? {}).result,
    resetPools: (trigger, ctx) => registry.invokeInline('pool.reset', { trigger }, ctx),
    processDecisionTimeouts: makeProcessDecisionTimeouts(decisionAnswerDeps),
  });
  registerRandomOps(registry);
  registerPlaypackRuntimeOps(registry, {
    playpackLookup: (id) => playpackLoader.loadedPlaypacks().find((playpack) => playpack.id === id) ?? null,
    defLookup,
    runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, undefined, vars).result,
  });

  const playpackActivator = new PlaypackActivator({
    loader: playpackLoader,
    defRegistry,
    opRegistry: registry,
    ruleProvider,
  });
  const actionCatalog = new ActionCatalog({
    getState: () => holder.getState(),
    exprEngine,
    queryEngine,
    ctxForActor: (actor, bindings) => ctxForSelf(actor, bindings),
    listActionDefs: () => defRegistry.allResolved()
      .filter((definition): definition is ActionDef => definition.kind === 'action') as ActionDef[],
  });

  return {
    holder,
    registry,
    defRegistry,
    defs: { get: (id) => defRegistry.resolve(id) ?? undefined },
    exprEngine,
    queryEngine,
    ctxForSelf,
    ruleProvider,
    hookDispatcher,
    flowInterpreter,
    playpackLoader,
    playpackActivator,
    actionCatalog,
    hookDiagnostics,
  };
}

/**
 * 一组便于模糊测试引用的种子 Def：每个 DefKind 至少一个可解析实例。
 *
 * 第二轮整合新增 abstract Def 与其具体子类（决策10 的运行期严厉性校验需要被模糊测试真正命中——
 * 此前种子集里完全没有 abstract Def，意味着 checkInstantiable 的 abstract 分支从未在随机
 * Op 序列里被触发过，只有穷举单测覆盖）。命名约定：`d:abstract_*` 为抽象基类，
 * `d:concrete_*` 为继承自它的具体子类（用来验证"继承不传播 abstract"这条修正）。
 */
export function defaultSeedDefs(): Def[] {
  return [
    { id: 'd:human', kind: 'entity', clamp: { hp: { min: 0, max: 100 } } },
    { id: 'd:sword', kind: 'item' },
    { id: 'd:room', kind: 'node' },
    { id: 'd:door', kind: 'link' },
    { id: 'd:buff', kind: 'attachment', stackStrategy: 'count', maxStack: 5 } as unknown as Def,
    { id: 'd:move', kind: 'action', label: 'Move', require: true, cost: [], effects: [] } as unknown as Def,
    { id: 'd:vote', kind: 'decision', quorum: 'any', options: [{ name: 'yes', label: 'Yes' }], onTimeout: 'void', onResolve: [] } as unknown as Def,
    {
      id: 'p:room',
      kind: 'prefab',
      nodes: [{ key: 'root', def: 'd:room' }, { key: 'annex', def: 'd:room' }],
      links: [{ a: 'root', b: 'annex', def: 'd:door' }],
      attachTo: 'root',
    } as unknown as Def,
    { id: 'expr:always', kind: 'expr', body: true, pure: true } as unknown as Def,
    {
      id: 'sched:main',
      kind: 'schedule',
      phases: [{ kind: 'action', id: 'p:action' }, { kind: 'response', id: 'p:response' }],
      loop: true,
    } as unknown as Def,
    { id: 'pol:ai', kind: 'policy', mode: 'rules', policyRules: [] } as unknown as Def,

    // ---- abstract 基类与具体子类（决策10 的三维校验需要被随机序列命中）----
    { id: 'd:abstract_entity', kind: 'entity', abstract: true, props: { fromBase: true } },
    { id: 'd:concrete_entity', kind: 'entity', extends: ['d:abstract_entity'] },
    { id: 'd:abstract_item', kind: 'item', abstract: true },
    { id: 'd:concrete_item', kind: 'item', extends: ['d:abstract_item'] },
    { id: 'd:abstract_node', kind: 'node', abstract: true },
    { id: 'd:concrete_node', kind: 'node', extends: ['d:abstract_node'] },
    { id: 'd:abstract_link', kind: 'link', abstract: true },
    { id: 'd:concrete_link', kind: 'link', extends: ['d:abstract_link'] },
  ];
}

/** 供模糊测试引用的抽象 Def Id 全集（断言"任何序列都不能实例化它们"时使用）。 */
export const ABSTRACT_SEED_DEF_IDS = [
  'd:abstract_entity',
  'd:abstract_item',
  'd:abstract_node',
  'd:abstract_link',
] as const;

/** 供模糊测试引用的、继承自抽象基类的具体 Def Id 全集（断言"这些反而必须能实例化"）。 */
export const CONCRETE_SUBCLASS_DEF_IDS = [
  'd:concrete_entity',
  'd:concrete_item',
  'd:concrete_node',
  'd:concrete_link',
] as const;
