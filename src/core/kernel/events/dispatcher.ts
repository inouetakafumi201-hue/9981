/**
 * L4 Events/Hooks: HookDispatcher（design.md 3.5节 / 需求23.1-23.10, 24.1-24.6）。
 *
 * 分层接线判断（记录于 决策与风险记录.md）：Hook 触发的 effects 需要被解释执行，但解释器
 * FlowInterpreter 属于 L5（高于 L4），HookDispatcher 不能反向 import 它。这里用依赖注入解决：
 * HookDispatcher 的构造依赖只声明"如何跑一段 Effect[]"的函数签名（EffectRunner），具体实现
 * （FlowInterpreter）由更高层的组合根（kernel/index.ts 或测试代码）注入，HookDispatcher 本身
 * 只依赖这个函数类型，不 import L5 的任何具体类。`when` 谓词的求值直接用 L2 的 ExprEngine
 * （L4 import L2 是向下依赖，合法）。
 *
 * modify 阶段改写 payload 的机制（design.md 未给出具体接线方式，属于本实现的判断）：
 * 把当前 payload 作为 vars.payload 传给 runEffects，effects 通过 {let:'payload', be:...} 产生
 * 新值，runEffects 返回更新后的 vars，HookDispatcher 读回 vars.payload 作为下一个候选看到的
 * payload，链式传递。
 *
 * after 阶段"以只读方式响应"（需求23.7）不是靠人工审查保证，而是机械约束：after 阶段的每个
 * 候选在一个嵌套事务保存点内执行，执行完毕后无条件 rollback，其对 WorldState 的任何写入都被
 * 丢弃——只有 ctx.emit 记录的事件（不经过 draft）会保留。这与内核"机械约束优于代码审查"的
 * 一贯手法一致（对应 readonly 字段、封闭算子表等既有机制）。
 */
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine.js';
import type { EvalContext } from '../expr/engine.js';
import type { Value } from '../state/value.js';
import type { Result } from '../ops/result.js';
import { ok } from '../ops/result.js';
import type { OpContext } from '../ops/registry.js';
import type { Effect } from './effect-types.js';
import type { RuleDef, DispatchResult, HookPhase } from './types.js';

export type EffectRunner = (
  effects: Effect[],
  ctx: OpContext,
  vars: Record<string, Value>,
  ruleId: string,
) => { result: Result<void>; vars: Record<string, Value> };

export interface HookCandidate {
  readonly rule: RuleDef;
  readonly hostContainerIndex?: number;
  readonly hostSlotIndex?: number;
}

export interface HookDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface HookDispatcherDeps {
  runEffects: EffectRunner;
  evalWhen?: (expression: RuleDef['when'], ctx: OpContext, vars: Record<string, Value>) => Value | null;
  onDiagnostic?: (d: HookDiagnostic) => void;
}

const DEFAULT_MAX_DEPTH = 32;

function nonInsteadSortKey(c: HookCandidate): [number, string] {
  return [c.rule.priority, c.rule.id];
}

function compareNonInstead(a: HookCandidate, b: HookCandidate): number {
  const [pa, ida] = nonInsteadSortKey(a);
  const [pb, idb] = nonInsteadSortKey(b);
  return pa !== pb ? pa - pb : ida.localeCompare(idb);
}

/** instead 阶段排序键：(priority, 宿主容器索引, 槎位索引, defId) 四元组（需求23.6）。 */
function compareInstead(a: HookCandidate, b: HookCandidate): number {
  if (a.rule.priority !== b.rule.priority) return a.rule.priority - b.rule.priority;
  const ca = a.hostContainerIndex ?? 0;
  const cb = b.hostContainerIndex ?? 0;
  if (ca !== cb) return ca - cb;
  const sa = a.hostSlotIndex ?? 0;
  const sb = b.hostSlotIndex ?? 0;
  if (sa !== sb) return sa - sb;
  return a.rule.id.localeCompare(b.rule.id);
}

export class HookDispatcher {
  private depth = 0;
  private readonly activeHooks = new Set<string>();
  private readonly exprEngine = new ExprEngine();

  constructor(
    private readonly deps: HookDispatcherDeps,
    private readonly maxDepth: number = DEFAULT_MAX_DEPTH,
  ) {}

  /** depth 在事务提交边界处重置（需求24.3），由 OpRegistry.invoke 在成功 commit 后调用。 */
  resetDepth(): void {
    this.depth = 0;
  }

  getDepth(): number {
    return this.depth;
  }

  dispatch(eventType: string, payload: Record<string, Value>, candidates: readonly HookCandidate[], ctx: OpContext): DispatchResult {
    if (this.depth >= this.maxDepth) {
      this.deps.onDiagnostic?.({ code: 'E_HOOK_DEPTH', message: `事件连锁深度超出上限 ${this.maxDepth}: ${eventType}` });
      return { cancelled: true, reason: 'E_HOOK_DEPTH', finalPayload: payload };
    }
    this.depth++;
    try {
      return this.dispatchInner(eventType, payload, candidates, ctx);
    } finally {
      this.depth--;
    }
  }

  private byPhase(candidates: readonly HookCandidate[], phase: HookPhase): HookCandidate[] {
    return candidates.filter((c) => c.rule.phase === phase);
  }

  private hookKey(eventType: string, ruleId: string): string {
    return `${eventType}::${ruleId}`;
  }

  /** 需求24.6：同一 (type, hookId) 组合下重入拒绝。返回 false 表示应跳过该候选。 */
  private tryEnter(eventType: string, ruleId: string): boolean {
    const key = this.hookKey(eventType, ruleId);
    if (this.activeHooks.has(key)) {
      this.deps.onDiagnostic?.({ code: 'E_HOOK_REENTRY', message: `Hook 重入被拒绝: ${key}` });
      return false;
    }
    this.activeHooks.add(key);
    return true;
  }

  private exit(eventType: string, ruleId: string): void {
    this.activeHooks.delete(this.hookKey(eventType, ruleId));
  }

  private evalWhen(rule: RuleDef, payload: Record<string, Value>, ctx: OpContext): boolean {
    // 注意：rule.when 是 Expr，字面量 false 是合法的 Expr 值（design.md 3.3节 Expr = Value | ...），
    // 不能用 falsy 检查判断"是否声明了 when"，否则 when:false 会被误当成"未声明 when"从而恒真放行。
    if (rule.when === undefined) return true;
    if (this.deps.evalWhen) return this.deps.evalWhen(rule.when, ctx, { payload }) === true;
    const evalCtx: EvalContext = makeDefaultEvalContext({
      vars: { payload },
      resolvePath: (path) => resolveFromDraft(ctx, path),
    });
    return this.exprEngine.eval(rule.when, evalCtx) === true;
  }

  /** 需求23.10：单条 Hook 内部异常只跳过该 Hook 并记录 warn，不中断整个 dispatch。 */
  private runOneSafely(rule: RuleDef, ctx: OpContext, payload: Record<string, Value>): { result: Result<void>; payload: Record<string, Value> } {
    try {
      const { result, vars } = this.deps.runEffects(rule.effects, ctx, { payload }, rule.id);
      const nextPayload = (vars['payload'] as Record<string, Value> | undefined) ?? payload;
      return { result, payload: nextPayload };
    } catch (e) {
      this.deps.onDiagnostic?.({ code: 'W_HOOK_INTERNAL_ERROR', message: `Hook ${rule.id} 内部异常: ${e instanceof Error ? e.message : String(e)}` });
      return { result: ok(undefined), payload };
    }
  }

  private dispatchInner(eventType: string, payload: Record<string, Value>, candidates: readonly HookCandidate[], ctx: OpContext): DispatchResult {
    let payloadCursor = payload;

    // ---- before：任一候选 veto 即整体取消（短路，因为外层事务未提交，写入天然被丢弃）----
    for (const cand of this.byPhase(candidates, 'before').sort(compareNonInstead)) {
      if (!this.tryEnter(eventType, cand.rule.id)) continue;
      try {
        if (!this.evalWhen(cand.rule, payloadCursor, ctx)) continue;
        const { result, payload: nextPayload } = this.runOneSafely(cand.rule, ctx, payloadCursor);
        payloadCursor = nextPayload;
        if (!result.ok) {
          return { cancelled: true, reason: result.detail, finalPayload: payloadCursor };
        }
      } finally {
        this.exit(eventType, cand.rule.id);
      }
    }

    // ---- modify：按优先级顺序改写 payload ----
    for (const cand of this.byPhase(candidates, 'modify').sort(compareNonInstead)) {
      if (!this.tryEnter(eventType, cand.rule.id)) continue;
      try {
        if (!this.evalWhen(cand.rule, payloadCursor, ctx)) continue;
        const { payload: nextPayload } = this.runOneSafely(cand.rule, ctx, payloadCursor);
        payloadCursor = nextPayload;
      } finally {
        this.exit(eventType, cand.rule.id);
      }
    }

    // ---- instead：取排序后第一个 when 通过者，其余不参与（需求23.6）----
    let insteadRan = false;
    for (const cand of this.byPhase(candidates, 'instead').sort(compareInstead)) {
      if (!this.evalWhen(cand.rule, payloadCursor, ctx)) continue;
      if (!this.tryEnter(eventType, cand.rule.id)) break; // 重入：视为无候选通过，转入 default
      try {
        const { payload: nextPayload } = this.runOneSafely(cand.rule, ctx, payloadCursor);
        payloadCursor = nextPayload;
        insteadRan = true;
      } finally {
        this.exit(eventType, cand.rule.id);
      }
      break; // 恰好一个候选执行，其余不参与
    }

    // ---- default：仅当没有 instead 候选通过时执行 ----
    if (!insteadRan) {
      for (const cand of this.byPhase(candidates, 'default').sort(compareNonInstead)) {
        if (!this.tryEnter(eventType, cand.rule.id)) continue;
        try {
          if (!this.evalWhen(cand.rule, payloadCursor, ctx)) continue;
          const { payload: nextPayload } = this.runOneSafely(cand.rule, ctx, payloadCursor);
          payloadCursor = nextPayload;
        } finally {
          this.exit(eventType, cand.rule.id);
        }
      }
    }

    // ---- after：只读响应，机械强制——嵌套保存点执行后无条件 rollback（需求23.7）----
    for (const cand of this.byPhase(candidates, 'after').sort(compareNonInstead)) {
      if (!this.tryEnter(eventType, cand.rule.id)) continue;
      try {
        if (!this.evalWhen(cand.rule, payloadCursor, ctx)) continue;
        ctx.tx.begin();
        try {
          this.runOneSafely(cand.rule, ctx, payloadCursor);
        } finally {
          ctx.tx.rollback();
        }
      } finally {
        this.exit(eventType, cand.rule.id);
      }
    }

    return { cancelled: false, finalPayload: payloadCursor };
  }
}

function resolveFromDraft(ctx: OpContext, path: string): Value | null {
  const parts = path.split('.');
  let cur: unknown = ctx.tx.getDraft();
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return (cur ?? null) as Value | null;
}
