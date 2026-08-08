/**
 * Safe, read-only projection of AI results for UI and external presentation.
 *
 * Nothing is published unless the play layer declares it publishable. The AI
 * enforces the declaration rather than deciding disclosure itself: bindings are
 * filtered key by key, any published reference must be visible in the viewing
 * belief slice, and diagnostics are reduced to their public form.
 */
import { toPublicDiagnostic } from './diagnostics.js';
import type { CostSpec } from '../actions/types.js';
import type { Ref } from '../state/ids.js';
import type { AIDecisionResult, AIExplanationNode, AIExplanationProjection, BeliefSlice } from './types.js';

/**
 * Play-declared disclosure policy. Omitting it publishes the action identifier
 * and generic reasons only, which is the safe default rather than a placeholder.
 */
export interface AIExplanationPolicy {
  /** Binding keys the play layer has cleared for display. */
  readonly publishableBindingKeys?: readonly string[];
  /** Whether the action's declared cost may be shown. */
  readonly publishCost?: boolean;
  /** Play-authored reason text per node kind, replacing the generic summary. */
  readonly summaries?: Readonly<Partial<Record<AIExplanationNode['kind'], string>>>;
}

const GENERIC_SUMMARIES: Readonly<Record<AIExplanationNode['kind'], string>> = Object.freeze({
  'legal-action': 'The recommendation is currently a legal action.',
  'policy-rule': 'A policy rule contributed to this recommendation.',
  tier: 'The configured planning tier was applied.',
  evaluation: 'The policy evaluated the decision using permitted information.',
  revalidation: 'The candidate was checked against current legality before presentation.',
});

function isVisibleRef(value: unknown, visibleIds: ReadonlySet<string>): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every((item) => isVisibleRef(item, visibleIds));
  const candidate = value as { $?: unknown };
  if (typeof candidate.$ === 'string') return visibleIds.has(candidate.$);
  return Object.values(value as Record<string, unknown>).every((item) => isVisibleRef(item, visibleIds));
}

function publishableBindings(
  bindings: Readonly<Record<string, unknown>>,
  policy: AIExplanationPolicy | undefined,
  visibleIds: ReadonlySet<string>,
): Record<string, unknown> {
  const allowed = policy?.publishableBindingKeys ?? [];
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(bindings, key)) continue;
    const value = bindings[key];
    // A declared key still cannot leak a reference the viewer cannot see.
    if (!isVisibleRef(value, visibleIds)) continue;
    result[key] = value;
  }
  return result;
}

export function projectAIExplanation(
  result: AIDecisionResult,
  slice: BeliefSlice,
  policy?: AIExplanationPolicy,
): AIExplanationProjection {
  const visibleIds = new Set(slice.visibleRefs.map((ref) => ref.$));
  const reasons = result.candidate?.rationale
    .filter((node) => node.visibleRefs.every((ref) => visibleIds.has(ref.$)))
    .map((node) => Object.freeze({
      kind: node.kind,
      summary: policy?.summaries?.[node.kind] ?? GENERIC_SUMMARIES[node.kind],
      visibleRefs: Object.freeze(node.visibleRefs.map((ref: Ref) => Object.freeze({ ...ref }))),
    })) ?? [];

  const recommendation = result.candidate === undefined
    ? undefined
    : Object.freeze({
      action: result.candidate.legalAction.action,
      bindings: Object.freeze(publishableBindings(result.candidate.legalAction.bindings, policy, visibleIds)),
      cost: policy?.publishCost === true
        ? Object.freeze([...result.candidate.legalAction.cost]) as unknown as CostSpec[]
        : [],
    });

  return Object.freeze({
    status: result.status,
    ...(recommendation === undefined ? {} : { recommendation }),
    reasons: Object.freeze(reasons),
    diagnostics: Object.freeze(result.diagnostics.map(toPublicDiagnostic)),
  });
}
