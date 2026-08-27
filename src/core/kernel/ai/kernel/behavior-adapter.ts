/**
 * Def-backed AI behavior validation.
 *
 * The base-class layer owns the family schema: which parameters exist, where
 * they live, who owns each value, and which of them are player-visible. This
 * adapter validates a concrete binding definition against that supplied schema
 * and produces a `ValidatedAIBehaviorBinding`. It never invents a parameter, a
 * state machine, a patrol route or a threshold.
 */
import type { DefRegistry } from '../../state/def';
import type { Def } from '../../state/def';
import type { Id, Ref } from '../../state/ids';
import type { Value } from '../../state/value';
import type { AIPolicyCategory, AIResult, ValidatedAIBehaviorBinding, ValidatedAIParameter } from '../types';
import { resolveStatePath } from './state-read';

export interface AIBehaviorParameterSchema {
  /** Read path inside the binding definition, e.g. `props.alertLevel`. */
  readonly path: string;
  readonly schema: Ref;
  readonly owner: ValidatedAIParameter['owner'];
  readonly playerVisible: boolean;
  readonly internalMetric: boolean;
  readonly required: boolean;
}

export interface AIBehaviorFamilySchema {
  readonly family: Ref;
  readonly category: AIPolicyCategory;
  readonly parameters: readonly AIBehaviorParameterSchema[];
  /**
   * Paths that a reusable base-layer definition must not fill in, such as a
   * concrete patrol route or a play-specific state machine. Present values here
   * produce `AI_PLAY_CONFIGURATION_REQUIRED` naming the owning layer.
   */
  readonly playOwnedPaths?: readonly string[];
  /** Optional path holding the coarse-tier relevant action id list. */
  readonly relevantActionsPath?: string;
  /** Optional path holding the declared fallback state name. */
  readonly fallbackStatePath?: string;
}

export interface DefBackedBehaviorDeps {
  defRegistry: Pick<DefRegistry, 'resolve' | 'getRaw'>;
  /** Family schema per binding definition id, supplied by the base-class layer. */
  familyOf: (binding: Ref) => AIBehaviorFamilySchema | null;
}

function readPath(def: Def, path: string): Value | null {
  // Reuse the shared dotted reader so binding lookups behave like state reads.
  return resolveStatePath(def as unknown as never, path);
}

function asActionIds(value: Value | null): readonly Id[] | null {
  if (!Array.isArray(value)) return null;
  const ids: Id[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) {
      ids.push(entry);
      continue;
    }
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const ref = (entry as { $?: unknown }).$;
      if (typeof ref === 'string' && ref.length > 0) {
        ids.push(ref);
        continue;
      }
    }
    return null;
  }
  return ids;
}

/**
 * Produces validated bindings for `ValidatedBehaviorGateway`, which then applies
 * the cross-boundary checks (provenance conflicts and the player-visible 1-5
 * gameplay range).
 */
export class DefBackedBehaviorValidator {
  constructor(private readonly deps: DefBackedBehaviorDeps) {}

  resolve(binding: Ref): AIResult<ValidatedAIBehaviorBinding> {
    const family = this.deps.familyOf(binding);
    if (family === null) {
      return {
        ok: false,
        code: 'AI_CONTRACT_UNAVAILABLE',
        detail: `No base-class AI behavior family schema is registered for binding ${binding.$}.`,
      };
    }
    const def = this.deps.defRegistry.resolve(binding.$);
    if (def === null) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `Behavior binding definition ${binding.$} does not exist.` };
    }
    if (def.kind !== 'policy') {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `Behavior binding ${binding.$} must be a policy definition, found ${def.kind}.` };
    }

    if (def.abstract === true) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `Behavior binding ${binding.$} is abstract and cannot drive a decision.` };
    }

    // Requirement 9.4: a reusable (abstract) ancestor must not fix play-owned
    // values such as a concrete patrol route or perception threshold. A concrete
    // play binding is free to supply them.
    const hardcoded = this.findReusableHardcoding(binding.$, family.playOwnedPaths ?? []);
    if (hardcoded !== null) {
      return {
        ok: false,
        code: 'AI_PLAY_CONFIGURATION_REQUIRED',
        detail: `Reusable behavior definition ${hardcoded.ancestor} fixes ${hardcoded.path}; that value belongs to the play layer.`,
      };
    }

    const parameters: ValidatedAIParameter[] = [];
    for (const schema of family.parameters) {
      const value = readPath(def, schema.path);
      if (value === null) {
        if (schema.required) {
          return {
            ok: false,
            code: 'AI_PLAY_CONFIGURATION_REQUIRED',
            detail: `Required behavior parameter ${schema.path} is missing from ${binding.$}; the play layer owns this value.`,
          };
        }
        continue;
      }
      parameters.push({
        path: schema.path,
        value,
        schema: schema.schema,
        owner: schema.owner,
        playerVisible: schema.playerVisible,
        internalMetric: schema.internalMetric,
      });
    }

    const policyId = typeof def['policy'] === 'string' ? (def['policy'] as Id) : def.id;
    const result: {
      family: Ref; policy: Ref; category: AIPolicyCategory;
      parameters: readonly ValidatedAIParameter[];
      relevantActionIds?: readonly Ref[];
      fallbackState?: string;
    } = {
      family: family.family,
      policy: { $: policyId },
      category: family.category,
      parameters,
    };

    if (family.relevantActionsPath !== undefined) {
      const raw = readPath(def, family.relevantActionsPath);
      if (raw !== null) {
        const ids = asActionIds(raw);
        if (ids === null) {
          return {
            ok: false,
            code: 'AI_POLICY_BINDING_INVALID',
            detail: `Path ${family.relevantActionsPath} in ${binding.$} must list action ids or refs.`,
          };
        }
        result.relevantActionIds = ids.map((id) => ({ $: id }));
      }
    }
    if (family.fallbackStatePath !== undefined) {
      const raw = readPath(def, family.fallbackStatePath);
      if (typeof raw === 'string' && raw.length > 0) result.fallbackState = raw;
    }

    return { ok: true, value: result };
  }

  /** Walks the raw inheritance chain looking for play values fixed in a reusable definition. */
  private findReusableHardcoding(
    bindingId: Id,
    playOwnedPaths: readonly string[],
  ): { ancestor: Id; path: string } | null {
    if (playOwnedPaths.length === 0) return null;
    const visited = new Set<Id>();
    const pending: Id[] = [...(this.deps.defRegistry.getRaw(bindingId)?.extends ?? [])];
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const raw = this.deps.defRegistry.getRaw(current);
      if (raw === null) continue;
      if (raw.abstract === true) {
        for (const path of playOwnedPaths) {
          if (readPath(raw, path) !== null) return { ancestor: current, path };
        }
      }
      pending.push(...(raw.extends ?? []));
    }
    return null;
  }
}
