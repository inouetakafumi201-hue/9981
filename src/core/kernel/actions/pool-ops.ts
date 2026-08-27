/**
 * Generic resource-pool operations used by declarative playpacks.
 * Pool semantics are data-driven by PoolDef; this module does not know AP, stamina, or any game rule.
 */
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import { getPath, setPath } from '../ops/path';
import type { OpContext, OpImpl, OpRegistry } from '../ops/registry';
import type { Result } from '../ops/result';
import { err, ok } from '../ops/result';
import type { Id, Ref } from '../state/ids';
import type { PoolDef } from '../schedule/playpack';

export type PoolResetTrigger = 'phase' | 'turn';

export interface PoolInitializeArgs {
  names?: string[];
}

export interface PoolSetArgs {
  pool: string;
  scope: Id | Ref;
  value: number;
}

export interface PoolAddArgs {
  pool: string;
  scope: Id | Ref;
  delta: number;
}

export interface PoolGetArgs {
  pool: string;
  scope: Id | Ref;
  view?: 'real' | 'available';
}

export interface PoolResetArgs {
  trigger: PoolResetTrigger;
}

export interface PoolAddResult {
  value: number;
  overflowed: boolean;
}

export interface PoolOpsDeps {
  poolDefs: () => readonly PoolDef[];
  exprEngine?: ExprEngine;
}

interface PoolBounds {
  min: number;
  max?: number;
}

function scopeIdOf(scope: Id | Ref): Id {
  return typeof scope === 'string' ? scope : scope.$;
}

function poolPath(pool: string, scopeId: Id, field: 'min' | 'max' | 'real' | 'available'): string {
  return `world.props.pools.${pool}.${scopeId}.${field}`;
}

function findPool(deps: PoolOpsDeps, name: string): Result<PoolDef> {
  const matches = deps.poolDefs().filter((pool) => pool.name === name);
  if (matches.length === 0) return err('E_REF_MISSING', `PoolDef ${name} 不存在`);
  if (matches.length > 1) return err('E_LOAD_CONFLICT', `PoolDef ${name} 重复声明`);
  return ok(matches[0] as PoolDef);
}

function evalNumber(
  expression: PoolDef['min'] | PoolDef['max'] | PoolDef['initial'] | PoolDef['resetTo'],
  fallback: number | undefined,
  scopeId: Id,
  ctx: OpContext,
  exprEngine: ExprEngine,
): Result<number | undefined> {
  if (expression === undefined) return ok(fallback);
  const evaluated = exprEngine.eval(expression, makeDefaultEvalContext({
    self: { $: scopeId },
    vars: { scope: { $: scopeId }, scopeId },
    resolvePath: (path) => getPath(ctx.tx.getDraft(), path),
  }));
  if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) {
    return err('E_OP_INVALID_ARGS', `Pool 表达式对 ${scopeId} 的求值结果不是有限数`);
  }
  return ok(evaluated);
}

function boundsFor(pool: PoolDef, scopeId: Id, ctx: OpContext, exprEngine: ExprEngine): Result<PoolBounds> {
  const minimum = evalNumber(pool.min, 0, scopeId, ctx, exprEngine);
  if (!minimum.ok) return minimum;
  const maximum = evalNumber(pool.max, undefined, scopeId, ctx, exprEngine);
  if (!maximum.ok) return maximum;
  if (maximum.value !== undefined && maximum.value < (minimum.value ?? 0)) {
    return err('E_OP_INVALID_ARGS', `Pool ${pool.name} 的 max 小于 min`);
  }
  return ok({ min: minimum.value ?? 0, max: maximum.value });
}

function clamp(value: number, bounds: PoolBounds): number {
  const upper = bounds.max === undefined ? value : Math.min(value, bounds.max);
  return Math.max(bounds.min, upper);
}

function scopeIds(pool: PoolDef, ctx: OpContext): Id[] {
  const state = ctx.tx.getDraft();
  if (pool.per === 'world') return ['w:0'];
  if (pool.per === 'actor') return Object.keys(state.world.agents).sort();
  const factions = new Set<Id>();
  for (const agent of Object.values(state.world.agents)) {
    const factionId = agent.props['factionId'];
    if (typeof factionId === 'string') factions.add(factionId);
  }
  return [...factions].sort();
}

function writePool(
  pool: PoolDef,
  scopeId: Id,
  value: number,
  bounds: PoolBounds,
  ctx: OpContext,
): void {
  let draft = ctx.tx.getDraft();
  draft = setPath(draft, poolPath(pool.name, scopeId, 'min'), bounds.min);
  if (bounds.max !== undefined) draft = setPath(draft, poolPath(pool.name, scopeId, 'max'), bounds.max);
  draft = setPath(draft, poolPath(pool.name, scopeId, 'real'), value);
  draft = setPath(draft, poolPath(pool.name, scopeId, 'available'), value);
  ctx.tx.setDraft(draft);
}

function makePoolInitialize(deps: PoolOpsDeps, exprEngine: ExprEngine): OpImpl<PoolInitializeArgs, void> {
  return (args, ctx) => {
    const selected = args.names ? new Set(args.names) : null;
    const pools = deps.poolDefs().filter((pool) => !selected || selected.has(pool.name));
    if (selected) {
      for (const name of selected) {
        if (!pools.some((pool) => pool.name === name)) return err('E_REF_MISSING', `PoolDef ${name} 不存在`);
      }
    }
    const seen = new Set<string>();
    for (const pool of pools) {
      if (seen.has(pool.name)) return err('E_LOAD_CONFLICT', `PoolDef ${pool.name} 重复声明`);
      seen.add(pool.name);
      for (const scopeId of scopeIds(pool, ctx)) {
        const existing = getPath(ctx.tx.getDraft(), poolPath(pool.name, scopeId, 'real'));
        if (typeof existing === 'number') continue;
        const bounds = boundsFor(pool, scopeId, ctx, exprEngine);
        if (!bounds.ok) return bounds;
        const initial = evalNumber(pool.initial, bounds.value.min, scopeId, ctx, exprEngine);
        if (!initial.ok) return initial;
        writePool(pool, scopeId, clamp(initial.value ?? bounds.value.min, bounds.value), bounds.value, ctx);
      }
    }
    ctx.tx.logOp('pool.initialize', args, () => {});
    return ok(undefined);
  };
}

function makePoolSet(deps: PoolOpsDeps, exprEngine: ExprEngine): OpImpl<PoolSetArgs, number> {
  return (args, ctx) => {
    if (!Number.isFinite(args.value)) return err('E_OP_INVALID_ARGS', 'pool.set.value 必须是有限数');
    const poolResult = findPool(deps, args.pool);
    if (!poolResult.ok) return poolResult;
    const scopeId = scopeIdOf(args.scope);
    const bounds = boundsFor(poolResult.value, scopeId, ctx, exprEngine);
    if (!bounds.ok) return bounds;
    const value = clamp(args.value, bounds.value);
    writePool(poolResult.value, scopeId, value, bounds.value, ctx);
    ctx.tx.logOp('pool.set', args, () => {});
    return ok(value);
  };
}

function makePoolAdd(deps: PoolOpsDeps, exprEngine: ExprEngine): OpImpl<PoolAddArgs, PoolAddResult> {
  return (args, ctx) => {
    if (!Number.isFinite(args.delta)) return err('E_OP_INVALID_ARGS', 'pool.add.delta 必须是有限数');
    const poolResult = findPool(deps, args.pool);
    if (!poolResult.ok) return poolResult;
    const scopeId = scopeIdOf(args.scope);
    const bounds = boundsFor(poolResult.value, scopeId, ctx, exprEngine);
    if (!bounds.ok) return bounds;
    const realPath = poolPath(args.pool, scopeId, 'real');
    const availablePath = poolPath(args.pool, scopeId, 'available');
    const currentReal = getPath(ctx.tx.getDraft(), realPath);
    const currentAvailable = getPath(ctx.tx.getDraft(), availablePath);
    if (typeof currentReal !== 'number' || typeof currentAvailable !== 'number') {
      return err('E_REF_MISSING', `Pool ${args.pool}/${scopeId} 尚未初始化`);
    }
    const attempted = currentReal + args.delta;
    const nextReal = clamp(attempted, bounds.value);
    const appliedDelta = nextReal - currentReal;
    const nextAvailable = clamp(currentAvailable + appliedDelta, bounds.value);
    let draft = setPath(ctx.tx.getDraft(), realPath, nextReal);
    draft = setPath(draft, availablePath, nextAvailable);
    ctx.tx.setDraft(draft);
    const overflowed = bounds.value.max !== undefined && attempted > bounds.value.max;
    if (overflowed) {
      ctx.emit('pool.overflow', {
        pool: args.pool,
        scope: { $: scopeId },
        attempted,
        value: nextReal,
        overflow: attempted - (bounds.value.max as number),
      });
    }
    ctx.tx.logOp('pool.add', args, () => {});
    return ok({ value: nextReal, overflowed });
  };
}

function makePoolGet(deps: PoolOpsDeps): OpImpl<PoolGetArgs, number> {
  return (args, ctx) => {
    const poolResult = findPool(deps, args.pool);
    if (!poolResult.ok) return poolResult;
    const scopeId = scopeIdOf(args.scope);
    const field = args.view ?? 'real';
    const value = getPath(ctx.tx.getDraft(), poolPath(args.pool, scopeId, field));
    if (typeof value !== 'number') return err('E_REF_MISSING', `Pool ${args.pool}/${scopeId} 尚未初始化`);
    return ok(value);
  };
}

function shouldReset(pool: PoolDef, trigger: PoolResetTrigger, scopeId: Id, ctx: OpContext, exprEngine: ExprEngine): boolean {
  if (pool.reset === 'never') return false;
  if (pool.reset === trigger) return true;
  if (typeof pool.reset === 'string') return false;
  return exprEngine.eval(pool.reset, makeDefaultEvalContext({
    self: { $: scopeId },
    vars: { scope: { $: scopeId }, scopeId, trigger },
    resolvePath: (path) => getPath(ctx.tx.getDraft(), path),
  })) === true;
}

function makePoolReset(deps: PoolOpsDeps, exprEngine: ExprEngine): OpImpl<PoolResetArgs, void> {
  return (args, ctx) => {
    if (args.trigger !== 'phase' && args.trigger !== 'turn') {
      return err('E_OP_INVALID_ARGS', `未知 pool reset trigger: ${String(args.trigger)}`);
    }
    const seen = new Set<string>();
    for (const pool of deps.poolDefs()) {
      if (seen.has(pool.name)) return err('E_LOAD_CONFLICT', `PoolDef ${pool.name} 重复声明`);
      seen.add(pool.name);
      for (const scopeId of scopeIds(pool, ctx)) {
        if (!shouldReset(pool, args.trigger, scopeId, ctx, exprEngine)) continue;
        const bounds = boundsFor(pool, scopeId, ctx, exprEngine);
        if (!bounds.ok) return bounds;
        const fallback = evalNumber(pool.initial, bounds.value.min, scopeId, ctx, exprEngine);
        if (!fallback.ok) return fallback;
        const resetValue = evalNumber(pool.resetTo, fallback.value, scopeId, ctx, exprEngine);
        if (!resetValue.ok) return resetValue;
        writePool(pool, scopeId, clamp(resetValue.value ?? bounds.value.min, bounds.value), bounds.value, ctx);
      }
    }
    ctx.tx.logOp('pool.reset', args, () => {});
    return ok(undefined);
  };
}

export function registerPoolOps(registry: OpRegistry, deps: PoolOpsDeps): void {
  const exprEngine = deps.exprEngine ?? new ExprEngine();
  registry.register('pool.initialize', makePoolInitialize(deps, exprEngine));
  registry.register('pool.set', makePoolSet(deps, exprEngine));
  registry.register('pool.get', makePoolGet(deps));
  registry.register('pool.add', makePoolAdd(deps, exprEngine));
  registry.register('pool.reset', makePoolReset(deps, exprEngine));
}
