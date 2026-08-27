/**
 * Restricted AI read gateway.
 *
 * The kernel-specific adapter is intentionally supplied by the owner of Query,
 * visibleTo, Knowledge and ActionCatalog. This module never accepts WorldState
 * and therefore cannot retain or expose an unfiltered world alias.
 */
import type { LegalAction } from '../actions/types';
import type { Query } from '../state/expr-types';
import type { Ref } from '../state/ids';
import { isValidValue } from '../state/value';
import type { AIReadGateway, AIReadScope, AIResult, BeliefSlice, KnownFact } from './types';

export interface ReadAuthority {
  readonly agent: Ref;
  readonly controlledEntities: readonly Ref[];
  readonly omniscient: boolean;
}

export interface AIReadVersions {
  readonly knowledge: string;
  readonly actions: string;
}

/**
 * This adapter is owned by kernel integration. Its implementations must source
 * references via Query.visibleTo and facts via the requesting agent's Knowledge
 * scope. It is deliberately read-only and must never return WorldState.
 */
export interface AIReadAdapter {
  readAuthority(agent: Ref): AIResult<ReadAuthority>;
  buildBeliefSlice(authority: ReadAuthority): AIResult<BeliefSlice>;
  queryVisible(authority: ReadAuthority, query: Query): AIResult<readonly Ref[]>;
  queryActions(authority: ReadAuthority, actor: Ref): AIResult<readonly LegalAction[]>;
  versions(authority: ReadAuthority): AIResult<AIReadVersions>;
  isCurrent(authority: ReadAuthority, versions: AIReadVersions): boolean;
}

function adapterFailure(operation: string, error: unknown): AIResult<never> {
  return {
    ok: false,
    code: 'AI_CONTRACT_UNAVAILABLE',
    detail: `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function callAdapter<T>(operation: string, call: () => AIResult<T>): AIResult<T> {
  try {
    return call();
  } catch (error) {
    return adapterFailure(operation, error);
  }
}

/** Clone and recursively freeze JSON-like adapter output so no nested alias can mutate a frozen read scope. */
function cloneAndFreeze<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new Error('adapter output contains a cyclic object graph');
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze(entry, nextAncestors))) as T;
  }
  const clone = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, cloneAndFreeze(entry, nextAncestors)]),
  );
  return Object.freeze(clone) as T;
}

function isRef(value: unknown): value is Ref {
  return value !== null
    && typeof value === 'object'
    && typeof (value as { readonly $?: unknown }).$ === 'string'
    && (value as { readonly $: string }).$.length > 0;
}

function isKnownFact(value: unknown): value is KnownFact {
  if (value === null || typeof value !== 'object') return false;
  const fact = value as Partial<KnownFact>;
  return isValidValue(fact.value)
    && typeof fact.observedAt === 'number'
    && Number.isFinite(fact.observedAt)
    && fact.observedAt >= 0
    && (fact.certainty === 'observed' || fact.certainty === 'historical' || fact.certainty === 'uncertain');
}

function validateBeliefSlice(value: BeliefSlice, agent: Ref): AIResult<void> {
  if (!isRef(value.agent) || value.agent.$ !== agent.$) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'Read adapter returned a BeliefSlice for a different or invalid agent.' };
  }
  if (!Array.isArray(value.visibleRefs) || value.visibleRefs.some((ref) => !isRef(ref))) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'BeliefSlice.visibleRefs must contain only non-empty refs.' };
  }
  const ids = value.visibleRefs.map((ref) => ref.$);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'BeliefSlice.visibleRefs must not contain duplicates.' };
  }
  if (Object.values(value.visibleFacts).some((fact) => !isValidValue(fact))) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'BeliefSlice.visibleFacts contains a non-Value field.' };
  }
  if (Object.values(value.knownFacts).some((fact) => !isKnownFact(fact))) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'BeliefSlice.knownFacts contains invalid provenance metadata.' };
  }
  if (Object.values(value.policyContext).some((field) => !isValidValue(field))) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'BeliefSlice.policyContext contains a non-Value field.' };
  }
  return { ok: true, value: undefined };
}

function validateActions(actions: readonly LegalAction[]): AIResult<void> {
  if (!Array.isArray(actions)) {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'queryActions must return an array.' };
  }
  for (const action of actions) {
    if (action === null
      || typeof action !== 'object'
      || typeof action.action !== 'string'
      || action.action.length === 0
      || action.bindings === null
      || typeof action.bindings !== 'object'
      || Array.isArray(action.bindings)
      || !Array.isArray(action.cost)
      || (action.reason !== undefined && typeof action.reason !== 'string')) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'queryActions returned a malformed LegalAction.' };
    }
    if (Object.values(action.bindings).some((binding) => !isValidValue(binding))) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `Action ${action.action} contains a non-Value binding.` };
    }
  }
  return { ok: true, value: undefined };
}

class RestrictedAIReadScope implements AIReadScope {
  readonly agent: Ref;
  readonly knowledgeVersion: string;
  readonly actionVersion: string;

  constructor(
    private readonly adapter: AIReadAdapter,
    private readonly authority: ReadAuthority,
    versions: AIReadVersions,
  ) {
    this.agent = authority.agent;
    this.knowledgeVersion = versions.knowledge;
    this.actionVersion = versions.actions;
  }

  beliefSlice(): AIResult<BeliefSlice> {
    const result = callAdapter('AIReadAdapter.buildBeliefSlice', () => this.adapter.buildBeliefSlice(this.authority));
    if (!result.ok) return result;
    const validation = validateBeliefSlice(result.value, this.agent);
    if (!validation.ok) return validation;
    try {
      return { ok: true, value: cloneAndFreeze(result.value) };
    } catch (error) {
      return adapterFailure('BeliefSlice isolation', error);
    }
  }

  queryActions(actor: Ref): AIResult<readonly LegalAction[]> {
    if (!this.authority.controlledEntities.some((entity) => entity.$ === actor.$)) {
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Actor ${actor.$} is not controlled by AI agent ${this.agent.$}.` };
    }
    const result = callAdapter('AIReadAdapter.queryActions', () => this.adapter.queryActions(this.authority, actor));
    if (!result.ok) return result;
    const validation = validateActions(result.value);
    if (!validation.ok) return validation;
    try {
      return { ok: true, value: cloneAndFreeze(result.value) };
    } catch (error) {
      return adapterFailure('LegalAction isolation', error);
    }
  }

  query(query: Query): AIResult<readonly Ref[]> {
    if (!this.authority.omniscient && query.visibleTo === undefined) {
      return {
        ok: false,
        code: 'AI_CONTRACT_UNAVAILABLE',
        detail: 'Non-omniscient AI queries must carry the owner-provided visibleTo predicate.',
      };
    }
    const result = callAdapter('AIReadAdapter.queryVisible', () => this.adapter.queryVisible(this.authority, query));
    if (!result.ok) return result;
    if (!Array.isArray(result.value) || result.value.some((ref) => !isRef(ref))) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'queryVisible returned malformed refs.' };
    }
    const ids = result.value.map((ref) => ref.$);
    if (new Set(ids).size !== ids.length) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'queryVisible returned duplicate refs.' };
    }
    try {
      return { ok: true, value: cloneAndFreeze(result.value) };
    } catch (error) {
      return adapterFailure('visible query isolation', error);
    }
  }

  isCurrent(version: { readonly knowledge: string; readonly actions: string }): boolean {
    try {
      return this.adapter.isCurrent(this.authority, version) === true;
    } catch {
      return false;
    }
  }
}

export class RestrictedAIReadGateway implements AIReadGateway {
  constructor(private readonly adapter: AIReadAdapter) {}

  openReadScope(agent: Ref): AIResult<AIReadScope> {
    if (!isRef(agent)) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'AI read scope requires a non-empty agent ref.' };
    }
    const authority = callAdapter('AIReadAdapter.readAuthority', () => this.adapter.readAuthority(agent));
    if (!authority.ok) return authority;
    if (!isRef(authority.value.agent)
      || authority.value.agent.$ !== agent.$
      || !Array.isArray(authority.value.controlledEntities)
      || authority.value.controlledEntities.some((ref) => !isRef(ref))
      || typeof authority.value.omniscient !== 'boolean') {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'Read adapter returned malformed or mismatched authority.' };
    }
    const controlIds = authority.value.controlledEntities.map((ref) => ref.$);
    if (new Set(controlIds).size !== controlIds.length) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'Read authority contains duplicate controlled entities.' };
    }
    const isolatedAuthority = cloneAndFreeze(authority.value);
    const versions = callAdapter('AIReadAdapter.versions', () => this.adapter.versions(isolatedAuthority));
    if (!versions.ok) return versions;
    if (typeof versions.value.knowledge !== 'string'
      || typeof versions.value.actions !== 'string'
      || versions.value.knowledge.length === 0
      || versions.value.actions.length === 0) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'AI read versions must be explicit non-empty tokens.' };
    }
    return {
      ok: true,
      value: new RestrictedAIReadScope(this.adapter, isolatedAuthority, cloneAndFreeze(versions.value)),
    };
  }
}

/** Use when the owning kernel integration has not frozen its safe read contract. */
export class UnavailableAIReadGateway implements AIReadGateway {
  constructor(private readonly detail: string) {}

  openReadScope(_agent: Ref): AIResult<AIReadScope> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }
}
