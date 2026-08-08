/**
 * L11 KnowledgeStore: pure-read getFacts/knows (design.md 3.12节 / 需求34.1-34.5).
 * Write goes through prop.set (existing path ops). visibleTo wired in QueryEngine.
 */
import type { WorldState } from '../state/world-state.js';
import type { Id } from '../state/ids.js';
import type { Value } from '../state/value.js';

function cloneAndFreezeValue(value: Value): Value {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreezeValue)) as Value[];
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneAndFreezeValue(child)]),
  )) as { [key: string]: Value };
}

function cloneAndFreezeFacts(facts: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.freeze(Object.fromEntries(
    Object.entries(facts).map(([key, value]) => [key, cloneAndFreezeValue(value)]),
  ));
}

export interface KnowledgeStore {
  /**
   * Get all facts known by an agent (their public knowledge).
   * Returns the facts record or empty object if agent has no knowledge entry.
   */
  getFacts(state: WorldState, agentId: Id): Record<string, Value>;

  /**
   * Check whether an agent "knows" a specific fact key.
   * Returns the value if known, null if not.
   */
  knows(state: WorldState, agentId: Id, factKey: string): Value | null;
}

export class WorldKnowledgeStore implements KnowledgeStore {
  getFacts(state: WorldState, agentId: Id): Record<string, Value> {
    return cloneAndFreezeFacts(state.world.knowledge[agentId]?.facts ?? {});
  }

  knows(state: WorldState, agentId: Id, factKey: string): Value | null {
    const entry = state.world.knowledge[agentId];
    if (!entry) return null;
    const value = entry.facts[factKey];
    return value !== undefined ? cloneAndFreezeValue(value) : null;
  }

  /**
   * Get the "seen" record of an agent — things they've observed but may not fully know.
   */
  getSeen(state: WorldState, agentId: Id): Record<string, Value> {
    return cloneAndFreezeFacts(state.world.knowledge[agentId]?.seen ?? {});
  }
}

/**
 * Default singleton instance.
 */
export const knowledgeStore = new WorldKnowledgeStore();
