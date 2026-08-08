/**
 * Kernel-bound canonical submission adapter.
 *
 * The AI never writes state here. Every semantic write is produced by the same
 * public Ops a human uses: `intent.submit` -> `intent.resolve`, or
 * `decision.answer` for an answer to an already open Decision. If resolution
 * fails after a successful submit, the frozen reservation is released through
 * `intent.void` so no partial state or unsettled cost survives.
 */
import { sameLegalAction } from '../candidate-planner.js';
import type { QueryMode } from '../../actions/catalog.js';
import type { LegalAction } from '../../actions/types.js';
import type { Result } from '../../ops/result.js';
import type { Def } from '../../state/def.js';
import type { Id, Ref } from '../../state/ids.js';
import type { Value } from '../../state/value.js';
import type { WorldState } from '../../state/world-state.js';
import type { CanonicalSubmissionAdapter } from '../commit-gateway.js';
import type { AIResult, CanonicalCommitResult } from '../types.js';

export interface OpInvoker {
  invoke<A, T>(name: string, args: A): Result<T>;
}

export interface LegalActionSourceForCommit {
  queryActions(actor: Ref, mode: QueryMode): LegalAction[];
}

export interface KernelCommitDeps {
  getState: () => WorldState;
  opRegistry: OpInvoker;
  actionCatalog: LegalActionSourceForCommit;
  defLookup: (id: Id) => Def | null;
  /**
   * Declares whether an action's resolution is deferred to the upstream
   * schedule instead of settling immediately. This is required: resolution
   * timing is a rule decision, so it must be stated rather than defaulted.
   */
  isDeferred: (action: Def) => boolean;
}

function asRef(value: unknown): Ref | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { $?: unknown };
  return typeof candidate.$ === 'string' && candidate.$.length > 0 ? { $: candidate.$ } : null;
}

/** A candidate that answers an open Decision rather than submitting an Intent. */
function decisionAnswerOf(action: LegalAction): { decision: Ref; choice: string } | null {
  const decision = asRef(action.bindings['decision']);
  const choice = action.bindings['choice'];
  if (decision === null || typeof choice !== 'string' || choice.length === 0) return null;
  return { decision, choice };
}

export class KernelCanonicalSubmissionAdapter implements CanonicalSubmissionAdapter {
  constructor(private readonly deps: KernelCommitDeps) {}

  authorize(agent: Ref, actor: Ref, action: LegalAction): AIResult<void> {
    const state = this.deps.getState();
    const record = state.world.agents[agent.$];
    if (record === undefined) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `AI agent ${agent.$} is not registered in world.agents.` };
    }
    if (record.kind !== 'ai') {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `Agent ${agent.$} has kind ${record.kind}; only an ai agent may submit an AI action.` };
    }
    if (!record.controls.some((controlled) => controlled.$ === actor.$)) {
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Agent ${agent.$} does not control ${actor.$}.` };
    }
    // `authority` is an existing upstream allow-list. When present it is binding.
    if (record.authority !== undefined && record.authority.length > 0) {
      const allowed = record.authority.includes('*') || record.authority.includes(action.action);
      if (!allowed) {
        return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Agent ${agent.$} is not authorized for action ${action.action}.` };
      }
    }
    const def = this.deps.defLookup(action.action);
    if (def === null || def.kind !== 'action') {
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Action ${action.action} is not a registered action definition.` };
    }
    return { ok: true, value: undefined };
  }

  validateLifecycle(agent: Ref, actor: Ref, action: LegalAction): AIResult<void> {
    const state = this.deps.getState();
    const legal = this.verifyCurrentlyLegal(actor, action);
    if (!legal.ok) return legal;

    const answer = decisionAnswerOf(action);
    if (answer !== null) {
      const decision = state.world.decisions[answer.decision.$];
      if (decision === undefined) {
        return { ok: false, code: 'AI_DECISION_STALE', detail: `Decision ${answer.decision.$} no longer exists.` };
      }
      if (decision.status !== 'open') {
        return { ok: false, code: 'AI_DECISION_STALE', detail: `Decision ${answer.decision.$} is ${decision.status}.` };
      }
      if (!decision.askees.some((askee) => askee.$ === actor.$)) {
        return { ok: false, code: 'AI_DECISION_STALE', detail: `Actor ${actor.$} is not an askee of decision ${answer.decision.$}.` };
      }
      if (decision.answers[actor.$] !== undefined) {
        return { ok: false, code: 'AI_DECISION_STALE', detail: `Actor ${actor.$} already answered decision ${answer.decision.$}.` };
      }
      return { ok: true, value: undefined };
    }

    // A duplicate pending Intent would freeze the cost twice for one decision.
    for (const intent of Object.values(state.world.intents)) {
      if (intent.status !== 'pending') continue;
      if (intent.agent !== actor.$ || intent.action !== action.action) continue;
      if (sameLegalAction({ action: intent.action, bindings: intent.bindings, cost: [] }, { ...action, cost: [] })) {
        return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Actor ${actor.$} already has a pending intent for ${action.action}.` };
      }
    }
    return { ok: true, value: undefined };
  }

  submitCanonical(agent: Ref, actor: Ref, action: LegalAction): AIResult<CanonicalCommitResult> {
    const legal = this.verifyCurrentlyLegal(actor, action);
    if (!legal.ok) return legal;

    const answer = decisionAnswerOf(action);
    if (answer !== null) {
      const answered = this.deps.opRegistry.invoke<{ id: Id; actor: Ref; choice: string }, void>('decision.answer', {
        id: answer.decision.$,
        actor,
        choice: answer.choice,
      });
      if (!answered.ok) {
        return { ok: false, code: 'AI_TRANSACTION_FAILED', detail: `decision.answer rejected: ${answered.code} ${answered.detail}` };
      }
      return { ok: true, value: { outcome: 'submitted' } };
    }

    const bindings = action.bindings as Record<string, Value>;
    const submitted = this.deps.opRegistry.invoke<
      { action: Id; agent: Id; bindings: Record<string, Value> },
      Ref
    >('intent.submit', { action: action.action, agent: actor.$, bindings });
    if (!submitted.ok) {
      return { ok: false, code: 'AI_TRANSACTION_FAILED', detail: `intent.submit rejected: ${submitted.code} ${submitted.detail}` };
    }
    const intentId = submitted.value.$;

    const def = this.deps.defLookup(action.action);
    if (def === null) {
      this.deps.opRegistry.invoke<{ id: Id; reason: string }, void>('intent.void', {
        id: intentId,
        reason: 'ai submit: action definition disappeared',
      });
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Action definition ${action.action} disappeared during submission.` };
    }
    if (this.deps.isDeferred(def)) {
      return { ok: true, value: { outcome: 'submitted-intent' } };
    }

    const settled = this.deps.opRegistry.invoke<{ id: Id }, void>('intent.resolve', { id: intentId });
    if (!settled.ok) {
      // Release the reservation so a failed resolution leaves no frozen cost.
      this.deps.opRegistry.invoke<{ id: Id; reason: string }, void>('intent.void', {
        id: intentId,
        reason: `ai resolve failed: ${settled.code}`,
      });
      return { ok: false, code: 'AI_TRANSACTION_FAILED', detail: `intent.resolve rejected: ${settled.code} ${settled.detail}` };
    }

    const finalStatus = this.deps.getState().world.intents[intentId]?.status;
    if (finalStatus === 'void' || finalStatus === 'failed') {
      return { ok: false, code: 'AI_INTENT_VOID', detail: `Intent ${intentId} ended as ${finalStatus} during resolution.` };
    }
    return { ok: true, value: { outcome: 'submitted' } };
  }

  /**
   * Confirms the named actor still owns this exact action in the authoritative
   * ActionCatalog. The actor is always supplied by the candidate, never derived.
   */
  private verifyCurrentlyLegal(actor: Ref, action: LegalAction): AIResult<void> {
    let available: LegalAction[];
    try {
      available = this.deps.actionCatalog.queryActions(actor, 'ai');
    } catch (error) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `queryActions failed for ${actor.$}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const current = available.find((candidate) => candidate.reason === undefined && sameLegalAction(candidate, action));
    if (current === undefined) {
      return {
        ok: false,
        code: 'AI_CANDIDATE_ILLEGAL',
        detail: `Actor ${actor.$} does not currently offer ${action.action} with these bindings.`,
      };
    }
    return { ok: true, value: undefined };
  }
}
