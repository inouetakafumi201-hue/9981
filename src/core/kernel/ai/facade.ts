/** The sole public decision facade for bounded AI recommendation and action. */
import { createAIDiagnostic } from './diagnostics.js';
import { isSearchPlanner } from './sequential-search.js';
import type {
  AICandidate,
  AIDecisionFacade,
  AIDecisionRequest,
  AIDecisionResult,
  AIDiagnostic,
  AIDiagnosticCode,
  AIReadScope,
  AIRecommendationRequest,
  CandidateCommitGateway,
  EvaluationGateway,
  EvaluationGuard,
  NPCActionRequest,
  PlannerRegistry,
  SearchSessionGateway,
  AIReadGateway,
  AIBehaviorValidationGateway,
  ValidatedAIBehaviorBinding,
} from './types.js';

export interface AIDecisionFacadeDependencies {
  readonly readGateway: AIReadGateway;
  readonly behaviorGateway: AIBehaviorValidationGateway;
  readonly planners: PlannerRegistry;
  readonly evaluationGateway: EvaluationGateway;
  readonly evaluationGuard: EvaluationGuard;
  readonly commitGateway: CandidateCommitGateway;
  /** Required only when the resolved planner implements bounded sequential search. */
  readonly searchSessions?: SearchSessionGateway;
}

interface PlannedDecision {
  readonly result: AIDecisionResult;
  readonly scope?: AIReadScope;
}

function failureDiagnostic(
  request: AIDecisionRequest,
  code: AIDiagnosticCode,
  phase: AIDiagnostic['phase'],
  reason: string,
  upstreamContract: string,
  hint: string,
  candidate?: AICandidate,
): AIDiagnostic {
  return createAIDiagnostic(request, {
    code,
    severity: 'error',
    phase,
    reason,
    upstreamContract,
    hint,
    ...(candidate === undefined ? {} : { candidateAction: { $: candidate.legalAction.action } }),
  });
}

function rejected(request: AIDecisionRequest, diagnostic: AIDiagnostic): AIDecisionResult {
  return { status: 'rejected', diagnostics: [diagnostic] };
}

function noAction(request: AIDecisionRequest, diagnostic: AIDiagnostic): AIDecisionResult {
  return {
    status: 'no-action',
    diagnostics: [diagnostic],
  };
}

/**
 * This facade coordinates only bounded gateways. It never receives WorldState,
 * an arbitrary legal-action callback, or an action application callback.
 */
export class BoundedAIDecisionFacade implements AIDecisionFacade {
  constructor(private readonly deps: AIDecisionFacadeDependencies) {}

  recommend(request: AIRecommendationRequest): AIDecisionResult {
    if (request.mode !== 'recommend') {
      return rejected(request, failureDiagnostic(
        request,
        'AI_POLICY_BINDING_INVALID',
        'bind',
        'Recommendation entry received a non-recommend request.',
        'AIDecisionFacade.recommend',
        'Use the recommendation endpoint only for a recommend request.',
      ));
    }
    return this.planAndRevalidate(request).result;
  }

  act(request: NPCActionRequest): AIDecisionResult {
    // Runtime check protects an untrusted caller casting a player request as NPCActionRequest.
    if (request.category !== 'npc-behavior' || request.mode !== 'act') {
      return rejected(request, failureDiagnostic(
        request,
        'AI_POLICY_BINDING_INVALID',
        'bind',
        'Only an NPC behavior request may submit an AI action.',
        'AIDecisionFacade.act',
        'Use recommend for player assistance and submit only validated NPC behavior requests.',
      ));
    }

    const planned = this.planAndRevalidate(request);
    if (planned.scope === undefined || planned.result.candidate === undefined) return planned.result;

    // Revalidation is intentionally repeated immediately before the canonical
    // write boundary; planning and submission may be separated by user code.
    const currentAction = this.deps.commitGateway.revalidate(planned.scope, planned.result.candidate);
    if (!currentAction.ok) {
      const diagnostic = failureDiagnostic(
        request,
        currentAction.code,
        'revalidate',
        currentAction.detail,
        'CandidateCommitGateway.revalidate',
        'Create a fresh candidate from the current read scope before submission.',
        planned.result.candidate,
      );
      return { status: 'rejected', candidate: planned.result.candidate, diagnostics: [...planned.result.diagnostics, diagnostic] };
    }

    const submitted = this.deps.commitGateway.submit(
      request.agent,
      planned.result.candidate.actor,
      currentAction.value,
    );
    if (!submitted.ok || submitted.value.outcome === 'rejected') {
      const diagnostic = failureDiagnostic(
        request,
        submitted.ok ? 'AI_CANDIDATE_ILLEGAL' : submitted.code,
        'submit',
        submitted.ok ? 'Canonical submission rejected the candidate.' : submitted.detail,
        'CandidateCommitGateway.submit',
        'Inspect the canonical lifecycle result and generate a fresh legal candidate.',
        planned.result.candidate,
      );
      return { status: 'rejected', candidate: planned.result.candidate, diagnostics: [...planned.result.diagnostics, diagnostic] };
    }

    return { status: 'submitted', candidate: planned.result.candidate, diagnostics: planned.result.diagnostics };
  }

  private planAndRevalidate(request: AIDecisionRequest): PlannedDecision {
    const behavior = this.deps.behaviorGateway.resolveValidatedBinding(request.behaviorBinding);
    if (!behavior.ok) {
      return { result: rejected(request, failureDiagnostic(
        request,
        behavior.code,
        'bind',
        behavior.detail,
        'AIBehaviorValidationGateway.resolveValidatedBinding',
        'Install or correct the validated base-class behavior binding.',
      )) };
    }
    const bindingCheck = this.validateBehaviorBinding(request, behavior.value);
    if (bindingCheck !== undefined) return { result: rejected(request, bindingCheck) };

    const scope = this.deps.readGateway.openReadScope(request.agent);
    if (!scope.ok) {
      return { result: rejected(request, failureDiagnostic(
        request,
        scope.code,
        'read',
        scope.detail,
        'AIReadGateway.openReadScope',
        'Provide the frozen Query/visibleTo/Knowledge read adapter.',
      )) };
    }

    const planner = this.deps.planners.resolve(request.policy, request.category);
    if (!planner.ok) {
      return { result: rejected(request, failureDiagnostic(
        request,
        planner.code,
        'plan',
        planner.detail,
        'PlannerRegistry.resolve',
        'Register a policy adapter or keep this policy unavailable until its adapter is frozen.',
      )) };
    }

    const plan = planner.value.plan(scope.value, request, behavior.value);
    if (!plan.ok) {
      const diagnostic = failureDiagnostic(
        request,
        plan.code,
        'plan',
        plan.detail,
        'CandidatePlanner.plan',
        plan.code === 'AI_NO_LEGAL_ACTION'
          ? 'Return no action until queryActions exposes an executable candidate.'
          : 'Correct the policy configuration or refresh the bounded read scope.',
      );
      return {
        result: plan.code === 'AI_NO_LEGAL_ACTION' ? noAction(request, diagnostic) : rejected(request, diagnostic),
        scope: scope.value,
      };
    }

    // A deliberate coarse-tier no-op (config complete, no relevant legal action):
    // a distinguishable normal no-op carrying at most one info diagnostic, never an
    // error-level no-legal-action or configuration error (requirements 2.5/5.3).
    if (plan.value.noOp !== undefined) {
      const fallbackNote = plan.value.noOp.declaredFallback === undefined
        ? ''
        : ` Play-declared fallback state: ${plan.value.noOp.declaredFallback}.`;
      return {
        result: noAction(request, createAIDiagnostic(request, {
          code: 'AI_NO_RELEVANT_ACTION',
          severity: 'info',
          phase: 'plan',
          reason: `Coarse tier is fully configured, but no currently legal action is marked relevant.${fallbackNote}`,
          upstreamContract: 'CandidatePlanner.plan',
          hint: 'This is a normal no-op. Mark a relevant action in the play configuration to expand coarse candidates.',
        })),
        scope: scope.value,
      };
    }

    let best: AICandidate | undefined;
    const diagnostics: AIDiagnostic[] = [];
    if (isSearchPlanner(planner.value)) {
      const rootContext = { request, scope: scope.value, behavior: behavior.value };
      if (this.deps.searchSessions === undefined) {
        return {
          result: rejected(request, failureDiagnostic(
            request,
            'AI_CONTRACT_UNAVAILABLE',
            'simulate',
            'The resolved search planner has no bounded SearchSession gateway.',
            'SearchSessionGateway.open',
            'Install the canonical checkpoint, shadow-random and participant-context adapter before enabling this search policy.',
          )),
          scope: scope.value,
        };
      }

      let opened: ReturnType<SearchSessionGateway['open']>;
      try {
        opened = this.deps.searchSessions.open(rootContext);
      } catch (error) {
        opened = {
          ok: false,
          code: 'AI_CONTRACT_UNAVAILABLE',
          detail: `SearchSession gateway threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!opened.ok) {
        return {
          result: rejected(request, failureDiagnostic(
            request,
            opened.code,
            'simulate',
            opened.detail,
            'SearchSessionGateway.open',
            'Keep the search policy unavailable until the bounded simulation session can be opened.',
          )),
          scope: scope.value,
        };
      }

      let searched: ReturnType<typeof planner.value.search>;
      try {
        searched = planner.value.search(opened.value, plan.value);
      } catch (error) {
        searched = {
          ok: false,
          code: 'AI_SIMULATION_FAILED',
          detail: `Search planner threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!searched.ok) {
        const diagnostic = failureDiagnostic(
          request,
          searched.code,
          'simulate',
          searched.detail,
          'SearchPlanner.search',
          searched.code === 'AI_NO_LEGAL_ACTION'
            ? 'Return no action until a bounded search branch yields an executable candidate.'
            : 'Correct the bounded search integration before retrying this policy.',
        );
        return {
          result: searched.code === 'AI_NO_LEGAL_ACTION' ? noAction(request, diagnostic) : rejected(request, diagnostic),
          scope: scope.value,
        };
      }
      best = searched.value;
      if (best === undefined) {
        return {
          result: noAction(request, failureDiagnostic(
            request,
            'AI_NO_LEGAL_ACTION',
            'plan',
            'Bounded search completed without an executable candidate.',
            'SearchPlanner.search',
            'Return no action until the current scoped search produces a legal candidate.',
          )),
          scope: scope.value,
        };
      }
    } else {
      for (const seed of plan.value.candidates) {
        const consumed = plan.value.budget.consume('evaluationCalls');
        if (!consumed.ok) {
          diagnostics.push(failureDiagnostic(
            request,
            consumed.code,
            'plan',
            consumed.detail,
            'BudgetLedger.consume',
            'Use an already revalidated candidate, an explicit policy fallback, or return no action.',
          ));
          break;
        }
        let raw: unknown;
        let fallback: number;
        try {
          raw = this.deps.evaluationGateway.evaluate(request.controlledEntity, plan.value.rootSlice, request.policy);
          fallback = this.deps.evaluationGateway.neutralFallback(request.policy);
        } catch (error) {
          raw = undefined;
          fallback = Number.NaN;
          diagnostics.push(failureDiagnostic(
            request,
            'AI_EVALUATION_INVALID',
            'plan',
            `Evaluation adapter threw: ${error instanceof Error ? error.message : String(error)}`,
            'EvaluationGateway',
            'Make evaluation and neutral fallback evaluation total and finite.',
          ));
        }
        const outcome = this.deps.evaluationGuard.normalize(raw, fallback!, {
          request,
          slice: plan.value.rootSlice,
          candidate: seed.legalAction,
        });
        if (outcome.diagnostic !== undefined) diagnostics.push(outcome.diagnostic);
        const candidate: AICandidate = {
          actor: request.controlledEntity,
          legalAction: seed.legalAction,
          rationale: [
            { kind: 'tier', summary: `Root planning tier: ${plan.value.tier}.`, visibleRefs: [request.controlledEntity] },
            { kind: 'legal-action', summary: `Candidate ${seed.legalAction.action} came from current queryActions.`, visibleRefs: [request.controlledEntity] },
            { kind: 'evaluation', summary: outcome.status === 'evaluated' ? 'Policy evaluation is finite.' : 'Policy evaluation used its explicit finite fallback.', visibleRefs: [] },
          ],
          score: outcome.score,
          scoreStatus: outcome.status,
          rootKnowledgeVersion: scope.value.knowledgeVersion,
          rootActionVersion: scope.value.actionVersion,
        };
        if (best === undefined || candidate.score > best.score) best = candidate;
      }
    }

    if (best === undefined) {
      if (diagnostics.length === 0) {
        diagnostics.push(failureDiagnostic(
          request,
          'AI_NO_LEGAL_ACTION',
          'plan',
          'Planner supplied no candidates.',
          'CandidatePlanner.plan',
          'Return an executable current legal action or no action.',
        ));
      }
      return { result: { status: 'no-action', diagnostics }, scope: scope.value };
    }

    const revalidated = this.deps.commitGateway.revalidate(scope.value, best);
    if (!revalidated.ok) {
      diagnostics.push(failureDiagnostic(
        request,
        revalidated.code,
        'revalidate',
        revalidated.detail,
        'CandidateCommitGateway.revalidate',
        'Discard the stale candidate and plan again from a fresh scope.',
        best,
      ));
      return { result: { status: 'rejected', candidate: best, diagnostics }, scope: scope.value };
    }

    const currentCandidate: AICandidate = { ...best, legalAction: revalidated.value };
    return { result: { status: 'recommended', candidate: currentCandidate, diagnostics }, scope: scope.value };
  }

  private validateBehaviorBinding(request: AIDecisionRequest, behavior: ValidatedAIBehaviorBinding): AIDiagnostic | undefined {
    if (behavior.category !== request.category) {
      return failureDiagnostic(
        request,
        'AI_POLICY_BINDING_INVALID',
        'bind',
        'Behavior binding category is incompatible with the request category.',
        'ValidatedAIBehaviorBinding.category',
        'Bind a category-compatible behavior through the base-class validator.',
      );
    }
    if (behavior.policy.$ !== request.policy.$) {
      return failureDiagnostic(
        request,
        'AI_POLICY_BINDING_INVALID',
        'bind',
        'Behavior binding policy is incompatible with the requested policy.',
        'ValidatedAIBehaviorBinding.policy',
        'Use the policy reference validated by the behavior binding.',
      );
    }
    return undefined;
  }
}
