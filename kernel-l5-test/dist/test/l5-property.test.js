"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const strict_1 = __importDefault(require("node:assert/strict"));
const fast_check_1 = __importDefault(require("fast-check"));
const index_js_1 = require("../src/index.js");
const evaluator = new index_js_1.ExprEvaluator();
const literal = (value) => ({ type: 'literal', value });
const variable = (name) => ({ type: 'variable', name });
const binary = (op, left, right) => ({
    type: 'binary', op, left, right
});
const query = (operation, source, filter, field) => ({
    type: 'query', query: { source, operation, ...(filter ? { filter } : {}), ...(field ? { field } : {}) }
});
function expectCode(action, code) {
    strict_1.default.throws(action, (error) => error instanceof Error && error.message === code);
}
(0, vitest_1.describe)('L5: Expr表达式求值', () => {
    // 100,000 runs
    (0, vitest_1.it)('EXPR-1: 算术运算拒绝非number', () => {
        fast_check_1.default.assert(fast_check_1.default.property(fast_check_1.default.oneof(fast_check_1.default.string(), fast_check_1.default.boolean(), fast_check_1.default.constant(null)), fast_check_1.default.oneof(fast_check_1.default.string(), fast_check_1.default.boolean(), fast_check_1.default.constant(null)), (left, right) => {
            try {
                const result = evaluator.eval(binary('+', literal(left), literal(right)), {});
                return (left === null || right === null) && result === null;
            }
            catch (error) {
                return error instanceof Error && error.message === 'E_EXPR_TYPE';
            }
        }), { numRuns: 100000 });
    });
    // 100,000 runs
    (0, vitest_1.it)('EXPR-2: 除零和取模零必须报错', () => {
        fast_check_1.default.assert(fast_check_1.default.property(fast_check_1.default.integer(), fast_check_1.default.constantFrom('/', '%'), (numerator, op) => {
            try {
                evaluator.eval(binary(op, literal(numerator), literal(0)), {});
                return false;
            }
            catch (error) {
                return error instanceof Error && error.message === 'E_EXPR_DIV_ZERO';
            }
        }), { numRuns: 100000 });
    });
    // 100,000 runs
    (0, vitest_1.it)('EXPR-3: null参与所有算术运算均传播', () => {
        fast_check_1.default.assert(fast_check_1.default.property(fast_check_1.default.integer(), fast_check_1.default.constantFrom('+', '-', '*', '/', '%', '**'), (number, op) => evaluator.eval(binary(op, literal(null), literal(number)), {}) === null
            && evaluator.eval(binary(op, literal(number), literal(null)), {}) === null), { numRuns: 100000 });
    });
    // 10,000 runs
    (0, vitest_1.it)('EXPR-4: && 与 || 是布尔结果且正确短路', () => {
        fast_check_1.default.assert(fast_check_1.default.property(fast_check_1.default.boolean(), fast_check_1.default.boolean(), (left, right) => {
            const andResult = evaluator.eval(binary('&&', literal(left), literal(right)), {});
            const orResult = evaluator.eval(binary('||', literal(left), literal(right)), {});
            return andResult === (left && right) && orResult === (left || right);
        }), { numRuns: 10000 });
        const divideByZero = binary('/', literal(1), literal(0));
        strict_1.default.equal(evaluator.eval(binary('&&', literal(false), divideByZero), {}), false);
        strict_1.default.equal(evaluator.eval(binary('||', literal(true), divideByZero), {}), true);
    });
    // 10,000 runs
    (0, vitest_1.it)('EXPR-5: query.count使用$.field过滤后正确计数', () => {
        const itemArbitrary = fast_check_1.default.record({
            def: fast_check_1.default.string(),
            stack: fast_check_1.default.integer({ min: 1, max: 100 })
        });
        fast_check_1.default.assert(fast_check_1.default.property(fast_check_1.default.array(itemArbitrary), fast_check_1.default.string(), (items, targetDef) => {
            const expr = query('count', variable('items'), binary('==', variable('$.def'), literal(targetDef)));
            return evaluator.eval(expr, { items }) === items.filter((item) => item.def === targetDef).length;
        }), { numRuns: 10000 });
    });
    (0, vitest_1.it)('边界用例：47项', () => {
        const edgeCases = [
            ['literal number', () => strict_1.default.equal(evaluator.eval(literal(7), {}), 7)],
            ['literal boolean', () => strict_1.default.equal(evaluator.eval(literal(true), {}), true)],
            ['literal string', () => strict_1.default.equal(evaluator.eval(literal('x'), {}), 'x')],
            ['literal null', () => strict_1.default.equal(evaluator.eval(literal(null), {}), null)],
            ['bound variable', () => strict_1.default.equal(evaluator.eval(variable('x'), { x: 3 }), 3)],
            ['unbound variable', () => expectCode(() => evaluator.eval(variable('x'), {}), 'E_EXPR_UNBOUND_VAR')],
            ['addition', () => strict_1.default.equal(evaluator.eval(binary('+', literal(2), literal(3)), {}), 5)],
            ['subtraction', () => strict_1.default.equal(evaluator.eval(binary('-', literal(2), literal(3)), {}), -1)],
            ['multiplication', () => strict_1.default.equal(evaluator.eval(binary('*', literal(2), literal(3)), {}), 6)],
            ['division', () => strict_1.default.equal(evaluator.eval(binary('/', literal(6), literal(3)), {}), 2)],
            ['modulo', () => strict_1.default.equal(evaluator.eval(binary('%', literal(7), literal(3)), {}), 1)],
            ['exponent', () => strict_1.default.equal(evaluator.eval(binary('**', literal(2), literal(3)), {}), 8)],
            ['equal', () => strict_1.default.equal(evaluator.eval(binary('==', literal('a'), literal('a')), {}), true)],
            ['not equal', () => strict_1.default.equal(evaluator.eval(binary('!=', literal('a'), literal('b')), {}), true)],
            ['less than', () => strict_1.default.equal(evaluator.eval(binary('<', literal(1), literal(2)), {}), true)],
            ['greater than', () => strict_1.default.equal(evaluator.eval(binary('>', literal(2), literal(1)), {}), true)],
            ['less or equal', () => strict_1.default.equal(evaluator.eval(binary('<=', literal(2), literal(2)), {}), true)],
            ['greater or equal', () => strict_1.default.equal(evaluator.eval(binary('>=', literal(2), literal(2)), {}), true)],
            ['unary not', () => strict_1.default.equal(evaluator.eval({ type: 'unary', op: '!', operand: literal(false) }, {}), true)],
            ['unary minus', () => strict_1.default.equal(evaluator.eval({ type: 'unary', op: '-', operand: literal(5) }, {}), -5)],
            ['unary type violation', () => expectCode(() => evaluator.eval({ type: 'unary', op: '-', operand: literal('5') }, {}), 'E_EXPR_TYPE')],
            ['arithmetic type violation', () => expectCode(() => evaluator.eval(binary('*', literal(true), literal(1)), {}), 'E_EXPR_TYPE')],
            ['ordered comparison type violation', () => expectCode(() => evaluator.eval(binary('<', literal('1'), literal('2')), {}), 'E_EXPR_TYPE')],
            ['null equality', () => strict_1.default.equal(evaluator.eval(binary('==', literal(null), literal(null)), {}), true)],
            ['null inequality', () => strict_1.default.equal(evaluator.eval(binary('!=', literal(null), literal(1)), {}), true)],
            ['null ordered comparison', () => strict_1.default.equal(evaluator.eval(binary('<', literal(null), literal(1)), {}), false)],
            ['division by zero', () => expectCode(() => evaluator.eval(binary('/', literal(1), literal(0)), {}), 'E_EXPR_DIV_ZERO')],
            ['modulo by zero', () => expectCode(() => evaluator.eval(binary('%', literal(1), literal(0)), {}), 'E_EXPR_DIV_ZERO')],
            ['literal Infinity', () => expectCode(() => evaluator.eval(literal(Infinity), {}), 'E_EXPR_TYPE')],
            ['literal NaN', () => expectCode(() => evaluator.eval(literal(NaN), {}), 'E_EXPR_TYPE')],
            ['arithmetic overflow', () => expectCode(() => evaluator.eval(binary('**', literal(2), literal(1024)), {}), 'E_EXPR_TYPE')],
            ['checkFinite Infinity', () => expectCode(() => (0, index_js_1.checkFinite)(Infinity), 'E_EXPR_TYPE')],
            ['checkFinite NaN', () => expectCode(() => (0, index_js_1.checkFinite)(NaN), 'E_EXPR_TYPE')],
            ['empty count', () => strict_1.default.equal(evaluator.eval(query('count', variable('items')), { items: [] }), 0)],
            ['empty any', () => strict_1.default.equal(evaluator.eval(query('any', variable('items')), { items: [] }), false)],
            ['empty all', () => strict_1.default.equal(evaluator.eval(query('all', variable('items')), { items: [] }), true)],
            ['empty first', () => strict_1.default.equal(evaluator.eval(query('first', variable('items')), { items: [] }), null)],
            ['empty sum', () => strict_1.default.equal(evaluator.eval(query('sum', variable('items'), undefined, 'value'), { items: [] }), 0)],
            ['filtered count', () => strict_1.default.equal(evaluator.eval(query('count', variable('items'), binary('>', variable('$.stack'), literal(2))), { items: [{ stack: 1 }, { stack: 3 }] }), 1)],
            ['filtered any', () => strict_1.default.equal(evaluator.eval(query('any', variable('items'), binary('>', variable('$'), literal(2))), { items: [1, 3] }), true)],
            ['filtered all', () => strict_1.default.equal(evaluator.eval(query('all', variable('items'), binary('>', variable('$'), literal(2))), { items: [3, 4] }), true)],
            ['filtered all false', () => strict_1.default.equal(evaluator.eval(query('all', variable('items'), binary('>', variable('$'), literal(2))), { items: [2, 3] }), false)],
            ['first filtered item', () => strict_1.default.deepEqual(evaluator.eval(query('first', variable('items'), binary('==', variable('$.def'), literal('b'))), { items: [{ def: 'a' }, { def: 'b' }] }), { def: 'b' })],
            ['sum direct field', () => strict_1.default.equal(evaluator.eval(query('sum', variable('items'), undefined, 'stack'), { items: [{ stack: 2 }, { stack: 3 }] }), 5)],
            ['sum self field', () => strict_1.default.equal(evaluator.eval(query('sum', variable('items'), undefined, '$'), { items: [2, 3] }), 5)],
            ['sum nested field', () => strict_1.default.equal(evaluator.eval(query('sum', variable('items'), undefined, 'stats.attack'), { items: [{ stats: { attack: 2 } }, { stats: { attack: 3 } }] }), 5)],
            ['invalid sum query', () => expectCode(() => evaluator.eval(query('sum', variable('items')), { items: [] }), 'E_EXPR_INVALID_QUERY')]
        ];
        strict_1.default.equal(edgeCases.length, 47);
        for (const [label, run] of edgeCases) {
            strict_1.default.doesNotThrow(run, label);
        }
    });
});
//# sourceMappingURL=l5-property.test.js.map