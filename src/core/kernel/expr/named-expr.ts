/**
 * L2 Expr: 具名表达式（kind:'expr'）注册与 pure 校验（design.md 3.3节 / 需求13.1-13.5）。
 */
import type { Id } from '../state/ids';
import type { Def, DefRegistry } from '../state/def';
import type { Expr } from '../state/expr-types';

export interface ExprDef extends Def {
  readonly kind: 'expr';
  readonly params?: string[];
  readonly body: Expr;
  readonly pure: true;
}

export type PureCheckResult = { ok: true } | { ok: false; detail: string };

/**
 * pure 恒真校验（需求13.2）：body 不得含 `q` 之外的 Op 调用形态。
 * Expr 语法本身只有 path/var/op/q/call 五种非字面形态，其中 op 只能是内置纯函数算子
 * （已在 ExprEngine 层排除随机算子），不存在"调用 Op"的语法通道——因此这里的校验
 * 实质是确认 body 里不包含任何形如 {invokeOp:...}/{op:'prop.set',...} 这类越界扩展形态。
 */
export function checkPure(body: Expr): PureCheckResult {
  const violation = findOpCallViolation(body);
  if (violation) return { ok: false, detail: `具名表达式 body 中出现非法的 Op 调用形态: ${violation}` };
  return { ok: true };
}

const KNOWN_OP_WRITE_PREFIXES = [
  'prop.', 'list.', 'tag.', 'entity.', 'item.', 'stack.', 'node.', 'link.', 'slot.',
  'prefab.', 'relation.', 'agent.', 'attach.', 'decision.', 'intent.', 'outcome.',
  'schedule.', 'random.',
];

function findOpCallViolation(expr: unknown): string | null {
  if (expr === null || typeof expr !== 'object') return null;
  if (Array.isArray(expr)) {
    for (const item of expr) {
      const v = findOpCallViolation(item);
      if (v) return v;
    }
    return null;
  }
  const obj = expr as Record<string, unknown>;
  if ('op' in obj && typeof obj['op'] === 'string') {
    const opName = obj['op'] as string;
    if (KNOWN_OP_WRITE_PREFIXES.some((p) => opName.startsWith(p))) {
      return opName;
    }
    const args = obj['args'];
    if (Array.isArray(args)) {
      for (const a of args) {
        const v = findOpCallViolation(a);
        if (v) return v;
      }
    }
    return null;
  }
  if ('call' in obj) return null; // call 引用另一个具名表达式，不是 Op 调用
  for (const v of Object.values(obj)) {
    const r = findOpCallViolation(v);
    if (r) return r;
  }
  return null;
}

/**
 * 注册一个具名表达式：先做 pure 校验，再委托 DefRegistry.register 做环检测与继承展开
 * （装载期例外，写入通道情形c）。
 */
export function registerExprDef(registry: DefRegistry, def: ExprDef): ReturnType<DefRegistry['register']> {
  const pureCheck = checkPure(def.body);
  if (!pureCheck.ok) {
    // pure 校验失败的本质是 body 出现了不允许的算子调用，复用 E_EXPR_UNKNOWN_OP
    // （design.md 4.3节 ErrCode taxonomy 未单列"purity violation"专用码，
    // 这是本实现的判断：语义上等价于"引用了一个在纯读表达式上下文中不合法的算子"）。
    return { ok: false, code: 'E_EXPR_UNKNOWN_OP', detail: pureCheck.detail };
  }
  return registry.register(def);
}

/**
 * PlaypackDef.overrides 替换具名表达式实现的接入点（需求13.5）。
 * overrides: Record<原 Id, 新 Id> —— resolveNamedExpr 的调用方应先查 overrides 表，
 * 命中则改为解析覆盖目标的 body，未命中则解析原 Id 本身。
 */
export function applyOverrides(overrides: Record<Id, Id> | undefined, id: Id): Id {
  return overrides?.[id] ?? id;
}
