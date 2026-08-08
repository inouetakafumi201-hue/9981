/**
 * Kernel-bound bounded search session.
 *
 * Each participant is evaluated against a freshly opened read scope for the
 * currently active simulated branch, so no participant ever sees another
 * participant's hidden information. Branch entry and exit use the canonical
 * simulation adapter, and tie-breaking is a pure deterministic draw from the
 * AI shadow stream so exploration is replayable without advancing a live stream.
 */
import { FixedBudgetLedger } from '../budget.js';
import { createAIDiagnostic } from '../diagnostics.js';
import type { LegalAction } from '../../actions/types.js';
import type { Ref } from '../../state/ids.js';
import type { WorldState } from '../../state/world-state.js';
import type {
  AIBehaviorValidationGateway,
  AIBudget,
  AIPolicyCategory,
  AIReadGateway,
  AIResult,
  EvaluationGateway,
  EvaluationGuard,
  EvaluationOutcome,
  NPCActionRequest,
  SearchDecisionContext,
  SearchSession,
  SearchSessionGateway,
  SimulationAdapter,
  SimulationHandle,
  SimulationOutcome,
} from '../types.js';
import { DEFAULT_AI_SHADOW_STREAM } from './simulation-adapter.js';
import { fingerprint } from './state-read.js';

/** Identity of the next participant; ordering belongs to the schedule layer. */
export interface NextParticipant {
  readonly agent: Ref;
  readonly controlledEntity: Ref;
  readonly policy: Ref;
  readonly behaviorBinding: Ref;
  readonly category: AIPolicyCategory;
}

export type NextParticipantResolver = (
  previous: SearchDecisionContext,
  after: SimulationOutcome,
) => AIResult<NextParticipant | undefined>;

export interface KernelSearchSessionDeps {
  getState: () => WorldState;
  readGateway: AIReadGateway;
  behaviorGateway: AIBehaviorValidationGateway;
  evaluationGateway: EvaluationGateway;
  evaluationGuard: EvaluationGuard;
  simulation: SimulationAdapter;
  nextParticipant: NextParticipantResolver;
  shadowStreamName?: string;
}

function asNPCActionRequest(context: SearchDecisionContext): NPCActionRequest | null {
  const request = context.request;
  return request.category === 'npc-behavior' && request.mode === 'act' ? request : null;
}

interface OpenBranch {
  readonly handle: SimulationHandle;
  /** The context that entered this branch; the next participant derives from it. */
  readonly context: SearchDecisionContext;
}

class KernelSearchSession implements SearchSession {
  private readonly branches = new Map<string, OpenBranch>();
  private readonly ledger: FixedBudgetLedger;
  private readonly shadowStream: string;

  constructor(
    readonly root: SearchDecisionContext,
    private readonly deps: KernelSearchSessionDeps,
  ) {
    this.ledger = new FixedBudgetLedger(root.request.budget);
    this.shadowStream = deps.shadowStreamName ?? DEFAULT_AI_SHADOW_STREAM;
  }

  evaluate(context: SearchDecisionContext, candidate?: LegalAction): EvaluationOutcome {
    const consumed = this.ledger.consume('evaluationCalls');
    if (!consumed.ok) {
      return this.fallbackOutcome(context, candidate, 'AI_BUDGET_EXHAUSTED', consumed.detail, 'BudgetLedger.consume');
    }
    // A fresh scope reflects the active simulated branch, not the root state.
    const scope = this.deps.readGateway.openReadScope(context.request.agent);
    if (!scope.ok) {
      return this.fallbackOutcome(context, candidate, scope.code, scope.detail, 'AIReadGateway.openReadScope');
    }
    const slice = scope.value.beliefSlice();
    if (!slice.ok) {
      return this.fallbackOutcome(context, candidate, slice.code, slice.detail, 'AIReadScope.beliefSlice');
    }

    let raw: unknown;
    let fallback: number;
    try {
      raw = this.deps.evaluationGateway.evaluate(context.request.controlledEntity, slice.value, context.request.policy);
      fallback = this.deps.evaluationGateway.neutralFallback(context.request.policy);
    } catch (error) {
      return this.fallbackOutcome(
        context,
        candidate,
        'AI_EVALUATION_INVALID',
        `Evaluation adapter threw: ${error instanceof Error ? error.message : String(error)}`,
        'EvaluationGateway',
      );
    }
    return this.deps.evaluationGuard.normalize(raw, fallback, {
      request: context.request,
      slice: slice.value,
      ...(candidate === undefined ? {} : { candidate }),
    });
  }

  simulate(context: SearchDecisionContext, candidate: LegalAction): AIResult<SimulationOutcome> {
    const request = asNPCActionRequest(context);
    if (request === null) {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: 'Only an NPC behavior action context may enter a canonical simulated branch.',
      };
    }
    const consumed = this.ledger.consume('simulations');
    if (!consumed.ok) return consumed;

    const handle = this.deps.simulation.begin(request);
    if (!handle.ok) return handle;

    const attempted = handle.value.attempt(context.request.controlledEntity, candidate);
    if (!attempted.ok) {
      // The managed handle already restored; release it so no checkpoint leaks.
      handle.value.close();
      return attempted;
    }
    this.branches.set(attempted.value.checkpoint, { handle: handle.value, context });
    return attempted;
  }

  restore(after: SimulationOutcome): AIResult<void> {
    const branch = this.branches.get(after.checkpoint);
    if (branch === undefined) {
      return { ok: false, code: 'AI_SIMULATION_FAILED', detail: `No open simulated branch for checkpoint ${after.checkpoint}.` };
    }
    this.branches.delete(after.checkpoint);
    const restored = branch.handle.restore();
    if (!restored.ok) {
      branch.handle.close();
      return restored;
    }
    return branch.handle.close();
  }

  nextDecisionContext(after: SimulationOutcome): AIResult<SearchDecisionContext | undefined> {
    // The successor must be derived from the participant that actually entered
    // this branch, otherwise a chain longer than two could never advance.
    const branch = this.branches.get(after.checkpoint);
    if (branch === undefined) {
      return { ok: false, code: 'AI_SIMULATION_FAILED', detail: `No open simulated branch for checkpoint ${after.checkpoint}.` };
    }
    const proposed = this.deps.nextParticipant(branch.context, after);
    if (!proposed.ok) return proposed;
    if (proposed.value === undefined) return { ok: true, value: undefined };
    const participant = proposed.value;

    if (participant.category !== 'npc-behavior') {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: `Participant ${participant.agent.$} is a ${participant.category} policy and cannot be simulated as an actor.`,
      };
    }

    // Every derived participant is proven independently: its own read scope and
    // its own validated behavior binding, never the root participant's.
    const scope = this.deps.readGateway.openReadScope(participant.agent);
    if (!scope.ok) return scope;
    const behavior = this.deps.behaviorGateway.resolveValidatedBinding(participant.behaviorBinding);
    if (!behavior.ok) return behavior;
    if (behavior.value.category !== participant.category || behavior.value.policy.$ !== participant.policy.$) {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: `Validated behavior for ${participant.agent.$} does not match its declared policy and category.`,
      };
    }

    const request: NPCActionRequest = {
      category: 'npc-behavior',
      mode: 'act',
      agent: participant.agent,
      controlledEntity: participant.controlledEntity,
      policy: participant.policy,
      behaviorBinding: participant.behaviorBinding,
      tier: this.root.request.tier,
      budget: this.root.request.budget,
      correlationId: this.root.request.correlationId,
    };
    return { ok: true, value: { request, scope: scope.value, behavior: behavior.value } };
  }

  /**
   * Deterministic shadow draw. It reads the reserved AI stream's declared seed
   * and counter but never advances a stream, so identical public state and an
   * identical tie set always select the same index on replay.
   */
  selectTie(actions: readonly LegalAction[], context: SearchDecisionContext): AIResult<number> {
    if (actions.length === 0) {
      return { ok: false, code: 'AI_NO_LEGAL_ACTION', detail: 'Tie selection requires at least one action.' };
    }
    const stream = this.deps.getState().world.rng[this.shadowStream];
    const token = fingerprint('ai-tie', {
      stream: this.shadowStream,
      seed: stream?.seed ?? 0,
      counter: stream?.counter ?? 0,
      agent: context.request.agent.$,
      actor: context.request.controlledEntity.$,
      correlationId: context.request.correlationId,
      actions: actions.map((action) => action.action),
    });
    // Reduce the full digest modulo the tie count without precision loss.
    const digits = token.slice(token.lastIndexOf(':') + 1);
    let draw = 0;
    for (const character of digits) {
      const nibble = Number.parseInt(character, 16);
      if (!Number.isFinite(nibble)) {
        return { ok: false, code: 'AI_SIMULATION_FAILED', detail: 'Shadow tie draw produced a non-finite digit.' };
      }
      draw = (draw * 16 + nibble) % actions.length;
    }
    return { ok: true, value: draw };
  }

  remainingBudget(): Readonly<AIBudget> {
    return this.ledger.remaining();
  }

  /** Releases any branch still open after an aborted search. */
  closeAll(): void {
    for (const [name, branch] of this.branches) {
      branch.handle.restore();
      branch.handle.close();
      this.branches.delete(name);
    }
  }

  private fallbackOutcome(
    context: SearchDecisionContext,
    candidate: LegalAction | undefined,
    code: Parameters<typeof createAIDiagnostic>[1]['code'],
    reason: string,
    upstreamContract: string,
  ): EvaluationOutcome {
    return {
      score: 0,
      status: 'neutral-fallback',
      diagnostic: createAIDiagnostic(context.request, {
        code,
        severity: 'warn',
        phase: 'plan',
        reason,
        upstreamContract,
        hint: 'Restore the bounded read or budget contract before relying on this branch score.',
        ...(candidate === undefined ? {} : { candidateAction: { $: candidate.action } }),
      }),
    };
  }
}

export class KernelSearchSessionGateway implements SearchSessionGateway {
  constructor(private readonly deps: KernelSearchSessionDeps) {}

  open(root: SearchDecisionContext): AIResult<SearchSession> {
    if (asNPCActionRequest(root) === null) {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: 'A bounded search session root must be an NPC behavior action request.',
      };
    }
    try {
      return { ok: true, value: new KernelSearchSession(root, this.deps) };
    } catch (error) {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: `Invalid search budget: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
