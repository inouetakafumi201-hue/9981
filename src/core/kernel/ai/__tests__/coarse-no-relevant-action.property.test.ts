import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ScopedCandidatePlanner } from '../candidate-planner';
import { CanonicalCandidateCommitGateway } from '../commit-gateway';
import { FiniteEvaluationGuard } from '../evaluation';
import { BoundedAIDecisionFacade } from '../facade';
import { StaticPlannerRegistry } from '../planner-registry';
import type { LegalAction } from '../../actions/types';
import type {
  AIReadScope,
  BeliefSlice,
  NPCActionRequest,
  ValidatedAIBehaviorBinding,
} from '../types';

const actionId = fc.string({ minLength: 1, maxLength: 8 }).map((suffix) => `a:${suffix}`);

function scopeWith(executableIds: readonly string[]): AIReadScope {
  const slice: BeliefSlice = {
    agent: { $: 'g:npc' },
    visibleFacts: {},
    knownFacts: {},
    visibleRefs: [{ $: 'e:npc' }],
    policyContext: {},
  };
  const actions: LegalAction[] = executableIds.map((id) => ({ action: id, bindings: {}, cost: [] }));
  return {
    agent: { $: 'g:npc' },
    knowledgeVersion: 'k:1',
    actionVersion: 'a:1',
    beliefSlice: () => ({ ok: true, value: slice }),
    queryActions: (actor) => actor.$ === 'e:npc'
      ? { ok: true, value: actions }
      : { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'uncontrolled actor' },
    query: () => ({ ok: true, value: [{ $: 'e:npc' }] }),
    isCurrent: (version) => version.knowledge === 'k:1' && version.actions === 'a:1',
  };
}

const coarseRequest: NPCActionRequest = {
  category: 'npc-behavior',
  mode: 'act',
  agent: { $: 'g:npc' },
  controlledEntity: { $: 'e:npc' },
  policy: { $: 'd:policy' },
  behaviorBinding: { $: 'd:behavior' },
  tier: 'coarse',
  budget: { decisionPoints: 3, simulations: 1, evaluationCalls: 3 },
  correlationId: 'prop-coarse',
};

function coarseBinding(relevantIds: readonly string[]): ValidatedAIBehaviorBinding {
  return {
    family: { $: 'd:family' },
    policy: { $: 'd:policy' },
    category: 'npc-behavior',
    parameters: [],
    relevantActionIds: relevantIds.map((id) => ({ $: id })),
  };
}

describe('wakeup-ai coarse-tier relevance no-op', () => {
  it('Feature: wakeup-ai, Property 1: coarse tier fully configured with no relevant legal action yields a distinguishable no-op, never AI_NO_LEGAL_ACTION or AI_TIER_CONFIGURATION_MISSING', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(actionId, { minLength: 1, maxLength: 6 }),
        fc.array(actionId, { maxLength: 6 }),
        (executableIds, relevantCandidates) => {
          const executableSet = new Set(executableIds);
          // Configuration is present and complete, but marks NONE of the currently
          // executable legal actions (relevant ids are made disjoint from executable).
          const relevantIds = relevantCandidates.filter((id) => !executableSet.has(id));
          const binding = coarseBinding(relevantIds);
          const scope = scopeWith(executableIds);

          // Planner: a successful plan with no candidates and a coarse no-op marker,
          // never a no-legal-action or configuration failure.
          const planner = new ScopedCandidatePlanner();
          const plan = planner.plan(scope, coarseRequest, binding);
          expect(plan.ok).toBe(true);
          if (!plan.ok) return;
          expect(plan.value.candidates).toEqual([]);
          expect(plan.value.noOp).toMatchObject({ kind: 'coarse-no-relevant-action' });

          // Facade: an info-level no-action, never an error no-legal-action or config error,
          // and never a canonical submission.
          const commits: string[] = [];
          const facade = new BoundedAIDecisionFacade({
            readGateway: { openReadScope: () => ({ ok: true, value: scope }) },
            behaviorGateway: { resolveValidatedBinding: () => ({ ok: true, value: binding }) },
            planners: new StaticPlannerRegistry([
              { policy: { $: 'd:policy' }, category: 'npc-behavior', planner },
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

          const result = facade.act(coarseRequest);
          expect(result.status).toBe('no-action');
          expect(result.diagnostics).toHaveLength(1);
          expect(result.diagnostics[0]).toMatchObject({ code: 'AI_NO_RELEVANT_ACTION', severity: 'info' });
          expect(result.diagnostics.every((diagnostic) =>
            diagnostic.code !== 'AI_NO_LEGAL_ACTION' && diagnostic.code !== 'AI_TIER_CONFIGURATION_MISSING')).toBe(true);
          expect(commits).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
