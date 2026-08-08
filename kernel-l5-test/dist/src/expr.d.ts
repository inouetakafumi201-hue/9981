export type Expr = {
    type: 'literal';
    value: number | boolean | string | null;
} | {
    type: 'variable';
    name: string;
} | {
    type: 'binary';
    op: BinaryOp;
    left: Expr;
    right: Expr;
} | {
    type: 'unary';
    op: UnaryOp;
    operand: Expr;
} | {
    type: 'query';
    query: Query;
};
export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '**' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||';
export type UnaryOp = '!' | '-';
export interface Query {
    source: Expr;
    filter?: Expr;
    operation: 'count' | 'sum' | 'any' | 'all' | 'first';
    field?: string;
}
export interface Context {
    entity?: any;
    target?: any;
    [key: string]: any;
}
export type Value = number | boolean | string | null | any[];
//# sourceMappingURL=expr.d.ts.map