/**
 * Public contracts for the bounded AI subsystem.
 *
 * These types deliberately expose only immutable read models and canonical
 * gateways. They never expose WorldState, Transaction, OpContext, or a write
 * callback, so callers cannot bypass the kernel's Action/Decision/Intent/Op
 * lifecycle through the AI API.
 */
import type { LegalAction } from '../actions/types.js';
import type { Query } from '../state/expr-types.js';
import type { Ref } from '../state/ids.js';
import type { Value } from '../state/value.js';

export type AIPolicyCategory = 'player-assistance' | 'npc-behavior';
export type PlanningTier = 'exact' | 'coarse';
export type AIDiagnosticSeverity = 'info' | 'warn' | 'error';
export type AIPhase = 'bind' | 'read' | 'plan' | 'simulate' | 'revalidate' | 'submit';

export type AIDiagnosticCode =
  | 'AI_POLICY_BINDING_INVALID'
  | 'AI_CONTRACT_UNAVAILABLE'
  | 'AI_NO_LEGAL_ACTION'
  | 'AI_NO_RELEVANT_ACTION'
  | 'AI_CANDIDATE_ILLEGAL'
  | 'AI_KNOWLEDGE_CHANGED'
  | 'AI_DECISION_STALE'
  | 'AI_INTENT_VOID'
  | 'AI_BUDGET_EXHAUSTED'
  | 'AI_EVALUATION_INVALID'
  | 'AI_SIMULATION_FAILED'
  | 'AI_TRANSACTION_FAILED'
  | 'AI_TIER_CONFIGURATION_MISSING'
  | 'AI_PLAY_CONFIGURATION_REQUIRED';

/** A failure-closed result local to AI integration boundaries. */
export type AIResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: AIDiagnosticCode; readonly detail: string };

export interface AIBudget {
  /** Internal decision-point budget, never a player-visible gameplay value. */
  readonly decisionPoints: number;
  /** Internal canonical simulation budget, never a player-visible gameplay value. */
  readonly simulations: number;
  /** Internal evaluation-call budget, never a player-visible gameplay value. */
  readonly evaluationCalls: number;
}

export type AIBudgetKind = keyof AIBudget;

export interface AIRequestBase {
  readonly agent: Ref;
  readonly controlledEntity: Ref;
  readonly policy: Ref;
  /** A validated base-class behavior binding; values remain owned by its source layer. */
  readonly behaviorBinding: Ref;
  readonly tier: PlanningTier;
  readonly budget: AIBudget;
  readonly correlationId: string;
}

export interface PlayerRecommendationRequest extends AIRequestBase {
  readonly category: 'player-assistance';
  readonly mode: 'recommend';
}

export interface NPCRecommendationRequest extends AIRequestBase {
  readonly category: 'npc-behavior';
  readonly mode: 'recommend';
}

export interface NPCActionRequest extends AIRequestBase {
  readonly category: 'npc-behavior';
  readonly mode: 'act';
}

export type AIRecommendationRequest = PlayerRecommendationRequest | NPCRecommendationRequest;
export type AIDecisionRequest = AIRecommendationRequest | NPCActionRequest;

/**
 * Every AI diagnostic is self-contained. CandidateAction is mandatory whenever
 * the diagnostic refers to an actual candidate rather than request setup.
 */
export interface AIDiagnostic {
  readonly code: AIDiagnosticCode;
  readonly severity: AIDiagnosticSeverity;
  readonly category: AIPolicyCategory;
  readonly agent: Ref;
  readonly controlledEntity: Ref;
  readonly policy: Ref;
  readonly correlationId: string;
  readonly candidateAction?: Ref;
  readonly phase: AIPhase;
  readonly reason: string;
  readonly upstreamContract: string;
  readonly hint: string;
}

export interface PublicAIDiagnostic {
  readonly code: AIDiagnosticCode;
  readonly severity: AIDiagnosticSeverity;
  readonly phase: AIPhase;
  readonly reason: string;
  readonly hint: string;
}

export interface AIExplanationNode {
  readonly kind: 'legal-action' | 'policy-rule' | 'tier' | 'evaluation' | 'revalidation';
  readonly summary: string;
  readonly visibleRefs: readonly Ref[];
}

export interface KnownFact {
  readonly value: Value;
  readonly observedAt: number;
  readonly certainty: 'observed' | 'historical' | 'uncertain';
}

/** Immutable, information-filtered input to planning and explanation. */
export interface BeliefSlice {
  readonly agent: Ref;
  readonly visibleFacts: Readonly<Record<string, Value>>;
  readonly knownFacts: Readonly<Record<string, KnownFact>>;
  readonly visibleRefs: readonly Ref[];
  readonly policyContext: Readonly<Record<string, Value>>;
}

export interface AIReadScope {
  readonly agent: Ref;
  readonly knowledgeVersion: string;
  readonly actionVersion: string;
  beliefSlice(): AIResult<BeliefSlice>;
  queryActions(actor: Ref): AIResult<readonly LegalAction[]>;
  query(query: Query): AIResult<readonly Ref[]>;
  isCurrent(version: { readonly knowledge: string; readonly actions: string }): boolean;
}

export interface AIReadGateway {
  openReadScope(agent: Ref): AIResult<AIReadScope>;
}

export interface SemanticIntent {
  readonly kind: string;
  readonly labels: readonly string[];
  readonly orderedSteps: readonly LegalAction[];
}

export interface CandidateSeed {
  readonly legalAction: LegalAction;
  readonly intent?: SemanticIntent;
}

/**
 * A deliberate, distinguishable empty result — NOT a gap or a no-legal-action.
 *
 * It is produced only when the coarse tier is fully configured but none of the
 * currently executable legal actions is marked relevant (requirements 2.5/5.3).
 * `candidates` is empty in this case; the facade maps it to a `no-action` result
 * carrying at most an `info` diagnostic, and never to `AI_NO_LEGAL_ACTION` or
 * `AI_TIER_CONFIGURATION_MISSING`.
 */
export interface AIPlanNoOp {
  readonly kind: 'coarse-no-relevant-action';
  /** A play-declared fallback state, surfaced for explanation when present. */
  readonly declaredFallback?: string;
}

export interface AIPlan {
  readonly rootSlice: BeliefSlice;
  readonly tier: PlanningTier;
  readonly candidates: readonly CandidateSeed[];
  readonly budget: BudgetLedger;
  /** Present only for a deliberate coarse-tier no-op; candidates is then empty. */
  readonly noOp?: AIPlanNoOp;
}

export interface BudgetLedger {
  remaining(): Readonly<AIBudget>;
  consume(kind: AIBudgetKind): AIResult<void>;
  exhausted(): boolean;
}

export interface CandidatePlanner {
  plan(scope: AIReadScope, request: AIDecisionRequest, behavior: ValidatedAIBehaviorBinding): AIResult<AIPlan>;
}

export interface EvaluationContext {
  readonly request: AIDecisionRequest;
  readonly slice: BeliefSlice;
  readonly candidate?: LegalAction;
}

export interface EvaluationGateway {
  evaluate(actor: Ref, slice: BeliefSlice, policy: Ref): unknown;
  neutralFallback(policy: Ref): number;
}

export interface EvaluationOutcome {
  readonly score: number;
  readonly status: 'evaluated' | 'neutral-fallback';
  readonly diagnostic?: AIDiagnostic;
}

export interface EvaluationGuard {
  normalize(raw: unknown, fallback: number, context: EvaluationContext): EvaluationOutcome;
}

export interface AICandidate {
  /** Controlled entity that must still own the legal action during revalidation. */
  readonly actor: Ref;
  readonly legalAction: LegalAction;
  readonly rationale: readonly AIExplanationNode[];
  readonly score: number;
  readonly scoreStatus: 'evaluated' | 'neutral-fallback';
  /** Present for sequential multi-participant search; keyed by controlled entity id. */
  readonly scoreVector?: SearchScoreVector;
  readonly rootKnowledgeVersion: string;
  readonly rootActionVersion: string;
}

export interface CanonicalCommitResult {
  readonly outcome: 'submitted' | 'opened-decision' | 'submitted-intent' | 'rejected';
}

export interface CandidateCommitGateway {
  revalidate(scope: AIReadScope, candidate: AICandidate): AIResult<LegalAction>;
  /** `actor` is the controlled entity that owns the action; it is never inferred. */
  submit(agent: Ref, actor: Ref, action: LegalAction): AIResult<CanonicalCommitResult>;
}

export interface ValidatedAIParameter {
  readonly path: string;
  readonly value: Value;
  readonly schema: Ref;
  readonly owner: 'base-schema' | 'play-configuration';
  readonly playerVisible: boolean;
  readonly internalMetric: boolean;
}

/** A read-only result owned and validated by the base-class layer. */
export interface ValidatedAIBehaviorBinding {
  readonly family: Ref;
  readonly policy: Ref;
  readonly category: AIPolicyCategory;
  readonly parameters: readonly ValidatedAIParameter[];
  /** Required for coarse planning; omission is a configuration error, never an exact-tier fallback. */
  readonly relevantActionIds?: readonly Ref[];
  readonly fallbackState?: string;
}

export interface AIBehaviorValidationGateway {
  resolveValidatedBinding(binding: Ref): AIResult<ValidatedAIBehaviorBinding>;
}

export interface PolicyAdapter {
  readonly category: AIPolicyCategory;
  supports(policy: Ref): AIResult<void>;
  createPlanner(policy: Ref, tier: PlanningTier): AIResult<CandidatePlanner>;
}

export interface PlannerRegistry {
  resolve(policy: Ref, category: AIPolicyCategory): AIResult<CandidatePlanner>;
}

export interface SimulationOutcome {
  readonly checkpoint: string;
  readonly visibleStateChanged: boolean;
  readonly decisionState: 'none' | 'open' | 'resolved' | 'void';
  readonly intentState: 'none' | 'pending' | 'resolved' | 'void';
}

export interface SimulationHandle {
  attempt(actor: Ref, candidate: LegalAction): AIResult<SimulationOutcome>;
  restore(): AIResult<void>;
  close(): AIResult<void>;
}

export interface SimulationAdapter {
  begin(request: NPCActionRequest): AIResult<SimulationHandle>;
}

export interface SearchDecisionContext {
  readonly request: AIDecisionRequest;
  readonly scope: AIReadScope;
  readonly behavior: ValidatedAIBehaviorBinding;
}

export interface SearchScoreEntry {
  readonly score: number;
  readonly status: EvaluationOutcome['status'];
}

export type SearchScoreVector = Readonly<Record<string, SearchScoreEntry>>;

export interface SearchSession {
  readonly root: SearchDecisionContext;
  /** Evaluate a participant against the currently active simulated branch. */
  evaluate(context: SearchDecisionContext, candidate?: LegalAction): EvaluationOutcome;
  /** Enter one canonical simulated branch. The branch remains active until restore is called. */
  simulate(context: SearchDecisionContext, candidate: LegalAction): AIResult<SimulationOutcome>;
  /** Restore and close the branch identified by the simulation outcome. */
  restore(after: SimulationOutcome): AIResult<void>;
  /** Derive the next participant only from the currently active post-simulation branch. */
  nextDecisionContext(after: SimulationOutcome): AIResult<SearchDecisionContext | undefined>;
  /** Select one index among equal-score actions, normally through a named replayable random stream. */
  selectTie(actions: readonly LegalAction[], context: SearchDecisionContext): AIResult<number>;
  remainingBudget(): Readonly<AIBudget>;
}

export interface SearchSessionGateway {
  /** Open a bounded search session for the validated root context. */
  open(root: SearchDecisionContext): AIResult<SearchSession>;
}

export interface SearchPlanner extends CandidatePlanner {
  search(session: SearchSession, root: AIPlan): AIResult<AICandidate | undefined>;
}

export interface AIDecisionResult {
  readonly status: 'recommended' | 'submitted' | 'no-action' | 'rejected';
  readonly candidate?: AICandidate;
  readonly diagnostics: readonly AIDiagnostic[];
  /** 可选：本次决策的完整审计记录（DecisionTrace），由成功路径回填；既有消费方不受影响。 */
  readonly trace?: import('./tuning/trace.js').DecisionTrace;
}

/** The only formal public decision entry point. */
export interface AIDecisionFacade {
  recommend(request: AIRecommendationRequest): AIDecisionResult;
  act(request: NPCActionRequest): AIDecisionResult;
}

export interface AIExplanationProjection {
  readonly status: AIDecisionResult['status'];
  readonly recommendation?: Readonly<LegalAction>;
  readonly reasons: readonly AIExplanationNode[];
  readonly diagnostics: readonly PublicAIDiagnostic[];
}
