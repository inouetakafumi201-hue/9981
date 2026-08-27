/** Canonical candidate revalidation and injected Action/Decision/Intent/Op submission. */
import { sameLegalAction } from './candidate-planner';
import type { LegalAction } from '../actions/types';
import type { Ref } from '../state/ids';
import type {
  AICandidate,
  AIReadScope,
  AIResult,
  CanonicalCommitResult,
  CandidateCommitGateway,
} from './types';

/**
 * This adapter is owned by the kernel integration point. submitCanonical must
 * use the Action -> Decision/Intent -> OpRegistry.invoke lifecycle; the AI
 * module has no direct write capability and cannot substitute another route.
 */
export interface CanonicalSubmissionAdapter {
  authorize(agent: Ref, actor: Ref, action: LegalAction): AIResult<void>;
  /** Maps upstream closed/stale Decision and void Intent outcomes to AI codes. */
  validateLifecycle(agent: Ref, actor: Ref, action: LegalAction): AIResult<void>;
  submitCanonical(agent: Ref, actor: Ref, action: LegalAction): AIResult<CanonicalCommitResult>;
}

export class CanonicalCandidateCommitGateway implements CandidateCommitGateway {
  constructor(private readonly adapter: CanonicalSubmissionAdapter) {}

  revalidate(scope: AIReadScope, candidate: AICandidate): AIResult<LegalAction> {
    if (!scope.isCurrent({ knowledge: candidate.rootKnowledgeVersion, actions: candidate.rootActionVersion })) {
      return { ok: false, code: 'AI_KNOWLEDGE_CHANGED', detail: 'Knowledge or legal-action version changed after candidate generation.' };
    }
    const actions = scope.queryActions(candidate.actor);
    if (!actions.ok) return actions;
    const current = actions.value.find((action) => action.reason === undefined && sameLegalAction(action, candidate.legalAction));
    if (current === undefined) {
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: 'Candidate is not a member of the current executable queryActions result.' };
    }
    const authorization = this.adapter.authorize(scope.agent, candidate.actor, current);
    if (!authorization.ok) return authorization;
    const lifecycle = this.adapter.validateLifecycle(scope.agent, candidate.actor, current);
    if (!lifecycle.ok) return lifecycle;
    return { ok: true, value: current };
  }

  submit(agent: Ref, actor: Ref, action: LegalAction): AIResult<CanonicalCommitResult> {
    const authorization = this.adapter.authorize(agent, actor, action);
    if (!authorization.ok) return authorization;
    const lifecycle = this.adapter.validateLifecycle(agent, actor, action);
    if (!lifecycle.ok) return lifecycle;
    return this.adapter.submitCanonical(agent, actor, action);
  }
}

/** Default for deployments where the canonical submission adapter is not frozen. */
export class UnavailableCandidateCommitGateway implements CandidateCommitGateway {
  constructor(private readonly detail: string) {}

  revalidate(_scope: AIReadScope, _candidate: AICandidate): AIResult<LegalAction> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }

  submit(_agent: Ref, _actor: Ref, _action: LegalAction): AIResult<CanonicalCommitResult> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }
}
