// L5层: 表达式求值器
// EXPR-1 类型安全; EXPR-2 除零检查; EXPR-3 null传播; EXPR-4 短路;
// EXPR-5 查询; EXPR-6 未绑定变量; EXPR-7 非有限数拒绝。

import { BinaryOp, Context, Expr, Query, UnaryOp, Value } from './expr.js';

const ARITHMETIC_OPS: readonly BinaryOp[] = ['+', '-', '*', '/', '%', '**'];
const COMPARISON_OPS: readonly BinaryOp[] = ['==', '!=', '<', '>', '<=', '>='];

export class ExprEvaluator {
  eval(expr: Expr, ctx: Context): Value {
    switch (expr.type) {
      case 'literal':
        return this.requireFiniteNumber(expr.value);
      case 'variable':
        return this.resolveVariable(expr.name, ctx);
      case 'binary':
        return this.evalBinary(expr.op, expr.left, expr.right, ctx);
      case 'unary':
        return this.evalUnary(expr.op, expr.operand, ctx);
      case 'query':
        return this.evalQuery(expr.query, ctx);
      default:
        throw new Error('E_EXPR_UNKNOWN_TYPE');
    }
  }

  private resolveVariable(name: string, ctx: Context): Value {
    if (name in ctx) {
      return this.requireFiniteNumber(ctx[name]);
    }

    // 查询过滤器支持 $.field（当前元素的字段）及任意绑定对象的点路径。
    const [root, ...path] = name.split('.');
    if (path.length > 0 && root in ctx) {
      let value: unknown = ctx[root];
      for (const segment of path) {
        if (value === null || typeof value !== 'object' || !(segment in value)) {
          throw new Error('E_EXPR_UNBOUND_VAR');
        }
        value = (value as Record<string, unknown>)[segment];
      }
      return this.requireFiniteNumber(value);
    }

    throw new Error('E_EXPR_UNBOUND_VAR');
  }

  private evalBinary(op: BinaryOp, left: Expr, right: Expr, ctx: Context): Value {
    const leftValue = this.eval(left, ctx);

    // EXPR-4: 右侧只有在必要时才被求值；逻辑结果始终为 boolean。
    if (op === '&&') {
      if (!leftValue) return false;
      return Boolean(this.eval(right, ctx));
    }
    if (op === '||') {
      if (leftValue) return true;
      return Boolean(this.eval(right, ctx));
    }

    const rightValue = this.eval(right, ctx);

    // EXPR-3: null 只在算术中传播；相等性比较仍遵循严格相等。
    if (leftValue === null || rightValue === null) {
      if (ARITHMETIC_OPS.includes(op)) return null;
      if (op === '==') return leftValue === rightValue;
      if (op === '!=') return leftValue !== rightValue;
      return false;
    }

    if (ARITHMETIC_OPS.includes(op)) {
      if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
        throw new Error('E_EXPR_TYPE');
      }
      checkFinite(leftValue);
      checkFinite(rightValue);

      if ((op === '/' || op === '%') && rightValue === 0) {
        throw new Error('E_EXPR_DIV_ZERO');
      }

      let result: number;
      switch (op) {
        case '+': result = leftValue + rightValue; break;
        case '-': result = leftValue - rightValue; break;
        case '*': result = leftValue * rightValue; break;
        case '/': result = leftValue / rightValue; break;
        case '%': result = leftValue % rightValue; break;
        case '**': result = Math.pow(leftValue, rightValue); break;
        default: throw new Error('E_EXPR_UNKNOWN_OP');
      }
      checkFinite(result);
      return result;
    }

    if (COMPARISON_OPS.includes(op)) {
      if (op === '==' || op === '!=') {
        return op === '==' ? leftValue === rightValue : leftValue !== rightValue;
      }
      if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
        throw new Error('E_EXPR_TYPE');
      }
      checkFinite(leftValue);
      checkFinite(rightValue);
      switch (op) {
        case '<': return leftValue < rightValue;
        case '>': return leftValue > rightValue;
        case '<=': return leftValue <= rightValue;
        case '>=': return leftValue >= rightValue;
        default: throw new Error('E_EXPR_UNKNOWN_OP');
      }
    }

    throw new Error('E_EXPR_UNKNOWN_OP');
  }

  private evalUnary(op: UnaryOp, operand: Expr, ctx: Context): Value {
    const value = this.eval(operand, ctx);
    if (op === '!') return !value;
    if (op === '-') {
      if (typeof value !== 'number') throw new Error('E_EXPR_TYPE');
      checkFinite(value);
      const result = -value;
      checkFinite(result);
      return result;
    }
    throw new Error('E_EXPR_UNKNOWN_OP');
  }

  private evalQuery(query: Query, ctx: Context): Value {
    const source = this.eval(query.source, ctx);
    if (!Array.isArray(source)) throw new Error('E_EXPR_TYPE');

    const items = query.filter
      ? source.filter((item) => {
          // item 字段覆盖外层同名绑定；$ 总是引用当前元素本身。
          const fields = item !== null && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {};
          return Boolean(this.eval(query.filter!, { ...ctx, ...fields, $: item }));
        })
      : source;

    switch (query.operation) {
      case 'count': return items.length;
      case 'any': return items.length > 0;
      case 'all': return items.length === source.length;
      case 'first': return items.length === 0 ? null : items[0];
      case 'sum': {
        if (!query.field) throw new Error('E_EXPR_INVALID_QUERY');
        const total = items.reduce((sum, item) => {
          const value = this.resolveField(item, query.field!);
          if (value === undefined || value === null) return sum;
          if (typeof value !== 'number') throw new Error('E_EXPR_TYPE');
          checkFinite(value);
          const next = sum + value;
          checkFinite(next);
          return next;
        }, 0);
        return total;
      }
      default:
        throw new Error('E_EXPR_UNKNOWN_OP');
    }
  }

  private resolveField(item: unknown, field: string): unknown {
    if (field === '$') return item;
    let value: unknown = item;
    for (const segment of field.split('.')) {
      if (value === null || typeof value !== 'object' || !(segment in value)) {
        return undefined;
      }
      value = (value as Record<string, unknown>)[segment];
    }
    return value;
  }

  private requireFiniteNumber(value: unknown): Value {
    if (typeof value === 'number') checkFinite(value);
    return value as Value;
  }
}

export function checkFinite(value: number): void {
  if (!Number.isFinite(value)) throw new Error('E_EXPR_TYPE');
}
