/**
 * 设计货币在「真实资源池」字段上的决策（真实内核链路）。
 *
 * AP / 体力在引擎里不是实体 props，而是 world.props.pools.<pool>.<scope>.real
 * （actions/pool-ops.ts、schedule/playpack.ts 的 PoolDef 是 engine 原语）。本批用例
 * 通过 KernelAIReadAdapter → state-read.resolveRefProps 的资源池投影（受控实体把宿主
 * agent 的池代数量投影为 `pool.<name>` 字段），让设计货币在同一托管链路里读到真实池值，
 * 覆盖：
 *   - AP 持续穷尽：保留 AP 的选项优于把 AP 压零（资源预算珍贵，AP=0 是动作机会清零）；
 *   - 体力（清醒值）耗尽：把体力压到 0 的选项绝不被选（清醒是强骰/处决机会）；
 *   - 多点比对（趋利避害）：相同安全状态下，绝不选任何把关键资源拖到耗尽的后果。
 *
 * 所有数值均为 Internal_Metric，可绝对值 > 1-5；玩家可见值保持 1-5。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionCatalog } from '../../actions/catalog.js';
import { registerPoolOps, type PoolOpsDeps } from '../../actions/pool-ops.js';
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
import type { PoolDef } from '../../schedule/playpack.js';
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

/** 动作：通过真实 op 把指定池代数量覆盖为 value。 */
function poolAction(id: string, pool: string, after: number): ActionDef {
  return {
    id,
    kind: 'action',
    label: id,
    require: true,
    cost: [],
    effects: [
      opEffect('prop.set', { path: `world.props.pools.${pool}.${AGENT}.real`, value: after }),
      opEffect('prop.set', { path: `world.props.pools.${pool}.${AGENT}.available`, value: after }),
    ],
  };
}
const keepAp = poolAction('a:use-sparingly', 'ap', 2);
const burnAllAp = poolAction('a:overcharge-ap', 'ap', 0);
const keepStamina = poolAction('a:rest', 'stamina', 3);
const burnStamina = poolAction('a:reckless-surge', 'stamina', 0);

function makeWorld(startAp: number, startStamina: number) {
  let state = createEmptyWorldState('sched:round');
  state = setPath(state, 'world.props.hiddenRefs', [] as never) as WorldState;
  state = setPath(state, `world.props.pools.ap.${AGENT}.real`, startAp) as WorldState;
  state = setPath(state, `world.props.pools.ap.${AGENT}.available`, startAp) as WorldState;
  state = setPath(state, `world.props.pools.stamina.${AGENT}.real`, startStamina) as WorldState;
  state = setPath(state, `world.props.pools.stamina.${AGENT}.available`, startStamina) as WorldState;
  state = {
    ...state,
    world: {
      ...state.world,
      agents: { [AGENT]: { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: ENTITY }], policy: POLICY } },
    },
    entities: { [ENTITY]: { ...createEntityShape(ENTITY, 'd:fighter'), props: { initiative: 3 } } },
  };
  const holder = new WorldStateHolder(state);
  const defRegistry = new DefRegistry();
  for (const a of [keepAp, burnAllAp, keepStamina, burnStamina]) defRegistry.register(a as Def);
  defRegistry.register(schedule as Def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  defRegistry.register({ id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 } });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  const poolDefs: readonly PoolDef[] = [
    { name: 'ap', per: 'actor', min: 0, max: 3, reset: 'turn' },
    { name: 'stamina', per: 'actor', min: 0, max: 5, reset: 'never' },
  ];
  registerPoolOps(registry, { poolDefs: () => poolDefs } satisfies PoolOpsDeps);
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
    listActionDefs: () => [keepAp, burnAllAp, keepStamina, burnStamina],
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

  const currency = new DesignCurrencyGateway();
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
  return { category: 'npc-behavior', mode: 'act', agent: { $: AGENT }, controlledEntity: { $: ENTITY }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, tier: 'exact', budget: { decisionPoints: 60, simulations: 90, evaluationCalls: 180 }, correlationId: 'corr-pools' };
}

describe('设计货币在真实资源池（world.props.pools）字段上引导玩家尝试', () => {
  beforeEach(() => { /* 每个用例独立 makeWorld。 */ });

  it('AP 持续穷尽：保留 AP 的选项优于把 AP 压零（动作机会清零，绝不趋利避害）', () => {
    const { facade } = makeWorld(2, 3);
    const result = facade.act(rootRequest());
    expect(result.candidate?.legalAction.action).toBe('a:use-sparingly');
    expect(result.candidate?.legalAction.action).not.toBe('a:overcharge-ap');
  });

  it('体力耗尽：绝不选把体力（清醒值）压到 0 的自断强骰选项', () => {
    const { facade } = makeWorld(2, 1);
    const result = facade.act(rootRequest());
    expect(result.candidate?.legalAction.action).not.toBe('a:reckless-surge');
  });

  it('多点比对（趋利避害）：当两池都可能耗尽时，只在保留关键资源的候选中择优，绝不选把任何池压零的后果', () => {
    const { facade } = makeWorld(1, 1);
    const result = facade.act(rootRequest());
    expect(result.candidate).not.toBeNull();
    expect(['a:use-sparingly', 'a:rest']).toContain(result.candidate?.legalAction.action);
    expect(result.candidate?.legalAction.action).not.toBe('a:overcharge-ap');
    expect(result.candidate?.legalAction.action).not.toBe('a:reckless-surge');
  });
});
