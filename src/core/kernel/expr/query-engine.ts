/**
 * L2 Query: 查询引擎（design.md 3.3节 / 需求14.1-14.5, 15.1-15.4）。
 */
import type { Ref } from '../state/ids.js';
import type { WorldState } from '../state/world-state.js';
import type { Query, QueryFrom } from '../state/expr-types.js';
import type { Value } from '../state/value.js';
import { logEntryToValue } from '../state/event-log.js';
import type { ExprEngine, EvalContext } from './engine.js';

/** 数据源分发：把 WorldState 的六大集合 + attachments/agents/decisions/intents/log 映射为 Ref 数组。 */
export function collectSourceRefs(state: WorldState, from: QueryFrom): Ref[] {
  switch (from) {
    case 'entities':
      return Object.keys(state.entities).map((id) => ({ $: id }));
    case 'items':
      return Object.keys(state.items).map((id) => ({ $: id }));
    case 'nodes':
      return Object.keys(state.nodes).map((id) => ({ $: id }));
    case 'links':
      return Object.keys(state.links).map((id) => ({ $: id }));
    case 'attachments':
      return Object.keys(state.world.attachments).map((id) => ({ $: id }));
    case 'defs':
      return Object.keys(state.defs).map((id) => ({ $: id }));
    case 'agents':
      return Object.keys(state.world.agents).map((id) => ({ $: id }));
    case 'decisions':
      return Object.keys(state.world.decisions).map((id) => ({ $: id }));
    case 'intents':
      return Object.keys(state.world.intents).map((id) => ({ $: id }));
    case 'log':
      // 日志条目不是 Ref 可寻址对象：需求1.2 把 Ref 前缀限定为封闭集合，其中没有日志前缀
      // （见 state/world-state.ts 的 LogEntry 注释）。因此返回 Ref[] 的 run() 对 log 源恒为空集，
      // 日志查询走 runValues()——它返回 Value[]，能承载事件自描述映射。Expr 的 {q:...} 形态
      // 已经统一改走 runValues，所以玩法包表达式里的 from:'log' 是可用的。
      return [];
    default:
      return [];
  }
}

export interface QueryRunDeps {
  exprEngine: ExprEngine;
  baseCtx: EvalContext;
  /** 为某个 Ref 构造一个求值上下文（self 指向该 Ref，供 where/orderBy 里的 path 相对求值）。 */
  ctxForSelf: (ref: Ref) => EvalContext;
  /**
   * 为一个非 Ref 的候选值（当前只有日志条目）构造求值上下文，把它绑定到变量 `$`。
   * 缺省实现由 makeValueCtx 提供，调用方通常不需要自己传。
   */
  ctxForValue?: (value: Value) => EvalContext;
}

/** 把候选值绑定到 `$` 变量的默认上下文构造器（日志查询的 where/orderBy 以 `{var:'$'}` 访问条目）。 */
function makeValueCtx(deps: QueryRunDeps): (value: Value) => EvalContext {
  return deps.ctxForValue ?? ((value: Value) => ({
    ...deps.baseCtx,
    vars: { ...deps.baseCtx.vars, $: value },
  }));
}

export class QueryEngine {
  run(state: WorldState, q: Query, deps: QueryRunDeps): Ref[] {
    let refs = collectSourceRefs(state, q.from);

    if (q.in) {
      const inResult = deps.exprEngine.eval(q.in, deps.baseCtx);
      if (Array.isArray(inResult)) {
        const allowed = new Set((inResult as unknown[]).map((v) => (v as Ref).$));
        refs = refs.filter((r) => allowed.has(r.$));
      }
    }

    // 判定谓词的存在性必须用 !== undefined，不能用真值判断：`where: false`、`visibleTo: null`
    // 这类假值谓词若被当成"没有声明谓词"，整个过滤块会被跳过并放行全部结果——这正是
    // 声明了门禁却静默失效的最危险形态。
    if (q.where !== undefined) {
      refs = refs.filter((r) => {
        const ctx = deps.ctxForSelf(r);
        return deps.exprEngine.eval(q.where as NonNullable<Query['where']>, ctx) === true;
      });
    }

    if (q.visibleTo !== undefined) {
      refs = refs.filter((r) => {
        const ctx = deps.ctxForSelf(r);
        // 可见性是权限边界：只有严格布尔 true 才能放行。null、缺失路径、
        // 字符串和其他非布尔结果都必须失败关闭，不能用"不是 false"放行。
        return deps.exprEngine.eval(q.visibleTo as NonNullable<Query['visibleTo']>, ctx) === true;
      });
    }

    if (q.orderBy) {
      const keyed = refs.map((r) => ({
        ref: r,
        key: deps.exprEngine.eval(q.orderBy as NonNullable<Query['orderBy']>, deps.ctxForSelf(r)),
      }));
      keyed.sort((a, b) => compareOrderKey(a.key, b.key));
      if (q.desc) keyed.reverse();
      refs = keyed.map((k) => k.ref);
    }

    if (q.limit !== undefined && q.limit >= 0) {
      refs = refs.slice(0, q.limit);
    }

    return refs;
  }

  /**
   * 返回 Value[] 的查询入口（需求15.3：from:'log' 的真实数据通道）。
   *
   * 对九个对象类数据源，结果与 run() 完全一致（Ref 本身就是 Value），因此这不是第二套查询语义，
   * 只是把返回类型放宽到 Value 以容纳不可寻址的日志条目。对 from:'log'，逐条投影成自描述映射后
   * 再套用同一组 where/orderBy/desc/limit 过滤——过滤逻辑复用同一份实现，避免日志查询与对象查询
   * 在谓词语义上漂移。
   */
  runValues(state: WorldState, q: Query, deps: QueryRunDeps): Value[] {
    if (q.from !== 'log') return this.run(state, q, deps) as unknown as Value[];

    const ctxFor = makeValueCtx(deps);
    let entries = state.world.log.map(logEntryToValue);

    if (q.where !== undefined) {
      entries = entries.filter((entry) =>
        deps.exprEngine.eval(q.where as NonNullable<Query['where']>, ctxFor(entry)) === true);
    }
    if (q.visibleTo !== undefined) {
      // 与对象查询同样失败关闭：只有严格 true 放行。
      entries = entries.filter((entry) =>
        deps.exprEngine.eval(q.visibleTo as NonNullable<Query['visibleTo']>, ctxFor(entry)) === true);
    }
    if (q.orderBy) {
      const keyed = entries.map((entry) => ({
        entry,
        key: deps.exprEngine.eval(q.orderBy as NonNullable<Query['orderBy']>, ctxFor(entry)),
      }));
      keyed.sort((a, b) => compareOrderKey(a.key, b.key));
      if (q.desc) keyed.reverse();
      entries = keyed.map((k) => k.entry);
    }
    if (q.limit !== undefined && q.limit >= 0) entries = entries.slice(0, q.limit);
    return entries;
  }
}

function compareOrderKey(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index++) {
      const compared = compareOrderKey(a[index], b[index]);
      if (compared !== 0) return compared;
    }
    return a.length - b.length;
  }
  return 0;
}
