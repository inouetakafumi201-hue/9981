// L5层: 表达式定义
// 规范: EXPR-1 EXPR-2 EXPR-3 EXPR-4 EXPR-5 EXPR-6 EXPR-7

export type Expr =
  | { type: 'literal'; value: number | boolean | string | null }
  | { type: 'variable'; name: string }
  | { type: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { type: 'unary'; op: UnaryOp; operand: Expr }
  | { type: 'query'; query: Query };

export type BinaryOp = 
  | '+' | '-' | '*' | '/' | '%' | '**'  // 算术
  | '==' | '!=' | '<' | '>' | '<=' | '>='  // 比较
  | '&&' | '||';  // 逻辑（短路求值）

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
