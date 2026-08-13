/**
 * L7 Intent Ops: intent.submit / intent.resolve / intent.void / intent.reveal
 * (design.md 3.8 / requirements 25.1-25.7, 26.1-26.6, Property 9, 10)
 *
 * These are public Ops registered in OpRegistry. They call
 * freezeCost/settleCost/refundCost from L6 actions/cost.ts.
 */
import type { OpImpl, OpRegistry } from '../ops/registry.js';
import { ok, err } from '../ops/result.js';
import type { Result } from '../ops/result.js';
import type { Id, Ref } from '../state/ids.js';
import { nextId } from '../state/ids.js';
import type { Value } from '../state/value.js';
import type { IntentState } from '../state/world-state.js';
import { freezeCost, settleCost, refundCost } from '../actions/cost.js';
import type { Reservation, FrozenCostEntry, CostSettleDeps } from '../actions/cost.js';
import type { Effect } from '../events/effect-types.js';
import type { ActionDef } from '../actions/types.js';
import type { Def } from '../state/def.js';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine.js';
import type { Expr } from '../state/expr-types.js';
import type { OpContext } from '../ops/registry.js';
import { checkInstantiable } from '../ops/def-guard.js';

export type IntentSubmitArgs = {
  action: Id;
  agent: Id;
  bindings: Record<string, Value>;
  priority?: number;
  hidden?: boolean;
};
export type IntentResolveArgs = { id: Id };
export type IntentVoidArgs = { id: Id; reason: string };
export type IntentRevealArgs = { id: Id };
export type IntentResolveBatchArgs = { ids?: Id[]; scheduleId?: Id };

export interface IntentOpsDeps {
  defLookup: (id: Id) => Def | null;
  now: () => number;
  /** 由组合根接入 FlowInterpreter，使 ActionDef.effects 在 Intent 事务内执行。 */
  runEffects?: (
    effects: ActionDef['effects'],
    ctx: OpContext,
    vars: Record<string, Value>,
  ) => Result<void>;
}

function deserializeReservation(v: Value | undefined): Reservation | null {
  if (v === null || v === undefined) return { entries: [] };
  if (typeof v !== 'object' || Array.isArray(v) || '$' in (v as object)) return null;
  const rec = v as Record<string, Value>;
  const entriesRaw = rec['entries'];
  if (!Array.isArray(entriesRaw)) return { entries: [] };
  const entries: FrozenCostEntry[] = [];
  for (const e of entriesRaw) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
    const entry = e as Record<string, Value>;
    const kind = entry['kind'];
    if (kind === 'pool') {
      if (typeof entry['pool'] !== 'string' || typeof entry['scopeId'] !== 'string' || typeof entry['amount'] !== 'number') return null;
      entries.push({ kind: 'pool', pool: entry['pool'], scopeId: entry['scopeId'], amount: entry['amount'] });
    } else if (kind === 'items') {
      const ids = entry['itemIds'];
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
      entries.push({ kind: 'items', itemIds: ids as string[] });
    } else if (kind === 'attach') {
      if (typeof entry['attachmentId'] !== 'string') return null;
      entries.push({ kind: 'attach', attachmentId: entry['attachmentId'] });
    } else if (kind === 'custom') {
      const effects = entry['effects'];
      if (!Array.isArray(effects)) return null;
      entries.push({ kind: 'custom', effects: effects as unknown as Effect[] });
    } else {
      return null;
    }
  }
  return { entries };
}

function serializeReservation(res: Reservation): Value {
  return {
    entries: res.entries.map((e): Value => {
      switch (e.kind) {
        case 'pool':
          return { kind: 'pool', pool: e.pool, scopeId: e.scopeId, amount: e.amount };
        case 'items':
          return { kind: 'items', itemIds: [...e.itemIds] };
        case 'attach':
          return { kind: 'attach', attachmentId: e.attachmentId };
        case 'custom':
          return { kind: 'custom', effects: e.effects as unknown as Value };
      }
    }),
  };
}

const exprEngine = new ExprEngine();

function evalRequire(action: ActionDef, bindings: Record<string, Value>, ctx: OpContext, agentId?: Id): boolean {
  if (action.require === undefined || action.require === null) return true;
  const agentRef = agentId ? { $: agentId } : undefined;
  const evalCtx = makeDefaultEvalContext({
    self: agentRef,
    vars: agentRef ? { ...bindings, self: agentRef, agent: agentRef } : bindings,
    resolvePath: (path) => {
      const parts = path.split('.');
      let cur: unknown = ctx.tx.getDraft();
      for (const part of parts) {
        if (cur === null || typeof cur !== 'object') return null;
        cur = (cur as Record<string, unknown>)[part];
      }
      return (cur ?? null) as Value | null;
    },
    resolveRefValue: (ref, path) => {
      const state = ctx.tx.getDraft();
      const root: unknown = state.world.agents[ref.$]
        ?? state.entities[ref.$]
        ?? state.items[ref.$]
        ?? state.nodes[ref.$]
        ?? state.links[ref.$]
        ?? state.world.attachments[ref.$];
      let current = root;
      for (const part of path.split('.')) {
        if (current === null || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[part];
      }
      return (current ?? null) as Value | null;
    },
  });
  return exprEngine.eval(action.require, evalCtx) === true;
}

function makeIntentSubmit(deps: IntentOpsDeps): OpImpl<IntentSubmitArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable(deps.defLookup, args.action, 'action');
    if (!guard.ok) return guard;
    const action = guard.value as ActionDef;

    if (!evalRequire(action, args.bindings, ctx, args.agent)) {
      return err('E_OP_NOT_ACCEPTED', `action ${args.action} require condition not met`);
    }

    const costs = action.cost ?? [];
    // 把 action bindings 传入代价求值：items 代价（"消耗被选中的物品"）与带绑定的 pool 数量
    // 都需要引用 bindings，否则这些形态无法表达（此前 freezeCost 不收 bindings 是一处隐性缺口）。
    const freezeResult = freezeCost(args.agent, costs, ctx, args.bindings);
    if (!freezeResult.ok) return freezeResult;

    const id = nextId('g');
    const intent: IntentState = {
      id,
      agent: args.agent,
      action: args.action,
      bindings: args.bindings,
      submittedAt: deps.now(),
      priority: args.priority,
      hidden: args.hidden ?? false,
      status: 'pending',
      reservation: serializeReservation(freezeResult.value),
    };

    const draft = ctx.tx.getDraft();
    ctx.tx.setDraft({ ...draft, world: { ...draft.world, intents: { ...draft.world.intents, [id]: intent } } });
    ctx.tx.logOp('intent.submit', args, () => {});
    return ok({ $: id });
  };
}

function makeIntentResolve(deps: IntentOpsDeps, settleDeps: CostSettleDeps): OpImpl<IntentResolveArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const intent = draft.world.intents[args.id];
    if (!intent) return err('E_REF_MISSING', `Intent ${args.id} not found`);
    if (intent.status !== 'pending') return err('E_OP_NOT_ACCEPTED', `Intent ${args.id} status is not pending`);

    const def = deps.defLookup(intent.action);
    if (!def || def.kind !== 'action') return err('E_REF_MISSING', `ActionDef ${intent.action} not found`);
    const action = def as ActionDef;

    const requireOk = evalRequire(action, intent.bindings, ctx, intent.agent);
    const reservation = deserializeReservation(intent.reservation);

    if (!requireOk) {
      if (reservation) refundCost(reservation, 'require condition failed before resolution', ctx, intent.id);
      const updated: IntentState = { ...intent, status: 'void' };
      const d = ctx.tx.getDraft();
      ctx.tx.setDraft({ ...d, world: { ...d.world, intents: { ...d.world.intents, [args.id]: updated } } });
      ctx.tx.logOp('intent.resolve', args, () => {});
      return ok(undefined);
    }

    if (reservation) {
      const settleResult = settleCost(reservation, ctx, settleDeps);
      if (!settleResult.ok) return settleResult;
    }

    if (deps.runEffects && action.effects.length > 0) {
      const effectResult = deps.runEffects(action.effects, ctx, {
        ...intent.bindings,
        self: { $: intent.agent },
        agent: { $: intent.agent },
        intent: { $: intent.id },
      });
      if (!effectResult.ok) return effectResult;
    }

    const updated: IntentState = { ...intent, status: 'resolved' };
    const d = ctx.tx.getDraft();
    ctx.tx.setDraft({ ...d, world: { ...d.world, intents: { ...d.world.intents, [args.id]: updated } } });
    ctx.tx.logOp('intent.resolve', args, () => {});
    return ok(undefined);
  };
}

function makeIntentVoid(_deps: IntentOpsDeps): OpImpl<IntentVoidArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const intent = draft.world.intents[args.id];
    if (!intent) return err('E_REF_MISSING', `Intent ${args.id} not found`);
    if (intent.status !== 'pending') return err('E_OP_NOT_ACCEPTED', `Intent ${args.id} status is not pending`);

    const reservation = deserializeReservation(intent.reservation);
    if (reservation) refundCost(reservation, args.reason, ctx, intent.id);

    const updated: IntentState = { ...intent, status: 'void' };
    const d = ctx.tx.getDraft();
    ctx.tx.setDraft({ ...d, world: { ...d.world, intents: { ...d.world.intents, [args.id]: updated } } });
    ctx.tx.logOp('intent.void', args, () => {});
    return ok(undefined);
  };
}

const intentReveal: OpImpl<IntentRevealArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const intent = draft.world.intents[args.id];
  if (!intent) return err('E_REF_MISSING', `Intent ${args.id} not found`);
  if (!intent.hidden) return ok(undefined);
  const updated: IntentState = { ...intent, hidden: false };
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, intents: { ...draft.world.intents, [args.id]: updated } } });
  ctx.tx.logOp('intent.reveal', args, () => {});
  return ok(undefined);
};

/**
 * 批量解算 Intent，按 ScheduleDef.resolveOrder 表达式排序（需求29.6-29.7）。
 * 每个 Intent 在当前事务的嵌套事务中解算（使用 invokeInline），依序执行。
 */
function makeIntentResolveBatch(deps: IntentOpsDeps, registry: OpRegistry): OpImpl<IntentResolveBatchArgs, void> {
  const exprEngine = new ExprEngine();
  
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    
    // 获取待解算的 Intent 列表
    let pendingIds: Id[];
    if (args.ids) {
      pendingIds = args.ids;
    } else {
      // 未指定 ids 时，解算所有 pending 状态的 Intent
      pendingIds = Object.values(draft.world.intents)
        .filter(intent => intent && intent.status === 'pending')
        .map(intent => intent.id);
    }

    if (pendingIds.length === 0) {
      return ok(undefined);
    }

    // 获取 ScheduleDef 以读取 resolveOrder
    const scheduleId = args.scheduleId ?? draft.world.turn.scheduleId;
    const scheduleDef = deps.defLookup(scheduleId);
    
    let sortedIds = [...pendingIds];
    
    if (scheduleDef && scheduleDef.kind === 'schedule') {
      const schedule = scheduleDef as { resolveOrder?: unknown };
      const resolveOrder = schedule.resolveOrder;
      
      if (resolveOrder && typeof resolveOrder === 'object' && resolveOrder !== null) {
        // 对每个 Intent 求值 resolveOrder 表达式
        const priorities: Array<{ id: Id; priority: number }> = [];
        const orderExpr = resolveOrder as Expr;
        
        for (const intentId of pendingIds) {
          const intent = draft.world.intents[intentId];
          if (!intent) continue;
          
          // 构造求值上下文：self = agent, intent = intent ref
          const evalCtx = makeDefaultEvalContext({
            self: { $: intent.agent },
            vars: {
              ...intent.bindings,
              self: { $: intent.agent },
              agent: { $: intent.agent },
              intent: { $: intentId },
              priority: intent.priority ?? 0,
            },
            // resolveOrder 是 Expr，走 eval 通道（需求12.1 全函数）：缺跳路时按
            // makeDefaultEvalContext 的 resolvePath 兜底返回 null，由调用方回退 priority。
            resolvePath: (path) => {
              const parts = path.split('.');
              let cur: unknown = draft;
              for (const part of parts) {
                if (cur === null || typeof cur !== 'object') return null;
                cur = (cur as Record<string, unknown>)[part];
              }
              return (cur ?? null) as Value | null;
            },
          });
          
          const priorityValue = exprEngine.eval(orderExpr, evalCtx);
          const priority = typeof priorityValue === 'number' ? priorityValue : (intent.priority ?? 0);
          priorities.push({ id: intentId, priority });
        }
        
        // 按 priority 降序排序（高优先级先解算）
        priorities.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          // priority 相同时按 id 字典序（确定性）
          return a.id.localeCompare(b.id);
        });
        
        sortedIds = priorities.map(p => p.id);
      } else if (pendingIds.length > 1) {
        // 未指定 resolveOrder 但有多个 Intent 时，按提交时间排序
        const withTime = pendingIds.map(id => ({
          id,
          submittedAt: draft.world.intents[id]?.submittedAt ?? 0,
          priority: draft.world.intents[id]?.priority ?? 0,
        }));
        withTime.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          if (a.submittedAt !== b.submittedAt) return a.submittedAt - b.submittedAt;
          return a.id.localeCompare(b.id);
        });
        sortedIds = withTime.map(w => w.id);
      }
    }

    // 依序解算每个 Intent（每个在嵌套事务中）
    // 使用 invokeInline 保持在当前事务内，避免独立提交
    for (const intentId of sortedIds) {
      const resolveResult = registry.invokeInline('intent.resolve', { id: intentId }, ctx);
      // 解算失败不影响后续 Intent（可能因 require 重检失败而 void，这是正常行为）
      if (!resolveResult.ok && resolveResult.code !== 'E_OP_NOT_ACCEPTED') {
        // 只有非预期错误（非 void 转换）才中断批量解算
        return resolveResult;
      }
    }

    ctx.tx.logOp('intent.resolveBatch', args, () => {});
    return ok(undefined);
  };
}

export function registerIntentOps(registry: OpRegistry, deps: IntentOpsDeps): void {
  // settle 阶段的 items/attach 消耗走真实 Op（item.destroy / attach.del）以获得级联与不变量校验，
  // custom 走注入的 runEffects——都在 intent.resolve 的同一事务内，失败即整体回滚。
  const settleDeps: CostSettleDeps = {
    invokeInline: (op, opArgs, ctx) => registry.invokeInline(op, opArgs, ctx),
    runEffects: deps.runEffects
      ? (effects, ctx, vars) => deps.runEffects!(effects as ActionDef['effects'], ctx, vars)
      : undefined,
  };
  registry.register('intent.submit', makeIntentSubmit(deps), { structural: true });
  registry.register('intent.resolve', makeIntentResolve(deps, settleDeps), { structural: true });
  registry.register('intent.void', makeIntentVoid(deps), { structural: true });
  registry.register('intent.reveal', intentReveal, { structural: true });
  registry.register('intent.resolveBatch', makeIntentResolveBatch(deps, registry), { structural: true });
}
