import { Context, Expr, Value } from './expr.js';
export declare class ExprEvaluator {
    eval(expr: Expr, ctx: Context): Value;
    private resolveVariable;
    private evalBinary;
    private evalUnary;
    private evalQuery;
    private resolveField;
    private requireFiniteNumber;
}
export declare function checkFinite(value: number): void;
//# sourceMappingURL=evaluator.d.ts.map