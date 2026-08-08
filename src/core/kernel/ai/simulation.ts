/**
 * Safe simulation wrapper.
 *
 * The owner adapter must combine checkpoint/restore, shadow RNG, presentation
 * silence, and the canonical Action -> Decision/Intent -> Op transaction path.
 * This module manages lifecycle ordering but has no state or random access.
 */
import type { LegalAction } from '../actions/types.js';
import type { Ref } from '../state/ids.js';
import type {
  AIResult,
  NPCActionRequest,
  SimulationAdapter,
  SimulationHandle,
  SimulationOutcome,
} from './types.js';

export interface CanonicalSimulationSession {
  attemptCanonical(actor: Ref, candidate: LegalAction): AIResult<SimulationOutcome>;
  restoreCanonical(): AIResult<void>;
  closeCanonical(): AIResult<void>;
}

export interface CanonicalSimulationKernelAdapter {
  beginCanonicalSimulation(request: NPCActionRequest): AIResult<CanonicalSimulationSession>;
}

class ManagedSimulationHandle implements SimulationHandle {
  private restored = false;
  private closed = false;

  constructor(private readonly session: CanonicalSimulationSession) {}

  attempt(actor: Ref, candidate: LegalAction): AIResult<SimulationOutcome> {
    if (this.closed) {
      return { ok: false, code: 'AI_SIMULATION_FAILED', detail: 'Cannot attempt a candidate after its simulation handle is closed.' };
    }
    try {
      const outcome = this.session.attemptCanonical(actor, candidate);
      if (!outcome.ok) {
        const restore = this.restore();
        if (!restore.ok) return restore;
      }
      return outcome;
    } catch (error) {
      const restore = this.restore();
      if (!restore.ok) return restore;
      return {
        ok: false,
        code: 'AI_SIMULATION_FAILED',
        detail: `Canonical simulation threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  restore(): AIResult<void> {
    if (this.closed) {
      return { ok: false, code: 'AI_SIMULATION_FAILED', detail: 'Cannot restore a closed simulation handle.' };
    }
    if (this.restored) return { ok: true, value: undefined };
    try {
      const restored = this.session.restoreCanonical();
      if (restored.ok) this.restored = true;
      return restored;
    } catch (error) {
      return {
        ok: false,
        code: 'AI_SIMULATION_FAILED',
        detail: `Canonical simulation restore threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  close(): AIResult<void> {
    if (this.closed) return { ok: true, value: undefined };
    const restored = this.restore();
    if (!restored.ok) return restored;
    try {
      const closed = this.session.closeCanonical();
      if (closed.ok) this.closed = true;
      return closed;
    } catch (error) {
      return {
        ok: false,
        code: 'AI_SIMULATION_FAILED',
        detail: `Canonical simulation close threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export class CanonicalSimulationAdapter implements SimulationAdapter {
  constructor(private readonly adapter: CanonicalSimulationKernelAdapter) {}

  begin(request: NPCActionRequest): AIResult<SimulationHandle> {
    try {
      const started = this.adapter.beginCanonicalSimulation(request);
      if (!started.ok) return started;
      return { ok: true, value: new ManagedSimulationHandle(started.value) };
    } catch (error) {
      return {
        ok: false,
        code: 'AI_SIMULATION_FAILED',
        detail: `Canonical simulation initialization threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/** Used until the owning kernel freezes the unified simulation scope. */
export class UnavailableSimulationAdapter implements SimulationAdapter {
  constructor(private readonly detail: string) {}

  begin(_request: NPCActionRequest): AIResult<SimulationHandle> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }
}
