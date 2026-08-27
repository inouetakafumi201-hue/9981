import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ExprEngine, makeDefaultEvalContext } from '../engine';
import type { Expr } from '../../state/expr-types';

const engine = new ExprEngine();

describe('ExprEngine: 内置算子表与全函数性（需求12.1-12.8）', () => {
  it('字面量直接返回自身', () => {
    expect(engine.eval(42, makeDefaultEvalContext())).toBe(42);
    expect(engine.eval('hello', makeDefaultEvalContext())).toBe('hello');
    expect(engine.eval(null, makeDefaultEvalContext())).toBeNull();
    expect(engine.eval(true, makeDefaultEvalContext())).toBe(true);
  });

  it('var 读取局部变量', () => {
    const ctx = makeDefaultEvalContext({ vars: { x: 10 } });
    expect(engine.eval({ var: 'x' }, ctx)).toBe(10);
    expect(engine.eval({ var: 'missing' }, ctx)).toBeNull();
  });

  it('path 越界或不存在时返回 null（需求12.3）', () => {
    const ctx = makeDefaultEvalContext({ resolvePath: () => null });
    expect(engine.eval({ path: 'entities.e:99.props.hp' }, ctx)).toBeNull();
  });

  it('算术运算与除零返回 null（需求12.4）', () => {
    const ctx = makeDefaultEvalContext();
    expect(engine.eval({ op: 'add', args: [1, 2] }, ctx)).toBe(3);
    expect(engine.eval({ op: 'div', args: [4, 2] }, ctx)).toBe(2);
    expect(engine.eval({ op: 'div', args: [4, 0] }, ctx)).toBeNull();
    expect(engine.eval({ op: 'mod', args: [5, 0] }, ctx)).toBeNull();
  });

  it('比较、逻辑、空值算子', () => {
    const ctx = makeDefaultEvalContext();
    expect(engine.eval({ op: 'gt', args: [5, 3] }, ctx)).toBe(true);
    expect(engine.eval({ op: 'and', args: [true, false] }, ctx)).toBe(false);
    expect(engine.eval({ op: 'or', args: [false, true] }, ctx)).toBe(true);
    expect(engine.eval({ op: 'isNull', args: [null] }, ctx)).toBe(true);
    expect(engine.eval({ op: 'coalesce', args: [null, null, 7] }, ctx)).toBe(7);
  });

  it('未知算子名返回 null，不抛异常', () => {
    const ctx = makeDefaultEvalContext();
    expect(engine.eval({ op: 'notARealOp', args: [1, 2] }, ctx)).toBeNull();
  });

  it('随机算子名（roll/pick/shuffle/weightedPick）不在内置算子表中，求值返回 null（需求12.8）', () => {
    const ctx = makeDefaultEvalContext();
    expect(engine.eval({ op: 'roll', args: [] }, ctx)).toBeNull();
    expect(engine.eval({ op: 'pick', args: [] }, ctx)).toBeNull();
    expect(engine.eval({ op: 'shuffle', args: [] }, ctx)).toBeNull();
    expect(engine.eval({ op: 'weightedPick', args: [] }, ctx)).toBeNull();
  });

  it('内置算子表不含随机类算子名的静态断言（需求12.8）', () => {
    expect(() => ExprEngine.assertNoRandomOps()).not.toThrow();
  });

  it('hasTag 算子（需求4.3）', () => {
    const ctx = makeDefaultEvalContext();
    expect(engine.eval({ op: 'hasTag', args: [{ tags: ['metal'] }, 'metal'] }, ctx)).toBe(true);
    expect(engine.eval({ op: 'hasTag', args: [{ tags: ['metal'] }, 'wood'] }, ctx)).toBe(false);
  });

  it('isA 沿继承链判断归属（需求12.7）', () => {
    const registry = {
      defIsA: (defId: string, baseId: string) => defId === baseId || (defId === 'd:dog' && baseId === 'd:animal'),
    } as any;
    const ctx = makeDefaultEvalContext({
      defRegistry: registry,
      resolveRefDefId: () => 'd:dog',
    });
    expect(engine.isA({ $: 'e:1' }, 'd:animal', ctx)).toBe(true);
    expect(engine.isA({ $: 'e:1' }, 'd:cat', ctx)).toBe(false);
  });

  it('Property 2 的姊妹测试：对于任意结构随机但类型合法的 Expr AST，eval 都不应抛出异常（需求12.1）', () => {
    const exprArb: fc.Arbitrary<Expr> = fc.letrec<{ expr: Expr }>((tie) => ({
      expr: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        fc.constant(null),
        fc.boolean(),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.string({ maxLength: 8 }),
        fc.record({ path: fc.string({ maxLength: 10 }) }),
        fc.record({ var: fc.string({ maxLength: 10 }) }),
        fc.record({
          op: fc.constantFrom('add', 'sub', 'div', 'mod', 'eq', 'and', 'or', 'not', 'unknownOp', 'roll'),
          args: fc.array(tie('expr'), { maxLength: 3 }),
        }),
        fc.record({ call: fc.string({ maxLength: 10 }) }),
      ) as fc.Arbitrary<Expr>,
    })).expr;

    fc.assert(
      fc.property(exprArb, (expr) => {
        const ctx = makeDefaultEvalContext();
        expect(() => engine.eval(expr, ctx)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('Property: 求值深度超出预算时返回 null 而不是无限递归', () => {
    const ctx = makeDefaultEvalContext({ budget: { depth: 100, maxDepth: 64 } });
    expect(engine.eval({ op: 'add', args: [1, 2] }, ctx)).toBeNull();
  });
});
