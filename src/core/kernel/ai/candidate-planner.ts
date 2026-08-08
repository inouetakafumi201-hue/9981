/** Candidate planning constrained to a single AIReadScope. */
import { FixedBudgetLedger } from './budget.js';
import type { LegalAction } from '../actions/types.js';
import type {
  AIDecisionRequest,
  AIPlan,
  AIPlanNoOp,
  AIReadScope,
  AIResult,
  CandidatePlanner,
  CandidateSeed,
  SemanticIntent,
  ValidatedAIBehaviorBinding,
} from './types.js';

export type SemanticIntentOrganizer = (
  candidates: readonly LegalAction[],
  request: AIDecisionRequest,
) => AIResult<readonly CandidateSeed[]>;

function canonicalValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => canonicalValueEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => canonicalValueEqual(leftRecord[key], rightRecord[key]));
}

export function sameLegalAction(left: LegalAction, right: LegalAction): boolean {
  return left.action === right.action
    && canonicalValueEqual(left.bindings, right.bindings)
    && canonicalValueEqual(left.cost, right.cost)
    && left.reason === right.reason;
}

function containsAction(pool: readonly LegalAction[], candidate: LegalAction): boolean {
  return pool.some((known) => sameLegalAction(known, candidate));
}

function intentUsesOnlyLegalActions(intent: SemanticIntent, legalActions: readonly LegalAction[]): boolean {
  return intent.orderedSteps.every((step) => containsAction(legalActions, step));
}

/**
 * The standard planner obtains every candidate from the current scoped
 * ActionCatalog projection. It cannot add a manual action, binding or target.
 */
export class ScopedCandidatePlanner implements CandidatePlanner {
  constructor(private readonly organizer?: SemanticIntentOrganizer) {}

  plan(scope: AIReadScope, request: AIDecisionRequest, behavior: ValidatedAIBehaviorBinding): AIResult<AIPlan> {
    if (behavior.category !== request.category) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'Behavior binding category is not compatible with this AI request.' };
    }
    if (behavior.policy.$ !== request.policy.$) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'Behavior binding policy does not match the requested policy.' };
    }

    const slice = scope.beliefSlice();
    if (!slice.ok) return slice;
    const queried = scope.queryActions(request.controlledEntity);
    if (!queried.ok) return queried;

    // ActionCatalog includes visible-but-disabled UI rows with reason. A candidate
    // must be executable now, so those rows are explanation data, not candidates.
    const executable = queried.value.filter((action) => action.reason === undefined);
    let selected: readonly LegalAction[] = executable;
    let coarseNoOp: AIPlanNoOp | undefined;

    if (request.tier === 'coarse') {
      // A missing relevance projection is a genuine configuration gap.
      if (behavior.relevantActionIds === undefined) {
        return {
          ok: false,
          code: 'AI_TIER_CONFIGURATION_MISSING',
          detail: 'Coarse planning requires an explicit relevantActionIds projection from the validated behavior binding.',
        };
      }
      const relevant = new Set(behavior.relevantActionIds.map((action) => action.$));
      const marked = executable.filter((action) => relevant.has(action.action));
      // Configuration is complete, yet none of the currently executable legal
      // actions is marked relevant. Per requirements 2.5/5.3 this is NOT a gap and
      // NOT a no-legal-action: it is a normal no-op (or the play-declared fallback).
      // A single unmarked action is only filtered; it produces no per-action diagnostic.
      if (marked.length === 0 && executable.length > 0) {
        coarseNoOp = {
          kind: 'coarse-no-relevant-action',
          ...(behavior.fallbackState === undefined ? {} : { declaredFallback: behavior.fallbackState }),
        };
      }
      selected = marked;
    }

    // AI_NO_LEGAL_ACTION is reserved for genuinely having no executable legal
    // action at all (tier-independent); it never represents the coarse no-op above.
    if (coarseNoOp === undefined && selected.length === 0) {
      return { ok: false, code: 'AI_NO_LEGAL_ACTION', detail: 'No currently executable legal action is available.' };
    }

    let candidates: readonly CandidateSeed[] = selected.map((legalAction) => ({ legalAction }));
    // A deliberate coarse no-op has no candidates to organize.
    if (coarseNoOp === undefined && this.organizer !== undefined) {
      const organized = this.organizer(selected, request);
      if (!organized.ok) return organized;
      for (const candidate of organized.value) {
        if (!containsAction(selected, candidate.legalAction)) {
          return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'Semantic intent organizer produced an action outside the current legal action set.' };
        }
        if (candidate.intent !== undefined && !intentUsesOnlyLegalActions(candidate.intent, selected)) {
          return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'Semantic intent organizer produced a macro step outside the current legal action set.' };
        }
      }
      candidates = organized.value;
    }

    try {
      return {
        ok: true,
        value: Object.freeze({
          rootSlice: slice.value,
          tier: request.tier,
          candidates: Object.freeze(candidates.map((candidate) => Object.freeze({ ...candidate }))),
          budget: new FixedBudgetLedger(request.budget),
          ...(coarseNoOp === undefined ? {} : { noOp: Object.freeze(coarseNoOp) }),
        }),
      };
    } catch (error) {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: `Invalid internal AI budget: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/** Used for policy modes whose public candidate adapter has not been frozen. */
export class UnavailableCandidatePlanner implements CandidatePlanner {
  constructor(private readonly detail: string) {}

  plan(_scope: AIReadScope, _request: AIDecisionRequest, _behavior: ValidatedAIBehaviorBinding): AIResult<AIPlan> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }
}
