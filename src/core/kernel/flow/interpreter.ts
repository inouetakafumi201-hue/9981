/**
 * L5 Flow: FlowInterpreter 效果脚本解释器（design.md 3.6节 / 需求22.1-22.6）。
 * 十种 Effect 形态：op/let/if/forEach/while/emit/after/at/try/abort。
 * 不提供函数定义、递归、闭包（需求22.3）；每条 Effect（含每次迭代）计入 step 预算。
 */
import type { Effect } from '../events/effect-types';
import type { Result } from '../ops/result';
import { ok, err } from '../ops/result';
import type { OpContext } from '../ops/registry';
import type { OpRegistry } from '../ops/registry';
import type { Value } from '../state/value';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import type { EvalContext } from '../expr/engine';
import { QueryEngine } from '../expr/query-engine';
import type { Query } from '../state/expr-types';
import type { DefRegistry } from '../state/def';
import type { Ref } from '../state/ids';

export interface FlowRunResult {
  result: Result<void>;
  vars: Record<string, Value>;
}

export interface FlowInterpreterDeps {
  opRegistry: OpRegistry;
  exprEngine?: ExprEngine;
  queryEngine?: QueryEngine;
  defRegistry?: DefRegistry;
  /** emit 的接线点：Flow 里的 {emit:...} 效果需要真正触发事件分发，由更高层注入（避免 L5 反向依赖 L4 的具体分发实现）。 */
  onEmit?: (type: string, payload: Value | null, ctx: OpContext) => void;
  /**
   * after/at 延迟执行的观测回调（可选）。真正的调度落地在 world.deferredEffects：after/at 效果由
   * scheduleDeferred 写入队列，schedule.advance 在相位到达时兑现（见 schedule-ops.ts fireDueDeferred）。
   * 此回调仅供宿主观测/调试排期动作，不承担执行语义，省略它不影响延迟效果被兑现。
   */
  onScheduleDeferred?: (kind: 'after' | 'at', when: Value | null, effects: Effect[]) => void;
}

export class FlowInterpreter {
  private readonly exprEngine: ExprEngine;
  private readonly queryEngine: QueryEngine;

  constructor(private readonly deps: FlowInterpreterDeps) {
    this.exprEngine = deps.exprEngine ?? new ExprEngine();
    this.queryEngine = deps.queryEngine ?? new QueryEngine();
  }

  /** 使用与 Flow 相同的完整上下文求值，供 Hook when 复用 Query/具名表达式/refGet。 */
  evaluate(expr: import('../state/expr-types').Expr, ctx: OpContext, vars: Record<string, Value>): Value | null {
    return this.exprEngine.eval(expr, this.evalCtx(vars, ctx));
  }

  /** 全部十种 Effect 形态的解释执行；step 预算默认 1e4（需求22.4）。 */
  run(effects: Effect[], ctx: OpContext, budget: number = 1e4, initialVars: Record<string, Value> = {}): FlowRunResult {
    const stepCounter = { count: 0 };
    try {
      const { result, vars } = this.runBlock(effects, ctx, { ...initialVars }, stepCounter, budget);
      return { result, vars };
    } catch (e) {
      // 内部故障必须与用户脚本预算错误区分，避免错误修复方向和监控归因失真。
      return { result: err('E_FLOW_INTERNAL', e instanceof Error ? e.message : String(e)), vars: initialVars };
    }
  }

  private runBlock(
    effects: Effect[],
    ctx: OpContext,
    vars: Record<string, Value>,
    stepCounter: { count: number },
    budget: number,
  ): { result: Result<void>; vars: Record<string, Value> } {
    let currentVars = vars;
    for (const effect of effects) {
      stepCounter.count++;
      if (stepCounter.count > budget) {
        return { result: err('E_FLOW_BUDGET', `Flow 执行超出 step 预算 ${budget}`), vars: currentVars };
      }
      const stepResult = this.runOne(effect, ctx, currentVars, stepCounter, budget);
      currentVars = stepResult.vars;
      if (!stepResult.result.ok) {
        return { result: stepResult.result, vars: currentVars };
      }
    }
    return { result: ok(undefined), vars: currentVars };
  }

  private evalCtx(vars: Record<string, Value>, ctx: OpContext, self?: Ref): EvalContext {
    const scopedVars = self && vars['self'] === undefined ? { ...vars, self } : vars;
    return makeDefaultEvalContext({
      self,
      vars: scopedVars,
      resolvePath: (path) => resolveFromDraft(ctx, path, self),
      defRegistry: this.deps.defRegistry,
      resolveRefDefId: (ref) => resolveRefObject(ctx, ref)?.def ?? null,
      resolveRefValue: (ref, path) => {
        const value = resolveRefObject(ctx, ref);
        return value ? resolveAt(value, path) : null;
      },
      resolveNamedExpr: (id) => {
        const def = this.deps.defRegistry?.resolve(id);
        if (!def || def.kind !== 'expr') return null;
        const body = def['body'];
        return body === undefined ? null : {
          params: Array.isArray(def['params']) ? def['params'] as string[] : undefined,
          body: body as import('../state/expr-types').Expr,
        };
      },
      runQuery: (query: Query) => this.queryEngine.run(ctx.tx.getDraft(), query, {
        exprEngine: this.exprEngine,
        baseCtx: this.evalCtx(scopedVars, ctx, self),
        ctxForSelf: (ref) => this.evalCtx(scopedVars, ctx, ref),
      }),
      runQueryValues: (query: Query) => this.queryEngine.runValues(ctx.tx.getDraft(), query, {
        exprEngine: this.exprEngine,
        baseCtx: this.evalCtx(scopedVars, ctx, self),
        ctxForSelf: (ref) => this.evalCtx(scopedVars, ctx, ref),
      }),
    });
  }

  /**
   * 把一个 after/at 效果块排入 world.deferredEffects（写在当前 Op 事务的 draft 上，随事务提交/回滚、
   * 被 snapshot 捕获）。effects 以结构形式存为 Value（Effect 本身是 JSON 形状），vars 快照当前作用域。
   */
  private scheduleDeferred(
    ctx: OpContext,
    kind: 'after' | 'at',
    dueAt: number,
    effects: Effect[],
    vars: Record<string, Value>,
  ): void {
    const draft = ctx.tx.getDraft();
    const seq = draft.world.deferredSeq + 1;
    const entry = { seq, kind, dueAt, effects: effects as unknown as Value, vars: { ...vars } };
    ctx.tx.setDraft({
      ...draft,
      world: {
        ...draft.world,
        deferredEffects: [...draft.world.deferredEffects, entry],
        deferredSeq: seq,
      },
    });
  }

  private runOne(
    effect: Effect,
    ctx: OpContext,
    vars: Record<string, Value>,
    stepCounter: { count: number },
    budget: number,
  ): { result: Result<void>; vars: Record<string, Value> } {
    if ('op' in effect) {
      const evaledArgs: Record<string, Value> = {};
      for (const [k, v] of Object.entries(effect.args)) {
        evaledArgs[k] = this.exprEngine.eval(v, this.evalCtx(vars, ctx)) ?? null;
      }
      const opResult = this.deps.opRegistry.invokeInline(effect.op, evaledArgs, ctx);
      if (!opResult.ok) return { result: opResult, vars };
      const nextVars = effect.result === undefined
        ? vars
        : { ...vars, [effect.result]: (opResult.value ?? null) as Value };
      return { result: ok(undefined), vars: nextVars };
    }

    if ('let' in effect) {
      const value = this.exprEngine.eval(effect.be, this.evalCtx(vars, ctx));
      return { result: ok(undefined), vars: { ...vars, [effect.let]: value ?? null } };
    }

    if ('if' in effect) {
      const cond = this.exprEngine.eval(effect.if, this.evalCtx(vars, ctx));
      const branch = cond === true ? effect.then : (effect.else ?? []);
      return this.runBlock(branch, ctx, vars, stepCounter, budget);
    }

    if ('forEach' in effect) {
      const list = this.exprEngine.eval(effect.forEach, this.evalCtx(vars, ctx));
      if (!Array.isArray(list)) return { result: ok(undefined), vars };
      let currentVars = vars;
      for (const item of list) {
        stepCounter.count++;
        if (stepCounter.count > budget) {
          return { result: err('E_FLOW_BUDGET', `Flow forEach 超出 step 预算 ${budget}`), vars: currentVars };
        }
        const iterVars = { ...currentVars, [effect.as]: item as Value };
        const iterResult = this.runBlock(effect.do, ctx, iterVars, stepCounter, budget);
        currentVars = iterResult.vars;
        if (!iterResult.result.ok) return { result: iterResult.result, vars: currentVars };
      }
      return { result: ok(undefined), vars: currentVars };
    }

    if ('while' in effect) {
      // 需求22.6：while 缺失 maxIter 时运行期防御性拒绝（加载期 Linter 版本留给 L13）
      if (effect.maxIter === undefined || effect.maxIter === null) {
        return { result: err('E_FLOW_NO_MAXITER', 'while 效果缺失必填的 maxIter 字段'), vars };
      }
      let currentVars = vars;
      let iterations = 0;
      while (this.exprEngine.eval(effect.while, this.evalCtx(currentVars, ctx)) === true) {
        iterations++;
        if (iterations > effect.maxIter) {
          return { result: err('E_FLOW_BUDGET', `while 迭代次数超出 maxIter ${effect.maxIter}`), vars: currentVars };
        }
        stepCounter.count++;
        if (stepCounter.count > budget) {
          return { result: err('E_FLOW_BUDGET', `Flow while 超出 step 预算 ${budget}`), vars: currentVars };
        }
        const iterResult = this.runBlock(effect.do, ctx, currentVars, stepCounter, budget);
        currentVars = iterResult.vars;
        if (!iterResult.result.ok) return { result: iterResult.result, vars: currentVars };
      }
      return { result: ok(undefined), vars: currentVars };
    }

    if ('emit' in effect) {
      const data = effect.data ? this.exprEngine.eval(effect.data, this.evalCtx(vars, ctx)) : null;
      this.deps.onEmit?.(effect.emit, data, ctx);
      ctx.emit(effect.emit, (data as Record<string, Value> | null) ?? {});
      return { result: ok(undefined), vars };
    }

    if ('after' in effect) {
      // after N：N 个相位之后兑现。相对当前相位计时。非数 when 视为 0（立即下一次 advance 兑现）。
      const when = this.exprEngine.eval(effect.after, this.evalCtx(vars, ctx));
      const nowPhase = ctx.tx.getDraft().world.turn.phaseEnteredAt;
      const delay = typeof when === 'number' && Number.isFinite(when) ? when : 0;
      this.scheduleDeferred(ctx, 'after', nowPhase + delay, effect.do, vars);
      this.deps.onScheduleDeferred?.('after', when, effect.do);
      return { result: ok(undefined), vars };
    }

    if ('at' in effect) {
      // at M：在绝对相位 M 兑现。非数 when 退化为当前相位（下一次 advance 即兑现）。
      const when = this.exprEngine.eval(effect.at, this.evalCtx(vars, ctx));
      const dueAt = typeof when === 'number' && Number.isFinite(when)
        ? when
        : ctx.tx.getDraft().world.turn.phaseEnteredAt;
      this.scheduleDeferred(ctx, 'at', dueAt, effect.do, vars);
      this.deps.onScheduleDeferred?.('at', when, effect.do);
      return { result: ok(undefined), vars };
    }

    if ('try' in effect) {
      const tryResult = this.runBlock(effect.try, ctx, vars, stepCounter, budget);
      if (tryResult.result.ok) return tryResult;
      if (effect.catch) return this.runBlock(effect.catch, ctx, tryResult.vars, stepCounter, budget);
      return tryResult; // 没有恢复分支时传播原失败，禁止静默转成成功。
    }

    if ('abort' in effect) {
      const reason = this.exprEngine.eval(effect.abort, this.evalCtx(vars, ctx));
      return { result: err('E_FLOW_ABORT', reason === null ? 'Flow 被 abort 中止' : String(reason)), vars };
    }

    return {
      result: err('E_FLOW_UNKNOWN_EFFECT', `未登记的 Effect 形态：${Object.keys(effect as unknown as Record<string, unknown>).sort().join(', ') || '<empty>'}`),
      vars,
    };
  }
}

function resolveFromDraft(ctx: OpContext, path: string, self?: Ref): Value | null {
  const absolute = resolveAt(ctx.tx.getDraft(), path);
  if (absolute !== null || !self) return absolute;
  const host = resolveRefObject(ctx, self);
  if (!host) return null;
  const relativePath = path.startsWith('self.') ? path.slice(5) : path;
  return resolveAt(host, relativePath);
}

function resolveAt(root: unknown, path: string): Value | null {
  const parts = path.split('.').filter((part) => part.length > 0);
  let cur = root;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return (cur ?? null) as Value | null;
}

function resolveRefObject(ctx: OpContext, ref: Ref): (Record<string, Value> & { def?: string }) | null {
  const state = ctx.tx.getDraft();
  if (ref.$ === 'w:0') return state.world as unknown as Record<string, Value>;
  const candidates: unknown[] = [
    state.entities[ref.$], state.items[ref.$], state.nodes[ref.$], state.links[ref.$],
    state.world.attachments[ref.$], state.world.agents[ref.$], state.world.decisions[ref.$],
    state.world.intents[ref.$], state.defs[ref.$],
  ];
  const found = candidates.find((candidate) => candidate !== undefined);
  return found && typeof found === 'object' ? found as Record<string, Value> & { def?: string } : null;
}
