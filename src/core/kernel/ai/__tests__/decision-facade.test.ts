import { describe, expect, it } from 'vitest';
import { ScopedCandidatePlanner } from '../candidate-planner';
import { CanonicalCandidateCommitGateway } from '../commit-gateway';
import { FiniteEvaluationGuard } from '../evaluation';
import { BoundedAIDecisionFacade } from '../facade';
import { StaticPlannerRegistry, UnavailablePlannerRegistry } from '../planner-registry';
import type {
  AICandidate,
  AIReadScope,
  AIResult,
  AIRecommendationRequest,
  BeliefSlice,
  NPCActionRequest,
  SearchPlanner,
  SearchSessionGateway,
  ValidatedAIBehaviorBinding,
} from '../types';

const npcRequest: NPCActionRequest = {
  category: 'npc-behavior',
  mode: 'act',
  agent: { $: 'g:npc' },
  controlledEntity: { $: 'e:npc' },
  policy: { $: 'd:policy' },
  behaviorBinding: { $: 'd:behavior' },
  tier: 'exact',
  budget: { decisionPoints: 2, simulations: 1, evaluationCalls: 3 },
  correlationId: 'npc-correlation',
};

const playerRequest: AIRecommendationRequest = {
  ...npcRequest,
  category: 'player-assistance',
  mode: 'recommend',
  policy: { $: 'd:assist' },
  behaviorBinding: { $: 'd:assist-behavior' },
  correlationId: 'player-correlation',
};

function binding(category: 'npc-behavior' | 'player-assistance', policy = category === 'npc-behavior' ? 'd:policy' : 'd:assist'): ValidatedAIBehaviorBinding {
  return {
    family: { $: 'd:family' },
    policy: { $: policy },
    category,
    parameters: [],
  };
}

function makeScope(actions = [
  { action: 'a:wait', bindings: {}, cost: [] },
  { action: 'a:move', bindings: { target: { $: 'n:visible' } }, cost: [] },
]): AIReadScope {
  const slice: BeliefSlice = {
    agent: { $: 'g:npc' },
    visibleFacts: { visible: true },
    knownFacts: {},
    visibleRefs: [{ $: 'e:npc' }, { $: 'n:visible' }],
    policyContext: {},
  };
  return {
    agent: { $: 'g:npc' },
    knowledgeVersion: 'knowledge:1',
    actionVersion: 'actions:1',
    beliefSlice: () => ({ ok: true, value: slice }),
    queryActions: (actor) => actor.$ === 'e:npc'
      ? { ok: true, value: actions }
      : { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'uncontrolled actor' },
    query: () => ({ ok: true, value: [{ $: 'e:npc' }] }),
    isCurrent: (version) => version.knowledge === 'knowledge:1' && version.actions === 'actions:1',
  };
}

describe('candidate planner and finite evaluation', () => {
  it('uses the scoped legal action result as its only exact-tier candidate source', () => {
    const planner = new ScopedCandidatePlanner();
    const result = planner.plan(makeScope(), npcRequest, binding('npc-behavior'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates.map((candidate) => candidate.legalAction.action)).toEqual(['a:wait', 'a:move']);
  });

  it('requires base-layer relevance metadata in coarse tier and rejects organizer inventions', () => {
    const planner = new ScopedCandidatePlanner();
    const coarse = planner.plan(makeScope(), { ...npcRequest, tier: 'coarse' }, binding('npc-behavior'));
    expect(coarse).toMatchObject({ ok: false, code: 'AI_TIER_CONFIGURATION_MISSING' });

    const inventingPlanner = new ScopedCandidatePlanner(() => ({
      ok: true,
      value: [{ legalAction: { action: 'a:invented', bindings: {}, cost: [] } }],
    }));
    expect(inventingPlanner.plan(makeScope(), npcRequest, binding('npc-behavior')))
      .toMatchObject({ ok: false, code: 'AI_CANDIDATE_ILLEGAL' });
  });

  it('distinguishes coarse-tier configuration gap, normal no-op, and genuine no-legal-action', () => {
    const planner = new ScopedCandidatePlanner();
    const coarse = { ...npcRequest, tier: 'coarse' as const };

    // Missing relevance projection is a genuine configuration gap.
    expect(planner.plan(makeScope(), coarse, binding('npc-behavior')))
      .toMatchObject({ ok: false, code: 'AI_TIER_CONFIGURATION_MISSING' });

    // Config complete but nothing currently legal is marked: a normal no-op, not an error.
    const noneRelevant: ValidatedAIBehaviorBinding = { ...binding('npc-behavior'), relevantActionIds: [{ $: 'a:none' }], fallbackState: 'patrol' };
    const noOp = planner.plan(makeScope(), coarse, noneRelevant);
    expect(noOp.ok).toBe(true);
    if (noOp.ok) {
      expect(noOp.value.candidates).toEqual([]);
      expect(noOp.value.noOp).toMatchObject({ kind: 'coarse-no-relevant-action', declaredFallback: 'patrol' });
    }

    // Config complete and a legal action is marked: it becomes the only candidate.
    const someRelevant: ValidatedAIBehaviorBinding = { ...binding('npc-behavior'), relevantActionIds: [{ $: 'a:move' }] };
    const marked = planner.plan(makeScope(), coarse, someRelevant);
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      expect(marked.value.candidates.map((candidate) => candidate.legalAction.action)).toEqual(['a:move']);
      expect(marked.value.noOp).toBeUndefined();
    }

    // Genuinely no executable legal action at all: no-legal-action regardless of tier.
    expect(planner.plan(makeScope([]), coarse, noneRelevant))
      .toMatchObject({ ok: false, code: 'AI_NO_LEGAL_ACTION' });
  });

  it('accepts only finite numeric evaluations and records explicit fallback diagnostics', () => {
    const guard = new FiniteEvaluationGuard();
    expect(guard.normalize(4.5, 0, { request: npcRequest, slice: (makeScope().beliefSlice() as { readonly value: BeliefSlice }).value, candidate: { action: 'a:wait', bindings: {}, cost: [] } }))
      .toMatchObject({ score: 4.5, status: 'evaluated' });
    const fallback = guard.normalize('4.5', 1, {
      request: npcRequest,
      slice: (makeScope().beliefSlice() as { readonly value: BeliefSlice }).value,
      candidate: { action: 'a:wait', bindings: {}, cost: [] },
    });
    expect(fallback).toMatchObject({ score: 1, status: 'neutral-fallback' });
    expect(fallback.diagnostic).toMatchObject({ code: 'AI_EVALUATION_INVALID', candidateAction: { $: 'a:wait' } });
    expect(guard.normalize(Infinity, Infinity, { request: npcRequest, slice: (makeScope().beliefSlice() as { readonly value: BeliefSlice }).value }))
      .toMatchObject({ score: 0, status: 'neutral-fallback', diagnostic: { code: 'AI_EVALUATION_INVALID' } });
  });
});

describe('canonical candidate revalidation', () => {
  const candidate: AICandidate = {
    actor: { $: 'e:npc' },
    legalAction: { action: 'a:wait', bindings: {}, cost: [] },
    rationale: [],
    score: 1,
    scoreStatus: 'evaluated',
    rootKnowledgeVersion: 'knowledge:1',
    rootActionVersion: 'actions:1',
  };

  it('rejects stale versions and missing current legal membership before submit', () => {
    const gateway = new CanonicalCandidateCommitGateway({
      authorize: () => ({ ok: true, value: undefined }),
      validateLifecycle: () => ({ ok: true, value: undefined }),
      submitCanonical: () => ({ ok: true, value: { outcome: 'submitted' } }),
    });
    const staleScope = { ...makeScope(), isCurrent: () => false };
    expect(gateway.revalidate(staleScope, candidate)).toMatchObject({ ok: false, code: 'AI_KNOWLEDGE_CHANGED' });
    expect(gateway.revalidate(makeScope([]), candidate)).toMatchObject({ ok: false, code: 'AI_CANDIDATE_ILLEGAL' });
  });

  it('preserves canonical stale decision and void intent lifecycle categories', () => {
    const gateway = new CanonicalCandidateCommitGateway({
      authorize: () => ({ ok: true, value: undefined }),
      validateLifecycle: () => ({ ok: false, code: 'AI_DECISION_STALE', detail: 'decision closed' }),
      submitCanonical: () => ({ ok: true, value: { outcome: 'submitted' } }),
    });
    expect(gateway.revalidate(makeScope(), candidate)).toMatchObject({ ok: false, code: 'AI_DECISION_STALE' });
  });
});

describe('bounded AI decision facade', () => {
  function makeFacade(options?: {
    readonly scope?: AIReadScope;
    readonly submit?: () => AIResult<{ readonly outcome: 'submitted' | 'opened-decision' | 'submitted-intent' | 'rejected' }>;
    readonly registry?: StaticPlannerRegistry | UnavailablePlannerRegistry;
    readonly searchSessions?: SearchSessionGateway;
  }) {
    const scope = options?.scope ?? makeScope();
    const planner = new ScopedCandidatePlanner();
    const submit = options?.submit ?? (() => ({ ok: true as const, value: { outcome: 'submitted' as const } }));
    const commits: string[] = [];
    const facade = new BoundedAIDecisionFacade({
      readGateway: { openReadScope: () => ({ ok: true, value: scope }) },
      behaviorGateway: {
        resolveValidatedBinding: (ref) => ({
          ok: true,
          value: ref.$ === 'd:assist-behavior' ? binding('player-assistance') : binding('npc-behavior'),
        }),
      },
      planners: options?.registry ?? new StaticPlannerRegistry([
        { policy: { $: 'd:policy' }, category: 'npc-behavior', planner },
        { policy: { $: 'd:assist' }, category: 'player-assistance', planner },
      ]),
      evaluationGateway: {
        evaluate: (_actor, _slice, policy) => policy.$ === 'd:policy' ? 2 : 1,
        neutralFallback: () => 0,
      },
      evaluationGuard: new FiniteEvaluationGuard(),
      ...(options?.searchSessions === undefined ? {} : { searchSessions: options.searchSessions }),
      commitGateway: new CanonicalCandidateCommitGateway({
        authorize: () => ({ ok: true, value: undefined }),
        validateLifecycle: () => ({ ok: true, value: undefined }),
        submitCanonical: (agent, _actor, action) => {
          commits.push(`${agent.$}:${action.action}`);
          return submit();
        },
      }),
    });
    return { facade, commits };
  }

  it('recommends without submitting and submits NPC actions only through the canonical gateway', () => {
    const { facade, commits } = makeFacade();
    const recommendation = facade.recommend(playerRequest);
    expect(recommendation.status).toBe('recommended');
    expect(commits).toEqual([]);
    const action = facade.act(npcRequest);
    expect(action.status).toBe('submitted');
    expect(commits).toEqual(['g:npc:a:wait']);
  });

  it('rejects forged player action requests before any submission', () => {
    const { facade, commits } = makeFacade();
    const forged = facade.act({ ...playerRequest, mode: 'act' } as unknown as NPCActionRequest);
    expect(forged).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'AI_POLICY_BINDING_INVALID' }] });
    expect(commits).toEqual([]);
  });

  it('fails closed when a policy adapter is unavailable', () => {
    const { facade, commits } = makeFacade({ registry: new UnavailablePlannerRegistry('search adapter not frozen') });
    expect(facade.recommend(playerRequest)).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'AI_CONTRACT_UNAVAILABLE' }] });
    expect(commits).toEqual([]);
  });

  it('returns no action with a budget diagnostic when evaluation budget is exhausted', () => {
    const { facade } = makeFacade();
    const result = facade.recommend({ ...playerRequest, budget: { decisionPoints: 1, simulations: 0, evaluationCalls: 0 } });
    expect(result).toMatchObject({ status: 'no-action', diagnostics: [{ code: 'AI_BUDGET_EXHAUSTED' }] });
  });

  it('returns an info-level no-action, not an error no-legal-action, when coarse tier is configured but no legal action is marked relevant', () => {
    const scope = makeScope(); // executable: a:wait, a:move
    const coarseBinding: ValidatedAIBehaviorBinding = {
      family: { $: 'd:family' },
      policy: { $: 'd:assist' },
      category: 'player-assistance',
      parameters: [],
      relevantActionIds: [{ $: 'a:none' }], // marks nothing currently legal
      fallbackState: 'idle',
    };
    const commits: string[] = [];
    const facade = new BoundedAIDecisionFacade({
      readGateway: { openReadScope: () => ({ ok: true, value: scope }) },
      behaviorGateway: { resolveValidatedBinding: () => ({ ok: true, value: coarseBinding }) },
      planners: new StaticPlannerRegistry([
        { policy: { $: 'd:assist' }, category: 'player-assistance', planner: new ScopedCandidatePlanner() },
      ]),
      evaluationGateway: { evaluate: () => 1, neutralFallback: () => 0 },
      evaluationGuard: new FiniteEvaluationGuard(),
      commitGateway: new CanonicalCandidateCommitGateway({
        authorize: () => ({ ok: true, value: undefined }),
        validateLifecycle: () => ({ ok: true, value: undefined }),
        submitCanonical: (agent, _actor, action) => {
          commits.push(`${agent.$}:${action.action}`);
          return { ok: true, value: { outcome: 'submitted' } };
        },
      }),
    });

    const result = facade.recommend({ ...playerRequest, tier: 'coarse' });
    expect(result.status).toBe('no-action');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'AI_NO_RELEVANT_ACTION', severity: 'info', phase: 'plan' });
    expect(result.diagnostics[0]?.reason).toContain('idle'); // play-declared fallback surfaced
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'AI_NO_LEGAL_ACTION')).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'AI_TIER_CONFIGURATION_MISSING')).toBe(false);
    expect(commits).toEqual([]);
  });

  it('fails closed instead of statically evaluating a search planner when SearchSession is unavailable', () => {
    let searchCalls = 0;
    const base = new ScopedCandidatePlanner();
    const searchPlanner: SearchPlanner = {
      plan: (scope, request, behavior) => base.plan(scope, request, behavior),
      search: () => {
        searchCalls++;
        throw new Error('must not be reached without a session');
      },
    };
    const registry = new StaticPlannerRegistry([
      { policy: playerRequest.policy, category: 'player-assistance', planner: searchPlanner },
    ]);
    const { facade } = makeFacade({ registry });

    expect(facade.recommend(playerRequest)).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'AI_CONTRACT_UNAVAILABLE', phase: 'simulate' }],
    });
    expect(searchCalls).toBe(0);
  });

  it('executes a search planner only through the bounded SearchSession gateway and revalidates its result', () => {
    let opened = 0;
    let searched = 0;
    let staticEvaluations = 0;
    const base = new ScopedCandidatePlanner();
    const searchPlanner: SearchPlanner = {
      plan: (scope, request, behavior) => base.plan(scope, request, behavior),
      search: (session) => {
        searched++;
        expect(session.root.request.policy).toEqual(playerRequest.policy);
        return {
          ok: true,
          value: {
            actor: playerRequest.controlledEntity,
            legalAction: { action: 'a:move', bindings: { target: { $: 'n:visible' } }, cost: [] },
            rationale: [],
            score: 4,
            scoreStatus: 'evaluated',
            scoreVector: { 'e:npc': { score: 4, status: 'evaluated' } },
            rootKnowledgeVersion: 'knowledge:1',
            rootActionVersion: 'actions:1',
          },
        };
      },
    };
    const registry = new StaticPlannerRegistry([
      { policy: playerRequest.policy, category: 'player-assistance', planner: searchPlanner },
    ]);
    const searchSessions: SearchSessionGateway = {
      open: (root) => {
        opened++;
        return {
          ok: true,
          value: {
            root,
            evaluate: () => ({ score: 0, status: 'evaluated' }),
            simulate: () => ({ ok: false, code: 'AI_SIMULATION_FAILED', detail: 'unused by delegated test planner' }),
            restore: () => ({ ok: true, value: undefined }),
            nextDecisionContext: () => ({ ok: true, value: undefined }),
            selectTie: () => ({ ok: true, value: 0 }),
            remainingBudget: () => root.request.budget,
          },
        };
      },
    };
    const scope = makeScope();
    const facade = new BoundedAIDecisionFacade({
      readGateway: { openReadScope: () => ({ ok: true, value: scope }) },
      behaviorGateway: { resolveValidatedBinding: () => ({ ok: true, value: binding('player-assistance') }) },
      planners: registry,
      evaluationGateway: {
        evaluate: () => {
          staticEvaluations++;
          return 1;
        },
        neutralFallback: () => 0,
      },
      evaluationGuard: new FiniteEvaluationGuard(),
      searchSessions,
      commitGateway: new CanonicalCandidateCommitGateway({
        authorize: () => ({ ok: true, value: undefined }),
        validateLifecycle: () => ({ ok: true, value: undefined }),
        submitCanonical: () => ({ ok: true, value: { outcome: 'submitted' } }),
      }),
    });

    expect(facade.recommend(playerRequest)).toMatchObject({
      status: 'recommended',
      candidate: { legalAction: { action: 'a:move' }, score: 4 },
    });
    expect(opened).toBe(1);
    expect(searched).toBe(1);
    expect(staticEvaluations).toBe(0);
  });

  it('converts SearchSession gateway exceptions into failure-closed diagnostics', () => {
    const base = new ScopedCandidatePlanner();
    const searchPlanner: SearchPlanner = {
      plan: (scope, request, behavior) => base.plan(scope, request, behavior),
      search: () => ({ ok: true, value: undefined }),
    };
    const { facade } = makeFacade({
      registry: new StaticPlannerRegistry([
        { policy: playerRequest.policy, category: 'player-assistance', planner: searchPlanner },
      ]),
      searchSessions: {
        open: () => {
          throw new Error('checkpoint service unavailable');
        },
      },
    });

    expect(facade.recommend(playerRequest)).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'AI_CONTRACT_UNAVAILABLE', phase: 'simulate' }],
    });
  });
});
