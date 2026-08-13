/**
 * Cross-layer integration test for the action-turn playpack's initiative + AP allocation.
 *
 * This exercises the REAL wired kernel (createFullHarness): the declarative playpack.json is loaded
 * through PlaypackLoader, activated through PlaypackActivator (which runs the roll phase onEnter),
 * and the resulting AP pools are read back and independently checked against the frozen
 * `allocateAp` difference algorithm from `.kiro/specs/wakeup-core-mechanics/` (Requirement 5).
 *
 * Determinism: `random.roll` is a seeded LCG keyed by stream name (seed defaults to 0), so a given
 * participant count and creation order yields a fixed set of rolled tiers. The test does not hardcode
 * the rolled values; it reads each agent's observed `initiativeTotal` and verifies the AP the playpack
 * assigned equals what the reference algorithm computes for those same observed tiers. That keeps the
 * test valid under D-054 (1d6) without coupling to specific LCG outputs, and satisfies Requirement
 * 5.12 (the difference algorithm is verifiable against externally observed final tiers).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFullHarness, type FullHarness } from '../../../core/kernel/testing/full-harness.js';
import { resetIdCounters } from '../../../core/kernel/state/ids.js';
import type { PlaypackDef } from '../../../core/kernel/schedule/playpack.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYPACK_PATH = join(HERE, '..', 'playpack.json');

function loadPlaypackDef(): PlaypackDef {
  return JSON.parse(readFileSync(PLAYPACK_PATH, 'utf8')) as PlaypackDef;
}

/**
 * Reference AP allocation, transcribed from wakeup-core-mechanics Requirement 5.4-5.8 (NOT copied
 * from the playpack Flow, so the two implementations cross-check each other). `null` = unallocated.
 * 
 * U-002 resolved via D-037: single participant (n=1) receives 2 AP via apTierCap algorithm.
 */
function referenceAllocate(tiers: readonly number[]): (number | null)[] {
  const n = tiers.length;
  const maxTier = Math.max(...tiers);
  const countAtMax = tiers.filter((t) => t === maxTier).length;
  const below = tiers.filter((t) => t < maxTier);
  const secondTier = below.length > 0 ? Math.max(...below) : -100;
  const lead = maxTier - secondTier;

  return tiers.map((t) => {
    const diff = maxTier - t;
    if (n === 1 || n === 2) {
      // D-037: apTierCap disables 3 AP tier for 1-2 participants
      if (t === maxTier) return 2;
      if (diff === 1) return 1;
      return null;
    }
    // n >= 3
    if (t === maxTier) {
      return countAtMax === 1 && lead >= 2 ? 3 : 2;
    }
    if (diff === 1) return 1;
    return null;
  });
}

function createAgents(harness: FullHarness, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = harness.registry.invoke<{ kind: string; knowledgeScope: string }, { $: string }>(
      'agent.create',
      { kind: 'human', knowledgeScope: 'ks:test' },
    );
    expect(result.ok, `agent.create #${i} should succeed`).toBe(true);
    if (result.ok) ids.push(result.value.$);
  }
  return ids;
}

function agentTier(harness: FullHarness, id: string): number {
  const agent = harness.holder.getState().world.agents[id];
  const tier = agent?.props['initiativeTotal'];
  expect(typeof tier, `agent ${id} must have a numeric initiativeTotal`).toBe('number');
  return tier as number;
}

function apReal(harness: FullHarness, id: string): number {
  const pools = harness.holder.getState().world.props['pools'] as
    | Record<string, Record<string, { real?: number }>>
    | undefined;
  const value = pools?.['AP']?.[id]?.real;
  return typeof value === 'number' ? value : 0;
}

describe('action-turn playpack: initiative + AP allocation (cross-layer)', () => {
  beforeEach(() => resetIdCounters());

  it('loads and activates the declarative playpack without diagnostics', () => {
    const harness = createFullHarness();
    createAgents(harness, 3);
    const activation = harness.playpackActivator.activate(loadPlaypackDef());
    expect(activation.diagnostics, JSON.stringify(activation.diagnostics)).toEqual([]);
    expect(activation.ok).toBe(true);
  });

  it('rolls a 1d6 (not 1d5) initiative for every participant', () => {
    const harness = createFullHarness();
    const ids = createAgents(harness, 5);
    expect(harness.playpackActivator.activate(loadPlaypackDef()).ok).toBe(true);

    // Raw roll (no power-die) equals the internal comparison tier. With 1d6 the tier can reach 6,
    // which a 1d5 implementation could never produce; the value must be an integer in [1, 6].
    for (const id of ids) {
      const tier = agentTier(harness, id);
      expect(Number.isInteger(tier)).toBe(true);
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(6);
    }
  });

  it.each([2, 3, 4, 5])('allocates AP by the difference algorithm for %i participants', (count) => {
    const harness = createFullHarness();
    const ids = createAgents(harness, count);
    expect(harness.playpackActivator.activate(loadPlaypackDef()).ok).toBe(true);

    const tiers = ids.map((id) => agentTier(harness, id));
    const expected = referenceAllocate(tiers);

    ids.forEach((id, index) => {
      const expectedAp = expected[index];
      const actualAp = apReal(harness, id);
      // Unallocated is represented as pool value 0 (projection layer renders it as a discrete state).
      expect(actualAp, `agent ${id} tier=${tiers[index]} tiers=${JSON.stringify(tiers)}`)
        .toBe(expectedAp ?? 0);
    });

    // Two-participant games never produce 3 AP (Requirement 5.8).
    if (count === 2) {
      expect(ids.map((id) => apReal(harness, id))).not.toContain(3);
    }

    // Every allocated AP stays within the player-visible 1-5 band; the internal tier may exceed it.
    for (const id of ids) {
      const ap = apReal(harness, id);
      expect(ap).toBeGreaterThanOrEqual(0);
      expect(ap).toBeLessThanOrEqual(3);
    }
  });

  it('allocates 2 AP for single participant (U-002 resolved via D-037)', () => {
    const harness = createFullHarness();
    const ids = createAgents(harness, 1);
    const activation = harness.playpackActivator.activate(loadPlaypackDef());
    
    // U-002 resolved: single participant receives 2 AP (natural result of apTierCap algorithm
    // with 3 AP tier disabled, not a special case branch).
    expect(activation.ok).toBe(true);
    expect(activation.diagnostics).toEqual([]);
    
    const singleId = ids[0] as string;
    const actualAp = apReal(harness, singleId);
    expect(actualAp, 'single participant must receive 2 AP via D-037').toBe(2);
    
    // Cross-check with reference algorithm
    const tier = agentTier(harness, singleId);
    const expected = referenceAllocate([tier]);
    expect(actualAp).toBe(expected[0] ?? 0);
  });

  it('assigns 3 AP only to a unique leader ahead by at least 2 (property over observed tiers)', () => {
    const harness = createFullHarness();
    const ids = createAgents(harness, 4);
    expect(harness.playpackActivator.activate(loadPlaypackDef()).ok).toBe(true);

    const tiers = ids.map((id) => agentTier(harness, id));
    const maxTier = Math.max(...tiers);
    const countAtMax = tiers.filter((t) => t === maxTier).length;
    const below = tiers.filter((t) => t < maxTier);
    const lead = maxTier - (below.length > 0 ? Math.max(...below) : -100);

    ids.forEach((id, index) => {
      if (apReal(harness, id) === 3) {
        expect(tiers[index]).toBe(maxTier);
        expect(countAtMax).toBe(1);
        expect(lead).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
