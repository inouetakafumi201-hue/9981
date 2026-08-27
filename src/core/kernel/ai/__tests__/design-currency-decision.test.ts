/**
 * Design Currency 驱动真实 AI 决策的端到端用例测试。
 *
 * 目的：证明「设计货币」不只是能算出一个数（见 design-currency.test.ts），
 * 而是能让 AI 在真实内核决策链路上做出趋利避害的选择。
 *
 * 装配：复用 sequential-kernel.test 的内核接线（KernelAIReadAdapter +
 * BoundedAIDecisionFacade + SequentialSearchPlanner），但把估值来源换成
 * `DesignCurrencyGateway`，并让每个候选动作对实体 `props.vitality` 产生不同
 * 的后缀状态——这样设计货币的「死亡锚 / 分水岭修正」就能决定 AI 选哪条分支。
 *
 * 铁律：实体 props 位于 `entities.<id>.props.*` 自由区，`vitality` 是玩法层
 * 已下发的活体属性名（`defs/ids.ts` PROP_VITALITY）。所有可见数值保持 1-5。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionCatalog } from '../../actions/catalog';
import { registerIntentOps } from '../../decision/intent-ops';
import { registerScheduleOps } from '../../schedule/schedule-ops';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import { QueryEngine } from '../../expr/query-engine';
import { setPath } from '../../ops/path';
import { registerPropOps } from '../../ops/prop-ops';
import { OpRegistry } from '../../ops/registry';
import { WorldStateHolder } from '../../ops/transaction';
import { FlowInterpreter } from '../../flow/interpreter';
import { InMemoryCheckpointStore } from '../../persistence/persistence';
import { createAgentShape } from '../../state/agent';
import { DefRegistry } from '../../state/def';
import { createEntityShape } from '../../state/entity';
import { createEmptyWorldState, type WorldState } from '../../state/world-state';
import { DESIGN_CURRENCY_PRINCIPLES, DesignCurrencyGateway } from '../design-currency';
import { ValidatedBehaviorGateway } from '../behavior-validation';
import { ScopedCandidatePlanner } from '../candidate-planner';
import { CanonicalCandidateCommitGateway } from '../commit-gateway';
import { FiniteEvaluationGuard } from '../evaluation';
import { BoundedAIDecisionFacade } from '../facade';
import { StaticPlannerRegistry } from '../planner-registry';
import { RestrictedAIReadGateway } from '../read-gateway';
import { SequentialSearchPlanner } from '../sequential-search';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../kernel/behavior-adapter';
import { KernelCanonicalSubmissionAdapter } from '../kernel/commit-adapter';
import { SchedulePhaseParticipants } from '../kernel/participant-order';
import { KernelAIReadAdapter } from '../kernel/read-adapter';
import { KernelSearchSessionGateway } from '../kernel/search-session';
import type { ActionDef } from '../../actions/types';
import type { ScheduleDef } from '../../schedule/types';
import type { Def } from '../../state/def';
import type { Expr } from '../../state/expr-types';
import type { Effect } from '../../events/effect-types';
import type { NPCActionRequest } from '../types';

/** 玩法层同一专写的 Effect 构造器：`prop.set` 的 args 是已就绪的 `path`/`value`。 */
function opEffect(op: string, args: Record<string, Expr | number>): Effect {
  return { op, args: args as Record<string, Expr> } as Effect;
}

const AGENT = 'g:ai';
const ENTITY = 'e:ai';
const POLICY = 'd:policy';
const BINDING = 'd:bind';

const VISIBLE_TO: Expr = {
  op: 'not',
  args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }],
};

/** 两个零费合法动作：一个把实体压进死亡窗口(负分)，一个维持高血量(正分)。 */
const recklesslyAttackAction: ActionDef = {
  id: 'a:reckless',
  kind: 'action',
  label: 'Reckless',
  track: 'highlight',
  require: true,
  cost: [],
  effects: [opEffect('prop.set', { path: `entities.${ENTITY}.props.vitality`, value: 1 })],
};
const cautiousHoldAction: ActionDef = {
  id: 'a:cautious',
  kind: 'action',
  label: 'Cautious',
  track: 'highlight',
  require: true,
  cost: [],
  effects: [opEffect('prop.set', { path: `entities.${ENTITY}.props.vitality`, value: 5 })],
};

const INITIATIVE_OF: Expr = { op: 'refGet', args: [{ var: 'self' }, 'props.initiative'] };

const schedule: ScheduleDef = {
  id: 'sched:round',
  kind: 'schedule',
  order: 'initiative',
  initiativeExpr: INITIATIVE_OF,
  phases: [{
    id: 'ph:act',
    phaseKind: 'normal',
    actors: { from: 'entities', where: { op: 'gt', args: [INITIATIVE_OF, 0] } },
  }],
};

const family: AIBehaviorFamilySchema = {
  family: { $: 'd:ai-family' },
  category: 'npc-behavior',
  parameters: [{ path: 'props.alertLevel', schema: { $: 'd:ai-family' }, owner: 'play-configuration', playerVisible: true, internalMetric: false, required: true }],
};

const currency = new DesignCurrencyGateway();

/** 与 makeWorld 同构：额外铺两个资源池（ap/stamina）供跨字段威胁场景，其余装备完全相同。 */
function makePooledWorld(startVitality: number, startAp: number, startStamina: number) {
  let state = baseState(startVitality);
  state = setPath(state, `world.props.pools.ap.${AGENT}.real`, startAp) as WorldState;
  state = setPath(state, `world.props.pools.ap.${AGENT}.available`, startAp) as WorldState;
  state = setPath(state, `world.props.pools.stamina.${AGENT}.real`, startStamina) as WorldState;
  state = setPath(state, `world.props.pools.stamina.${AGENT}.available`, startStamina) as WorldState;

  const holder = new WorldStateHolder(state);
  const defRegistry = new DefRegistry();
  defRegistry.register(recklesslyAttackAction as Def);
  defRegistry.register(cautiousHoldAction as Def);
  // 资源动作：分别把 AP 压零、把体力压零——两个候选都保留生命安全，专测资源维度。
  const burnAp: ActionDef = {
    id: 'a:dump-ap',
    kind: 'action',
    label: 'Dump AP',
    track: 'highlight',
    require: true,
    cost: [],
    effects: [
      opEffect('prop.set', { path: `world.props.pools.ap.${AGENT}.real`, value: 0 }),
      opEffect('prop.set', { path: `world.props.pools.ap.${AGENT}.available`, value: 0 }),
    ],
  };
  const dumpStamina: ActionDef = {
    id: 'a:dump-stamina',
    kind: 'action',
    label: 'Dump Stamina',
    track: 'highlight',
    require: true,
    cost: [],
    effects: [
      opEffect('prop.set', { path: `world.props.pools.stamina.${AGENT}.real`, value: 0 }),
      opEffect('prop.set', { path: `world.props.pools.stamina.${AGENT}.available`, value: 0 }),
    ],
  };
  defRegistry.register(burnAp as Def);
  defRegistry.register(dumpStamina as Def);
  defRegistry.register(schedule as Def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  defRegistry.register({
    id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 },
  });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  const flowInterpreter = new FlowInterpreter({ opRegistry: registry, exprEngine, queryEngine, defRegistry });
  registerIntentOps(registry, {
    defLookup: (id) => defRegistry.resolve(id),
    now: () => 1,
    runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, 1e4, vars).result,
  });
  registerScheduleOps(registry, { defLookup: (id) => defRegistry.resolve(id) });

  const actionCatalog = new ActionCatalog({
    getState: () => holder.getState(),
    exprEngine,
    queryEngine,
    listActionDefs: () => [recklesslyAttackAction, cautiousHoldAction, burnAp, dumpStamina],
    ctxForActor: (actor, bindings) => makeDefaultEvalContext({
      self: actor,
      vars: bindings,
      resolvePath: (path) => {
        let cursor: unknown = holder.getState();
        for (const part of path.split('.')) {
          if (cursor === null || typeof cursor !== 'object') return null;
          cursor = (cursor as Record<string, unknown>)[part];
        }
        return (cursor ?? null) as never;
      },
    }),
  });

  const readAdapter = new KernelAIReadAdapter({
    getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry,
  });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({
    getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup: (id) => defRegistry.resolve(id),
    isDeferred: () => false,
  });

  const behaviorGateway = new ValidatedBehaviorGateway((binding) => {
    return new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding);
  });

  const base = new ScopedCandidatePlanner();
  const plannerRegistry = new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }]);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);

  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapter(
    new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }),
  );

  const order = new SchedulePhaseParticipants({
    getState: () => holder.getState(),
    queryEngine,
    defLookup: (id) => defRegistry.resolve(id),
    opRegistry: registry,
    behaviorBindingFor: (agentId) => (agentId === AGENT ? { $: BINDING } : null),
    exprEngine,
  });

  const facade = new BoundedAIDecisionFacade({
    readGateway,
    behaviorGateway,
    planners: new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner }]),
    evaluationGateway: currency,
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({
      getState: () => holder.getState(),
      readGateway,
      behaviorGateway,
      evaluationGateway: currency,
      evaluationGuard: new FiniteEvaluationGuard(),
      simulation,
      nextParticipant: order.resolve,
    }),
  });

  return { holder, facade };
}

function baseState(vitality: number): WorldState {
  let state = createEmptyWorldState('sched:round');
  state = setPath(state, 'world.props.hiddenRefs', [] as never) as WorldState;
  state = {
    ...state,
    world: { ...state.world, agents: { [AGENT]: { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: ENTITY }], policy: POLICY } } },
    entities: { [ENTITY]: { ...createEntityShape(ENTITY, 'd:fighter'), props: { initiative: 3, vitality } } },
  };
  return state;
}

function makeWorld(startVitality: number) {
  const holder = new WorldStateHolder(baseState(startVitality));
  const defRegistry = new DefRegistry();
  defRegistry.register(recklesslyAttackAction as Def);
  defRegistry.register(cautiousHoldAction as Def);
  defRegistry.register(schedule as Def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  defRegistry.register({
    id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 },
  });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  // 该测试的动作效果是 `op: 'prop.set'`，必须让 FlowInterpreter 真正执行它们，
  // 否则仿真分支里实体的生命力永远不会改变，设计货币在两条候选分支间看到的全是
  // 相同状态、无法区分优劣，AI 只能按 action 出现的先后顺序随意选第一个。
  const flowInterpreter = new FlowInterpreter({ opRegistry: registry, exprEngine, queryEngine, defRegistry });
  registerIntentOps(registry, {
    defLookup: (id) => defRegistry.resolve(id),
    now: () => 1,
    runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, 1e4, vars).result,
  });
  registerScheduleOps(registry, { defLookup: (id) => defRegistry.resolve(id) });

  const actionCatalog = new ActionCatalog({
    getState: () => holder.getState(),
    exprEngine,
    queryEngine,
    listActionDefs: () => [recklesslyAttackAction, cautiousHoldAction],
    ctxForActor: (actor, bindings) => makeDefaultEvalContext({
      self: actor,
      vars: bindings,
      resolvePath: (path) => {
        let cursor: unknown = holder.getState();
        for (const part of path.split('.')) {
          if (cursor === null || typeof cursor !== 'object') return null;
          cursor = (cursor as Record<string, unknown>)[part];
        }
        return (cursor ?? null) as never;
      },
    }),
  });

  const readAdapter = new KernelAIReadAdapter({
    getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry,
  });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({
    getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup: (id) => defRegistry.resolve(id),
    isDeferred: () => false,
  });

  const behaviorGateway = new ValidatedBehaviorGateway((binding) => {
    return new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding);
  });

  const base = new ScopedCandidatePlanner();
  const plannerRegistry = new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }]);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);

  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapterExt(
    new KernelSimulationAdapterExt({
      holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer,
    }),
  );

  const order = new SchedulePhaseParticipants({
    getState: () => holder.getState(),
    queryEngine,
    defLookup: (id) => defRegistry.resolve(id),
    opRegistry: registry,
    behaviorBindingFor: (agentId) => (agentId === AGENT ? { $: BINDING } : null),
    exprEngine,
  });

  const facade = new BoundedAIDecisionFacade({
    readGateway,
    behaviorGateway,
    planners: new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner }]),
    evaluationGateway: currency,
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({
      getState: () => holder.getState(),
      readGateway,
      behaviorGateway,
      evaluationGateway: currency,
      evaluationGuard: new FiniteEvaluationGuard(),
      simulation,
      nextParticipant: order.resolve,
    }),
  });

  return { holder, facade };
}

function rootRequest(): NPCActionRequest {
  return {
    category: 'npc-behavior',
    mode: 'act',
    agent: { $: AGENT },
    controlledEntity: { $: ENTITY },
    policy: { $: POLICY },
    behaviorBinding: { $: BINDING },
    tier: 'exact',
    budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 },
    correlationId: 'corr-currency',
  };
}

describe('设计货币驱动的 AI 决策（真实内核链路）', () => {
  beforeEach(() => {
    // 避免 id 计数器跨用例污染。
  });

  it('血量为 1（死亡窗口内）时，AI 选择恢复分值而非继续负分', () => {
    const { facade, holder } = makeWorld(1);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    expect(result.candidate?.legalAction.action).toBe('a:cautious');
    // Depth-1 搜索已落在「保全生命」的分支上：cautious 把生命复原到 5。
    expect(holder.getState().entities[ENTITY]?.props['vitality']).toBe(5);
  });

  it('血量为 5（安全上限）时仍无死亡锚负分，AI 不必为安全而改选', () => {
    const { facade, holder } = makeWorld(5);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    // 5 高于死亡窗口(<=4)，cautious 维持 5（正分），仍被选为最优。
    expect(result.candidate?.legalAction.action).toBe('a:cautious');
    expect(holder.getState().entities[ENTITY]?.props['vitality']).toBe(5);
  });

  it('死亡锚是内部度量：评分本身可允许绝对值超出 1-5', () => {
    // 直接调用设计货币评分，验证它是 Internal_Metric 而非玩家可见数值。
    const gateway = new DesignCurrencyGateway();
    expect(DESIGN_CURRENCY_PRINCIPLES.deathAnchor).toBe(-10);
    expect(DESIGN_CURRENCY_PRINCIPLES.lethalWindow).toBe(4);
    const slice = {
      agent: { $: AGENT },
      // BeliefSlice 的真实投影约定：`entities.<id>.props.*` -> `<id>.<字段>`
      visibleFacts: { [`${ENTITY}.vitality`]: 1 },
      knownFacts: {},
      visibleRefs: [{ $: ENTITY }],
      policyContext: {},
    };
    // 血量为 1 -> 死亡锚负分。
    expect(Number(gateway.evaluate({ $: AGENT }, slice, { $: POLICY }))).toBe(-10);
  });

  it('跨字段威胁：四选中既不把血自送死亡窗口，也不把 AP/体力任一关键资源压零', () => {
    const { facade } = makePooledWorld(3, 2, 2);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const action = result.candidate?.legalAction.action;
    // reckless 把血压到 1(死亡锚 -10)、dump-ap/dump-stamina 把关键资源压零(-6)，
    // 唯一保留所有维度的是 cautious：血回到 5，资源不动。绝不趋利避害地选牺牲项。
    expect(action).toBe('a:cautious');
  });
});

/** 轻量别名：复用 canonical 模拟 + 内核模拟适配器，保持测试可读。 */
import { CanonicalSimulationAdapter } from '../simulation';
import { KernelSimulationAdapter } from '../kernel/simulation-adapter';
const CanonicalSimulationAdapterExt = CanonicalSimulationAdapter;
const KernelSimulationAdapterExt = KernelSimulationAdapter;
