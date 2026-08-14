/**
 * 设计货币驱动 AI 作出「趋利避害」的玩家尝试级决策（真实内核链路）。
 *
 * 通过制造一组候选动作，让每个候选对实体的活体属性(生命)或 AP 状态产生不同
 * 的后缀，从而让设计货币的「死亡锚 / 存活窗口 / 稀缺」原则真正决定 AI 选哪条
 * 分支——覆盖狩猎(压低对手)、求生(保命优先)、回血时机(血越少越急)、危险路径
 * (不值得冒死)四类常识用例。
 *
 * 所有数值均为 Internal_Metric（可绝对值 > 1-5）；玩家可见值保持 1-5。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionCatalog } from '../../actions/catalog.js';
import { registerIntentOps } from '../../decision/intent-ops.js';
import { registerScheduleOps } from '../../schedule/schedule-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import { QueryEngine } from '../../expr/query-engine.js';
import { setPath } from '../../ops/path.js';
import { registerPropOps } from '../../ops/prop-ops.js';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { FlowInterpreter } from '../../flow/interpreter.js';
import { InMemoryCheckpointStore } from '../../persistence/persistence.js';
import { createAgentShape } from '../../state/agent.js';
import { DefRegistry } from '../../state/def.js';
import { createEntityShape } from '../../state/entity.js';
import { createEmptyWorldState, type WorldState } from '../../state/world-state.js';
import { DesignCurrencyGateway } from '../design-currency.js';
import { ValidatedBehaviorGateway } from '../behavior-validation.js';
import { ScopedCandidatePlanner } from '../candidate-planner.js';
import { CanonicalCandidateCommitGateway } from '../commit-gateway.js';
import { FiniteEvaluationGuard } from '../evaluation.js';
import { BoundedAIDecisionFacade } from '../facade.js';
import { StaticPlannerRegistry } from '../planner-registry.js';
import { RestrictedAIReadGateway } from '../read-gateway.js';
import { SequentialSearchPlanner } from '../sequential-search.js';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../kernel/behavior-adapter.js';
import { KernelCanonicalSubmissionAdapter } from '../kernel/commit-adapter.js';
import { SchedulePhaseParticipants } from '../kernel/participant-order.js';
import { KernelAIReadAdapter } from '../kernel/read-adapter.js';
import { KernelSearchSessionGateway } from '../kernel/search-session.js';
import { CanonicalSimulationAdapter } from '../simulation.js';
import { KernelSimulationAdapter } from '../kernel/simulation-adapter.js';
import type { ActionDef } from '../../actions/types.js';
import type { ScheduleDef } from '../../schedule/types.js';
import type { Def } from '../../state/def.js';
import type { Expr } from '../../state/expr-types.js';
import type { Effect } from '../../events/effect-types.js';
import type { NPCActionRequest } from '../types.js';

const pathOf = (path: string): Expr => ({ path });

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

/** 动作：把灵魂的生命压进死亡窗口（负分，代表「鲁莽攻击/踏入绝境」）。 */
function makeAction(id: string, vitalityAfter: number): ActionDef {
  return {
    id,
    kind: 'action',
    label: id,
    require: true,
    cost: [],
    effects: [opEffect('prop.set', { path: `entities.${ENTITY}.props.vitality`, value: vitalityAfter })],
  };
}
const badAction = makeAction('a:hunt-reckless', 1);
const goodAction = makeAction('a:sustain', 5);
const midAction = makeAction('a:hold', 3);

const INITIATIVE_OF: Expr = { op: 'refGet', args: [{ var: 'self' }, 'props.initiative'] };

const schedule: ScheduleDef = {
  id: 'sched:round',
  kind: 'schedule',
  order: 'initiative',
  initiativeExpr: INITIATIVE_OF,
  phases: [{ id: 'ph:act', phaseKind: 'normal', actors: { from: 'entities', where: { op: 'gt', args: [INITIATIVE_OF, 0] } } }],
};

const family: AIBehaviorFamilySchema = {
  family: { $: 'd:ai-family' },
  category: 'npc-behavior',
  parameters: [{ path: 'props.alertLevel', schema: { $: 'd:ai-family' }, owner: 'play-configuration', playerVisible: true, internalMetric: false, required: true }],
};

const currency = new DesignCurrencyGateway();

function makeWorld(startVitality: number) {
  let state = createEmptyWorldState('sched:round');
  state = setPath(state, 'world.props.hiddenRefs', [] as never) as WorldState;
  state = {
    ...state,
    world: { ...state.world, agents: { [AGENT]: { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: ENTITY }], policy: POLICY } } },
    entities: { [ENTITY]: { ...createEntityShape(ENTITY, 'd:fighter'), props: { initiative: 3, vitality: startVitality } } },
  };
  const holder = new WorldStateHolder(state);
  const defRegistry = new DefRegistry();
  defRegistry.register(badAction as Def);
  defRegistry.register(goodAction as Def);
  defRegistry.register(midAction as Def);
  defRegistry.register(schedule as Def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  defRegistry.register({ id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 } });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  // 该测试的动作效果是 `op: 'prop.set'`，必须让 FlowInterpreter 真正执行它们，
  // 否则仿真分支里实体的生命力永远不会改变，设计货币在三条候选分支间看到的全是
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
    listActionDefs: () => [badAction, goodAction, midAction],
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

  const readAdapter = new KernelAIReadAdapter({ getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({ getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup: (id) => defRegistry.resolve(id), isDeferred: () => false });
  const behaviorGateway = new ValidatedBehaviorGateway((binding) => new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding));

  const base = new ScopedCandidatePlanner();
  const searchPlanner = new SequentialSearchPlanner(base, new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }]));
  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapter(new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }));
  const order = new SchedulePhaseParticipants({ getState: () => holder.getState(), queryEngine, defLookup: (id) => defRegistry.resolve(id), opRegistry: registry, behaviorBindingFor: (agentId) => (agentId === AGENT ? { $: BINDING } : null), exprEngine });

  const facade = new BoundedAIDecisionFacade({
    readGateway,
    behaviorGateway,
    planners: new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner }]),
    evaluationGateway: currency,
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({ getState: () => holder.getState(), readGateway, behaviorGateway, evaluationGateway: currency, evaluationGuard: new FiniteEvaluationGuard(), simulation, nextParticipant: order.resolve }),
  });

  return { holder, facade };
}

function rootRequest(): NPCActionRequest {
  return { category: 'npc-behavior', mode: 'act', agent: { $: AGENT }, controlledEntity: { $: ENTITY }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, tier: 'exact', budget: { decisionPoints: 60, simulations: 90, evaluationCalls: 180 }, correlationId: 'corr-scenario' };
}

describe('设计货币在真实内核链路下引导常见玩家尝试（趋利避害）', () => {
  beforeEach(() => { /* 无需清理；每个用例独立 makeWorld。 */ });

  it('求生优先：血量为 1 时，AI 选「维持高血量」而非「鲁莽压低」，不是自陷绝境', () => {
    const { facade } = makeWorld(1);
    const result = facade.act(rootRequest());
    expect(result.candidate?.legalAction.action).toBe('a:sustain');
  });

  it('回血时机：血量低（3，存活窗口内）时仍优先保命动作，不选中间折中', () => {
    const { facade } = makeWorld(3);
    const result = facade.act(rootRequest());
    expect(result.candidate?.legalAction.action).toBe('a:sustain');
  });

  it('安全状态（5）时仍可选保命；即使存在鲁莽选项也不自陷', () => {
    const { facade } = makeWorld(5);
    const result = facade.act(rootRequest());
    // 5 是安全，sustain 维持 5（正分最优）；绝不选坏分支。
    expect(result.candidate?.legalAction.action).not.toBe('a:hunt-reckless');
  });

  it('绝不选择自杀式危险路径（把自身压到 1）；即使它是零费', () => {
    const { facade } = makeWorld(4);
    const result = facade.act(rootRequest());
    expect(result.candidate?.legalAction.action).toBe('a:sustain');
  });
});

/** AP/资源价值场景：候选动作在同一安全状态下，选择保留行动力（AP）而非把 AP 压零。 */
describe('设计货币驱动 AI 的 AP/资源价值判断（真实内核链路）', () => {
  function resourceAction(id: string, selfApAfter: number): ActionDef {
    return {
      id,
      kind: 'action',
      label: id,
      require: true,
      cost: [],
      effects: [opEffect('prop.set', { path: `entities.${ENTITY}.props.ap`, value: selfApAfter })],
    };
  }
  const keepAp = resourceAction('a:use-sparingly', 2);  // 保留 AP=2（保有下一步行动力）
  const keepMost = resourceAction('a:use-a-little', 3);  // 保留 AP=3
  const burnAll = resourceAction('a:overcharge', 0);     // 把 AP 压零（动作机会清零）

  function makeResourceWorld(startAp: number) {
    let state = createEmptyWorldState('sched:round');
    state = setPath(state, 'world.props.hiddenRefs', [] as never) as WorldState;
    state = {
      ...state,
      world: { ...state.world, agents: { [AGENT]: { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: ENTITY }], policy: POLICY } } },
      entities: { [ENTITY]: { ...createEntityShape(ENTITY, 'd:fighter'), props: { initiative: 3, vitality: 5, ap: startAp } } },
    };
    const holder = new WorldStateHolder(state);
    const defRegistry = new DefRegistry();
    defRegistry.register(keepAp as Def);
    defRegistry.register(keepMost as Def);
    defRegistry.register(burnAll as Def);
    defRegistry.register(schedule as Def);
    defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
    defRegistry.register({ id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 } });

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
      listActionDefs: () => [keepAp, keepMost, burnAll],
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

    const readAdapter = new KernelAIReadAdapter({ getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry });
    const readGateway = new RestrictedAIReadGateway(readAdapter);
    const submission = new KernelCanonicalSubmissionAdapter({ getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup: (id) => defRegistry.resolve(id), isDeferred: () => false });
    const behaviorGateway = new ValidatedBehaviorGateway((binding) => new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding));

    const base = new ScopedCandidatePlanner();
    const searchPlanner = new SequentialSearchPlanner(base, new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }]));
    const silencer = { silence: () => {}, resume: () => {} };
    const simulation = new CanonicalSimulationAdapter(new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }));
    const order = new SchedulePhaseParticipants({ getState: () => holder.getState(), queryEngine, defLookup: (id) => defRegistry.resolve(id), opRegistry: registry, behaviorBindingFor: (agentId) => (agentId === AGENT ? { $: BINDING } : null), exprEngine });

    const facade = new BoundedAIDecisionFacade({
      readGateway,
      behaviorGateway,
      planners: new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner }]),
      evaluationGateway: currency,
      evaluationGuard: new FiniteEvaluationGuard(),
      commitGateway: new CanonicalCandidateCommitGateway(submission),
      searchSessions: new KernelSearchSessionGateway({ getState: () => holder.getState(), readGateway, behaviorGateway, evaluationGateway: currency, evaluationGuard: new FiniteEvaluationGuard(), simulation, nextParticipant: order.resolve }),
    });

    return { holder, facade };
  }

  function resourceRequest(): NPCActionRequest {
    return { category: 'npc-behavior', mode: 'act', agent: { $: AGENT }, controlledEntity: { $: ENTITY }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, tier: 'exact', budget: { decisionPoints: 60, simulations: 90, evaluationCalls: 180 }, correlationId: 'corr-resource' };
  }

  it('AP 是珍贵资源：把自己 AP 压零（动作机会清零）的选项绝不被选', () => {
    const { facade } = makeResourceWorld(3); // 起点 AP=3
    const result = facade.act(resourceRequest());
    // 三者都保留生命安全；绝不选 AP 清零的自断后路选项。
    expect(result.candidate?.legalAction.action).not.toBe('a:overcharge');
  });
});
