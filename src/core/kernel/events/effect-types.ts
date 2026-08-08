/**
 * Effect 结构类型（design.md 3.6节 / 需求22.1-22.6）。
 *
 * 物理层归属判断：Effect 被 RuleDef.effects（L4，本层）、ActionDef.effects（L6）、
 * AttachmentDef.onAdd/onExpire/onRemove（L8）、MigrationDef.effects（L12）等多处引用，
 * 但 L4 是这些引用者中最低的一层——L1-L3 没有任何结构引用 Effect。因此这个纯结构类型
 * （零运行时逻辑，只是判别联合）放在 kernel/events（L4）就足够满足单向 DAG：
 * L5（kernel/flow）的 FlowInterpreter 从这里 import 类型（L5 import L4，方向合法），
 * 不需要像 Expr/Query/ErrCode 那样下沉到 L1。
 */
import type { Expr } from '../state/expr-types.js';

export type Effect =
  | { readonly op: string; readonly args: Record<string, Expr>; readonly result?: string }
  | { readonly let: string; readonly be: Expr }
  | { readonly if: Expr; readonly then: Effect[]; readonly else?: Effect[] }
  | { readonly forEach: Expr; readonly as: string; readonly do: Effect[] }
  | { readonly while: Expr; readonly do: Effect[]; readonly maxIter: number }
  | { readonly emit: string; readonly data?: Expr }
  | { readonly after: Expr; readonly do: Effect[] }
  | { readonly at: Expr; readonly do: Effect[] }
  | { readonly try: Effect[]; readonly catch?: Effect[] }
  | { readonly abort: Expr };
