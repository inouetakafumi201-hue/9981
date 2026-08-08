import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { checkFinite, Context, Expr, ExprEvaluator } from '../src/index.js';

const evaluator = new ExprEvaluator();
const literal = (value: number | boolean | string | null): Expr => ({ type: 'literal', value });
const variable = (name: string): Expr => ({ type: 'variable', name });
const binary = (op: Extract<Expr, { type: 'binary' }>['op'], left: Expr, right: Expr): Expr => ({
  type: 'binary', op, left, right
});
const query = (operation: Extract<Expr, { type: 'query' }>['query']['operation'], source: Expr, filter?: Expr, field?: string): Expr => ({
  type: 'query', query: { source, operation, ...(filter ? { filter } : {}), ...(field ? { field } : {}) }
});

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof Error && error.message === code);
}

describe('L5: Expr表达式求值', () => {
  // 100,000 runs
  it('EXPR-1: 算术运算拒绝非number', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
        fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
        (left, right) => {
          try {
            const result = evaluator.eval(binary('+', literal(left), literal(right)), {});
            return (left === null || right === null) && result === null;
          } catch (error: unknown) {
            return error instanceof Error && error.message === 'E_EXPR_TYPE';
          }
        }
      ),
      { numRuns: 100_000 }
    );
  });

  // 100,000 runs
  it('EXPR-2: 除零和取模零必须报错', () => {
    fc.assert(
      fc.property(fc.integer(), fc.constantFrom('/', '%'), (numerator, op) => {
        try {
          evaluator.eval(binary(op, literal(numerator), literal(0)), {});
          return false;
        } catch (error: unknown) {
          return error instanceof Error && error.message === 'E_EXPR_DIV_ZERO';
        }
      }),
      { numRuns: 100_000 }
    );
  });

  // 100,000 runs
  it('EXPR-3: null参与所有算术运算均传播', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom<Extract<Expr, { type: 'binary' }>['op']>('+', '-', '*', '/', '%', '**'),
        (number, op) => evaluator.eval(binary(op, literal(null), literal(number)), {}) === null
          && evaluator.eval(binary(op, literal(number), literal(null)), {}) === null
      ),
      { numRuns: 100_000 }
    );
  });

  // 10,000 runs
  it('EXPR-4: && 与 || 是布尔结果且正确短路', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (left, right) => {
        const andResult = evaluator.eval(binary('&&', literal(left), literal(right)), {});
        const orResult = evaluator.eval(binary('||', literal(left), literal(right)), {});
        return andResult === (left && right) && orResult === (left || right);
      }),
      { numRuns: 10_000 }
    );

    const divideByZero = binary('/', literal(1), literal(0));
    assert.equal(evaluator.eval(binary('&&', literal(false), divideByZero), {}), false);
    assert.equal(evaluator.eval(binary('||', literal(true), divideByZero), {}), true);
  });

  // 10,000 runs
  it('EXPR-5: query.count使用$.field过滤后正确计数', () => {
    const itemArbitrary = fc.record({
      def: fc.string(),
      stack: fc.integer({ min: 1, max: 100 })
    });
    fc.assert(
      fc.property(fc.array(itemArbitrary), fc.string(), (items, targetDef) => {
        const expr = query(
          'count',
          variable('items'),
          binary('==', variable('$.def'), literal(targetDef))
        );
        return evaluator.eval(expr, { items }) === items.filter((item) => item.def === targetDef).length;
      }),
      { numRuns: 10_000 }
    );
  });

  it('边界用例：47项', () => {
    const edgeCases: Array<[string, () => void]> = [
      ['literal number', () => assert.equal(evaluator.eval(literal(7), {}), 7)],
      ['literal boolean', () => assert.equal(evaluator.eval(literal(true), {}), true)],
      ['literal string', () => assert.equal(evaluator.eval(literal('x'), {}), 'x')],
      ['literal null', () => assert.equal(evaluator.eval(literal(null), {}), null)],
      ['bound variable', () => assert.equal(evaluator.eval(variable('x'), { x: 3 }), 3)],
      ['unbound variable', () => expectCode(() => evaluator.eval(variable('x'), {}), 'E_EXPR_UNBOUND_VAR')],
      ['addition', () => assert.equal(evaluator.eval(binary('+', literal(2), literal(3)), {}), 5)],
      ['subtraction', () => assert.equal(evaluator.eval(binary('-', literal(2), literal(3)), {}), -1)],
      ['multiplication', () => assert.equal(evaluator.eval(binary('*', literal(2), literal(3)), {}), 6)],
      ['division', () => assert.equal(evaluator.eval(binary('/', literal(6), literal(3)), {}), 2)],
      ['modulo', () => assert.equal(evaluator.eval(binary('%', literal(7), literal(3)), {}), 1)],
      ['exponent', () => assert.equal(evaluator.eval(binary('**', literal(2), literal(3)), {}), 8)],
      ['equal', () => assert.equal(evaluator.eval(binary('==', literal('a'), literal('a')), {}), true)],
      ['not equal', () => assert.equal(evaluator.eval(binary('!=', literal('a'), literal('b')), {}), true)],
      ['less than', () => assert.equal(evaluator.eval(binary('<', literal(1), literal(2)), {}), true)],
      ['greater than', () => assert.equal(evaluator.eval(binary('>', literal(2), literal(1)), {}), true)],
      ['less or equal', () => assert.equal(evaluator.eval(binary('<=', literal(2), literal(2)), {}), true)],
      ['greater or equal', () => assert.equal(evaluator.eval(binary('>=', literal(2), literal(2)), {}), true)],
      ['unary not', () => assert.equal(evaluator.eval({ type: 'unary', op: '!', operand: literal(false) }, {}), true)],
      ['unary minus', () => assert.equal(evaluator.eval({ type: 'unary', op: '-', operand: literal(5) }, {}), -5)],
      ['unary type violation', () => expectCode(() => evaluator.eval({ type: 'unary', op: '-', operand: literal('5') }, {}), 'E_EXPR_TYPE')],
      ['arithmetic type violation', () => expectCode(() => evaluator.eval(binary('*', literal(true), literal(1)), {}), 'E_EXPR_TYPE')],
      ['ordered comparison type violation', () => expectCode(() => evaluator.eval(binary('<', literal('1'), literal('2')), {}), 'E_EXPR_TYPE')],
      ['null equality', () => assert.equal(evaluator.eval(binary('==', literal(null), literal(null)), {}), true)],
      ['null inequality', () => assert.equal(evaluator.eval(binary('!=', literal(null), literal(1)), {}), true)],
      ['null ordered comparison', () => assert.equal(evaluator.eval(binary('<', literal(null), literal(1)), {}), false)],
      ['division by zero', () => expectCode(() => evaluator.eval(binary('/', literal(1), literal(0)), {}), 'E_EXPR_DIV_ZERO')],
      ['modulo by zero', () => expectCode(() => evaluator.eval(binary('%', literal(1), literal(0)), {}), 'E_EXPR_DIV_ZERO')],
      ['literal Infinity', () => expectCode(() => evaluator.eval(literal(Infinity), {}), 'E_EXPR_TYPE')],
      ['literal NaN', () => expectCode(() => evaluator.eval(literal(NaN), {}), 'E_EXPR_TYPE')],
      ['arithmetic overflow', () => expectCode(() => evaluator.eval(binary('**', literal(2), literal(1024)), {}), 'E_EXPR_TYPE')],
      ['checkFinite Infinity', () => expectCode(() => checkFinite(Infinity), 'E_EXPR_TYPE')],
      ['checkFinite NaN', () => expectCode(() => checkFinite(NaN), 'E_EXPR_TYPE')],
      ['empty count', () => assert.equal(evaluator.eval(query('count', variable('items')), { items: [] }), 0)],
      ['empty any', () => assert.equal(evaluator.eval(query('any', variable('items')), { items: [] }), false)],
      ['empty all', () => assert.equal(evaluator.eval(query('all', variable('items')), { items: [] }), true)],
      ['empty first', () => assert.equal(evaluator.eval(query('first', variable('items')), { items: [] }), null)],
      ['empty sum', () => assert.equal(evaluator.eval(query('sum', variable('items'), undefined, 'value'), { items: [] }), 0)],
      ['filtered count', () => assert.equal(evaluator.eval(query('count', variable('items'), binary('>', variable('$.stack'), literal(2))), { items: [{ stack: 1 }, { stack: 3 }] }), 1)],
      ['filtered any', () => assert.equal(evaluator.eval(query('any', variable('items'), binary('>', variable('$'), literal(2))), { items: [1, 3] }), true)],
      ['filtered all', () => assert.equal(evaluator.eval(query('all', variable('items'), binary('>', variable('$'), literal(2))), { items: [3, 4] }), true)],
      ['filtered all false', () => assert.equal(evaluator.eval(query('all', variable('items'), binary('>', variable('$'), literal(2))), { items: [2, 3] }), false)],
      ['first filtered item', () => assert.deepEqual(evaluator.eval(query('first', variable('items'), binary('==', variable('$.def'), literal('b'))), { items: [{ def: 'a' }, { def: 'b' }] }), { def: 'b' })],
      ['sum direct field', () => assert.equal(evaluator.eval(query('sum', variable('items'), undefined, 'stack'), { items: [{ stack: 2 }, { stack: 3 }] }), 5)],
      ['sum self field', () => assert.equal(evaluator.eval(query('sum', variable('items'), undefined, '$'), { items: [2, 3] }), 5)],
      ['sum nested field', () => assert.equal(evaluator.eval(query('sum', variable('items'), undefined, 'stats.attack'), { items: [{ stats: { attack: 2 } }, { stats: { attack: 3 } }] }), 5)],
      ['invalid sum query', () => expectCode(() => evaluator.eval(query('sum', variable('items')), { items: [] }), 'E_EXPR_INVALID_QUERY')]
    ];

    assert.equal(edgeCases.length, 47);
    for (const [label, run] of edgeCases) {
      assert.doesNotThrow(run, label);
    }
  });
});
