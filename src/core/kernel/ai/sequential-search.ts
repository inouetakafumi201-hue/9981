/** Honest sequential MaxN search over bounded SearchDecisionContext instances. */
import type { LegalAction } from '../actions/types';
import type {
  AICandidate,
  AIDecisionRequest,
  AIPlan,
  AIReadScope,
  AIResult,
  BudgetLedger,
  CandidatePlanner,
  EvaluationOutcome,
  PlannerRegistry,
  SearchDecisionContext,
  SearchPlanner,
  SearchScoreVector,
  SearchSession,
  ValidatedAIBehaviorBinding,
} from './types';

/** Identifies a search-capable planner without changing CandidatePlanner's base contract. */
export function isSearchPlanner(planner: CandidatePlanner): planner is SearchPlanner {
  return 'search' in planner && typeof (planner as Partial<SearchPlanner>).search === 'function';
}

interface PathEntry {
  readonly context: SearchDecisionContext;
  readonly action: LegalAction;
}

interface NodeChoice {
  readonly action: LegalAction;
  readonly vector: SearchScoreVector;
}

/**
 * Honest sequential MaxN search.
 *
 * Each participant selects the branch that maximizes its own terminal score
 * component. No participant selects for another participant and no coalition is
 * synthesized. Every branch is restored before its sibling is explored, even
 * when planning, evaluation or recursion fails.
 */
export class SequentialSearchPlanner implements SearchPlanner {
  constructor(
    private readonly candidatePlanner: CandidatePlanner,
    private readonly plannerRegistry: PlannerRegistry,
  ) {}

  plan(scope: AIReadScope, request: AIDecisionRequest, behavior: ValidatedAIBehaviorBinding): AIResult<AIPlan> {
    return this.candidatePlanner.plan(scope, request, behavior);
  }

  search(session: SearchSession, root: AIPlan): AIResult<AICandidate | undefined> {
    const searched = this.searchContext(session, session.root, root, root.tier, root.budget, []);
    if (!searched.ok) return searched;
    if (searched.value === undefined) return { ok: true, value: undefined };

    const rootActor = session.root.request.controlledEntity.$;
    const rootScore = searched.value.vector[rootActor];
    if (rootScore === undefined) {
      return {
        ok: false,
        code: 'AI_EVALUATION_INVALID',
        detail: `Terminal score vector did not contain the root participant ${rootActor}.`,
      };
    }

    return {
      ok: true,
      value: {
        actor: session.root.request.controlledEntity,
        legalAction: searched.value.action,
        rationale: [
          {
            kind: 'tier',
            summary: `Sequential MaxN root tier: ${root.tier}.`,
            visibleRefs: [session.root.request.controlledEntity],
          },
          {
            kind: 'legal-action',
            summary: `Candidate ${searched.value.action.action} came from the root participant's scoped queryActions set.`,
            visibleRefs: [session.root.request.controlledEntity],
          },
          {
            kind: 'evaluation',
            summary: rootScore.status === 'evaluated'
              ? 'The terminal root-participant evaluation is finite.'
              : 'The terminal root-participant evaluation used its finite fallback.',
            visibleRefs: [],
          },
        ],
        score: rootScore.score,
        scoreStatus: rootScore.status,
        scoreVector: searched.value.vector,
        rootKnowledgeVersion: session.root.scope.knowledgeVersion,
        rootActionVersion: session.root.scope.actionVersion,
      },
    };
  }

  private searchContext(
    session: SearchSession,
    context: SearchDecisionContext,
    plan: AIPlan,
    rootTier: AIPlan['tier'],
    budget: BudgetLedger,
    path: readonly PathEntry[],
  ): AIResult<NodeChoice | undefined> {
    if (context.request.tier !== rootTier || plan.tier !== rootTier) {
      return {
        ok: false,
        code: 'AI_TIER_CONFIGURATION_MISSING',
        detail: 'A sequential search chain cannot change its root planning tier.',
      };
    }

    const decision = budget.consume('decisionPoints');
    if (!decision.ok) return decision;

    const choices: NodeChoice[] = [];
    for (const seed of plan.candidates) {
      const simulationBudget = budget.consume('simulations');
      if (!simulationBudget.ok) return simulationBudget;

      const simulated = callSafely(
        () => session.simulate(context, seed.legalAction),
        'Canonical branch simulation threw.',
      );
      if (!simulated.ok) return simulated;

      const branchPath = [...path, { context, action: seed.legalAction }];
      let branchResult: AIResult<SearchScoreVector>;
      try {
        const next = session.nextDecisionContext(simulated.value);
        if (!next.ok) {
          branchResult = next;
        } else if (next.value === undefined) {
          branchResult = this.evaluateTerminal(session, branchPath, budget);
        } else {
          const nextPlanner = this.plannerRegistry.resolve(next.value.request.policy, next.value.request.category);
          if (!nextPlanner.ok) {
            branchResult = nextPlanner;
          } else {
            const nextPlan = nextPlanner.value.plan(next.value.scope, next.value.request, next.value.behavior);
            if (!nextPlan.ok) {
              branchResult = nextPlan;
            } else {
              const continuation = this.searchContext(
                session,
                next.value,
                nextPlan.value,
                rootTier,
                budget,
                branchPath,
              );
              branchResult = continuation.ok && continuation.value !== undefined
                ? { ok: true, value: continuation.value.vector }
                : continuation.ok
                  ? {
                      ok: false,
                      code: 'AI_NO_LEGAL_ACTION',
                      detail: `Participant ${next.value.request.controlledEntity.$} produced no search choice.`,
                    }
                  : continuation;
            }
          }
        }
      } catch (error) {
        branchResult = {
          ok: false,
          code: 'AI_SIMULATION_FAILED',
          detail: `Sequential branch processing threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const restored = callSafely(
        () => session.restore(simulated.value),
        `Canonical branch restore threw for checkpoint ${simulated.value.checkpoint}.`,
      );
      if (!restored.ok) return restored;
      if (!branchResult.ok) return branchResult;
      choices.push({ action: seed.legalAction, vector: branchResult.value });
    }

    if (choices.length === 0) return { ok: true, value: undefined };
    return this.selectForCurrentParticipant(session, context, choices);
  }

  private evaluateTerminal(
    session: SearchSession,
    path: readonly PathEntry[],
    budget: BudgetLedger,
  ): AIResult<SearchScoreVector> {
    // If a participant appears more than once, evaluate its latest context once.
    const latest = new Map<string, PathEntry>();
    for (const entry of path) latest.set(entry.context.request.controlledEntity.$, entry);

    const vector: Record<string, { score: number; status: EvaluationOutcome['status'] }> = {};
    for (const [actorId, entry] of latest) {
      const evaluationBudget = budget.consume('evaluationCalls');
      if (!evaluationBudget.ok) return evaluationBudget;
      let evaluation: EvaluationOutcome;
      try {
        evaluation = session.evaluate(entry.context, entry.action);
      } catch (error) {
        return {
          ok: false,
          code: 'AI_EVALUATION_INVALID',
          detail: `Terminal evaluation threw for ${actorId}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!Number.isFinite(evaluation.score)) {
        return {
          ok: false,
          code: 'AI_EVALUATION_INVALID',
          detail: `EvaluationGuard returned a non-finite score for ${actorId}.`,
        };
      }
      vector[actorId] = { score: evaluation.score, status: evaluation.status };
    }
    return { ok: true, value: Object.freeze(vector) };
  }

  private selectForCurrentParticipant(
    session: SearchSession,
    context: SearchDecisionContext,
    choices: readonly NodeChoice[],
  ): AIResult<NodeChoice> {
    const actorId = context.request.controlledEntity.$;
    let bestScore = -Infinity;
    let tied: NodeChoice[] = [];
    for (const choice of choices) {
      const score = choice.vector[actorId]?.score;
      if (score === undefined || !Number.isFinite(score)) {
        return {
          ok: false,
          code: 'AI_EVALUATION_INVALID',
          detail: `Terminal score vector did not contain a finite component for ${actorId}.`,
        };
      }
      if (score > bestScore) {
        bestScore = score;
        tied = [choice];
      } else if (score === bestScore) {
        tied.push(choice);
      }
    }

    if (tied.length === 1) return { ok: true, value: tied[0]! };
    const tie = callSafely(
      () => session.selectTie(tied.map((choice) => choice.action), context),
      `Tie selector threw for participant ${actorId}.`,
    );
    if (!tie.ok) return tie;
    if (!Number.isInteger(tie.value) || tie.value < 0 || tie.value >= tied.length) {
      return {
        ok: false,
        code: 'AI_SIMULATION_FAILED',
        detail: `Tie selector returned invalid index ${String(tie.value)} for ${tied.length} choices.`,
      };
    }
    return { ok: true, value: tied[tie.value]! };
  }
}

function callSafely<T>(operation: () => AIResult<T>, prefix: string): AIResult<T> {
  try {
    return operation();
  } catch (error) {
    return {
      ok: false,
      code: 'AI_SIMULATION_FAILED',
      detail: `${prefix} ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
