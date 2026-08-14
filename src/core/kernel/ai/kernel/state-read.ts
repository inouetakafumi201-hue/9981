/**
 * Internal read helpers shared by the kernel-bound AI adapters.
 *
 * These helpers live on the kernel side of the AI boundary: they may touch
 * WorldState, but they only ever return filtered, immutable projections. The
 * AI contracts in `../types.js` never receive a WorldState alias.
 */
import { createHash } from 'node:crypto';
import { makeDefaultEvalContext, type EvalContext } from '../../expr/engine.js';
import type { QueryEngine } from '../../expr/query-engine.js';
import { makeExprStateAccess } from '../../expr/state-access.js';
import type { ExprEngine } from '../../expr/engine.js';
import type { DefRegistry } from '../../state/def.js';
import type { Query } from '../../state/expr-types.js';
import type { Ref } from '../../state/ids.js';
import type { Value } from '../../state/value.js';
import type { WorldState } from '../../state/world-state.js';

export type StateQueryEngine = Pick<QueryEngine, 'run' | 'runValues'>;
export type StateExprEngine = ExprEngine;

export interface StateEvalOptions {
  readonly self?: Ref;
  readonly vars?: Record<string, Value>;
  readonly defRegistry?: DefRegistry;
}

/** Walks a dotted read path against a state root, mirroring the Op-layer reader. */
export function resolveStatePath(state: WorldState, path: string): Value | null {
  const parts = path.split('.');
  let cursor: unknown = state;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return (cursor ?? null) as Value | null;
}

/** Returns the `def` id of whatever object a Ref points at, or null. */
export function resolveRefDefId(state: WorldState, ref: Ref): string | null {
  const holder = state.entities[ref.$] ?? state.items[ref.$] ?? state.nodes[ref.$] ?? state.links[ref.$];
  return holder === undefined ? null : holder.def;
}

/** Returns the declarative `props` of whatever object a Ref points at. */
export function resolveRefProps(state: WorldState, ref: Ref): Readonly<Record<string, Value>> | null {
  const holder = state.entities[ref.$] ?? state.items[ref.$] ?? state.nodes[ref.$] ?? state.links[ref.$];
  if (holder === undefined) return null;
  const props: Record<string, Value> = { ...(holder.props ?? {}) };
  // 资源池投影：AP/体力等池不在实体 props 上，而在 world.props.pools.<pool>.<scope>.real。
  // 若该 Ref 是某个 agent 的受控实体，就把它主人的池代数量投影成可观测实体字段（real 为准，
  // available 是当前回合已结算前的暂计，外部读快照一律以 real 记账）。这样设计货币的
  // `ap`/`stamina` 费目就能在真实状态字段上被 KernelAIReadAdapter 看到，而不是只活在测试里。
  if (state.world.agents !== undefined) {
    for (const [, agent] of Object.entries(state.world.agents)) {
      const controlsAll = agent.controls ?? [];
      if (!controlsAll.some((c) => c.$ === ref.$)) continue;
      const pools = state.world.props?.pools as Record<string, unknown> | undefined;
      if (!pools) break;
      for (const [poolName, byScope] of Object.entries(pools)) {
        // 池结构是 world.props.pools.<pool>.<scope>.real。找到宿主 agent 自己的范围内那个
        // 数值场再投影成 `pool.<name>` 字段（real 为准；available 是本回合结算前的暂计，
        // 外部读快照一律以 real 记账）。
        // byScope 的类型是 { [scope]: Value }；其下再往下取 `.real` 需要的两重类型收缩都要
        // 通过 unknown 中转（Value 与 { real: Value } 索引签名不重叠，直接断言会被 tsc 拒绝）。
        const detached = byScope as unknown;
        const scoped = detached as Record<string, unknown> | undefined;
        const mine = scoped?.[agent.id];
        const real = mine !== undefined && typeof mine === 'object' && mine !== null
          ? (mine as Record<string, unknown>)['real']
          : undefined;
        if (typeof real === 'number') {
          props[`pool.${poolName}`] = real;
        }
      }
      break; // 找到宿主即停止；一个实体通常只被一个 agent 持有
    }
  }
  return Object.freeze(props);
}

/**
 * Reads a dotted path relative to the object a Ref points at. This backs the
 * built-in `refGet` operator, which is the kernel's idiom for per-reference
 * reads inside a Query predicate or ordering expression.
 */
export function resolveRefValuePath(state: WorldState, ref: Ref, path: string): Value | null {
  const holder = state.entities[ref.$] ?? state.items[ref.$] ?? state.nodes[ref.$] ?? state.links[ref.$];
  if (holder === undefined) return null;
  let cursor: unknown = holder;
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return (cursor ?? null) as Value | null;
}

/**
 * Deterministic canonical serialization with sorted keys.
 *
 * Version tokens must be reproducible across replays, so they cannot depend on
 * key insertion order or on wall-clock values.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value !== 'object') return 'null';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

/**
 * SHA-256 over the canonical form. A cryptographic digest is used rather than a
 * short checksum so a version token can never collide in practice: a collision
 * would make changed readable information look unchanged.
 */
export function fingerprint(prefix: string, value: unknown): string {
  return `${prefix}:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
}

/**
 * Builds an evaluation context bound to one immutable state snapshot.
 *
 * Shared by the kernel-side AI adapters so every Expr and Query they run reads
 * the same way the Op layer does, with no ambient or wall-clock inputs.
 */
export function makeStateEvalContext(
  state: WorldState,
  queryEngine: StateQueryEngine,
  exprEngine: StateExprEngine,
  options: StateEvalOptions = {},
): EvalContext {
  const overrides: Partial<EvalContext> = {
    resolvePath: (path) => resolveStatePath(state, path),
    resolveRefDefId: (ref) => resolveRefDefId(state, ref),
    resolveRefValue: (ref, path) => resolveRefValuePath(state, ref, path),
    stateAccess: makeExprStateAccess(() => state, options.defRegistry),
    runQuery: (query, ctx) => queryEngine.run(state, query, {
      exprEngine,
      baseCtx: ctx,
      ctxForSelf: (ref) => makeStateEvalContext(state, queryEngine, exprEngine, { ...options, self: ref }),
    }),
    runQueryValues: (query, ctx) => queryEngine.runValues(state, query, {
      exprEngine,
      baseCtx: ctx,
      ctxForSelf: (ref) => makeStateEvalContext(state, queryEngine, exprEngine, { ...options, self: ref }),
    }),
  };
  if (options.self !== undefined) {
    overrides.self = options.self;
    // `self` is also a var so refGet-style predicates can name the candidate.
    overrides.vars = { ...(options.vars ?? {}), self: { $: options.self.$ } };
  } else if (options.vars !== undefined) {
    overrides.vars = options.vars;
  }
  if (options.defRegistry !== undefined) overrides.defRegistry = options.defRegistry;
  return makeDefaultEvalContext(overrides);
}

/** Runs a Query against one state snapshot using {@link makeStateEvalContext}. */
export function runStateQuery(
  state: WorldState,
  queryEngine: StateQueryEngine,
  exprEngine: StateExprEngine,
  query: Query,
  options: StateEvalOptions = {},
): Ref[] {
  return queryEngine.run(state, query, {
    exprEngine,
    baseCtx: makeStateEvalContext(state, queryEngine, exprEngine, options),
    ctxForSelf: (ref) => makeStateEvalContext(state, queryEngine, exprEngine, { ...options, self: ref }),
  });
}
