import { describe, expect, it } from 'vitest';
import { ScopedCandidatePlanner } from '../candidate-planner.js';
import { FiniteEvaluationGuard } from '../evaluation.js';
import { StaticPlannerRegistry } from '../planner-registry.js';
import { SequentialSearchPlanner } from '../sequential-search.js';
import { CanonicalSimulationAdapter, UnavailableSimulationAdapter } from '../simulation.js';
import type {
  AIDecisionRequest,
  AIReadScope,
  BeliefSlice,
  NPCActionRequest,
  SearchDecisionContext,
  SearchSession,
  SimulationOutcome,
  ValidatedAIBehaviorBinding,
} from '../types.js';

function request(agent: string, actor: string, policy: string, correlationId: string): Extract<AIDecisionRequest, { readonly category: 'npc-behavior'; readonly mode: 'act' }> {
  return {
    category: 'npc-behavior',
    mode: 'act',
    agent: { $: agent },
    controlledEntity: { $: actor },
    policy: { $: policy },
    behaviorBinding: { $: `d:behavior:${agent}` },
    tier: 'exact',
    budget: { decisionPoints: 1, simulations: 1, evaluationCalls: 1 },
    correlationId,
  };
}

function binding(policy: string): ValidatedAIBehaviorBinding {
  return { family: { $: 'd:family' }, policy: { $: policy }, category: 'npc-behavior', parameters: [] };
}

function scope(agent: string, actor: string, actions: string[]): AIReadScope {
  const slice: BeliefSlice = {
    agent: { $: agent }, visibleFacts: {}, knownFacts: {}, visibleRefs: [{ $: actor }], policyContext: {},
  };
  return {
    agent: { $: agent }, knowledgeVersion: `knowledge:${agent}`, actionVersion: `actions:${agent}`,
    beliefSlice: () => ({ ok: true, value: slice }),
    queryActions: (requestedActor) => requestedActor.$ === actor
      ? { ok: true, value: actions.map((action) => ({ action, bindings: {}, cost: [] })) }
      : { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'wrong actor' },
    query: () => ({ ok: true, value: [{ $: actor }] }),
    isCurrent: (version) => version.knowledge === `knowledge:${agent}` && version.actions === `actions:${agent}`,
  };
}

describe('canonical simulation adapter', () => {
  it('restores after failed attempts and always restores before close', () => {
    const calls: string[] = [];
    const adapter = new CanonicalSimulationAdapter({
      beginCanonicalSimulation: () => ({
        ok: true,
        value: {
          attemptCanonical: () => { calls.push('attempt'); return { ok: false, code: 'AI_SIMULATION_FAILED', detail: 'hook vetoed' }; },
          restoreCanonical: () => { calls.push('restore'); return { ok: true, value: undefined }; },
          closeCanonical: () => { calls.push('close'); return { ok: true, value: undefined }; },
        },
      }),
    });
    const handle = adapter.begin(request('g:one', 'e:one', 'd:one', 'c:one'));
    expect(handle.ok).toBe(true);
    if (!handle.ok) return;
    expect(handle.value.attempt({ $: 'e:one' }, { action: 'a:one', bindings: {}, cost: [] }))
      .toMatchObject({ ok: false, code: 'AI_SIMULATION_FAILED' });
    expect(handle.value.close().ok).toBe(true);
    expect(calls).toEqual(['attempt', 'restore', 'close']);
  });

  it('fails closed without the unified checkpoint/shadow-stream adapter', () => {
    expect(new UnavailableSimulationAdapter('scope not frozen').begin(request('g:one', 'e:one', 'd:one', 'c:one')))
      .toMatchObject({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE' });
  });
});

describe('sequential multi-agent search', () => {
  it('derives and plans every next participant from its own context, restores every explored branch, and selects the root self-maximizing score', () => {
    const first = request('g:one', 'e:one', 'd:one', 'c:one');
    const second = request('g:two', 'e:two', 'd:two', 'c:two');
    const third = request('g:three', 'e:three', 'd:three', 'c:three');
    const firstContext: SearchDecisionContext = { request: first, scope: scope('g:one', 'e:one', ['a:one-low', 'a:one-high']), behavior: binding('d:one') };
    const secondContext: SearchDecisionContext = { request: second, scope: scope('g:two', 'e:two', ['a:two']), behavior: binding('d:two') };
    const thirdContext: SearchDecisionContext = { request: third, scope: scope('g:three', 'e:three', ['a:three']), behavior: binding('d:three') };
    const base = new ScopedCandidatePlanner();
    const registry = new StaticPlannerRegistry([
      { policy: first.policy, category: 'npc-behavior', planner: base },
      { policy: second.policy, category: 'npc-behavior', planner: base },
      { policy: third.policy, category: 'npc-behavior', planner: base },
    ]);
    const planner = new SequentialSearchPlanner(base, registry);
    // Root traversal reaches two terminal paths: root->second->third. The
    // shared search budget accounts for every continuous decision point.
    const rootRequest: NPCActionRequest = { ...first, budget: { decisionPoints: 5, simulations: 6, evaluationCalls: 6 } };
    const root = planner.plan(firstContext.scope, rootRequest, firstContext.behavior);
    expect(root.ok).toBe(true);
    if (!root.ok) return;

    const sequence: string[] = [];
    const outcomes: SimulationOutcome[] = [
      { checkpoint: 'cp:one-low', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
      { checkpoint: 'cp:two-low', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
      { checkpoint: 'cp:three-low', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
      { checkpoint: 'cp:one-high', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
      { checkpoint: 'cp:two-high', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
      { checkpoint: 'cp:three-high', visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' },
    ];
    let index = 0;
    const session: SearchSession = {
      root: firstContext,
      evaluate: (context, candidate) => {
        sequence.push(`evaluate:${context.request.agent.$}:${candidate?.action}`);
        return new FiniteEvaluationGuard().normalize(candidate?.action.endsWith('high') ? 2 : 1, 0, {
          request: context.request,
          slice: (context.scope.beliefSlice() as { readonly value: BeliefSlice }).value,
          candidate,
        });
      },
      simulate: (context, candidate) => {
        sequence.push(`simulate:${context.request.agent.$}:${candidate.action}`);
        return { ok: true, value: outcomes[index++]! };
      },
      restore: (outcome) => { sequence.push(`restore:${outcome.checkpoint}`); return { ok: true, value: undefined }; },
      nextDecisionContext: () => {
        const branchIndex = index % 3;
        const next = branchIndex === 1 ? secondContext : branchIndex === 2 ? thirdContext : undefined;
        if (next !== undefined) sequence.push(`next:${next.request.agent.$}`);
        return { ok: true, value: next };
      },
      selectTie: () => ({ ok: true, value: 0 }),
      remainingBudget: () => ({ decisionPoints: 5, simulations: 6, evaluationCalls: 6 }),
    };
    const result = planner.search(session, root.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.legalAction.action).toBe('a:one-high');
    expect(sequence).toContain('next:g:two');
    expect(sequence).toContain('evaluate:g:two:a:two');
    expect(sequence).toContain('next:g:three');
    expect(sequence).toContain('evaluate:g:three:a:three');
    expect(sequence.filter((event) => event.startsWith('restore:'))).toHaveLength(6);
  });

  it('treats exhausted shared simulation budget as failure-closed', () => {
    const first = request('g:one', 'e:one', 'd:one', 'c:one');
    const rootContext: SearchDecisionContext = { request: first, scope: scope('g:one', 'e:one', ['a:one']), behavior: binding('d:one') };
    const base = new ScopedCandidatePlanner();
    const registry = new StaticPlannerRegistry([{ policy: first.policy, category: 'npc-behavior', planner: base }]);
    const planner = new SequentialSearchPlanner(base, registry);
    const root = planner.plan(rootContext.scope, { ...first, budget: { decisionPoints: 1, simulations: 0, evaluationCalls: 1 } }, rootContext.behavior);
    if (!root.ok) throw new Error(root.detail);
    const session: SearchSession = {
      root: rootContext,
      evaluate: () => ({ score: 0, status: 'evaluated' }),
      simulate: () => ({ ok: true, value: { checkpoint: 'cp', visibleStateChanged: false, decisionState: 'none', intentState: 'none' } }),
      restore: () => ({ ok: true, value: undefined }),
      nextDecisionContext: () => ({ ok: true, value: undefined }),
      selectTie: () => ({ ok: true, value: 0 }),
      remainingBudget: () => ({ decisionPoints: 1, simulations: 0, evaluationCalls: 1 }),
    };
    expect(planner.search(session, root.value)).toMatchObject({ ok: false, code: 'AI_BUDGET_EXHAUSTED' });
  });

  it('uses honest MaxN: every participant selects its own score component instead of minimizing the root participant', () => {
    const rootRequest: NPCActionRequest = {
      ...request('g:root', 'e:root', 'd:root', 'c:maxn'),
      budget: { decisionPoints: 3, simulations: 8, evaluationCalls: 12 },
    };
    const opponentRequest = request('g:opponent', 'e:opponent', 'd:opponent', 'c:maxn-opponent');
    const rootContext: SearchDecisionContext = {
      request: rootRequest,
      scope: scope('g:root', 'e:root', ['a:bait', 'a:safe']),
      behavior: binding('d:root'),
    };
    const opponentContext: SearchDecisionContext = {
      request: opponentRequest,
      scope: scope('g:opponent', 'e:opponent', ['a:selfish', 'a:spite', 'a:accept']),
      behavior: binding('d:opponent'),
    };
    const base = new ScopedCandidatePlanner();
    const registry = new StaticPlannerRegistry([
      { policy: rootRequest.policy, category: 'npc-behavior', planner: base },
      { policy: opponentRequest.policy, category: 'npc-behavior', planner: base },
    ]);
    const planner = new SequentialSearchPlanner(base, registry);
    const root = planner.plan(rootContext.scope, rootRequest, rootContext.behavior);
    if (!root.ok) throw new Error(root.detail);

    const activeActions: string[] = [];
    const terminalScores: Readonly<Record<string, Readonly<Record<string, number>>>> = {
      'a:bait>a:selfish': { 'e:root': 5, 'e:opponent': 5 },
      'a:bait>a:spite': { 'e:root': 0, 'e:opponent': 1 },
      'a:bait>a:accept': { 'e:root': 1, 'e:opponent': 2 },
      'a:safe>a:selfish': { 'e:root': 3, 'e:opponent': 0 },
      'a:safe>a:spite': { 'e:root': 3, 'e:opponent': 1 },
      'a:safe>a:accept': { 'e:root': 3, 'e:opponent': 2 },
    };
    const restored: string[] = [];
    const session: SearchSession = {
      root: rootContext,
      evaluate: (context) => ({
        score: terminalScores[activeActions.join('>')]?.[context.request.controlledEntity.$] ?? Number.NaN,
        status: 'evaluated',
      }),
      simulate: (_context, candidate) => {
        activeActions.push(candidate.action);
        return {
          ok: true,
          value: {
            checkpoint: `cp:${activeActions.join('>')}`,
            visibleStateChanged: true,
            decisionState: 'none',
            intentState: 'resolved',
          },
        };
      },
      restore: (outcome) => {
        restored.push(outcome.checkpoint);
        activeActions.pop();
        return { ok: true, value: undefined };
      },
      nextDecisionContext: () => ({
        ok: true,
        value: activeActions.length === 1 ? opponentContext : undefined,
      }),
      selectTie: () => ({ ok: true, value: 0 }),
      remainingBudget: () => rootRequest.budget,
    };

    const result = planner.search(session, root.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Opponent chooses selfish (its 5 beats 1/2), so bait yields root score 5.
    // A paranoid minimizer would choose spite and force bait to 0, incorrectly selecting safe.
    expect(result.value?.legalAction.action).toBe('a:bait');
    expect(result.value?.scoreVector).toEqual({
      'e:root': { score: 5, status: 'evaluated' },
      'e:opponent': { score: 5, status: 'evaluated' },
    });
    expect(restored).toHaveLength(8);
    expect(activeActions).toEqual([]);
  });

  it('delegates equal-score selection to the injected replayable tie selector', () => {
    const rootRequest: NPCActionRequest = {
      ...request('g:root', 'e:root', 'd:root', 'c:tie'),
      budget: { decisionPoints: 1, simulations: 2, evaluationCalls: 2 },
    };
    const rootContext: SearchDecisionContext = {
      request: rootRequest,
      scope: scope('g:root', 'e:root', ['a:first', 'a:second']),
      behavior: binding('d:root'),
    };
    const base = new ScopedCandidatePlanner();
    const planner = new SequentialSearchPlanner(base, new StaticPlannerRegistry([]));
    const root = planner.plan(rootContext.scope, rootRequest, rootContext.behavior);
    if (!root.ok) throw new Error(root.detail);
    let tieCalls = 0;
    const session: SearchSession = {
      root: rootContext,
      evaluate: () => ({ score: 3, status: 'evaluated' }),
      simulate: (_context, candidate) => ({
        ok: true,
        value: { checkpoint: `cp:${candidate.action}`, visibleStateChanged: false, decisionState: 'none', intentState: 'none' },
      }),
      restore: () => ({ ok: true, value: undefined }),
      nextDecisionContext: () => ({ ok: true, value: undefined }),
      selectTie: (actions) => {
        tieCalls++;
        expect(actions.map((action) => action.action)).toEqual(['a:first', 'a:second']);
        return { ok: true, value: 1 };
      },
      remainingBudget: () => rootRequest.budget,
    };

    const result = planner.search(session, root.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.legalAction.action).toBe('a:second');
    expect(tieCalls).toBe(1);
  });

  it('restores the active branch when recursive planner resolution fails', () => {
    const rootRequest = request('g:root', 'e:root', 'd:root', 'c:restore-failure');
    const missingRequest = request('g:missing', 'e:missing', 'd:missing', 'c:missing');
    const rootContext: SearchDecisionContext = {
      request: rootRequest,
      scope: scope('g:root', 'e:root', ['a:enter']),
      behavior: binding('d:root'),
    };
    const missingContext: SearchDecisionContext = {
      request: missingRequest,
      scope: scope('g:missing', 'e:missing', ['a:missing']),
      behavior: binding('d:missing'),
    };
    const base = new ScopedCandidatePlanner();
    const planner = new SequentialSearchPlanner(base, new StaticPlannerRegistry([]));
    const root = planner.plan(rootContext.scope, rootRequest, rootContext.behavior);
    if (!root.ok) throw new Error(root.detail);
    const restored: string[] = [];
    const session: SearchSession = {
      root: rootContext,
      evaluate: () => ({ score: 0, status: 'evaluated' }),
      simulate: () => ({
        ok: true,
        value: { checkpoint: 'cp:active', visibleStateChanged: true, decisionState: 'none', intentState: 'none' },
      }),
      restore: (outcome) => {
        restored.push(outcome.checkpoint);
        return { ok: true, value: undefined };
      },
      nextDecisionContext: () => ({ ok: true, value: missingContext }),
      selectTie: () => ({ ok: true, value: 0 }),
      remainingBudget: () => rootRequest.budget,
    };

    expect(planner.search(session, root.value)).toMatchObject({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE' });
    expect(restored).toEqual(['cp:active']);
  });
});
