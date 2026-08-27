/**
 * Feature: wakeup-engine-bombardment
 * Property 2b: L2 Expr/Query 穷举健壮性
 * Validates: Requirements 2.5 (数据面，并入要求 2 属性面)
 *
 * ExprEngine.eval 被声明为全函数（需求12.1）：任意 Expr 输入返 Value 或 null，永不抛。
 * 这里用结构随机的 Expr（含未知算子/危险指令形态/越界嵌套/类型混用/`call` 环/`q` 查询），
 * 在真实 ExprEngine + QueryEngine + makeDefaultEvalContext 组合路径上轰炸：
 * - eval 对任意 Expr 不抛（返回 Value 或 null）；
 * - checkPure 对含写入类 Op 调用形态（prop./item./random. 等）的 body 判为不纯；
 * - pure 的 body checkPure ok，而全部 Op 调用形态判不纯。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import { QueryEngine } from '../expr/query-engine';
import { makeExprStateAccess } from '../expr/state-access';
import { checkPure } from '../expr/named-expr';
import type { Expr } from '../state/expr-types';
import { createEmptyWorldState } from '../state/world-state';
import { getPath } from '../ops/path';

/** 结构随机的 Expr（有限深度递归，避免 letrec 在该 fast-check 版本不可用）：字面量、path、var、op（含未知/随机/写入算子）、call、q、嵌套数组/对象。 */
function exprArbOf(maxDepth: number): fc.Arbitrary<Expr> {
  const scalar: fc.Arbitrary<Expr> = fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -100, max: 100 }),
    fc.float({ min: -1000, max: 1000 }),
    fc.string(),
  );
  if (maxDepth <= 0) return scalar;
  const objArb: fc.Arbitrary<Expr> = fc.oneof(
    fc.record({ path: fc.string() }),
    fc.record({ var: fc.constantFrom('self', 'x', 'y', 'missing') }),
    fc.record({
      op: fc.constantFrom('add', 'sub', 'mul', 'div', 'eq', 'gt', 'unknown.op', 'random.roll', 'literal', 'some.unknown'),
      args: fc.array(exprArbOf(maxDepth - 1), { maxLength: 3 }),
    }),
    fc.record({ call: fc.constant('expr:always') }),
    fc.record({ q: fc.record({ from: fc.constantFrom('entities', 'items', 'nodes', 'links', 'world', 'log', 'unknown') }) }),
  );
  // `oneof` 要求同构：scalar/obj 已是 Expr，数组单独 oneof 为 Expr[] 后统一映射回 Expr。
  return fc.oneof(
    scalar,
    objArb,
    fc.array(exprArbOf(maxDepth - 1), { maxLength: 3 }).map((arr) => arr as unknown as Expr),
  );
}

const exprArb: fc.Arbitrary<Expr> = exprArbOf(3);

describe('Feature: wakeup-engine-bombardment, Property 2b: L2 Expr/Query 穷举健壮性', () => {
  it('ExprEngine.eval 对任意随机 Expr 不抛（返回 Value 或 null 的全函数）', () => {
    const exprEngine = new ExprEngine();
    const queryEngine = new QueryEngine();
    const state = createEmptyWorldState('sched:l2b');

    // 直接构造 EvalContext（与 makeDefaultEvalContext 同构）：query 通过 runQueryValues 走真实 QueryEngine
    const baseCtx = makeDefaultEvalContext({
      self: { $: 'e:1' },
      vars: { self: { $: 'e:1' }, x: 1, y: 2 },
      resolvePath: (path) => getPath(state, path),
      defRegistry: makeDefRegistry({ 'expr:always': { id: 'expr:always', kind: 'expr', body: true, pure: true } }),
      stateAccess: makeExprStateAccess(() => state, makeDefRegistry({})),
      runQuery: (query) => queryEngine.run(state, query, { exprEngine, baseCtx, ctxForSelf: () => baseCtx }),
      runQueryValues: (query) => queryEngine.runValues(state, query, { exprEngine, baseCtx, ctxForSelf: () => baseCtx }),
      resolveNamedExpr: (id) => (id === 'expr:always' ? { body: true } : null),
    });

    fc.assert(
      fc.property(exprArb, (expr) => {
        let out: unknown;
        expect(() => { out = exprEngine.eval(expr, baseCtx); }).not.toThrow();
        // eval 是全函数：返回 Value 或 null（对合法/非法输入都不向调用方泄漏 undefined/异常）
        const okValueShape =
          out === null ||
          typeof out === 'number' ||
          typeof out === 'string' ||
          typeof out === 'boolean' ||
          Array.isArray(out) ||
          (typeof out === 'object' && out !== undefined);
        expect(okValueShape, `eval 返回了非 Value/null: ${String(out)}`).toBe(true);
        expect(out).not.toBe(undefined);
      }),
      { numRuns: 500 },
    );
  });

  it('checkPure：写入类 Op 形态判不纯；纯字面量/纯 op 形态判 ok', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const writeExpr: Expr = { op: `prop.set`, args: [{ path: `entities.e:${name}.props.hp` }, { value: 3 }] } as never;
        const randomExpr: Expr = { op: 'random.roll', args: [{ value: 6 }] } as never;
        const pureExpr: Expr = { op: 'add', args: [1, 2] } as never;
        const callExpr: Expr = { call: 'expr:always' } as never;
        expect(checkPure(writeExpr).ok).toBe(false);
        expect(checkPure(randomExpr).ok).toBe(false);
        expect(checkPure(pureExpr).ok).toBe(true);
        expect(checkPure(callExpr).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

/** 最小 DefRegistry 兼容壳（只够 resolveNamedExpr / stateAccess 使用），不承载真实注册。 */
function makeDefRegistry(defs: Record<string, { id: string; kind: string; body?: unknown; pure?: boolean }>): never {
  return {
    resolve: (id: string) => defs[id] ?? undefined,
  } as never;
}
