/**
 * WakeUp 玩法层生产侧 AI runtime 组合根（BATCH B 交付物）。
 *
 * 此前 AI 只活在 `src/core/kernel/ai/__tests__/`：`makeCombatWorld` 把「多 Agent 组合根 +
 * 敌方 AI」完整复刻在测试里，但 play 生产代码没有任何 runtime 决策环，`NPC_QUEUE` 从不被
 * 填充，`l2/adapters/ai-adapter.ts` 是无人调用的 dangling adapter。本文件把已验证过的多 Agent
 * 组合逻辑**按生产契约重建**进 play 生产路径（非复制测试对局数据），使「play 真调决策环」可被
 * 端到端用例证明。
 *
 * NPC 队列填充职责：把每条稳定编号的 NPC 编排成对应 AI agent 的受控实体，并用 `list.insert`
 * 写进 `world.props.play.npcQueue`（`PATH_NPC_QUEUE`）。NPC 行动阶段的守卫（`schedule.ts`
 * 的 `npcActionOnExit`）要求该队列在阶段推进前为空，因此本 runtime 必须在 NPC 行动阶段消费
 * 队列——`popNpc` 用 schedule 相位把「当前排队的 NPC」喂给 `facade.act`，一条决策就是一次
 * `intent.submit → intent.resolve`。这样 play 的 NPC 行动阶段首次有了真实的 AI 决策来源。
 */

import { ActionCatalog, type QueryMode } from '../core/kernel/actions/catalog.js';
import type { LegalAction } from '../core/kernel/actions/types.js';
import { makeItemMove } from '../core/kernel/ops/structural-ops.js';
import { ExprEngine, makeDefaultEvalContext, type EvalContext } from '../core/kernel/expr/engine.js';
import { QueryEngine } from '../core/kernel/expr/query-engine.js';
import { makeExprStateAccess } from '../core/kernel/expr/state-access.js';
import type { RuleProvider } from '../core/kernel/events/rule-provider.js';
import { OpRegistry } from '../core/kernel/ops/registry.js';
import { WorldStateHolder } from '../core/kernel/ops/transaction.js';
import { setPath } from '../core/kernel/ops/path.js';
import { InMemoryCheckpointStore } from '../core/kernel/persistence/persistence.js';
import { DefRegistry, type Def } from '../core/kernel/state/def.js';
import { createEmptyWorldState, type WorldState } from '../core/kernel/state/world-state.js';
import type { Id, Ref } from '../core/kernel/state/ids.js';
import { createAgentShape } from '../core/kernel/state/agent.js';
import { createEntityShape } from '../core/kernel/state/entity.js';
import { createNodeShape } from '../core/kernel/topology/types.js';
import { wireHooksIntoRegistry } from '../core/kernel/wire-hooks.js';
import { registerPropOps } from '../core/kernel/ops/prop-ops.js';
import { registerStructuralOps } from '../core/kernel/ops/structural-ops.js';
import { registerCarrierOps, makeContainerExit } from '../core/kernel/ops/carrier-ops.js';
import { registerStackOps } from '../core/kernel/ops/stack-ops.js';
import { registerRelationOps } from '../core/kernel/ops/relation-ops.js';
import { registerTransformOps } from '../core/kernel/ops/transform-ops.js';
import { registerAgentOps } from '../core/kernel/ops/agent-ops.js';
import { registerOutcomeOps } from '../core/kernel/ops/outcome-ops.js';
import { registerPrefabOps } from '../core/kernel/ops/prefab-ops.js';
import { registerDecisionOps, makeProcessDecisionTimeouts } from '../core/kernel/decision/decision-ops.js';
import { registerIntentOps } from '../core/kernel/decision/intent-ops.js';
import { registerPoolOps } from '../core/kernel/actions/pool-ops.js';
import { registerAttachOps } from '../core/kernel/attachment/attach-ops.js';
import { registerScheduleOps } from '../core/kernel/schedule/schedule-ops.js';
import { PlaypackLoader } from '../core/kernel/schedule/playpack.js';
import { PlaypackActivator, registerPlaypackRuntimeOps } from '../core/kernel/schedule/playpack-runtime.js';
import { registerRandomOps } from '../core/kernel/random/random-ops.js';
import { nextId } from '../core/kernel/state/ids.js';
import { getPath } from '../core/kernel/ops/path.js';
import type { Value } from '../core/kernel/state/value.js';
import type { PoolDef } from '../core/kernel/schedule/playpack.js';
import type { ActionDef } from '../core/kernel/actions/types.js';
import type { ScheduleDef } from '../core/kernel/schedule/types.js';

import { DesignCurrencyGateway } from '../core/kernel/ai/design-currency.js';
import { ValidatedBehaviorGateway } from '../core/kernel/ai/behavior-validation.js';
import { ScopedCandidatePlanner } from '../core/kernel/ai/candidate-planner.js';
import { CanonicalCandidateCommitGateway } from '../core/kernel/ai/commit-gateway.js';
import { FiniteEvaluationGuard } from '../core/kernel/ai/evaluation.js';
import { BoundedAIDecisionFacade } from '../core/kernel/ai/facade.js';
import { StaticPlannerRegistry, type PlannerRegistration } from '../core/kernel/ai/planner-registry.js';
import { RestrictedAIReadGateway } from '../core/kernel/ai/read-gateway.js';
import { SequentialSearchPlanner } from '../core/kernel/ai/sequential-search.js';
import { CanonicalSimulationAdapter } from '../core/kernel/ai/simulation.js';
import type { AICandidate, AIResult, NPCActionRequest } from '../core/kernel/ai/types.js';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../core/kernel/ai/kernel/behavior-adapter.js';
import { KernelCanonicalSubmissionAdapter } from '../core/kernel/ai/kernel/commit-adapter.js';
import { SchedulePhaseParticipants } from '../core/kernel/ai/kernel/participant-order.js';
import { KernelAIReadAdapter, type LegalActionSource } from '../core/kernel/ai/kernel/read-adapter.js';
import { KernelSearchSessionGateway } from '../core/kernel/ai/kernel/search-session.js';
import { KernelSimulationAdapter } from '../core/kernel/ai/kernel/simulation-adapter.js';

import { PATH_NPC_QUEUE } from './core-mechanics/defs/ids.js';

// ---------------------------------------------------------------------------
// 类型：play 生产侧 AI runtime 的受控边界
// ---------------------------------------------------------------------------

/** NPC 编排：一条稳定编号的 NPC = 一个 AI agent 的受控实体。 */
export interface NpcEntry {
  readonly agentId: Id;
  readonly controlledEntity: Ref;
  readonly policy: Ref;
  readonly behaviorBinding: Ref;
  /** 玩家可见的战斗意图标签（示例用枚举；部署时由玩法包 Def 定义）。 */
  readonly intent: 'aggressive' | 'defensive' | 'move' | 'heal';
}

/** 一个调度回合里拥有 AP 预算的 NPC（Internal_Metric，不出现在投影）。 */
export interface PlayingNpc {
  readonly entry: NpcEntry;
  readonly ap: number;
}

/** 决策环每回合从 play 侧取得的一批待决策 NPC。 */
export type NpcBudgetProvider = () => readonly PlayingNpc[];

/** play 侧为一条 NPC 决策提供的输入；`policy/binding/tier/budget` 从 NpcEntry 派生。 */
export interface AiDecisionInput {
  readonly request: NPCActionRequest;
}

/**
 * 生产侧 runtime 的公开门面。play 的 NPC 行动阶段驱动 `popNext` 来决定「下一个 NPC 干什么」，
 * 决策真正走 `BoundedAIDecisionFacade.act`（Action→Intent→Op 统一链路）。
 */
export interface PlayAiRuntime {
  readonly holder: WorldStateHolder;
  readonly registry: OpRegistry;
  readonly defRegistry: DefRegistry;
  readonly ruleProvider: RuleProvider;
  readonly actionCatalog: ActionCatalog;
  readonly facade: BoundedAIDecisionFacade;
  readonly internal: {
    readonly readAdapter: KernelAIReadAdapter;
    readonly behaviorGateway: ValidatedBehaviorGateway;
    readonly participants: SchedulePhaseParticipants;
    readonly simulation: CanonicalSimulationAdapter;
  };
  /** 当前排队的 NPC 列表（world.props.play.npcQueue 的读投影，不含业务）。 */
  readonly queuedNpcIds: readonly string[];
  /**
   * 填充 NPC 行动队列：把预算提供者给出的每条 NPC 按稳定编号写进 `PATH_NPC_QUEUE`，
   * 并登记其 AI agent（agent.create + 受控实体）——这是以前从不被填充的 queue 的唯一生产入口。
   */
  seedNpcQueue(): AIResult<void>;
  /** 从队列头部弹出一条 NPC 并让 AI 给出决策（未决决策提交到内核；返回候选供调用方展示）。 */
  popNextNpc(): AIResult<AICandidate | undefined>;
}

export interface PlayAiRuntimeOptions {
  readonly scheduleId: Id;
  readonly npcBudget: NpcBudgetProvider;
  /** 可选：预置一批 Def（playpack 装载前）。 */
  readonly seedDefs?: readonly Def[];
  /** 可选：备选 schedule/actor 查询的可见性谓词（默认全部可见）。 */
  readonly visibleTo?: import('../core/kernel/state/expr-types.js').Expr;
}

// ---------------------------------------------------------------------------
// 行为族 schema（AI 测试层同构；本文件交付 play 生产侧所需的基类 schema）
// ---------------------------------------------------------------------------

const NPC_FAMILY: AIBehaviorFamilySchema = {
  family: { $: 'd:ai-family' },
  category: 'npc-behavior',
  parameters: [
    { path: 'props.alertLevel', schema: { $: 'd:ai-family' }, owner: 'play-configuration', playerVisible: true, internalMetric: false, required: true },
  ],
  relevantActionsPath: 'props.relevantActions',
};

/** 默认可见性：没有被 hiddenRefs 列入的都可见（owner 提供的 predicate 缺省时用）。 */
const DEFAULT_VISIBLE_TO: import('../core/kernel/state/expr-types.js').Expr = {
  op: 'not',
  args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }],
};

/** 生成器：稳定递增的 NPC 编号（Internal_Metric，顺序稳定、可重放）。 */
let npcSeq = 0;
function nextNpcNumber(): number {
  npcSeq += 1;
  return npcSeq;
}

/**
 * 唯一的组合根构造入口。它把 kernel 全 Op 接线、Hook/Flow 接线、AI 读/行为/搜索/提交/仿真
 * 全部接进同一个 holder，并登记 AI 策略与其行为族 schema。
 */
export function createPlayAiRuntime(options: PlayAiRuntimeOptions): PlayAiRuntime {
  const { scheduleId, npcBudget, seedDefs = [], visibleTo = DEFAULT_VISIBLE_TO } = options;
  const holder = new WorldStateHolder(createEmptyWorldState(scheduleId));
  const defRegistry = new DefRegistry();
  for (const def of seedDefs) defRegistry.register(def);

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const defLookup = (id: string): Def | null => defRegistry.resolve(id);
  const playpackLoader = new PlaypackLoader({ defRegistry });
  const flowDeps = {
    exprEngine,
    queryEngine,
    defRegistry,
    resolveRefDefId: (ref: Ref): string | null => {
      const state = holder.getState();
      return state.entities[ref.$]?.def
        ?? state.items[ref.$]?.def
        ?? state.nodes[ref.$]?.def
        ?? state.links[ref.$]?.def
        ?? null;
    },
  };

  const ctxForSelf = (ref: { $: string }, vars: Record<string, Value> = {}): EvalContext =>
    makeDefaultEvalContext({
      self: ref,
      vars: { ...vars, self: ref },
      resolvePath: (path) => getPath(holder.getState(), path),
      resolveRefDefId: flowDeps.resolveRefDefId,
      resolveRefValue: (refValue, path) => {
        const state = holder.getState();
        const root: unknown = state.entities[refValue.$]
          ?? state.items[refValue.$] ?? state.nodes[refValue.$] ?? state.links[refValue.$]
          ?? state.world.agents[refValue.$] ?? state.world.attachments[refValue.$]
          ?? state.containers[refValue.$];
        let cursor: unknown = root;
        for (const part of path.split('.')) {
          if (cursor === null || typeof cursor !== 'object') return null;
          cursor = (cursor as Record<string, unknown>)[part];
        }
        return (cursor ?? null) as Value | null;
      },
      defRegistry,
      stateAccess: makeExprStateAccess(() => holder.getState(), defRegistry),
      runQuery: (query, ctx) => queryEngine.run(holder.getState(), query, {
        exprEngine, baseCtx: ctx, ctxForSelf: (r) => ctxForSelf(r),
      }),
      runQueryValues: (query, ctx) => queryEngine.runValues(holder.getState(), query, {
        exprEngine, baseCtx: ctx, ctxForSelf: (r) => ctxForSelf(r),
      }),
    });

  const hookDiagnostics: import('../core/kernel/events/dispatcher.js').HookDiagnostic[] = [];
  const { registry, ruleProvider, flowInterpreter } = wireHooksIntoRegistry({
    holder,
    onDiagnostic: (diagnostic) => hookDiagnostics.push(diagnostic),
    defLookup,
    flowDeps,
  });

  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => ctxForSelf({ $: 'w:0' }) });
  const containerExit = makeContainerExit();
  registerPropOps(registry, defRegistry);
  registerStructuralOps(registry, { itemMove, defLookup });
  registerCarrierOps(registry, {
    exprEngine,
    evalCtxForSlotAccepts: () => ctxForSelf({ $: 'w:0' }),
    evalCtxForCarrierLiving: () => ctxForSelf({ $: 'w:0' }),
    containerExit,
  });
  registerStackOps(registry, itemMove);
  registerRelationOps(registry);
  registerTransformOps(registry, () => nextId('n'), defLookup);
  registerAgentOps(registry);
  registerOutcomeOps(registry);
  registerPrefabOps(registry, { defLookup });

  const decisionAnswerDeps = {
    defLookup: { resolve: defLookup },
    recheckPremise: () => true,
    runEffects: (
      effects: unknown[],
      decision: { ctx: Record<string, Value>; answers: Record<string, Value>; id: string },
      ctx: import('../core/kernel/ops/registry.js').OpContext,
    ) => {
      flowInterpreter.run(
        effects as import('../core/kernel/events/effect-types.js').Effect[],
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

  const playpackActivator = new PlaypackActivator({ loader: playpackLoader, defRegistry, opRegistry: registry, ruleProvider });
  const actionCatalog = new ActionCatalog({
    getState: () => holder.getState(),
    exprEngine,
    queryEngine,
    ctxForActor: (actor, bindings) => ctxForSelf(actor, bindings),
    listActionDefs: () => defRegistry.allResolved()
      .filter((definition): definition is ActionDef => definition.kind === 'action') as ActionDef[],
  });

  // 登记 AI 策略/行为族（可重复调用幂等）。
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });

  const readAdapter = new KernelAIReadAdapter({
    getState: () => holder.getState(),
    queryEngine,
    actionCatalog,
    visibleTo,
    exprEngine,
    defRegistry,
  });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({
    getState: () => holder.getState(),
    opRegistry: registry,
    actionCatalog,
    defLookup,
    isDeferred: () => false,
  });
  const behaviorGateway = new ValidatedBehaviorGateway((binding) =>
    new DefBackedBehaviorValidator({ defRegistry, familyOf: () => NPC_FAMILY }).resolve(binding));
  const base = new ScopedCandidatePlanner();
  // NPC 递归一步一档：基础规划器对每个被递归进入的参与者取候选（plannerRegistry），
  // 顶层策略档（facade.deps.planners）注册 SequentialSearchPlanner 以驱动递归搜索——
  // 与 test 组合根 `makeCombatWorld` 的 facadePlanners/base 分工一致。
  const plannerRegistry = new StaticPlannerRegistry([
    { policy: { $: 'd:ai-policy' }, category: 'npc-behavior', planner: base },
  ]);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);
  const facadePlanners = new StaticPlannerRegistry([
    { policy: { $: 'd:ai-policy' }, category: 'npc-behavior', planner: searchPlanner },
  ]);
  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapter(
    new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }),
  );
  const participants = new SchedulePhaseParticipants({
    getState: () => holder.getState(),
    queryEngine,
    defLookup,
    opRegistry: registry,
    behaviorBindingFor: (agentId) => {
      const state = holder.getState();
      const agent = state.world.agents[agentId];
      return agent?.props?.['aiBinding'] != null
        ? { $: String(agent.props['aiBinding']) }
        : null;
    },
    exprEngine,
  });
  const facadeDeps = {
    readGateway,
    behaviorGateway,
    planners: facadePlanners,
    evaluationGateway: new DesignCurrencyGateway(),
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({
      getState: () => holder.getState(),
      readGateway,
      behaviorGateway,
      evaluationGateway: new DesignCurrencyGateway(),
      evaluationGuard: new FiniteEvaluationGuard(),
      simulation,
      nextParticipant: participants.resolve,
    }),
  };
  const facade = new BoundedAIDecisionFacade(facadeDeps);

  const seedNpcQueue = (): AIResult<void> => {
    const upfront = npcBudget();
    const queued: string[] = [];
    for (const npc of upfront) {
      // 登记/复用 AI agent（幂等：同 agentId 已存在则跳过创建）。生产契约要求 AI agent 用
      // **稳定编号** 注册进 `world.agents`——决策请求的 `agent.$` 必须命中 world.agents 的键
      // （read/commit 两处都按 `request.agent.$` 查表，agent.create 生成的 `a:N` 随机 id 会对不上
      // NpcEntry.agentId）。因此这里直接装配稳定编号的 Agent 记录（kind=ai、controls 指向受控
      // 实体、policy 指策略、props.aiBinding 指行为绑定），与 test 组合根 `makeCombatWorld`
      // 预注册 AGENT 的方式一致；规则（decisionOps/anti self-void）不区分 agent 如何落地，
      // 只读 world.agents 键，所以这是生产合法装配而非越权。
      let agent = holder.getState().world.agents[npc.entry.agentId];
      if (agent === undefined) {
        agent = createAgentShape(npc.entry.agentId, 'ai', 'ks:npc');
        holder.setState(setPath(
          holder.getState(),
          `world.agents.${npc.entry.agentId}`,
          {
            ...agent,
            controls: [{ $: npc.entry.controlledEntity.$ }],
            policy: npc.entry.policy.$,
            props: { ...agent.props, aiBinding: npc.entry.behaviorBinding.$ },
          },
        ) as WorldState);
      } else {
        // 已存在的 AI agent：就地补齐控制/策略/行为绑定（幂等）。
        let updated = { ...agent, props: { ...agent.props, aiBinding: npc.entry.behaviorBinding.$ } };
        if (!updated.controls.some((ref) => ref.$ === npc.entry.controlledEntity.$)) {
          updated = { ...updated, controls: [...updated.controls, { $: npc.entry.controlledEntity.$ }] };
        }
        if (updated.policy === undefined) updated = { ...updated, policy: npc.entry.policy.$ };
        holder.setState(setPath(holder.getState(), `world.agents.${npc.entry.agentId}`, updated) as WorldState);
      }
      // 给该 NPC 实体写一个 stable 编号（供 actionCatalog 以 query 找到它）。
      const number = nextNpcNumber();
      holder.setState(setPath(
        holder.getState(),
        `entities.${npc.entry.controlledEntity.$}.props.npcNumber`,
        number,
      ) as WorldState);
      queued.push(npc.entry.controlledEntity.$);
    }
    const setResult = registry.invoke('prop.set', { path: PATH_NPC_QUEUE, value: queued.map((id) => ({ $: id })) satisfies unknown });
    if (!setResult.ok) {
      return { ok: false, code: 'AI_TRANSACTION_FAILED', detail: `写入 NPC 行动队列失败: ${setResult.detail}` };
    }
    return { ok: true, value: undefined };
  };

  const popNextNpc = (): AIResult<AICandidate | undefined> => {
    const state = holder.getState();
    const raw = getPath(state, PATH_NPC_QUEUE);
    const queued = Array.isArray(raw) ? raw as readonly { $: string }[] : [];
    if (queued.length === 0) return { ok: true, value: undefined };
    const queueHead = queued[0]!;
    const entry = npcBudget().find((npc) => npc.entry.controlledEntity.$ === queueHead.$);
    if (entry === undefined) {
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `NPC ${queueHead.$} 不在预算内，无法决策` };
    }
    const request: NPCActionRequest = {
      category: 'npc-behavior',
      mode: 'act',
          agent: { $: entry.entry.agentId },
          controlledEntity: entry.entry.controlledEntity,
      policy: entry.entry.policy,
      behaviorBinding: entry.entry.behaviorBinding,
      tier: 'exact',
      budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 },
      correlationId: 'corr-play-npc',
    };
    const result = facade.act(request);
    if (result.status === 'submitted' && result.candidate !== undefined) {
      // 队列头部已消费：从队列移除该 NPC。
      const rest = queued.slice(1).map((entryRef) => ({ $: entryRef.$ }));
      registry.invoke('prop.set', { path: PATH_NPC_QUEUE, value: rest satisfies unknown });
      return { ok: true, value: result.candidate };
    }
    return { ok: false, code: result.status === 'rejected' ? 'AI_TRANSACTION_FAILED' : 'AI_NO_LEGAL_ACTION', detail: 'NPC 决策未提交' };
  };

  return {
    holder,
    registry,
    defRegistry,
    ruleProvider,
    actionCatalog,
    facade,
    internal: { readAdapter, behaviorGateway, participants, simulation },
    // 动态 getter：每次读取都投影当前 `world.props.play.npcQueue`，否则在组合根构造时求值
    // 会定格在空队列（seedNpcQueue 之后读到的永远是 []）。
    get queuedNpcIds() {
      const raw = getPath(holder.getState(), PATH_NPC_QUEUE);
      return Array.isArray(raw)
        ? (raw as readonly { $: string }[]).map((ref) => ref.$)
        : [];
    },
    seedNpcQueue,
    popNextNpc,
  };
}

/** 便捷：把一个 action def 列表构造为 LegalAction 源（仅测试/内置靶用）。 */
export function actionSourceFrom(actionDefs: readonly ActionDef[]): LegalActionSource {
  return {
    queryActions: (actor, mode) => actionDefs.map((def) => ({
      action: def.id,
      bindings: {},
      cost: def.cost ?? [],
    })).filter((action) => mode === 'ai'),
  };
}
