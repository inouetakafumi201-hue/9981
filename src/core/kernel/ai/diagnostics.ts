/** Structured AI diagnostic factories. */
import type {
  AIDecisionRequest,
  AIDiagnostic,
  AIDiagnosticCode,
  AIDiagnosticSeverity,
  AIPhase,
  PublicAIDiagnostic,
} from './types';
import type { Ref } from '../state/ids';

export interface AIDiagnosticInput {
  readonly code: AIDiagnosticCode;
  readonly severity: AIDiagnosticSeverity;
  readonly phase: AIPhase;
  readonly reason: string;
  readonly upstreamContract: string;
  readonly hint: string;
  readonly candidateAction?: Ref;
}

/** Creates a complete diagnostic from an immutable request context. */
export function createAIDiagnostic(request: AIDecisionRequest, input: AIDiagnosticInput): AIDiagnostic {
  return {
    code: input.code,
    severity: input.severity,
    category: request.category,
    agent: request.agent,
    controlledEntity: request.controlledEntity,
    policy: request.policy,
    correlationId: request.correlationId,
    ...(input.candidateAction === undefined ? {} : { candidateAction: input.candidateAction }),
    phase: input.phase,
    reason: input.reason,
    upstreamContract: input.upstreamContract,
    hint: input.hint,
  };
}

export function unavailableContract(
  request: AIDecisionRequest,
  phase: AIPhase,
  upstreamContract: string,
  reason: string,
  hint: string,
  candidateAction?: Ref,
): AIDiagnostic {
  return createAIDiagnostic(request, {
    code: 'AI_CONTRACT_UNAVAILABLE',
    severity: 'error',
    phase,
    upstreamContract,
    reason,
    hint,
    ...(candidateAction === undefined ? {} : { candidateAction }),
  });
}

/** Removes non-public identity, upstream integration data and free-form private details. */
export function toPublicDiagnostic(diagnostic: AIDiagnostic): PublicAIDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    phase: diagnostic.phase,
    reason: publicReason(diagnostic.code),
    hint: publicHint(diagnostic.code),
  };
}

function publicReason(code: AIDiagnosticCode): string {
  switch (code) {
    case 'AI_NO_LEGAL_ACTION': return 'No executable action is currently available.';
    case 'AI_NO_RELEVANT_ACTION': return 'No action is currently marked relevant for this policy; no action is taken.';
    case 'AI_CANDIDATE_ILLEGAL': return 'The recommended action is no longer legal.';
    case 'AI_KNOWLEDGE_CHANGED': return 'The information used for this recommendation changed.';
    case 'AI_DECISION_STALE': return 'The decision context is no longer current.';
    case 'AI_INTENT_VOID': return 'The planned intent can no longer be resolved.';
    case 'AI_BUDGET_EXHAUSTED': return 'The decision budget was exhausted.';
    case 'AI_EVALUATION_INVALID': return 'The policy evaluation could not be used safely.';
    case 'AI_SIMULATION_FAILED': return 'The decision simulation could not be completed.';
    case 'AI_TRANSACTION_FAILED': return 'The action could not be committed.';
    case 'AI_TIER_CONFIGURATION_MISSING': return 'The selected planning tier is not configured.';
    case 'AI_PLAY_CONFIGURATION_REQUIRED': return 'The behavior needs a valid play configuration.';
    case 'AI_POLICY_BINDING_INVALID': return 'The behavior policy binding is invalid.';
    case 'AI_CONTRACT_UNAVAILABLE': return 'A required decision capability is not available.';
  }
}

function publicHint(code: AIDiagnosticCode): string {
  switch (code) {
    case 'AI_NO_LEGAL_ACTION': return 'Review the current legal actions and try again when the situation changes.';
    case 'AI_NO_RELEVANT_ACTION': return 'This is expected; mark a relevant action in the play configuration if an action should be considered.';
    case 'AI_CANDIDATE_ILLEGAL': return 'Request a fresh recommendation before acting.';
    case 'AI_KNOWLEDGE_CHANGED': return 'Refresh the recommendation from current visible information.';
    case 'AI_DECISION_STALE': return 'Open a current decision through the normal action flow.';
    case 'AI_INTENT_VOID': return 'Select a currently legal action through the normal action flow.';
    case 'AI_BUDGET_EXHAUSTED': return 'Use a later decision point or a configured fallback.';
    case 'AI_EVALUATION_INVALID': return 'Correct the policy evaluation configuration.';
    case 'AI_SIMULATION_FAILED': return 'Check the rule outcome and retry through the normal action flow.';
    case 'AI_TRANSACTION_FAILED': return 'Review the action result and retry only if it becomes legal.';
    case 'AI_TIER_CONFIGURATION_MISSING': return 'Configure the selected behavior through the validated play binding.';
    case 'AI_PLAY_CONFIGURATION_REQUIRED': return 'Provide a validated play-layer behavior configuration.';
    case 'AI_POLICY_BINDING_INVALID': return 'Use a validated policy and behavior binding.';
    case 'AI_CONTRACT_UNAVAILABLE': return 'Wait for the owning kernel or base-class integration to be available.';
  }
}
