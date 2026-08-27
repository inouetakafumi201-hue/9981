/**
 * Expr / Query 的结构类型声明（design.md 3.3节）。
 *
 * 这两个类型本身是零运行时逻辑的纯结构判别联合，只依赖 L1 的 Value/Id，
 * 因此物理上放在 kernel/state（L1）而不是 kernel/expr（L2）——
 * 后者只拥有对这些类型求值/查询的运行时引擎（ExprEngine/QueryEngine）。
 * 这避免了 L1 的 Def.slots[].accepts: Expr 字段声明造成 L1 反向 import L2 的分层违规。
 */
import type { Id } from './ids';
import type { Value } from './value';

export type Expr =
  | Value
  | { readonly path: string }
  | { readonly var: string }
  | { readonly op: string; readonly args: Expr[] }
  | { readonly q: Query }
  | { readonly call: Id; readonly args?: Record<string, Expr> };

export type QueryFrom =
  | 'entities'
  | 'items'
  | 'nodes'
  | 'links'
  | 'attachments'
  | 'defs'
  | 'agents'
  | 'decisions'
  | 'intents'
  | 'log';

export interface Query {
  readonly from: QueryFrom;
  readonly where?: Expr;
  readonly in?: Expr;
  readonly visibleTo?: Expr;
  readonly orderBy?: Expr;
  readonly desc?: boolean;
  readonly limit?: number;
}

/**
 * 遍历一个 Expr AST，收集其中全部 `{call: Id}` 形态引用的具名表达式 Id（需求13.3 环检测的输入）。
 * 物理上放在 L1（与 Expr 类型同处）是因为 DefRegistry.register（L1，装载期例外）需要在注册
 * kind:'expr' 的 Def 时就地做调用图环检测，不应为此反向 import L2。
 *
 * 已知的解释歧义（记录于设计决策文档）：Expr 是非判别联合（表单靠特定键名识别，如 'call'/'op'/'q'/
 * 'path'/'var'），因此一个字面 Value 对象若恰好含有名为这些键之一的属性，会被误判为 Expr 节点而非
 * 字面数据。这是源设计稿的固有歧义，不是本实现引入的缺陷。
 */
export function collectCallTargets(expr: Expr): Id[] {
  const result: Id[] = [];
  const visit = (e: unknown): void => {
    if (e === null || typeof e !== 'object') return;
    if (Array.isArray(e)) {
      for (const item of e) visit(item);
      return;
    }
    const obj = e as Record<string, unknown>;
    if ('call' in obj && typeof obj['call'] === 'string') {
      result.push(obj['call'] as Id);
      const args = obj['args'];
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        for (const v of Object.values(args as Record<string, unknown>)) visit(v);
      }
      return;
    }
    if ('op' in obj && Array.isArray(obj['args'])) {
      for (const a of obj['args'] as unknown[]) visit(a);
      return;
    }
    if ('q' in obj) {
      const q = obj['q'] as Query;
      if (q.where) visit(q.where);
      if (q.in) visit(q.in);
      if (q.visibleTo) visit(q.visibleTo);
      if (q.orderBy) visit(q.orderBy);
      return;
    }
    if ('path' in obj || 'var' in obj) return;
    // 普通对象形态的 Value（映射）：递归其取值，因为 Value 本身允许任意嵌套的映射/表
    for (const v of Object.values(obj)) visit(v);
  };
  visit(expr);
  return result;
}
