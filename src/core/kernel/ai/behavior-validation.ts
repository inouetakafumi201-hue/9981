/**
 * Consumption-side validation for base-class AI behavior bindings.
 *
 * Schema parsing remains owned by the base-class layer. AI only accepts its
 * already-validated projection and checks cross-boundary invariants that must
 * remain true at AI use time.
 */
import type { Ref } from '../state/ids';
import type { AIBehaviorValidationGateway, AIResult, ValidatedAIBehaviorBinding, ValidatedAIParameter } from './types';

export type ValidatedBindingResolver = (binding: Ref) => AIResult<ValidatedAIBehaviorBinding>;

function validateParameter(parameter: ValidatedAIParameter): AIResult<void> {
  if (parameter.playerVisible && parameter.internalMetric) {
    return {
      ok: false,
      code: 'AI_POLICY_BINDING_INVALID',
      detail: `Parameter ${parameter.path} cannot be both player-visible and an internal metric.`,
    };
  }
  if (parameter.playerVisible) {
    if (typeof parameter.value !== 'number' || !Number.isFinite(parameter.value) || parameter.value < 1 || parameter.value > 5) {
      return {
        ok: false,
        code: 'AI_PLAY_CONFIGURATION_REQUIRED',
        detail: `Player-visible parameter ${parameter.path} must be a finite gameplay value in the inclusive range 1-5.`,
      };
    }
  }
  return { ok: true, value: undefined };
}

/**
 * A bridge for a frozen upstream validator. It refuses malformed validation
 * output instead of filling missing provenance with inferred defaults.
 */
export class ValidatedBehaviorGateway implements AIBehaviorValidationGateway {
  constructor(private readonly resolver: ValidatedBindingResolver) {}

  resolveValidatedBinding(binding: Ref): AIResult<ValidatedAIBehaviorBinding> {
    const result = this.resolver(binding);
    if (!result.ok) return result;
    const resolved = result.value;
    if (resolved.family.$.length === 0 || resolved.policy.$.length === 0) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'Validated behavior binding is missing a family or policy reference.' };
    }
    for (const parameter of resolved.parameters) {
      const parameterResult = validateParameter(parameter);
      if (!parameterResult.ok) return parameterResult;
    }
    if (resolved.relevantActionIds !== undefined) {
      const ids = new Set<string>();
      for (const action of resolved.relevantActionIds) {
        if (ids.has(action.$)) {
          return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `Behavior binding repeats relevant action ${action.$}.` };
        }
        ids.add(action.$);
      }
    }
    return {
      ok: true,
      value: Object.freeze({
        ...resolved,
        parameters: Object.freeze(resolved.parameters.map((parameter) => Object.freeze({ ...parameter }))),
        ...(resolved.relevantActionIds === undefined ? {} : { relevantActionIds: Object.freeze(resolved.relevantActionIds.map((action) => Object.freeze({ ...action }))) }),
      }),
    };
  }
}

/** Use until base-class behavior Schema validation exposes a stable result. */
export class UnavailableBehaviorValidationGateway implements AIBehaviorValidationGateway {
  constructor(private readonly detail: string) {}

  resolveValidatedBinding(_binding: Ref): AIResult<ValidatedAIBehaviorBinding> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }
}
