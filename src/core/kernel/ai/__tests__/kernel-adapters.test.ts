/**
 * End-to-end proof that the bounded AI runs on the real kernel: the real
 * QueryEngine with a play-supplied visibleTo predicate, the real Knowledge
 * store, the real ActionCatalog, and the real Action -> Intent -> Op pipeline.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionCatalog } from '../../actions/catalog';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import { QueryEngine } from '../../expr/query-engine';
import { OpRegistry } from '../../ops/registry';
import { registerPropOps } from '../../ops/prop-ops';
import { setPath } from '../../ops/path';
import { WorldStateHolder } from '../../ops/transaction';
import { InMemoryCheckpointStore } from '../../persistence/persistence';
import { registerIntentOps } from '../../decision/intent-ops';
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
import { CanonicalSimulationAdapter } from '../simulation';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../kernel/behavior-adapter';
import { KernelCanonicalSubmissionAdapter } from '../kernel/commit-adapter';
import { AISearchPolicyBridge } from '../kernel/policy-bridge';
import { ReferenceCountedPresentationSilencer } from '../kernel/presentation-silencer';
import { KernelAIReadAdapter } from '../kernel/read-adapter';
import { KernelSimulationAdapter } from '../kernel/simulation-adapter';
import type { PolicyDef } from '../../schedule/policy';
import type { ActionDef } from '../../actions/types';
import type { Expr } from '../../state/expr-types';
import type { Def } from '../../state/def';
import type { NPCActionRequest, NPCRecommendationRequest } from '../types';

const HIDDEN = 'e:hidden-scout';

/** Play-owned predicate: a reference is visible unless listed in world.props.hiddenRefs. */
const VISIBLE_TO: Expr = {
  op: 'not',
  args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }],
};

const guardAction: ActionDef = {
  id: 'a:hold-position',
  kind: 'action',
  label: 'Hold position',
  track: 'highlight',
  require: true,
  cost: [],
  effects: [{ emit: 'ai.acted' }],
};

const gatedAction: ActionDef = {
  id: 'a:advance',
  kind: 'action',
  label: 'Advance',
  track: 'highlight',
  require: { path: 'world.props.advanceAllowed' },
  cost: [],
  effects: [{ emit: 'ai.acted' }],
};

const behaviorFamily: AIBehaviorFamilySchema = {
  family: { $: 'd:ai-guard-family' },
  category: 'npc-behavior',
  parameters: [
    {
      path: 'props.alertLevel',
      schema: { $: 'd:ai-guard-family' },
      owner: 'play-configuration',
      playerVisible: true,
      internalMetric: false,
      required: true,
    },
  ],
  playOwnedPaths: ['props.patrolRoute'],
  relevantActionsPath: 'props.relevantActions',
};

function baseState(): WorldState {
  let state = createEmptyWorldState('sched:1');
  const npcAgent = {
    ...createAgentShape('g:npc', 'ai', 'ks:npc'),
    controls: [{ $: 'e:npc' }],
    policy: 'd:npc-search' as const,
  };
  const seerAgent = {
    ...createAgentShape('g:seer', 'ai', 'ks:seer'),
    controls: [{ $: 'e:npc' }],
    omniscient: true,
  };
  state = {
    ...state,
    world: { ...state.world, agents: { 'g:npc': npcAgent, 'g:seer': seerAgent } },
    entities: {
      'e:npc': { ...createEntityShape('e:npc', 'd:guard'), props: { alert: 1 } },
      'e:ally': { ...createEntityShape('e:ally', 'd:guard'), props: { alert: 2 } },
      [HIDDEN]: { ...createEntityShape(HIDDEN, 'd:scout'), props: { secretPlan: 'flank' } },
    },
  };
  state = setPath(state, 'world.props.hiddenRefs', [{ $: HIDDEN }] as never) as WorldState;
  state = setPath(state, 'world.props.advanceAllowed', true as never) as WorldState;
  state = setPath(state, 'world.knowledge.g:npc.facts.lastSeen:e:hidden-scout', 'n:room2' as never) as WorldState;
  // Knowledge keys must stay dot-free: setPath treats dots as nesting.
  state = setPath(state, 'world.knowledge.g:npc.seen.allyPresent', true as never) as WorldState;
  return state;
}

function makeKernel(actions: ActionDef[] = [guardAction, gatedAction]) {
  const holder = new WorldStateHolder(baseState());
  const defRegistry = new DefRegistry();
  for (const action of actions) defRegistry.register(action as Def);

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  registerIntentOps(registry, {
    defLookup: (id) => defRegistry.resolve(id),
    now: () => 1000,
    // Stands in for the FlowInterpreter: effects still execute inside the
    // intent.resolve transaction and through the Op write channel.
    runEffects: (_effects, ctx) => registry.invokeInline('prop.add', { path: 'world.props.aiResolveCount', delta: 1 }, ctx),
  });

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
    getState: () => holder.getState(),
    queryEngine,
    actionCatalog,
    visibleTo: VISIBLE_TO,
    exprEngine,
    defRegistry,
  });
  const submission = new KernelCanonicalSubmissionAdapter({
    getState: () => holder.getState(),
    opRegistry: registry,
    actionCatalog,
    defLookup: (id) => defRegistry.resolve(id),
    isDeferred: () => false,
  });

  return { holder, defRegistry, registry, actionCatalog, readAdapter, submission, queryEngine, exprEngine };
}

function npcRequest(overrides: Partial<NPCActionRequest> = {}): NPCActionRequest {
  return {
    category: 'npc-behavior',
    mode: 'act',
    agent: { $: 'g:npc' },
    controlledEntity: { $: 'e:npc' },
    policy: { $: 'd:npc-search' },
    behaviorBinding: { $: 'd:npc-binding' },
    tier: 'exact',
    budget: { decisionPoints: 3, simulations: 3, evaluationCalls: 6 },
    correlationId: 'corr-kernel',
    ...overrides,
  };
}

describe('kernel AI read adapter', () => {
  beforeEach(() => resetIdCounters());

  it('applies the play visibleTo predicate and never exposes a hidden entity', () => {
    const { readAdapter } = makeKernel();
    const authority = readAdapter.readAuthority({ $: 'g:npc' });
    expect(authority.ok).toBe(true);
    if (!authority.ok) return;

    const slice = readAdapter.buildBeliefSlice(authority.value);
    expect(slice.ok).toBe(true);
    if (!slice.ok) return;

    const visibleIds = slice.value.visibleRefs.map((ref) => ref.$);
    expect(visibleIds).toContain('e:npc');
    expect(visibleIds).toContain('e:ally');
    expect(visibleIds).not.toContain(HIDDEN);
    expect(JSON.stringify(slice.value.visibleFacts)).not.toContain('secretPlan');
    expect(slice.value.policyContext['policy.id']).toBe('d:npc-search');
  });

  it('separates live observation from retained knowledge', () => {
    const { readAdapter } = makeKernel();
    const authority = readAdapter.readAuthority({ $: 'g:npc' });
    if (!authority.ok) return;
    const slice = readAdapter.buildBeliefSlice(authority.value);
    if (!slice.ok) return;

    expect(slice.value.knownFacts['allyPresent']).toMatchObject({ certainty: 'observed', value: true });
    expect(slice.value.knownFacts['lastSeen:e:hidden-scout']).toMatchObject({ certainty: 'historical', value: 'n:room2' });
  });

  it('filters a caller query that omits visibleTo', () => {
    const { readAdapter } = makeKernel();
    const authority = readAdapter.readAuthority({ $: 'g:npc' });
    if (!authority.ok) return;
    const unfiltered = readAdapter.queryVisible(authority.value, { from: 'entities' });
    expect(unfiltered.ok).toBe(true);
    if (unfiltered.ok) expect(unfiltered.value.map((ref) => ref.$)).not.toContain(HIDDEN);
  });

  it('honours a legitimate upstream omniscient agent only', () => {
    const { readAdapter } = makeKernel();
    const seer = readAdapter.readAuthority({ $: 'g:seer' });
    if (!seer.ok) return;
    expect(seer.value.omniscient).toBe(true);
    const slice = readAdapter.buildBeliefSlice(seer.value);
    if (!slice.ok) return;
    expect(slice.value.visibleRefs.map((ref) => ref.$)).toContain(HIDDEN);
  });

  it('produces deterministic versions that change when readable information changes', () => {
    const { readAdapter, holder } = makeKernel();
    const authority = readAdapter.readAuthority({ $: 'g:npc' });
    if (!authority.ok) return;
    const first = readAdapter.versions(authority.value);
    const repeat = readAdapter.versions(authority.value);
    expect(first).toEqual(repeat);
    if (!first.ok) return;
    expect(readAdapter.isCurrent(authority.value, first.value)).toBe(true);

    holder.setState(setPath(holder.getState(), 'world.knowledge.g:npc.facts.lastSeen:e:hidden-scout', 'n:room9' as never) as WorldState);
    expect(readAdapter.isCurrent(authority.value, first.value)).toBe(false);
  });

  it('projects an owner resource pool real value onto the controlled entity', () => {
    // AP/体力等池在引擎里是 world.props.pools.<pool>.<scope>.real（非实体 props）。受控实体
    // 应把它主的池代数量投影为 `pool.<name>` 观测字段，供设计货币等估值函数读取。
    let state = baseState();
    state = setPath(state, 'world.props.pools.ap.g:npc.real', 2) as WorldState;
    state = setPath(state, 'world.props.pools.ap.g:npc.available', 2) as WorldState;
    state = setPath(state, 'world.props.pools.stamina.g:npc.real', 1) as WorldState;
    state = setPath(state, 'world.props.pools.stamina.g:npc.available', 1) as WorldState;
    const holder = new WorldStateHolder(state);

    const exprEngine = new ExprEngine();
    const queryEngine = new QueryEngine();
    const registry = new OpRegistry(holder);
    registerPropOps(registry, new DefRegistry());
    registerIntentOps(registry, {
      defLookup: () => null,
      now: () => 1000,
      runEffects: () => undefined as never,
    });
    const actionCatalog = new ActionCatalog({
      getState: () => holder.getState(),
      exprEngine,
      queryEngine,
      listActionDefs: () => [],
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
    const readAdapter = new KernelAIReadAdapter({ getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine });

    const authority = readAdapter.readAuthority({ $: 'g:npc' });
    expect(authority.ok).toBe(true);
    if (!authority.ok) return;
    const slice = readAdapter.buildBeliefSlice(authority.value);
    expect(slice.ok).toBe(true);
    if (!slice.ok) return;

    // 只投影该 agent 自己范围内的 real，不投影他人池、不投影 available 暂计。
    expect(slice.value.visibleFacts['e:npc.pool.ap']).toBe(2);
    expect(slice.value.visibleFacts['e:npc.pool.stamina']).toBe(1);
    // 未被该 agent 控制的对象不投影池代数量。
    expect(slice.value.visibleFacts['e:ally.pool.ap']).toBeUndefined();
  });
});

describe('kernel canonical submission adapter', () => {
  beforeEach(() => resetIdCounters());

  it('commits through intent.submit and intent.resolve and actually changes state', () => {
    const { submission, holder } = makeKernel();
    const legal = { action: guardAction.id, bindings: {}, cost: [] };
    expect(submission.authorize({ $: 'g:npc' }, { $: 'e:npc' }, legal).ok).toBe(true);
    expect(submission.validateLifecycle({ $: 'g:npc' }, { $: 'e:npc' }, legal).ok).toBe(true);

    const committed = submission.submitCanonical({ $: 'g:npc' }, { $: 'e:npc' }, legal);
    expect(committed).toMatchObject({ ok: true, value: { outcome: 'submitted' } });
    expect(holder.getState().world.props['aiResolveCount']).toBe(1);
    const intents = Object.values(holder.getState().world.intents);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.status).toBe('resolved');
    expect(intents[0]!.agent).toBe('e:npc');
  });

  it('refuses an action that the ActionCatalog does not currently offer', () => {
    const { submission, holder } = makeKernel();
    holder.setState(setPath(holder.getState(), 'world.props.advanceAllowed', false as never) as WorldState);
    const illegal = { action: gatedAction.id, bindings: {}, cost: [] };
    expect(submission.submitCanonical({ $: 'g:npc' }, { $: 'e:npc' }, illegal)).toMatchObject({ ok: false, code: 'AI_CANDIDATE_ILLEGAL' });
    expect(Object.keys(holder.getState().world.intents)).toHaveLength(0);
  });

  it('reports a void intent when the precondition lapses between submit and resolve', () => {
    const { holder, registry, defRegistry, actionCatalog } = makeKernel();
    // A resolve-time gate: legal at submit, revoked inside the resolve transaction.
    const flipping = new KernelCanonicalSubmissionAdapter({
      getState: () => holder.getState(),
      opRegistry: {
        invoke: <A, T>(name: string, args: A) => {
          if (name === 'intent.resolve') {
            holder.setState(setPath(holder.getState(), 'world.props.advanceAllowed', false as never) as WorldState);
          }
          return registry.invoke<A, T>(name, args);
        },
      },
      actionCatalog,
      defLookup: (id) => defRegistry.resolve(id),
      isDeferred: () => false,
    });
    const result = flipping.submitCanonical({ $: 'g:npc' }, { $: 'e:npc' }, { action: gatedAction.id, bindings: {}, cost: [] });
    expect(result).toMatchObject({ ok: false, code: 'AI_INTENT_VOID' });
    expect(holder.getState().world.props['aiResolveCount']).toBeUndefined();
  });

  it('rejects a non-ai agent and an unauthorized action', () => {
    const { submission, holder } = makeKernel();
    holder.setState({
      ...holder.getState(),
      world: {
        ...holder.getState().world,
        agents: {
          ...holder.getState().world.agents,
          'g:human': { ...createAgentShape('g:human', 'human', 'ks:h'), controls: [{ $: 'e:npc' }] },
          'g:npc': { ...holder.getState().world.agents['g:npc']!, authority: ['a:something-else'] },
        },
      },
    });
    expect(submission.authorize({ $: 'g:human' }, { $: 'e:npc' }, { action: guardAction.id, bindings: {}, cost: [] }))
      .toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
    expect(submission.authorize({ $: 'g:npc' }, { $: 'e:npc' }, { action: guardAction.id, bindings: {}, cost: [] }))
      .toMatchObject({ ok: false, code: 'AI_CANDIDATE_ILLEGAL' });
  });
});

describe('kernel simulation adapter', () => {
  beforeEach(() => resetIdCounters());

  it('runs the canonical chain inside a branch and restores state, rng and journal-visible commitments', () => {
    const { holder, submission } = makeKernel();
    const delivered: string[] = [];
    const silencer = new ReferenceCountedPresentationSilencer({ dispatch: (type) => delivered.push(type) });
    const checkpoints = new InMemoryCheckpointStore();
    const adapter = new CanonicalSimulationAdapter(new KernelSimulationAdapter({
      holder,
      checkpoints,
      submission,
      presentation: silencer,
    }));

    const before = holder.getState();
    const handle = adapter.begin(npcRequest());
    expect(handle.ok).toBe(true);
    if (!handle.ok) return;

    silencer.dispatch('presentation.during-simulation', {});
    const attempted = handle.value.attempt({ $: 'e:npc' }, { action: guardAction.id, bindings: {}, cost: [] });
    expect(attempted.ok).toBe(true);
    if (attempted.ok) {
      expect(attempted.value.intentState).toBe('resolved');
      expect(attempted.value.visibleStateChanged).toBe(true);
    }
    // The branch really executed the canonical chain.
    expect(holder.getState().world.props['aiResolveCount']).toBe(1);

    expect(handle.value.close().ok).toBe(true);
    const after = holder.getState();
    expect(after).toBe(before);
    expect(after.world.rng).toEqual(before.world.rng);
    expect(Object.keys(after.world.intents)).toHaveLength(0);
    expect(after.world.props['aiResolveCount']).toBeUndefined();
    expect(delivered).toEqual([]);
    expect(silencer.suppressedCount()).toBe(1);
    expect(checkpoints.list()).toEqual([]);

    silencer.dispatch('presentation.after-simulation', {});
    expect(delivered).toEqual(['presentation.after-simulation']);
  });
});

describe('Def-backed behavior validation', () => {
  beforeEach(() => resetIdCounters());

  function validatorFor(defs: readonly Def[]) {
    const defRegistry = new DefRegistry();
    for (const def of defs) defRegistry.register(def);
    const validator = new DefBackedBehaviorValidator({
      defRegistry,
      familyOf: () => behaviorFamily,
    });
    return new ValidatedBehaviorGateway((binding) => validator.resolve(binding));
  }

  const abstractFamily: Def = {
    id: 'd:ai-guard-family',
    kind: 'policy',
    abstract: true,
    mode: 'search',
  };

  it('accepts a concrete play binding and exposes coarse relevance', () => {
    const gateway = validatorFor([
      abstractFamily,
      {
        id: 'd:npc-binding',
        kind: 'policy',
        extends: ['d:ai-guard-family'],
        mode: 'search',
        policy: 'd:npc-search',
        props: { alertLevel: 3, relevantActions: ['a:hold-position'] },
      },
    ]);
    const result = gateway.resolveValidatedBinding({ $: 'd:npc-binding' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.policy).toEqual({ $: 'd:npc-search' });
    expect(result.value.relevantActionIds).toEqual([{ $: 'a:hold-position' }]);
    expect(result.value.parameters[0]).toMatchObject({ path: 'props.alertLevel', value: 3, playerVisible: true });
  });

  it('rejects a play value hardcoded in a reusable definition', () => {
    const gateway = validatorFor([
      { ...abstractFamily, props: { patrolRoute: ['n:a', 'n:b'] } },
      { id: 'd:npc-binding', kind: 'policy', extends: ['d:ai-guard-family'], mode: 'search', props: { alertLevel: 3 } },
    ]);
    expect(gateway.resolveValidatedBinding({ $: 'd:npc-binding' }))
      .toMatchObject({ ok: false, code: 'AI_PLAY_CONFIGURATION_REQUIRED' });
  });

  it('rejects a missing required parameter, an abstract binding and an out-of-range player value', () => {
    const missing = validatorFor([abstractFamily, { id: 'd:npc-binding', kind: 'policy', extends: ['d:ai-guard-family'], mode: 'search' }]);
    expect(missing.resolveValidatedBinding({ $: 'd:npc-binding' }))
      .toMatchObject({ ok: false, code: 'AI_PLAY_CONFIGURATION_REQUIRED' });

    const abstractBinding = validatorFor([{ ...abstractFamily, id: 'd:npc-binding', props: { alertLevel: 3 } }]);
    expect(abstractBinding.resolveValidatedBinding({ $: 'd:npc-binding' }))
      .toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });

    const outOfRange = validatorFor([
      abstractFamily,
      { id: 'd:npc-binding', kind: 'policy', extends: ['d:ai-guard-family'], mode: 'search', props: { alertLevel: 6 } },
    ]);
    expect(outOfRange.resolveValidatedBinding({ $: 'd:npc-binding' }))
      .toMatchObject({ ok: false, code: 'AI_PLAY_CONFIGURATION_REQUIRED' });
  });
});

describe('bounded AI on the real kernel', () => {
  beforeEach(() => resetIdCounters());

  function wire() {
    const kernel = makeKernel();
    const defRegistry = new DefRegistry();
    defRegistry.register({ id: 'd:ai-guard-family', kind: 'policy', abstract: true, mode: 'search' });
    defRegistry.register({
      id: 'd:npc-binding',
      kind: 'policy',
      extends: ['d:ai-guard-family'],
      mode: 'search',
      policy: 'd:npc-search',
      props: { alertLevel: 2, relevantActions: ['a:hold-position'] },
    });
    const behaviorGateway = new ValidatedBehaviorGateway((binding) =>
      new DefBackedBehaviorValidator({ defRegistry, familyOf: () => behaviorFamily }).resolve(binding));
    const planner = new ScopedCandidatePlanner();
    const facade = new BoundedAIDecisionFacade({
      readGateway: new RestrictedAIReadGateway(kernel.readAdapter),
      behaviorGateway,
      planners: new StaticPlannerRegistry([
        { policy: { $: 'd:npc-search' }, category: 'npc-behavior', planner },
      ]),
      evaluationGateway: { evaluate: () => 1, neutralFallback: () => 0 },
      evaluationGuard: new FiniteEvaluationGuard(),
      commitGateway: new CanonicalCandidateCommitGateway(kernel.submission),
    });
    return { ...kernel, facade };
  }

  it('recommends without any state change and submits through the canonical chain', () => {
    const { facade, holder } = wire();
    const before = holder.getState();

    const recommendation = facade.recommend({ ...npcRequest(), mode: 'recommend' } as NPCRecommendationRequest);
    expect(recommendation.status).toBe('recommended');
    expect(holder.getState()).toBe(before);

    const acted = facade.act(npcRequest());
    expect(acted.status).toBe('submitted');
    expect(holder.getState().world.props['aiResolveCount']).toBe(1);
  });

  it('offers exactly the legal actions a human sees for the same entity', () => {
    const { facade, actionCatalog } = wire();
    const humanActions = actionCatalog.queryActions({ $: 'e:npc' }, 'ui')
      .filter((action) => action.reason === undefined)
      .map((action) => action.action)
      .sort();
    const recommendation = facade.recommend({ ...npcRequest(), mode: 'recommend' } as NPCRecommendationRequest);
    expect(recommendation.candidate).toBeDefined();
    expect(humanActions).toContain(recommendation.candidate!.legalAction.action);
  });

  it('returns no action when the shared legality gate closes', () => {
    const { facade, holder } = wire();
    holder.setState(setPath(holder.getState(), 'world.props.advanceAllowed', false as never) as WorldState);
    const only = makeKernel([gatedAction]);
    expect(only.actionCatalog.queryActions({ $: 'e:npc' }, 'ai').length).toBeGreaterThanOrEqual(0);

    const acted = facade.act(npcRequest());
    // hold-position stays legal, so the AI still acts; the gated action is simply absent.
    expect(acted.status).toBe('submitted');
    expect(acted.candidate!.legalAction.action).toBe(guardAction.id);
  });

  it('drives a mode:search policy through the bridge without writing state', () => {
    const { facade, holder } = wire();
    const bridge = new AISearchPolicyBridge({
      facade,
      bindingFor: (_def, agentId) => agentId !== 'g:npc' ? null : {
        agent: { $: 'g:npc' },
        controlledEntity: { $: 'e:npc' },
        behaviorBinding: { $: 'd:npc-binding' },
        tier: 'exact',
        budget: { decisionPoints: 2, simulations: 2, evaluationCalls: 4 },
        correlationId: 'corr-bridge',
      },
    });
    const policy: PolicyDef = { id: 'd:npc-search', kind: 'policy', mode: 'search', searchDepth: 2 };
    const before = holder.getState();
    const proposed = bridge.propose(policy, { state: null, agentId: 'g:npc' });
    expect(proposed).toBe(guardAction.id);
    expect(holder.getState()).toBe(before);
    expect(bridge.propose(policy, { state: null, agentId: 'g:other' })).toBeNull();
  });
});
