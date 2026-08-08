/**
 * Schedule-backed participant ordering for bounded sequential search.
 *
 * Turn order belongs to the schedule layer, so this resolver reads the active
 * ScheduleDef's current phase: `phase.actors` supplies the participant set and
 * `order`/`initiativeExpr` supply the sequence. The AI never invents an order,
 * a round length or an initiative rule.
 *
 * A non-AI actor legitimately ends the lookahead: a human choice cannot be
 * predicted by a policy. An AI actor without a validated behavior binding is a
 * contract gap and fails closed instead of being modelled with guesses.
 */
import { ExprEngine } from '../../expr/engine.js';
import type { QueryEngine } from '../../expr/query-engine.js';
import type { ScheduleDef } from '../../schedule/types.js';
import type { Def } from '../../state/def.js';
import type { Id, Ref } from '../../state/ids.js';
import type { WorldState } from '../../state/world-state.js';
import type { AIResult } from '../types.js';
import type { NextParticipant, NextParticipantResolver } from './search-session.js';
import { makeStateEvalContext, runStateQuery } from './state-read.js';

export interface SchedulePhaseParticipantDeps {
  getState: () => WorldState;
  queryEngine: QueryEngine;
  defLookup: (id: Id) => Def | null;
  /**
   * Canonical Op channel used to advance the phase inside a simulated branch
   * when the current phase is exhausted. Advancing runs the schedule's own
   * boundary effects, pool resets and invariants, and is rolled back with the
   * branch like any other exploratory write.
   */
  opRegistry: { invoke<A, T>(name: string, args: A): { ok: boolean; value?: T; code?: string; detail?: string } };
  /**
   * Validated behavior binding for an AI agent. Ownership stays with the
   * composition root; a missing binding is reported, never invented.
   */
  behaviorBindingFor: (agentId: Id) => Ref | null;
  exprEngine?: ExprEngine;
}

export class SchedulePhaseParticipants {
  private readonly exprEngine: ExprEngine;

  constructor(private readonly deps: SchedulePhaseParticipantDeps) {
    this.exprEngine = deps.exprEngine ?? new ExprEngine();
  }

  /** Matches {@link NextParticipantResolver}. */
  resolve: NextParticipantResolver = (previous) => {
    const state = this.deps.getState();
    const turn = state.world.turn;
    const schedule = this.deps.defLookup(turn.scheduleId);
    if (schedule === null || schedule.kind !== 'schedule') {
      return {
        ok: false,
        code: 'AI_CONTRACT_UNAVAILABLE',
        detail: `Active schedule ${turn.scheduleId} is not a registered schedule definition, so participant order is unknown.`,
      };
    }
    const phases = (schedule as ScheduleDef).phases;
    if (phases.length === 0) return { ok: true, value: undefined };
    const phase = phases[Math.min(turn.phaseIndex, phases.length - 1)]!;
    if (phase.actors === undefined) {
      // A phase that declares no actor set has no further participant to model.
      return { ok: true, value: undefined };
    }

    let actors: Ref[];
    try {
      actors = runStateQuery(state, this.deps.queryEngine, this.exprEngine, phase.actors);
    } catch (error) {
      return {
        ok: false,
        code: 'AI_CONTRACT_UNAVAILABLE',
        detail: `Phase ${phase.id} actor query failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const ordered = this.applyOrder(state, schedule as ScheduleDef, actors);
    if (!ordered.ok) return ordered;

    const currentIndex = ordered.value.findIndex((actor) => actor.$ === previous.request.controlledEntity.$);
    let nextActor: Ref;
    if (currentIndex >= 0 && currentIndex + 1 < ordered.value.length) {
      nextActor = ordered.value[currentIndex + 1]!;
    } else {
      // The phase is exhausted: advance through the canonical schedule Op and
      // continue with the first actor of the next non-empty phase.
      const advanced = this.advanceToNextActor(phases.length);
      if (!advanced.ok) return advanced;
      if (advanced.value === undefined) return { ok: true, value: undefined };
      nextActor = advanced.value;
    }

    const controller = Object.values(state.world.agents)
      .find((agent) => agent.controls.some((ref) => ref.$ === nextActor.$));
    if (controller === undefined || controller.kind !== 'ai') return { ok: true, value: undefined };

    if (controller.policy === undefined) {
      return {
        ok: false,
        code: 'AI_POLICY_BINDING_INVALID',
        detail: `AI agent ${controller.id} controls ${nextActor.$} but declares no policy.`,
      };
    }
    const behaviorBinding = this.deps.behaviorBindingFor(controller.id);
    if (behaviorBinding === null) {
      return {
        ok: false,
        code: 'AI_CONTRACT_UNAVAILABLE',
        detail: `No validated behavior binding is registered for AI agent ${controller.id}; refusing to model it with defaults.`,
      };
    }

    const participant: NextParticipant = {
      agent: { $: controller.id },
      controlledEntity: { $: nextActor.$ },
      policy: { $: controller.policy },
      behaviorBinding,
      category: 'npc-behavior',
    };
    return { ok: true, value: participant };
  };

  /**
   * Advances the phase through `schedule.advance` until a phase with at least
   * one actor is entered. Bounded by the phase count so a schedule whose phases
   * are all empty terminates instead of looping forever.
   */
  private advanceToNextActor(phaseCount: number): AIResult<Ref | undefined> {
    for (let attempt = 0; attempt < phaseCount; attempt++) {
      const before = this.deps.getState().world.turn;
      const advanced = this.deps.opRegistry.invoke('schedule.advance', {});
      if (!advanced.ok) {
        return {
          ok: false,
          code: 'AI_TRANSACTION_FAILED',
          detail: `schedule.advance rejected during lookahead: ${advanced.code ?? ''} ${advanced.detail ?? ''}`.trim(),
        };
      }
      const state = this.deps.getState();
      if (state.world.turn.phaseIndex === before.phaseIndex) {
        // A non-looping schedule parked on its last phase: nothing follows.
        return { ok: true, value: undefined };
      }
      const schedule = this.deps.defLookup(state.world.turn.scheduleId);
      if (schedule === null || schedule.kind !== 'schedule') {
        return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'Active schedule vanished while advancing the phase.' };
      }
      const phases = (schedule as ScheduleDef).phases;
      const phase = phases[Math.min(state.world.turn.phaseIndex, phases.length - 1)];
      if (phase?.actors === undefined) continue;
      let actors: Ref[];
      try {
        actors = runStateQuery(state, this.deps.queryEngine, this.exprEngine, phase.actors);
      } catch (error) {
        return {
          ok: false,
          code: 'AI_CONTRACT_UNAVAILABLE',
          detail: `Phase ${phase.id} actor query failed after advancing: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (actors.length === 0) continue;
      const ordered = this.applyOrder(state, schedule as ScheduleDef, actors);
      if (!ordered.ok) return ordered;
      const first = ordered.value[0];
      if (first !== undefined) return { ok: true, value: first };
    }
    return { ok: true, value: undefined };
  }

  private applyOrder(state: WorldState, schedule: ScheduleDef, actors: readonly Ref[]): AIResult<Ref[]> {
    if (schedule.order !== 'initiative') {
      // 'fixed' (or unspecified) keeps the actor query's own deterministic order.
      return { ok: true, value: [...actors] };
    }
    const initiative = schedule.initiativeExpr;
    if (initiative === undefined) {
      return {
        ok: false,
        code: 'AI_CONTRACT_UNAVAILABLE',
        detail: `Schedule ${schedule.id} declares initiative order without an initiativeExpr.`,
      };
    }
    const scored: Array<{ actor: Ref; score: number }> = [];
    for (const actor of actors) {
      let raw: unknown;
      try {
        raw = this.exprEngine.eval(
          initiative,
          makeStateEvalContext(state, this.deps.queryEngine, this.exprEngine, { self: actor }),
        );
      } catch (error) {
        return {
          ok: false,
          code: 'AI_CONTRACT_UNAVAILABLE',
          detail: `Initiative evaluation failed for ${actor.$}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return {
          ok: false,
          code: 'AI_EVALUATION_INVALID',
          detail: `Initiative for ${actor.$} is not a finite number, so participant order is undecidable.`,
        };
      }
      scored.push({ actor, score: raw });
    }
    // Higher initiative first; ties fall back to id order for replay determinism.
    scored.sort((left, right) => right.score - left.score || left.actor.$.localeCompare(right.actor.$));
    return { ok: true, value: scored.map((entry) => entry.actor) };
  }
}
