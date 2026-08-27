/**
 * Kernel-bound safe simulation adapter.
 *
 * Exploration runs on the real Op pipeline: hooks, preconditions, cost and
 * invariants all execute exactly as they would for a human action. Isolation
 * comes from `checkpoint` / `restore` over the whole WorldState, which includes
 * `world.rng`, so exploring a branch provably cannot advance a live random
 * stream, mutate real state, or leave a journal-visible commitment behind.
 * Presentation subscribers are silenced for the duration; rule outcomes and
 * failure diagnostics are never silenced.
 */
import type { LegalAction } from '../../actions/types';
import type { WorldStateHolder } from '../../ops/transaction';
import type { CheckpointStore } from '../../persistence/persistence';
import type { Ref } from '../../state/ids';
import type { WorldState } from '../../state/world-state';
import type { CanonicalSubmissionAdapter } from '../commit-gateway';
import type { CanonicalSimulationKernelAdapter, CanonicalSimulationSession } from '../simulation';
import type { AIResult, NPCActionRequest, SimulationOutcome } from '../types';

/** Presentation transport that can withhold delivery while AI explores. */
export interface PresentationSilencer {
  silence(): void;
  resume(): void;
}

export interface KernelSimulationDeps {
  holder: WorldStateHolder;
  checkpoints: CheckpointStore;
  submission: CanonicalSubmissionAdapter;
  presentation?: PresentationSilencer;
  /**
   * Named stream reserved for AI-internal randomness such as tie-breaking. It
   * is deliberately distinct from gameplay streams so an AI draw can never
   * share a counter with a live stream.
   */
  shadowStreamName?: string;
}

export const DEFAULT_AI_SHADOW_STREAM = 'ai:shadow';

let simulationCounter = 0;

function decisionStateFor(before: WorldState, after: WorldState, actor: Ref): SimulationOutcome['decisionState'] {
  for (const [id, decision] of Object.entries(after.world.decisions)) {
    const previous = before.world.decisions[id];
    const involvesActor = decision.askees.some((askee) => askee.$ === actor.$);
    if (!involvesActor) continue;
    if (previous === undefined || previous.status !== decision.status) {
      return decision.status === 'timeout' ? 'void' : decision.status;
    }
  }
  return 'none';
}

function intentStateFor(before: WorldState, after: WorldState, actor: Ref): SimulationOutcome['intentState'] {
  let latest: { submittedAt: number; status: SimulationOutcome['intentState'] } | null = null;
  for (const [id, intent] of Object.entries(after.world.intents)) {
    if (intent.agent !== actor.$) continue;
    const previous = before.world.intents[id];
    if (previous !== undefined && previous.status === intent.status) continue;
    const status: SimulationOutcome['intentState'] = intent.status === 'failed' ? 'void' : intent.status;
    if (latest === null || intent.submittedAt >= latest.submittedAt) {
      latest = { submittedAt: intent.submittedAt, status };
    }
  }
  return latest === null ? 'none' : latest.status;
}

class KernelSimulationSession implements CanonicalSimulationSession {
  constructor(
    private readonly deps: KernelSimulationDeps,
    private readonly checkpointName: string,
    private readonly agent: Ref,
  ) {}

  attemptCanonical(actor: Ref, candidate: LegalAction): AIResult<SimulationOutcome> {
    const before = this.deps.holder.getState();
    const authorized = this.deps.submission.authorize(this.agent, actor, candidate);
    if (!authorized.ok) return authorized;
    const lifecycle = this.deps.submission.validateLifecycle(this.agent, actor, candidate);
    if (!lifecycle.ok) return lifecycle;

    const committed = this.deps.submission.submitCanonical(this.agent, actor, candidate);
    if (!committed.ok) return committed;

    const after = this.deps.holder.getState();
    return {
      ok: true,
      value: {
        checkpoint: this.checkpointName,
        visibleStateChanged: before !== after,
        decisionState: decisionStateFor(before, after, actor),
        intentState: intentStateFor(before, after, actor),
      },
    };
  }

  restoreCanonical(): AIResult<void> {
    const restored = this.deps.checkpoints.restore(this.checkpointName);
    if (restored === null) {
      return { ok: false, code: 'AI_SIMULATION_FAILED', detail: `Simulation checkpoint ${this.checkpointName} is missing; refusing to continue on an unknown state.` };
    }
    this.deps.holder.setState(restored);
    return { ok: true, value: undefined };
  }

  closeCanonical(): AIResult<void> {
    this.deps.checkpoints.remove(this.checkpointName);
    this.deps.presentation?.resume();
    return { ok: true, value: undefined };
  }
}

export class KernelSimulationAdapter implements CanonicalSimulationKernelAdapter {
  readonly shadowStreamName: string;

  constructor(private readonly deps: KernelSimulationDeps) {
    this.shadowStreamName = deps.shadowStreamName ?? DEFAULT_AI_SHADOW_STREAM;
  }

  beginCanonicalSimulation(request: NPCActionRequest): AIResult<CanonicalSimulationSession> {
    const name = `ai-sim:${request.correlationId}:${++simulationCounter}`;
    if (this.deps.checkpoints.restore(name) !== null) {
      return { ok: false, code: 'AI_SIMULATION_FAILED', detail: `Simulation checkpoint ${name} already exists.` };
    }
    this.deps.checkpoints.checkpoint(name, this.deps.holder.getState());
    this.deps.presentation?.silence();
    return { ok: true, value: new KernelSimulationSession(this.deps, name, request.agent) };
  }
}
