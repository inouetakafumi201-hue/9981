/**
 * Proves bounded sequential multi-participant search on the real kernel: the
 * participant order comes from the active ScheduleDef's phase actor query, each
 * participant plans from its own read scope and validated binding, exploration
 * runs through the canonical Action -> Intent -> Op chain, and every explored
 * branch is restored so only the finally chosen root action is committed.
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
import { InMemoryCheckpointStore } from '../../persistence/persistence';
import { createAgentShape } from '../../state/agent';
import { DefRegistry } from '../../state/def';
import { createEntityShape } from '../../state/entity';
import { resetIdCounters } from '../../state/ids';
import { createEmptyWorldState, type WorldState } from '../../state/world-state';
import { ValidatedBehaviorGateway } from '../behavior-validation';
import { ScopedCandidatePlanner } from '../candidate-planner';
import { CanonicalCandidateCommitGateway } from '../commit-gateway';
import { FiniteEvaluationGuard } from '../evaluation';
import { BoundedAIDecisionFacade } from '../facade';
import { StaticPlannerRegistry } from '../planner-registry';
import { RestrictedAIReadGateway } from '../read-gateway';
import { SequentialSearchPlanner } from '../sequential-search';
import { CanonicalSimulationAdapter } from '../simulation';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../kernel/behavior-adapter';
import { KernelCanonicalSubmissionAdapter } from '../kernel/commit-adapter';
import { SchedulePhaseParticipants } from '../kernel/participant-order';
import { ReferenceCountedPresentationSilencer } from '../kernel/presentation-silencer';
import { KernelAIReadAdapter } from '../kernel/read-adapter';
import { KernelSearchSessionGateway } from '../kernel/search-session';
import { KernelSimulationAdapter } from '../kernel/simulation-adapter';
import type { ActionDef } from '../../actions/types';
import type { ScheduleDef } from '../../schedule/types';
import type { Def } from '../../state/def';
import type { Expr } from '../../state/expr-types';
import type { NPCActionRequest, ValidatedAIBehaviorBinding } from '../types';

const PARTICIPANTS = [
  { agent: 'g:one', entity: 'e:one', policy: 'd:policy-one', binding: 'd:bind-one', initiative: 3 },
  { agent: 'g:two', entity: 'e:two', policy: 'd:policy-two', binding: 'd:bind-two', initiative: 2 },
  { agent: 'g:three', entity: 'e:three', policy: 'd:policy-three', binding: 'd:bind-three', initiative: 1 },
] as const;

const VISIBLE_TO: Expr = {
  op: 'not',
  args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }],
};

/** Two zero-cost legal actions so every participant has a real branching choice. */
const holdAction: ActionDef = {
  id: 'a:hold', kind: 'action', label: 'Hold', require: true, cost: [], effects: [{ emit: 'ai.acted' }], track: 'highlight',
};
const pushAction: ActionDef = {
  id: 'a:push', kind: 'action', label: 'Push', require: true, cost: [], effects: [{ emit: 'ai.acted' }], track: 'highlight',
};

/**
 * Phase actors are the entities carrying an initiative value; order comes from
 * the schedule's own initiativeExpr. `refGet` is the kernel idiom for reading a
 * field relative to the candidate reference inside a Query or ordering Expr.
 */
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
  parameters: [{
    path: 'props.alertLevel',
    schema: { $: 'd:ai-family' },
    owner: 'play-configuration',
    playerVisible: true,
    internalMetric: false,
    required: true,
  }],
};

function baseState(): WorldState {
  let state = createEmptyWorldState('sched:round');
  const agents: WorldState['world']['agents'] = {};
  const entities: WorldState['entities'] = {};
  for (const participant of PARTICIPANTS) {
    agents[participant.agent] = {
      ...createAgentShape(participant.agent, 'ai', `ks:${participant.agent}`),
      controls: [{ $: participant.entity }],
      policy: participant.policy,
    };
    entities[participant.entity] = {
      ...createEntityShape(participant.entity, 'd:fighter'),
      props: { initiative: participant.initiative },
    };
  }
  entities['e:hidden'] = { ...createEntityShape('e:hidden', 'd:spy'), props: { secret: 'plan' } };
  state = { ...state, world: { ...state.world, agents }, entities };
  state = setPath(state, 'world.props.hiddenRefs', [{ $: 'e:hidden' }] as never) as WorldState;
  state = setPath(state, 'world.props.phaseActors', true as never) as WorldState;
  return state;
}

function makeWorld() {
  const holder = new WorldStateHolder(baseState());
  const defRegistry = new DefRegistry();
  defRegistry.register(holdAction as Def);
  defRegistry.register(pushAction as Def);
  defRegistry.register(schedule as Def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  for (const participant of PARTICIPANTS) {
    defRegistry.register({
      id: participant.binding,
      kind: 'policy',
      extends: ['d:ai-family'],
      mode: 'search',
      policy: participant.policy,
      props: { alertLevel: 2 },
    });
  }

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  registerIntentOps(registry, {
    defLookup: (id) => defRegistry.resolve(id),
    now: () => 1,
    runEffects: (_effects, ctx) => registry.invokeInline('prop.add', { path: 'world.props.resolved', delta: 1 }, ctx),
  });
  // Phase advancement is a canonical Op; lookahead beyond the current phase
  // depends on it being registered exactly as it is for human play.
  registerScheduleOps(registry, { defLookup: (id) => defRegistry.resolve(id) });

  const actions = [holdAction, pushAction];
  const actionCatalog = new ActionCatalog({
    getState: () => holder.getState(),
    exprEngine,
    queryEngine,
    listActionDefs: () => actions,
    ctxForActor: (actor, bindings) => makeDefaultEvalContext({
      self: actor,
      vars: bindings,
      resolvePath: (path) => {
        const parts = path.split('.');
        let cursor: unknown = holder.getState();
        for (const part of parts) {
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

  const resolvedBindings: string[] = [];
  const behaviorGateway = new ValidatedBehaviorGateway((binding) => {
    resolvedBindings.push(binding.$);
    return new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding);
  });

  const base = new ScopedCandidatePlanner();
  const registrations = PARTICIPANTS.map((participant) => ({
    policy: { $: participant.policy },
    category: 'npc-behavior' as const,
    planner: base,
  }));
  const plannerRegistry = new StaticPlannerRegistry(registrations);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);

  const silencer = new ReferenceCountedPresentationSilencer({ dispatch: () => { /* no external transport in this test */ } });
  const simulation = new CanonicalSimulationAdapter(new KernelSimulationAdapter({
    holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer,
  }));

  const order = new SchedulePhaseParticipants({
    getState: () => holder.getState(),
    queryEngine,
    defLookup: (id) => defRegistry.resolve(id),
    opRegistry: registry,
    behaviorBindingFor: (agentId) => {
      const found = PARTICIPANTS.find((participant) => participant.agent === agentId);
      return found === undefined ? null : { $: found.binding };
    },
    exprEngine,
  });

  const facade = new BoundedAIDecisionFacade({
    readGateway,
    behaviorGateway,
    planners: new StaticPlannerRegistry([
      { policy: { $: PARTICIPANTS[0].policy }, category: 'npc-behavior', planner: searchPlanner },
      ...registrations.slice(1),
    ]),
    evaluationGateway: {
      // Score depends only on the acting entity's own visible initiative, so
      // each participant maximizes its own component.
      evaluate: (actor, slice) => Number(slice.visibleFacts[`${actor.$}.initiative`] ?? 0),
      neutralFallback: () => 0,
    },
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({
      getState: () => holder.getState(),
      readGateway,
      behaviorGateway,
      evaluationGateway: {
        evaluate: (actor, slice) => Number(slice.visibleFacts[`${actor.$}.initiative`] ?? 0),
        neutralFallback: () => 0,
      },
      evaluationGuard: new FiniteEvaluationGuard(),
      simulation,
      nextParticipant: order.resolve,
    }),
  });

  return { holder, facade, order, readAdapter, readGateway, resolvedBindings, silencer, actionCatalog };
}

function rootRequest(): NPCActionRequest {
  return {
    category: 'npc-behavior',
    mode: 'act',
    agent: { $: PARTICIPANTS[0].agent },
    controlledEntity: { $: PARTICIPANTS[0].entity },
    policy: { $: PARTICIPANTS[0].policy },
    behaviorBinding: { $: PARTICIPANTS[0].binding },
    tier: 'exact',
    budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 },
    correlationId: 'corr-seq',
  };
}

describe('schedule-backed participant order', () => {
  beforeEach(() => resetIdCounters());

  const OUTCOME = { checkpoint: 'cp', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' } as const;

  function behaviorFor(index: number): ValidatedAIBehaviorBinding {
    return { family: { $: 'd:ai-family' }, policy: { $: PARTICIPANTS[index]!.policy }, category: 'npc-behavior', parameters: [] };
  }

  it('advances through the phase actor query in initiative order', () => {
    const { order, readGateway } = makeWorld();
    const scope = readGateway.openReadScope({ $: PARTICIPANTS[0].agent });
    if (!scope.ok) throw new Error(scope.detail);

    const next = order.resolve({ request: rootRequest(), scope: scope.value, behavior: behaviorFor(0) }, OUTCOME);
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.value?.controlledEntity).toEqual({ $: PARTICIPANTS[1].entity });
      expect(next.value?.policy).toEqual({ $: PARTICIPANTS[1].policy });
      expect(next.value?.behaviorBinding).toEqual({ $: PARTICIPANTS[1].binding });
    }
  });

  it('ends the chain after the last actor in the phase order', () => {
    const { order, readGateway } = makeWorld();
    const scope = readGateway.openReadScope({ $: PARTICIPANTS[2].agent });
    if (!scope.ok) throw new Error(scope.detail);
    const next = order.resolve(
      {
        request: { ...rootRequest(), agent: { $: PARTICIPANTS[2].agent }, controlledEntity: { $: PARTICIPANTS[2].entity } },
        scope: scope.value,
        behavior: behaviorFor(2),
      },
      OUTCOME,
    );
    expect(next).toMatchObject({ ok: true, value: undefined });
  });
});

describe('bounded sequential search on the real kernel', () => {
  beforeEach(() => resetIdCounters());

  it('plans every derived participant from its own context and commits only the root choice', () => {
    const { facade, holder, resolvedBindings } = makeWorld();
    const before = holder.getState();

    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    expect(result.candidate).toBeDefined();

    // Each derived participant was validated through its own behavior binding.
    expect(resolvedBindings).toContain(PARTICIPANTS[1].binding);
    expect(resolvedBindings).toContain(PARTICIPANTS[2].binding);

    // Exploration restored every branch: exactly one real commitment remains.
    expect(holder.getState().world.props['resolved']).toBe(1);
    const intents = Object.values(holder.getState().world.intents);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.agent).toBe(PARTICIPANTS[0].entity);
    expect(intents[0]!.status).toBe('resolved');

    // Exploration never advanced a live random stream.
    expect(holder.getState().world.rng).toEqual(before.world.rng);
  });

  it('keeps a hidden entity out of every participant scope during search', () => {
    const { facade, holder } = makeWorld();
    const acted = facade.act(rootRequest());
    expect(acted.status).toBe('submitted');
    const serialized = JSON.stringify(acted.candidate);
    expect(serialized).not.toContain('e:hidden');
    expect(serialized).not.toContain('secret');
    expect(holder.getState().entities['e:hidden']!.props['secret']).toBe('plan');
  });

  it('fails closed when a derived AI participant has no validated behavior binding', () => {
    const { holder, readGateway } = makeWorld();
    const strict = new SchedulePhaseParticipants({
      getState: () => holder.getState(),
      queryEngine: new QueryEngine(),
      defLookup: () => schedule as Def,
      opRegistry: { invoke: () => ({ ok: true }) },
      behaviorBindingFor: () => null,
    });
    const scope = readGateway.openReadScope({ $: PARTICIPANTS[0].agent });
    if (!scope.ok) throw new Error(scope.detail);
    const next = strict.resolve(
      {
        request: rootRequest(),
        scope: scope.value,
        behavior: { family: { $: 'd:ai-family' }, policy: { $: PARTICIPANTS[0].policy }, category: 'npc-behavior', parameters: [] },
      },
      { checkpoint: 'cp', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
    );
    expect(next).toMatchObject({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE' });
  });
});

describe('cross-phase lookahead through the canonical schedule Op', () => {
  beforeEach(() => resetIdCounters());

  /** Two phases: the first holds e:one and e:two, the second holds e:three. */
  const splitSchedule: ScheduleDef = {
    id: 'sched:split',
    kind: 'schedule',
    order: 'initiative',
    initiativeExpr: INITIATIVE_OF,
    loop: true,
    phases: [
      { id: 'ph:front', phaseKind: 'normal', actors: { from: 'entities', where: { op: 'gte', args: [INITIATIVE_OF, 2] } } },
      { id: 'ph:back', phaseKind: 'normal', actors: { from: 'entities', where: { op: 'eq', args: [INITIATIVE_OF, 1] } } },
    ],
  };

  function makeSplitWorld() {
    let state = baseState();
    state = { ...state, world: { ...state.world, turn: { ...state.world.turn, scheduleId: 'sched:split' } } };
    const holder = new WorldStateHolder(state);
    const defRegistry = new DefRegistry();
    defRegistry.register(splitSchedule as Def);
    const registry = new OpRegistry(holder);
    registerScheduleOps(registry, { defLookup: (id) => defRegistry.resolve(id) });
    const order = new SchedulePhaseParticipants({
      getState: () => holder.getState(),
      queryEngine: new QueryEngine(),
      defLookup: (id) => defRegistry.resolve(id),
      opRegistry: registry,
      behaviorBindingFor: (agentId) => {
        const found = PARTICIPANTS.find((participant) => participant.agent === agentId);
        return found === undefined ? null : { $: found.binding };
      },
    });
    return { holder, order };
  }

  function contextFor(index: number, scope: never) {
    return {
      request: { ...rootRequest(), agent: { $: PARTICIPANTS[index]!.agent }, controlledEntity: { $: PARTICIPANTS[index]!.entity } },
      scope,
      behavior: { family: { $: 'd:ai-family' }, policy: { $: PARTICIPANTS[index]!.policy }, category: 'npc-behavior' as const, parameters: [] },
    };
  }

  const OUTCOME = { checkpoint: 'cp', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' } as const;

  it('advances to the next phase and continues with its first actor', () => {
    const { holder, order } = makeSplitWorld();
    const scope = { agent: { $: PARTICIPANTS[1]!.agent } } as unknown as never;
    // e:two is last in phase ph:front, so the chain must cross into ph:back.
    const next = order.resolve(contextFor(1, scope), OUTCOME);
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.value?.controlledEntity).toEqual({ $: PARTICIPANTS[2]!.entity });
    // The advance is a real canonical write inside the branch.
    expect(holder.getState().world.turn.phaseIndex).toBe(1);
  });

  it('fails closed when the phase cannot be advanced through the Op channel', () => {
    const { holder } = makeSplitWorld();
    const defRegistry = new DefRegistry();
    defRegistry.register(splitSchedule as Def);
    const withoutScheduleOps = new SchedulePhaseParticipants({
      getState: () => holder.getState(),
      queryEngine: new QueryEngine(),
      defLookup: (id) => defRegistry.resolve(id),
      // A registry without schedule.advance registered.
      opRegistry: new OpRegistry(holder),
      behaviorBindingFor: () => ({ $: PARTICIPANTS[2]!.binding }),
    });
    const scope = { agent: { $: PARTICIPANTS[1]!.agent } } as unknown as never;
    expect(withoutScheduleOps.resolve(contextFor(1, scope), OUTCOME))
      .toMatchObject({ ok: false, code: 'AI_TRANSACTION_FAILED' });
  });
});
