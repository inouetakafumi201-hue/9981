/**
 * L2 Query: from:'log' 查询历史（需求15.3）
 *
 * 锁定 QueryEngine.runValues 对日志源的行为：日志条目不是 Ref（需求1.2 的封闭前缀
 * 集合里没有日志前缀），因此走返回 Value[] 的 runValues 而非返回 Ref[] 的 run，
 * 并复用与对象查询同一套 where/orderBy/limit 过滤链。
 */
import { describe, expect, it } from 'vitest';
import { QueryEngine } from '../query-engine.js';
import { ExprEngine, makeDefaultEvalContext } from '../engine.js';
import type { EvalContext } from '../engine.js';
import { appendLogEntry } from '../../state/event-log.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import type { WorldState } from '../../state/world-state.js';
import type { Expr } from '../../state/expr-types.js';

const exprEngine = new ExprEngine();
const queryEngine = new QueryEngine();

function stateWithLog(): WorldState {
  let state = createEmptyWorldState('sched:t');
  state = appendLogEntry(state, 'damage', { amount: 3, source: { $: 'e:hero' } });
  state = appendLogEntry(state, 'death', { who: { $: 'e:foe' } });
  state = appendLogEntry(state, 'damage', { amount: 1, source: { $: 'e:foe' } });
  return state;
}

function deps() {
  const baseCtx: EvalContext = makeDefaultEvalContext({ resolvePath: () => null });
  return {
    exprEngine,
    baseCtx,
    ctxForSelf: () => baseCtx,
  };
}

const varRef = (name: string): Expr => ({ var: name });

describe("QueryEngine.runValues 的 from:'log'（需求15.3）", () => {
  it('返回全部日志条目的自描述映射', () => {
    const state = stateWithLog();
    const result = queryEngine.runValues(state, { from: 'log' }, deps());
    expect(result).toHaveLength(3);
    expect(result.map((e) => (e as { type: string }).type)).toEqual(['damage', 'death', 'damage']);
  });

  it('where 谓词可用 {var:$} 访问条目字段（type=="death"）', () => {
    const state = stateWithLog();
    const where: Expr = {
      op: 'eq',
      args: [{ op: 'get', args: [varRef('$'), 'type'] }, 'death'],
    };
    const result = queryEngine.runValues(state, { from: 'log', where }, deps());
    expect(result).toHaveLength(1);
    expect((result[0] as { type: string }).type).toBe('death');
  });

  it('orderBy + desc + limit 取最近一条，复用与对象查询相同的过滤链', () => {
    const state = stateWithLog();
    const orderBy: Expr = { op: 'get', args: [varRef('$'), 'seq'] };
    const latest = queryEngine.runValues(state, { from: 'log', orderBy, desc: true, limit: 1 }, deps());
    expect(latest).toHaveLength(1);
    expect((latest[0] as { seq: number }).seq).toBe(3);
  });

  it('visibleTo 失败关闭：非严格 true 一律过滤掉', () => {
    const state = stateWithLog();
    const result = queryEngine.runValues(state, { from: 'log', visibleTo: false }, deps());
    expect(result).toEqual([]);
  });

  it('对象源经由 runValues 与 run 结果一致（runValues 不是第二套语义）', () => {
    const state = stateWithLog();
    const asValues = queryEngine.runValues(state, { from: 'entities' }, deps());
    const asRefs = queryEngine.run(state, { from: 'entities' }, deps());
    expect(asValues).toEqual(asRefs);
  });
});
