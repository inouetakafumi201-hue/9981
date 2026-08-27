/** Declarative, validated UGC references for bounded AI behavior. */
import type { Ref } from '../state/ids';
import type {
  AIBehaviorValidationGateway,
  AIPolicyCategory,
  AIResult,
  PlannerRegistry,
  ValidatedAIBehaviorBinding,
} from './types';

export const AI_UGC_SCHEMA_VERSION = 'wakeup.ai.binding/v1';

/**
 * Raw UGC can name registered objects only. It cannot provide executable code,
 * an Op name, a world reference, a visibility override, or an omniscience flag.
 */
export interface DeclarativeAIUGCReference {
  readonly schemaVersion: typeof AI_UGC_SCHEMA_VERSION;
  readonly category: AIPolicyCategory;
  readonly policy: Ref;
  readonly behaviorBinding: Ref;
}

export interface ValidatedAIUGCReference {
  readonly declaration: DeclarativeAIUGCReference;
  readonly behavior: ValidatedAIBehaviorBinding;
}

const DECLARATION_KEYS = new Set(['schemaVersion', 'category', 'policy', 'behaviorBinding']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRef(value: unknown, field: string): AIResult<Ref> {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.$ !== 'string' || value.$.trim().length === 0) {
    return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `UGC field ${field} must be an exact non-empty Ref object.` };
  }
  return { ok: true, value: Object.freeze({ $: value.$ }) };
}

/**
 * Validates untrusted declaration data before it becomes an AI request input.
 * The base-class behavior validator retains ownership of Schema and play
 * configuration validation; the policy registry confirms registration only.
 */
export class DeclarativeAIUGCValidator {
  constructor(
    private readonly behaviorGateway: AIBehaviorValidationGateway,
    private readonly planners: PlannerRegistry,
  ) {}

  validate(input: unknown): AIResult<ValidatedAIUGCReference> {
    if (!isRecord(input)) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'AI UGC must be a declarative object.' };
    }
    for (const key of Object.keys(input)) {
      if (!DECLARATION_KEYS.has(key)) {
        return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `AI UGC field ${key} is not permitted in a declarative AI reference.` };
      }
    }
    if (input.schemaVersion !== AI_UGC_SCHEMA_VERSION) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'AI UGC schemaVersion is missing or unsupported.' };
    }
    if (input.category !== 'player-assistance' && input.category !== 'npc-behavior') {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'AI UGC category must be player-assistance or npc-behavior.' };
    }
    const policy = parseRef(input.policy, 'policy');
    if (!policy.ok) return policy;
    const behaviorBinding = parseRef(input.behaviorBinding, 'behaviorBinding');
    if (!behaviorBinding.ok) return behaviorBinding;

    const behavior = this.behaviorGateway.resolveValidatedBinding(behaviorBinding.value);
    if (!behavior.ok) return behavior;
    if (behavior.value.category !== input.category || behavior.value.policy.$ !== policy.value.$) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: 'AI UGC declaration does not match the validated behavior category and policy.' };
    }
    const planner = this.planners.resolve(policy.value, input.category);
    if (!planner.ok) return planner;

    return {
      ok: true,
      value: Object.freeze({
        declaration: Object.freeze({
          schemaVersion: AI_UGC_SCHEMA_VERSION,
          category: input.category,
          policy: policy.value,
          behaviorBinding: behaviorBinding.value,
        }),
        behavior: behavior.value,
      }),
    };
  }
}
