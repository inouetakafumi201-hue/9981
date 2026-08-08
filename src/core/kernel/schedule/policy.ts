/**
 * L9 PolicyDef: three modes (rules/search/scripted) (design.md 3.10节 / 需求34.1-34.7).
 * search mode delegates to an injected SearchPolicyResolver (the AI search bridge, backed by the
 * L12 checkpoint/restore machinery). This module keeps no dependency on any decision subsystem.
 */
import type { Id } from '../state/ids.js';
import type { Expr } from '../state/expr-types.js';
import type { Def } from '../state/def.js';
import type { Effect } from '../events/effect-types.js';

export interface PolicyRuleEntry {
  readonly condition: Expr;
  readonly action: Id;
  readonly priority?: number;
}

export interface PolicyDef extends Def {
  readonly kind: 'policy';
  readonly mode: 'rules' | 'search' | 'scripted';
  /** mode:'rules' — list of condition/action pairs evaluated in priority order */
  readonly policyRules?: PolicyRuleEntry[];
  /** mode:'search' — max branching depth; bounded exploration via checkpoint/restore. */
  readonly searchDepth?: number;
  readonly searchGoal?: Expr;
  /** mode:'scripted' — explicit effect sequence */
  readonly script?: Effect[];
  /** 转向策略（需求34.1/34.6）：本策略得不出合法着法（且搜索超预算）时改用它。可链式，环会被守卫。 */
  readonly fallback?: Id;
}

/** decide 的结果：选出一个着法、给出一段脚本，或什么都得不出（null）。 */
export type PolicyDecision =
  | { readonly kind: 'action'; readonly action: Id; readonly policy: Id }
  | { readonly kind: 'script'; readonly script: Effect[]; readonly policy: Id }
  | null;

/** decide 需要的注入能力：解析 fallback 策略 Id、求值 rules 条件、以及 search 上下文。 */
export interface PolicyDecideDeps {
  resolvePolicy: (id: Id) => PolicyDef | null;
  evalCondition: (cond: Expr) => boolean;
  ctx: PolicyEvalContext;
}

/** Optional checkpoint/restore hook a search resolver may use to explore then backtrack (L12). */
export type CheckpointRestoreHook = {
  checkpoint: () => unknown;
  restore: (snap: unknown) => void;
};

export interface PolicyEvalContext {
  state: unknown;
  agentId: Id;
  checkpointRestore?: CheckpointRestoreHook;
}

/**
 * PolicyEvaluator: evaluates a PolicyDef given current world state.
 * In rules mode: returns first rule whose condition is true (highest priority).
 * In scripted mode: returns the script for execution.
 * In search mode: delegates to the injected SearchPolicyResolver (proposes nothing if none injected).
 */
/**
 * Resolver for mode:'search' policies. The composition root supplies it (the AI
 * search bridge is one implementation) so this module needs no dependency on
 * any particular decision subsystem. A search policy only ever proposes an
 * action id; it never executes effects itself.
 */
export type SearchPolicyResolver = (def: PolicyDef, ctx: PolicyEvalContext) => Id | null;

export class PolicyEvaluator {
  constructor(private readonly searchResolver?: SearchPolicyResolver) {}

  evalMode(def: PolicyDef, _ctx: PolicyEvalContext): string {
    return def.mode;
  }

  /**
   * Get the action to take based on rules mode.
   * Returns the actionId of the first rule whose condition evaluates to true.
   * Rules sorted by priority (highest first).
   */
  evalRules(def: PolicyDef, evalCondition: (cond: Expr) => boolean): Id | null {
    if (def.mode !== 'rules' || !def.policyRules) return null;
    const sorted = [...def.policyRules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const rule of sorted) {
      if (evalCondition(rule.condition)) return rule.action;
    }
    return null;
  }

  /**
   * Scripted mode: return the script.
   */
  getScript(def: PolicyDef): Effect[] {
    if (def.mode !== 'scripted') return [];
    return def.script ?? [];
  }

  /**
   * Search mode: delegates to the injected resolver, which performs bounded
   * exploration through checkpoint/restore and the canonical action lifecycle.
   * Without a resolver the policy proposes nothing rather than guessing.
   */
  evalSearch(def: PolicyDef, ctx: PolicyEvalContext): Id | null {
    if (def.mode !== 'search') return null;
    if (this.searchResolver === undefined) return null;
    return this.searchResolver(def, ctx);
  }

  /** @deprecated Use {@link evalSearch}; retained so existing callers keep compiling. */
  searchPlaceholder(def: PolicyDef, ctx: PolicyEvalContext): Id | null {
    return this.evalSearch(def, ctx);
  }

  /**
   * 顶层决策入口（需求34.6）：按 mode 求本策略的结果；得不出合法着法（rules/search 返回 null，
   * 或 scripted 脚本为空）时，转向 `fallback` 指定的策略继续尝试。fallback 链用 visited 集合守卫环，
   * 遇到环或链尽头仍无结果则返回 null（NPC 本回合无动作，交由回合推进兜底，不卡死——需求34.7）。
   */
  decide(def: PolicyDef, deps: PolicyDecideDeps): PolicyDecision {
    const visited = new Set<Id>();
    let current: PolicyDef | null = def;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.mode === 'rules') {
        const action = this.evalRules(current, deps.evalCondition);
        if (action !== null) return { kind: 'action', action, policy: current.id };
      } else if (current.mode === 'search') {
        const action = this.evalSearch(current, deps.ctx);
        if (action !== null) return { kind: 'action', action, policy: current.id };
      } else if (current.mode === 'scripted') {
        const script = this.getScript(current);
        if (script.length > 0) return { kind: 'script', script, policy: current.id };
      }
      // 本策略无结果 → 转 fallback（需求34.6）
      current = current.fallback !== undefined ? deps.resolvePolicy(current.fallback) : null;
    }
    return null;
  }
}
