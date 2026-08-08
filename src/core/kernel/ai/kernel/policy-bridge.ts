/**
 * Bridge from a mode:'search' PolicyDef to the bounded AI decision facade.
 *
 * A policy proposes; it never executes. `propose` therefore uses the read-only
 * recommendation path and returns an action id for the upstream schedule to
 * submit through the canonical lifecycle. `submit` is offered separately for
 * schedulers that explicitly want the AI to commit the action itself.
 */
import type { PolicyDef, PolicyEvalContext } from '../../schedule/policy.js';
import type { Id, Ref } from '../../state/ids.js';
import type {
  AIDecisionFacade,
  AIDecisionResult,
  AIDiagnostic,
  NPCActionRequest,
  NPCRecommendationRequest,
} from '../types.js';

/** Identity and bounded budget for one policy-driven AI decision. */
export interface AIPolicyRequestBinding {
  readonly agent: Ref;
  readonly controlledEntity: Ref;
  readonly behaviorBinding: Ref;
  readonly tier: NPCActionRequest['tier'];
  readonly budget: NPCActionRequest['budget'];
  readonly correlationId: string;
}

export interface AISearchPolicyBridgeDeps {
  facade: AIDecisionFacade;
  /**
   * Supplies the validated request identity for an agent driving a policy.
   * Returning null means the agent is not configured for AI decisions; the
   * bridge then proposes nothing instead of inventing a binding.
   */
  bindingFor: (def: PolicyDef, agentId: Id) => AIPolicyRequestBinding | null;
}

export class AISearchPolicyBridge {
  private lastDiagnostics: readonly AIDiagnostic[] = [];

  constructor(private readonly deps: AISearchPolicyBridgeDeps) {}

  /** Diagnostics from the most recent proposal, for observability and tests. */
  diagnostics(): readonly AIDiagnostic[] {
    return this.lastDiagnostics;
  }

  /** Matches `SearchPolicyResolver`: proposes an action id without writing state. */
  propose = (def: PolicyDef, ctx: PolicyEvalContext): Id | null => {
    const request = this.recommendationRequest(def, ctx);
    if (request === null) return null;
    const result = this.deps.facade.recommend(request);
    this.lastDiagnostics = result.diagnostics;
    return result.status === 'recommended' && result.candidate !== undefined
      ? result.candidate.legalAction.action
      : null;
  };

  /** Commits through the canonical Action -> Decision/Intent -> Op lifecycle. */
  submit(def: PolicyDef, ctx: PolicyEvalContext): AIDecisionResult | null {
    if (def.mode !== 'search') return null;
    const binding = this.deps.bindingFor(def, ctx.agentId);
    if (binding === null) return null;
    const request: NPCActionRequest = {
      category: 'npc-behavior',
      mode: 'act',
      agent: binding.agent,
      controlledEntity: binding.controlledEntity,
      policy: { $: def.id },
      behaviorBinding: binding.behaviorBinding,
      tier: binding.tier,
      budget: binding.budget,
      correlationId: binding.correlationId,
    };
    const result = this.deps.facade.act(request);
    this.lastDiagnostics = result.diagnostics;
    return result;
  }

  private recommendationRequest(def: PolicyDef, ctx: PolicyEvalContext): NPCRecommendationRequest | null {
    if (def.mode !== 'search') return null;
    const binding = this.deps.bindingFor(def, ctx.agentId);
    if (binding === null) return null;
    return {
      category: 'npc-behavior',
      mode: 'recommend',
      agent: binding.agent,
      controlledEntity: binding.controlledEntity,
      policy: { $: def.id },
      behaviorBinding: binding.behaviorBinding,
      tier: binding.tier,
      budget: binding.budget,
      correlationId: binding.correlationId,
    };
  }
}
