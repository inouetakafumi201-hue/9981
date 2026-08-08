/**
 * Kernel-bound AI read adapter.
 *
 * Every reference the AI can observe passes the play-supplied `visibleTo`
 * predicate through the real QueryEngine, and every remembered fact comes from
 * the requesting agent's own Knowledge scope. Version tokens are deterministic
 * fingerprints of exactly the data the AI is allowed to read, so replay of the
 * same public state yields the same freshness decisions.
 */
import type { QueryMode } from '../../actions/catalog.js';
import type { LegalAction } from '../../actions/types.js';
import { ExprEngine, makeDefaultEvalContext, type EvalContext } from '../../expr/engine.js';
import type { QueryEngine } from '../../expr/query-engine.js';
import { makeExprStateAccess } from '../../expr/state-access.js';
import { WorldKnowledgeStore } from '../../knowledge/knowledge-store.js';
import type { DefRegistry } from '../../state/def.js';
import type { Expr, Query, QueryFrom } from '../../state/expr-types.js';
import type { Ref } from '../../state/ids.js';
import type { Value } from '../../state/value.js';
import type { WorldState } from '../../state/world-state.js';
import type { AIReadAdapter, AIReadVersions, ReadAuthority } from '../read-gateway.js';
import type { AIResult, BeliefSlice, KnownFact } from '../types.js';
import { fingerprint, resolveRefDefId, resolveRefProps, resolveRefValuePath, resolveStatePath } from './state-read.js';

/** Minimal legal-action source; the real ActionCatalog satisfies it structurally. */
export interface LegalActionSource {
  queryActions(actor: Ref, mode: QueryMode): LegalAction[];
}

export interface KernelAIReadDeps {
  getState: () => WorldState;
  queryEngine: QueryEngine;
  actionCatalog: LegalActionSource;
  /**
   * Visibility predicate owned by the play/base layer. It is evaluated with
   * `self` bound to the candidate reference and `vars.agent` bound to the
   * requesting agent. A missing predicate is a contract gap, not a default.
   */
  visibleTo: Expr;
  /** Collections enumerated for the belief slice. */
  sources?: readonly QueryFrom[];
  exprEngine?: ExprEngine;
  knowledge?: WorldKnowledgeStore;
  defRegistry?: DefRegistry;
}

const DEFAULT_SOURCES: readonly QueryFrom[] = ['entities', 'items', 'nodes', 'links'];

interface ReadProjection {
  readonly visibleRefs: readonly Ref[];
  readonly visibleIds: ReadonlySet<string>;
  readonly slice: BeliefSlice;
  readonly versions: AIReadVersions;
}

export class KernelAIReadAdapter implements AIReadAdapter {
  private readonly exprEngine: ExprEngine;
  private readonly knowledge: WorldKnowledgeStore;
  private readonly sources: readonly QueryFrom[];
  /** WorldState is immutable, so a per-state cache is safe and keeps versions stable. */
  private readonly cache = new WeakMap<WorldState, Map<string, ReadProjection>>();

  constructor(private readonly deps: KernelAIReadDeps) {
    this.exprEngine = deps.exprEngine ?? new ExprEngine();
    this.knowledge = deps.knowledge ?? new WorldKnowledgeStore();
    this.sources = deps.sources ?? DEFAULT_SOURCES;
  }

  readAuthority(agent: Ref): AIResult<ReadAuthority> {
    const state = this.deps.getState();
    const record = state.world.agents[agent.$];
    if (record === undefined) {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `AI agent ${agent.$} is not registered in world.agents.` };
    }
    if (record.kind === 'observer') {
      return { ok: false, code: 'AI_POLICY_BINDING_INVALID', detail: `Agent ${agent.$} is an observer and cannot drive AI decisions.` };
    }
    return {
      ok: true,
      value: {
        agent: { $: record.id },
        controlledEntities: Object.freeze(record.controls.map((ref) => Object.freeze({ $: ref.$ }))),
        omniscient: record.omniscient === true,
      },
    };
  }

  buildBeliefSlice(authority: ReadAuthority): AIResult<BeliefSlice> {
    const projection = this.project(authority);
    if (!projection.ok) return projection;
    return { ok: true, value: projection.value.slice };
  }

  queryVisible(authority: ReadAuthority, query: Query): AIResult<readonly Ref[]> {
    const projection = this.project(authority);
    if (!projection.ok) return projection;
    const state = this.deps.getState();
    let refs: Ref[];
    try {
      refs = this.deps.queryEngine.run(state, query, this.runDeps(state, authority));
    } catch (error) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `Query execution failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    // The caller's query may omit visibleTo; intersecting with the agent's own
    // visible set makes a leak impossible regardless of the supplied query.
    const permitted = authority.omniscient ? refs : refs.filter((ref) => projection.value.visibleIds.has(ref.$));
    return { ok: true, value: Object.freeze(permitted.map((ref) => Object.freeze({ $: ref.$ }))) };
  }

  queryActions(authority: ReadAuthority, actor: Ref): AIResult<readonly LegalAction[]> {
    if (!authority.controlledEntities.some((entity) => entity.$ === actor.$)) {
      return { ok: false, code: 'AI_CANDIDATE_ILLEGAL', detail: `Actor ${actor.$} is not controlled by agent ${authority.agent.$}.` };
    }
    try {
      return { ok: true, value: Object.freeze([...this.deps.actionCatalog.queryActions(actor, 'ai')]) };
    } catch (error) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `queryActions failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  versions(authority: ReadAuthority): AIResult<AIReadVersions> {
    const projection = this.project(authority);
    if (!projection.ok) return projection;
    return { ok: true, value: projection.value.versions };
  }

  isCurrent(authority: ReadAuthority, versions: AIReadVersions): boolean {
    const projection = this.project(authority);
    if (!projection.ok) return false;
    return projection.value.versions.knowledge === versions.knowledge
      && projection.value.versions.actions === versions.actions;
  }

  private project(authority: ReadAuthority): AIResult<ReadProjection> {
    const state = this.deps.getState();
    const key = authority.agent.$;
    const perState = this.cache.get(state) ?? new Map<string, ReadProjection>();
    const cached = perState.get(key);
    if (cached !== undefined) return { ok: true, value: cached };

    let visibleRefs: Ref[];
    try {
      visibleRefs = this.collectVisibleRefs(state, authority);
    } catch (error) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `Visibility query failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const visibleIds = new Set(visibleRefs.map((ref) => ref.$));

    const visibleFacts: Record<string, Value> = {};
    for (const ref of visibleRefs) {
      const props = resolveRefProps(state, ref);
      if (props === null) continue;
      for (const [name, value] of Object.entries(props)) {
        visibleFacts[`${ref.$}.${name}`] = value;
      }
    }

    const observedAt = state.world.turn.phaseEnteredAt;
    const knownFacts: Record<string, KnownFact> = {};
    // `seen` is a live observation record; `facts` is retained knowledge that
    // may already be out of date. Neither is allowed to invent a subject.
    for (const [name, value] of Object.entries(this.knowledge.getSeen(state, authority.agent.$))) {
      knownFacts[name] = { value, observedAt, certainty: 'observed' };
    }
    for (const [name, value] of Object.entries(this.knowledge.getFacts(state, authority.agent.$))) {
      if (knownFacts[name] !== undefined) continue;
      knownFacts[name] = { value, observedAt, certainty: value === null ? 'uncertain' : 'historical' };
    }

    const slice: BeliefSlice = Object.freeze({
      agent: Object.freeze({ $: authority.agent.$ }),
      visibleFacts: Object.freeze(visibleFacts),
      knownFacts: Object.freeze(knownFacts),
      visibleRefs: Object.freeze(visibleRefs.map((ref) => Object.freeze({ $: ref.$ }))),
      policyContext: Object.freeze(this.policyContext(state, authority)),
    });

    const actionSets: Record<string, unknown> = {};
    for (const entity of authority.controlledEntities) {
      try {
        actionSets[entity.$] = this.deps.actionCatalog.queryActions(entity, 'ai');
      } catch (error) {
        return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `queryActions failed for ${entity.$}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    const projection: ReadProjection = {
      visibleRefs: slice.visibleRefs,
      visibleIds,
      slice,
      versions: {
        knowledge: fingerprint('knowledge', {
          facts: this.knowledge.getFacts(state, authority.agent.$),
          seen: this.knowledge.getSeen(state, authority.agent.$),
          visible: [...visibleIds].sort(),
          visibleFacts,
        }),
        actions: fingerprint('actions', actionSets),
      },
    };
    perState.set(key, projection);
    this.cache.set(state, perState);
    return { ok: true, value: projection };
  }

  private collectVisibleRefs(state: WorldState, authority: ReadAuthority): Ref[] {
    const seen = new Set<string>();
    const refs: Ref[] = [];
    for (const from of this.sources) {
      const query: Query = authority.omniscient ? { from } : { from, visibleTo: this.deps.visibleTo };
      for (const ref of this.deps.queryEngine.run(state, query, this.runDeps(state, authority))) {
        if (seen.has(ref.$)) continue;
        seen.add(ref.$);
        refs.push(ref);
      }
    }
    return refs;
  }

  /** Public, declarative policy definition data; never private agent state. */
  private policyContext(state: WorldState, authority: ReadAuthority): Record<string, Value> {
    const agent = state.world.agents[authority.agent.$];
    const policyId = agent?.policy;
    if (policyId === undefined) return {};
    // The bound policy identity is public even when its definition is not
    // reachable from this registry; losing it would hide why a decision ran.
    const context: Record<string, Value> = { 'policy.id': policyId };
    const def = this.deps.defRegistry?.resolve(policyId) ?? state.defs[policyId] ?? null;
    if (def === null) return context;
    const mode = (def as { mode?: unknown }).mode;
    if (typeof mode === 'string') context['policy.mode'] = mode;
    for (const [name, value] of Object.entries(def.props ?? {})) {
      context[`policy.props.${name}`] = value;
    }
    return context;
  }

  private runDeps(state: WorldState, authority: ReadAuthority): Parameters<QueryEngine['run']>[2] {
    return {
      exprEngine: this.exprEngine,
      baseCtx: this.evalContext(state, authority),
      ctxForSelf: (ref: Ref) => this.evalContext(state, authority, ref),
    };
  }

  private evalContext(state: WorldState, authority: ReadAuthority, self?: Ref): EvalContext {
    const overrides: Partial<EvalContext> = {
      // `self` is also exposed as a var so a play-supplied visibleTo predicate
      // can compare the candidate reference without dynamic path construction.
      vars: self === undefined
        ? { agent: { $: authority.agent.$ } }
        : { agent: { $: authority.agent.$ }, self: { $: self.$ } },
      resolvePath: (path) => resolveStatePath(state, path),
      resolveRefDefId: (ref) => resolveRefDefId(state, ref),
      resolveRefValue: (ref, path) => resolveRefValuePath(state, ref, path),
      stateAccess: makeExprStateAccess(() => state, this.deps.defRegistry),
      runQuery: (query, ctx) => this.deps.queryEngine.run(state, query, {
        exprEngine: this.exprEngine,
        baseCtx: ctx,
        ctxForSelf: (ref) => this.evalContext(state, authority, ref),
      }),
      runQueryValues: (query, ctx) => this.deps.queryEngine.runValues(state, query, {
        exprEngine: this.exprEngine,
        baseCtx: ctx,
        ctxForSelf: (ref) => this.evalContext(state, authority, ref),
      }),
    };
    if (self !== undefined) overrides.self = self;
    if (this.deps.defRegistry !== undefined) overrides.defRegistry = this.deps.defRegistry;
    return makeDefaultEvalContext(overrides);
  }
}
