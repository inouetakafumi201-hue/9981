/**
 * Executable proof for the pure-JSON action-turn playpack.
 *
 * The playpack file is read from disk as text, parsed by the strict JSON codec, decoded into a
 * PlaypackDef, and activated through the real engine composition root. Every gameplay assertion
 * below therefore exercises the generic Intent / Flow / Hook / Schedule / Pool pipeline; no
 * mechanic-specific kernel operation exists for stamina, action turns, parry, or weaknesses.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { StrictJsonCodec } from '../../../core/kernel/spec-compiler/json-codec.js';
import { DEFAULT_TECHNICAL_QUOTAS } from '../../../core/kernel/spec-compiler/types.js';
import { decodePlaypack } from '../../../core/kernel/schedule/playpack-codec.js';
import type { PlaypackDef } from '../../../core/kernel/schedule/playpack.js';
import { createFullHarness, defaultSeedDefs } from '../../../core/kernel/testing/full-harness.js';
import type { FullHarness } from '../../../core/kernel/testing/full-harness.js';
import { resetIdCounters } from '../../../core/kernel/state/ids.js';
import { getPath } from '../../../core/kernel/ops/path.js';
import type { Effect } from '../../../core/kernel/events/effect-types.js';
import type { Value } from '../../../core/kernel/state/value.js';
import type { Ref } from '../../../core/kernel/state/ids.js';
import type { Attachment } from '../../../core/kernel/state/attachment.js';

const PLAYPACK_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'playpack.json');

function loadPlaypackFromDisk(): PlaypackDef {
  const parsed = new StrictJsonCodec().parse({
    sourceId: 'play/action-turn/playpack.json',
    documentUri: 'file:///play/action-turn/playpack.json',
    sourcePackage: 'play.action-turn',
    sourceText: readFileSync(PLAYPACK_PATH, 'utf8'),
    precedence: 100,
    owningLayer: '玩法层',
    normativeStatus: 'normative',
  }, DEFAULT_TECHNICAL_QUOTAS);
  const decoded = decodePlaypack(parsed);
  if (!decoded.ok) {
    throw new Error(`playpack decode failed: ${decoded.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`).join('; ')}`);
  }
  return decoded.value;
}

interface Scenario {
  readonly harness: FullHarness;
  readonly agents: Ref[];
  /** Runs declarative effects inside a real transaction so ctx.emit reaches the rule pipeline. */
  readonly runEffects: (effects: Effect[]) => { ok: boolean; detail?: string };
}

/** Test-only driver: lets a test emit gameplay events exactly like a combat playpack's own ActionDef would. */
const DRIVER_OP = 'test.driver.runEffects';

function startScenario(agentCount = 3): Scenario {
  const harness = createFullHarness(defaultSeedDefs());
  harness.registry.register(DRIVER_OP, (args: { effects: Effect[] }, ctx) =>
    harness.flowInterpreter.run(args.effects, ctx).result, { structural: true });

  const agents: Ref[] = [];
  for (let index = 0; index < agentCount; index++) {
    const created = harness.registry.invoke<unknown, Ref>('agent.create', { kind: 'human', knowledgeScope: 'ks:main' });
    if (!created.ok) throw new Error(`agent.create failed: ${created.detail}`);
    agents.push(created.value);
  }

  const activation = harness.playpackActivator.activate(loadPlaypackFromDisk());
  if (!activation.ok) {
    throw new Error(`activation failed: ${activation.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  }

  return {
    harness,
    agents,
    runEffects: (effects) => {
      const result = harness.registry.invoke(DRIVER_OP, { effects });
      return result.ok ? { ok: true } : { ok: false, detail: result.detail };
    },
  };
}

function pool(scenario: Scenario, name: string, actor: Ref, field: 'real' | 'available' = 'real'): number | null {
  const value = getPath(scenario.harness.holder.getState(), `world.props.pools.${name}.${actor.$}.${field}`);
  return typeof value === 'number' ? value : null;
}

function setPool(scenario: Scenario, name: string, actor: Ref, value: number): void {
  const result = scenario.harness.registry.invoke('pool.set', { pool: name, scope: actor, value });
  if (!result.ok) throw new Error(`pool.set failed: ${result.detail}`);
}

function queue(scenario: Scenario): string[] {
  const value = getPath(scenario.harness.holder.getState(), 'world.props.actionTurn.queue');
  return Array.isArray(value) ? value.map((item) => (item as Ref).$) : [];
}

function listAt(scenario: Scenario, path: string): string[] {
  const value = getPath(scenario.harness.holder.getState(), path);
  return Array.isArray(value) ? value.map((item) => (item as Ref).$) : [];
}

function attachmentsOf(scenario: Scenario, defId: string, target?: Ref): Attachment[] {
  return (Object.values(scenario.harness.holder.getState().world.attachments) as Attachment[])
    .filter((attachment) => attachment.def === defId && (!target || attachment.target.$ === target.$));
}

function submitAndResolve(
  scenario: Scenario,
  action: string,
  agent: Ref,
  options: { hidden?: boolean; bindings?: Record<string, Value> } = {},
): { ok: boolean; detail?: string } {
  const submitted = scenario.harness.registry.invoke<unknown, Ref>('intent.submit', {
    action,
    agent: agent.$,
    bindings: options.bindings ?? {},
    hidden: options.hidden,
  });
  if (!submitted.ok) return { ok: false, detail: submitted.detail };
  const resolved = scenario.harness.registry.invoke('intent.resolve', { id: submitted.value.$ });
  return resolved.ok ? { ok: true } : { ok: false, detail: resolved.detail };
}

function advancePhase(scenario: Scenario): void {
  const result = scenario.harness.registry.invoke('schedule.advance', {});
  if (!result.ok) throw new Error(`schedule.advance failed: ${result.detail}`);
}

function currentPhaseId(scenario: Scenario): string | undefined {
  const state = scenario.harness.holder.getState();
  const schedule = scenario.harness.defRegistry.resolve(state.world.turn.scheduleId);
  const phases = (schedule?.['phases'] ?? []) as { id: string }[];
  return phases[state.world.turn.phaseIndex]?.id;
}

describe('action-turn playpack: pure JSON decoding', () => {
  beforeEach(() => resetIdCounters());

  it('decodes the on-disk playpack without any executable field', () => {
    const playpack = loadPlaypackFromDisk();
    expect(playpack.kind).toBe('playpack');
    expect(playpack.schedule).toBe('schedule:action-turn');
    expect(playpack.linter).toBeUndefined();
    expect((playpack.pools ?? []).map((item) => item.name).sort()).toEqual(['AP', 'SP']);
  });

  it('declares no mechanic-specific kernel operation', () => {
    const harness = createFullHarness(defaultSeedDefs());
    const registered = new Set(harness.registry.listOpNames());
    const forbidden = ['stamina.add', 'actionTurn.advance', 'parry.declare', 'weakness.apply', 'dice.roll'];
    for (const name of forbidden) expect(registered.has(name)).toBe(false);

    const serialized = JSON.stringify(loadPlaypackFromDisk());
    for (const opName of [...serialized.matchAll(/"op":"([^"]+)"/g)].map((match) => match[1] as string)) {
      // Expression operators and Op names share the "op" key; only real Ops contain a dot namespace.
      if (opName.includes('.')) expect(registered.has(opName), `unregistered Op ${opName}`).toBe(true);
    }
  });
});

describe('action-turn playpack: activation', () => {
  beforeEach(() => resetIdCounters());

  it('initializes pools, selects the schedule, and builds the action-turn queue', () => {
    const scenario = startScenario();
    const state = scenario.harness.holder.getState();

    expect(state.world.turn.scheduleId).toBe('schedule:action-turn');
    expect(currentPhaseId(scenario)).toBe('phase:initiative-roll');
    for (const agent of scenario.agents) {
      expect(pool(scenario, 'SP', agent)).toBe(0);
      expect(pool(scenario, 'AP', agent)).not.toBeNull();
    }
    expect(queue(scenario).sort()).toEqual(scenario.agents.map((agent) => agent.$).sort());
  });

  it('orders the queue by action points then by the tie-break roll', () => {
    const scenario = startScenario();
    const state = scenario.harness.holder.getState();
    const ordered = queue(scenario).map((id) => ({
      id,
      total: state.world.agents[id]?.props['initiativeTotal'] as number,
      tie: state.world.agents[id]?.props['initiativeTie'] as number,
    }));

    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      expect(previous.total >= current.total).toBe(true);
      if (previous.total === current.total) expect(previous.tie >= current.tie).toBe(true);
    }
  });

  it('produces identical results for identical named random streams', () => {
    resetIdCounters();
    const first = startScenario();
    resetIdCounters();
    const second = startScenario();
    expect(queue(first)).toEqual(queue(second));
    expect(first.harness.holder.getState().world.rng).toEqual(second.harness.holder.getState().world.rng);
  });

  it('leaves definitions and world state untouched when activation fails', () => {
    const harness = createFullHarness(defaultSeedDefs());
    const before = harness.holder.getState();
    const broken: PlaypackDef = { ...loadPlaypackFromDisk(), schedule: 'schedule:missing' };

    const activation = harness.playpackActivator.activate(broken);

    expect(activation.ok).toBe(false);
    expect(harness.holder.getState()).toBe(before);
    expect(harness.defRegistry.resolve('action:parry')).toBeNull();
    expect(harness.playpackLoader.loadedPlaypacks()).toHaveLength(0);
  });
});

describe('action-turn playpack: stamina window actions', () => {
  beforeEach(() => resetIdCounters());

  it('charges 1 SP for the +1 power die and records an exclusive window choice', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 3);

    expect(submitAndResolve(scenario, 'action:power-die-1', actor).ok).toBe(true);

    expect(pool(scenario, 'SP', actor)).toBe(2);
    expect(attachmentsOf(scenario, 'attachment:power-die', actor)).toHaveLength(1);
    expect(attachmentsOf(scenario, 'attachment:power-die', actor)[0]!.props['bonus']).toBe(1);
  });

  it('charges 2 SP for the +2 power die', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 4);

    expect(submitAndResolve(scenario, 'action:power-die-2', actor).ok).toBe(true);

    expect(pool(scenario, 'SP', actor)).toBe(2);
    expect(attachmentsOf(scenario, 'attachment:power-die', actor)[0]!.props['bonus']).toBe(2);
  });

  it('rejects a power die the actor cannot pay for', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 1);

    const result = submitAndResolve(scenario, 'action:power-die-2', actor);

    expect(result.ok).toBe(false);
    expect(attachmentsOf(scenario, 'attachment:power-die', actor)).toHaveLength(0);
  });

  it('makes the power die and the reversal mutually exclusive within one window', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 3);

    expect(submitAndResolve(scenario, 'action:power-die-1', actor).ok).toBe(true);
    const second = submitAndResolve(scenario, 'action:reverse', actor);

    expect(second.ok).toBe(false);
    expect(attachmentsOf(scenario, 'attachment:reversal-choice', actor)).toHaveLength(0);
  });

  it('charges 1 AP for the regular reversal and 2 SP for the super reversal', () => {
    const scenario = startScenario();
    const reverser = scenario.agents[0]!;
    const superReverser = scenario.agents[1]!;
    setPool(scenario, 'AP', reverser, 3);
    setPool(scenario, 'SP', superReverser, 4);

    expect(submitAndResolve(scenario, 'action:reverse', reverser).ok).toBe(true);
    expect(submitAndResolve(scenario, 'action:super-reverse', superReverser).ok).toBe(true);

    expect(pool(scenario, 'AP', reverser)).toBe(2);
    expect(pool(scenario, 'SP', superReverser)).toBe(2);
    expect(attachmentsOf(scenario, 'attachment:reversal-choice', reverser)[0]!.props['places']).toBe(1);
    expect(attachmentsOf(scenario, 'attachment:reversal-choice', superReverser)[0]!.props['places']).toBe(2);
  });

  it('applies a pending reversal as a rank gain at the next roll phase', () => {
    const scenario = startScenario();
    const last = scenario.agents.find((agent) => agent.$ === queue(scenario)[queue(scenario).length - 1])!;
    setPool(scenario, 'AP', last, 3);
    expect(submitAndResolve(scenario, 'action:reverse', last).ok).toBe(true);

    advancePhase(scenario); // action
    advancePhase(scenario); // cleanup
    advancePhase(scenario); // wraps to the next roll phase

    expect(currentPhaseId(scenario)).toBe('phase:initiative-roll');
    const positionAfter = queue(scenario).indexOf(last.$);
    expect(positionAfter).toBeGreaterThanOrEqual(0);
    expect(positionAfter).toBeLessThan(queue(scenario).length - 1);
    expect(attachmentsOf(scenario, 'attachment:reversal-choice')).toHaveLength(0);
  });
});

describe('action-turn playpack: parry', () => {
  beforeEach(() => resetIdCounters());

  it('requires the parry intent to stay hidden', () => {
    const scenario = startScenario();
    const defender = scenario.agents[1]!;
    setPool(scenario, 'AP', defender, 3);

    const visible = submitAndResolve(scenario, 'action:parry', defender, { hidden: false });
    expect(visible.ok).toBe(false);

    const hidden = submitAndResolve(scenario, 'action:parry', defender, { hidden: true });
    expect(hidden.ok).toBe(true);
    expect(attachmentsOf(scenario, 'attachment:parry-ready', defender)).toHaveLength(1);
  });

  it('blocks the damage, staggers the attacker, and raises the attacker stamina', () => {
    const scenario = startScenario();
    const attacker = scenario.agents[0]!;
    const defender = scenario.agents[1]!;
    setPool(scenario, 'AP', defender, 3);
    setPool(scenario, 'SP', attacker, 1);
    expect(submitAndResolve(scenario, 'action:parry', defender, { hidden: true }).ok).toBe(true);

    scenario.runEffects([{
      op: 'prop.set',
      args: { path: `world.agents.${defender.$}.props.wounds`, value: 0 },
    }]);

    const intercepted = scenario.runEffects([{
      emit: 'combat.nearDamage',
      data: {
        attacker,
        target: defender,
        damagePath: `world.agents.${defender.$}.props.wounds`,
        delta: 3,
      } as unknown as Value,
    }]);
    expect(intercepted.ok).toBe(true);

    const state = scenario.harness.holder.getState();
    expect(state.world.agents[defender.$]?.props['wounds']).toBe(0);
    expect(attachmentsOf(scenario, 'attachment:staggered', attacker)).toHaveLength(1);
    expect(pool(scenario, 'SP', attacker)).toBe(2);
    expect(attachmentsOf(scenario, 'attachment:parry-ready', defender)).toHaveLength(0);
  });

  it('applies damage normally when nobody is prepared to parry', () => {
    const scenario = startScenario();
    const attacker = scenario.agents[0]!;
    const defender = scenario.agents[1]!;
    scenario.runEffects([{
      op: 'prop.set',
      args: { path: `world.agents.${defender.$}.props.wounds`, value: 0 },
    }]);

    const applied = scenario.runEffects([{
      emit: 'combat.nearDamage',
      data: {
        attacker,
        target: defender,
        damagePath: `world.agents.${defender.$}.props.wounds`,
        delta: 2,
      } as unknown as Value,
    }]);

    expect(applied.ok).toBe(true);
    expect(scenario.harness.holder.getState().world.agents[defender.$]?.props['wounds']).toBe(2);
    expect(attachmentsOf(scenario, 'attachment:staggered', attacker)).toHaveLength(0);
  });

  it('prevents a staggered actor from preparing a parry', () => {
    const scenario = startScenario();
    const defender = scenario.agents[1]!;
    setPool(scenario, 'AP', defender, 3);
    const staggered = scenario.harness.registry.invoke('attach.add', {
      def: 'attachment:staggered',
      target: defender,
    });
    expect(staggered.ok).toBe(true);

    const result = submitAndResolve(scenario, 'action:parry', defender, { hidden: true });

    expect(result.ok).toBe(false);
    expect(attachmentsOf(scenario, 'attachment:parry-ready', defender)).toHaveLength(0);
  });
});

describe('action-turn playpack: weakness chain', () => {
  beforeEach(() => resetIdCounters());

  function weaknessEvent(scenario: Scenario, target: Ref, attacker: Ref, damageType: string, weaknessType: string) {
    return scenario.runEffects([{
      emit: 'combat.weaknessHit',
      data: {
        attacker,
        target,
        damageType,
        weaknessType,
        itemId: null,
        dropContainerId: null,
      } as unknown as Value,
    }]);
  }

  it('raises stamina, lowers the rank, and staggers on a matching damage/weakness pair', () => {
    const scenario = startScenario();
    const attacker = scenario.agents[0]!;
    const target = scenario.agents.find((agent) => agent.$ === queue(scenario)[0])!;
    const rankBefore = queue(scenario).indexOf(target.$);

    expect(weaknessEvent(scenario, target, attacker, 'DMG_01', 'WKN_01').ok).toBe(true);

    expect(pool(scenario, 'SP', target)).toBe(1);
    expect(queue(scenario).indexOf(target.$)).toBe(rankBefore + 1);
    expect(attachmentsOf(scenario, 'attachment:staggered', target)).toHaveLength(1);
  });

  it('does nothing when the damage type does not match the exposed weakness', () => {
    const scenario = startScenario();
    const attacker = scenario.agents[0]!;
    const target = scenario.agents[1]!;
    const queueBefore = queue(scenario);

    expect(weaknessEvent(scenario, target, attacker, 'DMG_01', 'WKN_06').ok).toBe(true);

    expect(pool(scenario, 'SP', target)).toBe(0);
    expect(queue(scenario)).toEqual(queueBefore);
    expect(attachmentsOf(scenario, 'attachment:staggered', target)).toHaveLength(0);
  });

  it('covers every documented one-to-one damage-to-weakness pair', () => {
    for (let index = 1; index <= 10; index++) {
      resetIdCounters();
      const scenario = startScenario();
      const attacker = scenario.agents[0]!;
      const target = scenario.agents[1]!;
      const suffix = String(index).padStart(2, '0');

      expect(weaknessEvent(scenario, target, attacker, `DMG_${suffix}`, `WKN_${suffix}`).ok).toBe(true);
      expect(pool(scenario, 'SP', target), `DMG_${suffix} should trigger WKN_${suffix}`).toBe(1);
    }
  });

  it('chains into overload when the weakness gain overflows stamina', () => {
    // The stamina gain happens inside a Flow-executed rule, so the pool.overflow event it raises
    // must reach the rule pipeline from within an already-open transaction. This pins that nesting.
    const scenario = startScenario();
    const attacker = scenario.agents[0]!;
    const target = scenario.agents[1]!;
    setPool(scenario, 'SP', target, 5);

    expect(weaknessEvent(scenario, target, attacker, 'DMG_07', 'WKN_07').ok).toBe(true);

    expect(pool(scenario, 'SP', target)).toBe(5);
    expect(attachmentsOf(scenario, 'attachment:overloaded', target)).toHaveLength(1);
  });

  it('is not blocked by a prepared parry', () => {
    const scenario = startScenario();
    const attacker = scenario.agents[0]!;
    const target = scenario.agents[1]!;
    setPool(scenario, 'AP', target, 3);
    expect(submitAndResolve(scenario, 'action:parry', target, { hidden: true }).ok).toBe(true);

    expect(weaknessEvent(scenario, target, attacker, 'DMG_04', 'WKN_04').ok).toBe(true);

    expect(pool(scenario, 'SP', target)).toBe(1);
    expect(attachmentsOf(scenario, 'attachment:staggered', target)).toHaveLength(1);
  });
});

describe('action-turn playpack: overload', () => {
  beforeEach(() => resetIdCounters());

  it('caps stamina at five, marks the actor overloaded, and queues the skip', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 5);

    const result = scenario.harness.registry.invoke('pool.add', { pool: 'SP', scope: actor, delta: 1 });

    expect(result.ok).toBe(true);
    expect(pool(scenario, 'SP', actor)).toBe(5);
    expect(attachmentsOf(scenario, 'attachment:overloaded', actor)).toHaveLength(1);
    expect(listAt(scenario, 'world.props.actionTurn.skipped')).toContain(actor.$);
  });

  it('does not trigger when stamina merely reaches the cap', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 4);

    expect(scenario.harness.registry.invoke('pool.add', { pool: 'SP', scope: actor, delta: 1 }).ok).toBe(true);

    expect(pool(scenario, 'SP', actor)).toBe(5);
    expect(attachmentsOf(scenario, 'attachment:overloaded', actor)).toHaveLength(0);
  });

  it('stops an overloaded actor from submitting an intent while others still act', () => {
    const scenario = startScenario();
    const overloaded = scenario.agents[0]!;
    const healthy = scenario.agents[1]!;
    setPool(scenario, 'SP', overloaded, 5);
    expect(scenario.harness.registry.invoke('pool.add', { pool: 'SP', scope: overloaded, delta: 1 }).ok).toBe(true);

    // The identical action must succeed for a non-overloaded actor, proving the veto is the overload rule.
    expect(submitAndResolve(scenario, 'action:complete', healthy).ok).toBe(true);
    const blocked = submitAndResolve(scenario, 'action:complete', overloaded);

    expect(blocked.ok).toBe(false);
    expect(listAt(scenario, 'world.props.actionTurn.acted')).toEqual([healthy.$]);
  });

  it('excludes an overloaded actor from the next roll and readmits them afterwards', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'SP', actor, 5);
    expect(scenario.harness.registry.invoke('pool.add', { pool: 'SP', scope: actor, delta: 1 }).ok).toBe(true);

    advancePhase(scenario);
    advancePhase(scenario);
    advancePhase(scenario); // next roll phase
    expect(currentPhaseId(scenario)).toBe('phase:initiative-roll');
    expect(queue(scenario)).not.toContain(actor.$);

    advancePhase(scenario);
    advancePhase(scenario);
    advancePhase(scenario); // the roll phase after that
    expect(attachmentsOf(scenario, 'attachment:overloaded', actor)).toHaveLength(0);
    expect(queue(scenario)).toContain(actor.$);
  });
});

describe('action-turn playpack: cleanup phase', () => {
  beforeEach(() => resetIdCounters());

  it('recovers one stamina per actor without exceeding the cap', () => {
    const scenario = startScenario();
    const low = scenario.agents[0]!;
    const full = scenario.agents[1]!;
    setPool(scenario, 'SP', low, 2);
    setPool(scenario, 'SP', full, 5);

    advancePhase(scenario); // action
    advancePhase(scenario); // cleanup

    expect(currentPhaseId(scenario)).toBe('phase:cleanup');
    expect(pool(scenario, 'SP', low)).toBe(3);
    expect(pool(scenario, 'SP', full)).toBe(5);
    expect(attachmentsOf(scenario, 'attachment:overloaded', full)).toHaveLength(0);
  });

  it('clears round-scoped preparation and stagger states', () => {
    const scenario = startScenario();
    const defender = scenario.agents[1]!;
    setPool(scenario, 'AP', defender, 3);
    expect(submitAndResolve(scenario, 'action:parry', defender, { hidden: true }).ok).toBe(true);
    expect(scenario.harness.registry.invoke('attach.add', {
      def: 'attachment:staggered', target: scenario.agents[0]!,
    }).ok).toBe(true);

    advancePhase(scenario);
    advancePhase(scenario);

    expect(attachmentsOf(scenario, 'attachment:parry-ready')).toHaveLength(0);
    expect(attachmentsOf(scenario, 'attachment:staggered')).toHaveLength(0);
  });

  it('resets action points at the turn boundary', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;
    setPool(scenario, 'AP', actor, 5);

    advancePhase(scenario);
    advancePhase(scenario);
    advancePhase(scenario); // wraps: AP resets, then the roll phase assigns fresh values

    const assigned = pool(scenario, 'AP', actor);
    expect(assigned).not.toBeNull();
    expect(assigned!).toBeLessThanOrEqual(5);
    expect(assigned!).toBeGreaterThanOrEqual(0);
  });
});

describe('action-turn playpack: execution rank gain', () => {
  beforeEach(() => resetIdCounters());

  it('moves the successful executor one rank forward', () => {
    const scenario = startScenario();
    const lastId = queue(scenario)[queue(scenario).length - 1]!;
    const executor = scenario.agents.find((agent) => agent.$ === lastId)!;
    const positionBefore = queue(scenario).indexOf(executor.$);

    const result = scenario.runEffects([{
      emit: 'execution.success',
      data: { actor: executor } as unknown as Value,
    }]);

    expect(result.ok).toBe(true);
    expect(queue(scenario).indexOf(executor.$)).toBe(positionBefore - 1);
  });

  it('records a completed actor exactly once', () => {
    const scenario = startScenario();
    const actor = scenario.agents[0]!;

    expect(submitAndResolve(scenario, 'action:complete', actor).ok).toBe(true);
    expect(listAt(scenario, 'world.props.actionTurn.acted')).toEqual([actor.$]);

    const second = submitAndResolve(scenario, 'action:complete', actor);
    expect(second.ok).toBe(false);
    expect(listAt(scenario, 'world.props.actionTurn.acted')).toEqual([actor.$]);
  });
});
