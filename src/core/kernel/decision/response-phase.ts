/**
 * L7 Response Phase: query interface for "pending intents targeting me"
 * and PhaseDef.kind:'response' placeholder (design.md 3.8节 / 需求28.1-28.4).
 *
 * ResponsePhase is a pure-read query helper — no writes, no Op registration.
 * The actual PhaseDef struct will be expanded in L9 (ScheduleDef phases).
 */
import type { Id } from '../state/ids.js';
import type { IntentState } from '../state/world-state.js';
import type { WorldState } from '../state/world-state.js';

/** PhaseDef placeholder kind for the 'response' phase (expanded in L9 ScheduleDef). */
export type ResponsePhaseDef = {
  readonly kind: 'response';
  readonly label?: string;
  /** Optional: which agent role is expected to respond in this phase. */
  readonly respondent?: Id;
  /** Optional: max seconds allowed for response. */
  readonly timeoutSeconds?: number;
};

/**
 * Query pending intents that target a given agent (i.e., whose agent field matches agentId
 * and whose status is 'pending').
 *
 * Property 10: hidden intents are excluded from the result unless includeHidden is set.
 */
export function queryPendingIntentsFor(
  state: WorldState,
  agentId: Id,
  opts?: { includeHidden?: boolean },
): IntentState[] {
  const result: IntentState[] = [];
  for (const intent of Object.values(state.world.intents)) {
    if (intent.agent !== agentId) continue;
    if (intent.status !== 'pending') continue;
    if (intent.hidden && !opts?.includeHidden) continue;
    result.push(intent);
  }
  return result.sort((a, b) => {
    // Sort by priority descending (higher priority first), then by submittedAt ascending
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.submittedAt - b.submittedAt;
  });
}

/**
 * Query all pending intents in the world (for GM/policy views).
 * Hidden intents are excluded unless includeHidden is set (Property 10).
 */
export function queryAllPendingIntents(
  state: WorldState,
  opts?: { includeHidden?: boolean },
): IntentState[] {
  return Object.values(state.world.intents)
    .filter((i) => i.status === 'pending' && (!i.hidden || opts?.includeHidden))
    .sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.submittedAt - b.submittedAt;
    });
}
