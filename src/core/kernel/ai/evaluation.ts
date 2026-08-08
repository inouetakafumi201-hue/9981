/** Finite-only evaluation guard and explicit neutral fallback handling. */
import { createAIDiagnostic } from './diagnostics.js';
import type { EvaluationContext, EvaluationGuard, EvaluationOutcome } from './types.js';

function describeInvalidValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * No coercion is performed: strings, booleans, arrays and records are not
 * scores. This prevents language-level conversion from changing a decision.
 */
export class FiniteEvaluationGuard implements EvaluationGuard {
  normalize(raw: unknown, fallback: number, context: EvaluationContext): EvaluationOutcome {
    if (!Number.isFinite(fallback)) {
      return {
        score: 0,
        status: 'neutral-fallback',
        diagnostic: createAIDiagnostic(context.request, {
          code: 'AI_EVALUATION_INVALID',
          severity: 'error',
          phase: 'plan',
          reason: 'The policy declared a non-finite neutral evaluation fallback.',
          upstreamContract: 'EvaluationGateway.neutralFallback',
          hint: 'Provide an explicit finite internal neutral fallback before planning.',
          ...(context.candidate === undefined ? {} : { candidateAction: { $: context.candidate.action } }),
        }),
      };
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return { score: raw, status: 'evaluated' };
    }
    return {
      score: fallback,
      status: 'neutral-fallback',
      diagnostic: createAIDiagnostic(context.request, {
        code: 'AI_EVALUATION_INVALID',
        severity: 'warn',
        phase: 'plan',
        reason: `Evaluation returned an invalid internal score (${describeInvalidValue(raw)}).`,
        upstreamContract: 'EvaluationGateway.evaluate',
        hint: 'Return a finite number or correct the policy evaluation adapter.',
        ...(context.candidate === undefined ? {} : { candidateAction: { $: context.candidate.action } }),
      }),
    };
  }
}
