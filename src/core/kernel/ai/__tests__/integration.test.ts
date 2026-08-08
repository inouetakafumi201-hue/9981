import { describe, expect, it } from 'vitest';
import { ScopedCandidatePlanner } from '../candidate-planner.js';
import { ValidatedBehaviorGateway, UnavailableBehaviorValidationGateway } from '../behavior-validation.js';
import { CanonicalCandidateCommitGateway } from '../commit-gateway.js';
import { toPublicDiagnostic } from '../diagnostics.js';
import { FiniteEvaluationGuard } from '../evaluation.js';
import { projectAIExplanation } from '../explanation.js';
import { BoundedAIDecisionFacade } from '../facade.js';
import { StaticPlannerRegistry } from '../planner-registry.js';
import { UnavailableAIReadGateway } from '../read-gateway.js';
import { AI_UGC_SCHEMA_VERSION, DeclarativeAIUGCValidator } from '../ugc.js';
import type {
  AIDiagnostic,
  AIReadScope,
  BeliefSlice,
  NPCActionRequest,
  PlayerRecommendationRequest,
  ValidatedAIBehaviorBinding,
} from '../types.js';

const HIDDEN_ENTITY = 'e:hidden-assassin';

const playerRequest: PlayerRecommendationRequest = {
  category: 'player-assistance',
  mode: 'recommend',
  agent: { $: 'g:player' },
  controlledEntity: { $: 'e:player' },
  policy: { $: 'd:assist' },
  behaviorBinding: { $: 'd:assist-behavior' },
  tier: 'exact',
  budget: { decisionPoints: 2, simulations: 1, evaluationCalls: 2 },
  correlationId: 'corr-player',
};

const npcRequest: NPCActionRequest = {
  ...playerRequest,
  category: 'npc-behavior',
  mode: 'act',
  agent: { $: 'g:npc' },
  controlledEntity: { $: 'e:npc' },
  policy: { $: 'd:npc' },
  behaviorBinding: { $: 'd:npc-behavior' },
  correlationId: 'corr-npc',
};

function binding(category: 'player-assistance' | 'npc-behavior', policy: string): ValidatedAIBehaviorBinding {
  return { family: { $: 'd:family' }, policy: { $: policy }, category, parameters: [] };
}

const visibleSlice: BeliefSlice = {
  agent: { $: 'g:player' },
  visibleFacts: { 'e:player.stance': 'ready' },
  knownFacts: {},
  visibleRefs: [{ $: 'e:player' }],
  policyContext: {},
};

function scope(agent: string, actor: string): AIReadScope {
  return {
    agent: { $: agent },
    knowledgeVersion: 'knowledge:1',
    actionVersion: 'actions:1',
    beliefSlice: () => ({ ok: true, value: { ...visibleSlice, agent: { $: agent }, visibleRefs: [{ $: actor }] } }),
    queryActions: (requested) => requested.$ === actor
      ? { ok: true, value: [{ action: 'a:guard', bindings: { target: { $: actor } }, cost: [] }] }
      : { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'uncontrolled actor' },
    query: () => ({ ok: true, value: [{ $: actor }] }),
    isCurrent: (version) => version.knowledge === 'knowledge:1' && version.actions === 'actions:1',
  };
}

function makeFacade() {
  const planner = new ScopedCandidatePlanner();
  const commits: string[] = [];
  const facade = new BoundedAIDecisionFacade({
    readGateway: { openReadScope: (agent) => ({ ok: true, value: scope(agent.$, agent.$ === 'g:npc' ? 'e:npc' : 'e:player') }) },
    behaviorGateway: {
      resolveValidatedBinding: (ref) => ({
        ok: true,
        value: ref.$ === 'd:npc-behavior' ? binding('npc-behavior', 'd:npc') : binding('player-assistance', 'd:assist'),
      }),
    },
    planners: new StaticPlannerRegistry([
      { policy: { $: 'd:assist' }, category: 'player-assistance', planner },
      { policy: { $: 'd:npc' }, category: 'npc-behavior', planner },
    ]),
    evaluationGateway: { evaluate: () => 3, neutralFallback: () => 0 },
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
  return { facade, commits };
}

describe('UI explanation projection', () => {
  it('projects only visible reasons and never leaks bindings, scores or hidden refs', () => {
    const { facade } = makeFacade();
    const result = facade.recommend(playerRequest);
    expect(result.status).toBe('recommended');

    const leaky: AIDiagnostic = {
      code: 'AI_CANDIDATE_ILLEGAL',
      severity: 'warn',
      category: 'player-assistance',
      agent: { $: 'g:player' },
      controlledEntity: { $: 'e:player' },
      policy: { $: 'd:assist' },
      correlationId: 'corr-player',
      candidateAction: { $: 'a:guard' },
      phase: 'revalidate',
      reason: `Hidden entity ${HIDDEN_ENTITY} invalidated the target.`,
      upstreamContract: 'ActionCatalog.queryActions',
      hint: `Avoid ${HIDDEN_ENTITY}.`,
    };

    const projection = projectAIExplanation(
      {
        ...result,
        candidate: {
          ...result.candidate!,
          rationale: [
            ...result.candidate!.rationale,
            { kind: 'policy-rule', summary: `Chasing ${HIDDEN_ENTITY}`, visibleRefs: [{ $: HIDDEN_ENTITY }] },
          ],
        },
        diagnostics: [leaky],
      },
      visibleSlice,
    );

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(HIDDEN_ENTITY);
    expect(projection.reasons.every((reason) => reason.visibleRefs.every((ref) => ref.$ === 'e:player'))).toBe(true);
    expect(projection.recommendation?.action).toBe('a:guard');
    expect(projection.recommendation?.bindings).toEqual({});
    expect(projection.diagnostics).toEqual([{
      code: 'AI_CANDIDATE_ILLEGAL',
      severity: 'warn',
      phase: 'revalidate',
      reason: 'The recommended action is no longer legal.',
      hint: 'Request a fresh recommendation before acting.',
    }]);
    expect(serialized).not.toContain('score');
    expect(serialized).not.toContain('correlationId');
  });

  it('strips agent identity, correlation id and upstream contract from every public diagnostic', () => {
    const publicDiagnostic = toPublicDiagnostic({
      code: 'AI_CONTRACT_UNAVAILABLE',
      severity: 'error',
      category: 'npc-behavior',
      agent: { $: 'g:npc' },
      controlledEntity: { $: 'e:npc' },
      policy: { $: 'd:npc' },
      correlationId: 'corr-npc',
      phase: 'submit',
      reason: 'internal adapter detail',
      upstreamContract: 'internal adapter name',
      hint: 'internal fix instruction',
    });
    expect(Object.keys(publicDiagnostic).sort()).toEqual(['code', 'hint', 'phase', 'reason', 'severity']);
    expect(JSON.stringify(publicDiagnostic)).not.toContain('internal');
  });
});

describe('declarative UGC AI references', () => {
  const validator = new DeclarativeAIUGCValidator(
    new ValidatedBehaviorGateway((ref) => ref.$ === 'd:npc-behavior'
      ? { ok: true, value: binding('npc-behavior', 'd:npc') }
      : { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'unknown binding' }),
    new StaticPlannerRegistry([{ policy: { $: 'd:npc' }, category: 'npc-behavior', planner: new ScopedCandidatePlanner() }]),
  );

  const valid = {
    schemaVersion: AI_UGC_SCHEMA_VERSION,
    category: 'npc-behavior',
    policy: { $: 'd:npc' },
    behaviorBinding: { $: 'd:npc-behavior' },
  };

  it('accepts a registered declarative reference', () => {
    const result = validator.validate(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.behavior.policy).toEqual({ $: 'd:npc' });
  });

  it('rejects code, extra privileges, unregistered policies and mismatched categories', () => {
    expect(validator.validate({ ...valid, onEvaluate: '() => 1' })).toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
    expect(validator.validate({ ...valid, omniscient: true })).toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
    expect(validator.validate({ ...valid, category: 'player-assistance' })).toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
    expect(validator.validate({ ...valid, policy: 'd:npc' })).toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
    expect(validator.validate({ ...valid, schemaVersion: 'other' })).toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
    expect(validator.validate('policy')).toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
  });

  it('fails closed when the base-class validator is unavailable', () => {
    const unavailable = new DeclarativeAIUGCValidator(
      new UnavailableBehaviorValidationGateway('base validator not frozen'),
      new StaticPlannerRegistry([]),
    );
    expect(unavailable.validate(valid)).toMatchObject({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE' });
  });
});

describe('human and AI parity end to end', () => {
  it('uses the same legal action source and commits NPC actions only through the canonical chain', () => {
    const { facade, commits } = makeFacade();
    const humanVisibleActions = scope('g:npc', 'e:npc').queryActions({ $: 'e:npc' });
    expect(humanVisibleActions.ok).toBe(true);

    const acted = facade.act(npcRequest);
    expect(acted.status).toBe('submitted');
    expect(acted.candidate?.legalAction.action).toBe('a:guard');
    expect(commits).toEqual(['g:npc:a:guard']);

    const recommended = facade.recommend(playerRequest);
    expect(recommended.status).toBe('recommended');
    expect(commits).toEqual(['g:npc:a:guard']);
  });

  it('fails closed before planning, evaluation or submission when the safe Query/Knowledge adapter is not frozen', () => {
    let evaluations = 0;
    let submissions = 0;
    const planner = new ScopedCandidatePlanner();
    const facade = new BoundedAIDecisionFacade({
      readGateway: new UnavailableAIReadGateway(
        'container visibility, Knowledge provenance and scoped revisions are not frozen',
      ),
      behaviorGateway: {
        resolveValidatedBinding: () => ({ ok: true, value: binding('npc-behavior', 'd:npc') }),
      },
      planners: new StaticPlannerRegistry([
        { policy: { $: 'd:npc' }, category: 'npc-behavior', planner },
      ]),
      evaluationGateway: {
        evaluate: () => {
          evaluations++;
          return 3;
        },
        neutralFallback: () => 0,
      },
      evaluationGuard: new FiniteEvaluationGuard(),
      commitGateway: new CanonicalCandidateCommitGateway({
        authorize: () => ({ ok: true, value: undefined }),
        validateLifecycle: () => ({ ok: true, value: undefined }),
        submitCanonical: () => {
          submissions++;
          return { ok: true, value: { outcome: 'submitted' } };
        },
      }),
    });

    expect(facade.act(npcRequest)).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'AI_CONTRACT_UNAVAILABLE', phase: 'read' }],
    });
    expect(evaluations).toBe(0);
    expect(submissions).toBe(0);
  });
});
