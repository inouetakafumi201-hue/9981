/**
 * L6 Actions: 代价泛化三态生命周期（design.md 3.7节 / 需求26.1-26.6, 20.12, 16.1）。
 *
 * freezeCost/settleCost/refundCost 是私有 helper（写入通道情形b），只被 intent.submit/
 * intent.resolve/intent.void（L7）这三个 Op 的实现内部调用，不包成独立组件对外暴露公开方法。
 *
 * 需求26.1 要求支持四种 CostSpec：pool/items/attach/custom。四者的三态语义（design.md 3.7节）：
 * - pool：可提前冻结的连续数值资源。freeze 扣减 available，settle 扣减 real，refund 加回 available。
 *   数值双视图：`world.props.pools.${pool}.${scope}.available|real`（available 是"扣掉冻结后的可用"，
 *   real 是"真实余额"，二者的差 = 冻结中的额度）。
 * - items：消耗具体物品。freeze 只校验物品存在（不移除），settle 才通过 item.destroy 真正消耗，
 *   refund 无需回补（freeze 未移除）。
 * - attach：消耗一个 Attachment（如"充能"层）。freeze 校验其存在，settle 通过 attach.del 移除，
 *   refund 无需回补。
 * - custom：玩法包自定义代价，语义完全由其 Effect 决定。freeze 不动状态，settle 运行其 Effect，
 *   refund 无需回补（custom 若需回滚由其自身 Effect 表达）。
 *
 * 为什么 items/attach 是"校验存在，settle 才消耗"而不是"freeze 立即扣押"：物品与 Attachment 不像
 * pool 那样有"可用/真实"双视图可拆，立即移除再在失败时重建会丢失其 id 与挂在其上的 Attachment/
 * 关系（等价于销毁重造，破坏引用完整性）。延迟到 settle 消耗、失败则整个 intent.resolve 事务回滚，
 * 天然满足原子性且不产生悬空引用。
 */
import type { OpContext } from '../ops/registry';
import type { Result } from '../ops/result';
import { ok, err } from '../ops/result';
import type { CostSpec } from './types';
import type { Id, Ref } from '../state/ids';
import { isRef } from '../state/ids';
import type { Value } from '../state/value';
import type { Attachment } from '../state/attachment';
import type { Effect } from '../events/effect-types';
import { getPath, setPath } from '../ops/path';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import type { EvalContext } from '../expr/engine';

export type FrozenCostEntry =
  | { readonly kind: 'pool'; readonly pool: string; readonly scopeId: Id; readonly amount: number }
  | { readonly kind: 'items'; readonly itemIds: readonly Id[] }
  | { readonly kind: 'attach'; readonly attachmentId: Id }
  | { readonly kind: 'custom'; readonly effects: readonly Effect[] };

export interface Reservation {
  readonly entries: FrozenCostEntry[];
}

/** settle 阶段消耗 items/attach/custom 需要的能力：调用真实 Op（走级联/不变量）与运行 Effect。 */
export interface CostSettleDeps {
  invokeInline: (op: string, args: unknown, ctx: OpContext) => Result<unknown>;
  runEffects?: (effects: Effect[], ctx: OpContext, vars: Record<string, Value>) => Result<void>;
}

function poolPath(pool: string, scopeId: Id, field: 'available' | 'real'): string {
  return `world.props.pools.${pool}.${scopeId}.${field}`;
}

const exprEngine = new ExprEngine();

function evalCtxFor(ctx: OpContext, scopeRef: Ref, bindings: Record<string, Value>): EvalContext {
  return makeDefaultEvalContext({
    self: scopeRef,
    vars: { ...bindings, self: scopeRef, agent: scopeRef },
    resolvePath: (path) => getPath(ctx.tx.getDraft(), path),
  });
}

/** 把 items 代价表达式的求值结果归一化为物品 Id 列表：接受单个 Ref、Ref 数组或 Id 字符串数组。 */
function normalizeItemIds(value: Value | null): Id[] | null {
  if (value === null) return null;
  if (isRef(value)) return [value.$];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const ids: Id[] = [];
    for (const element of value) {
      if (isRef(element)) ids.push(element.$);
      else if (typeof element === 'string') ids.push(element);
      else return null;
    }
    return ids;
  }
  return null;
}

/**
 * freezeCost：按 CostSpec 类型冻结代价（需求26.2）。intent.submit 内部调用。
 * pool 立即扣减 available；items/attach 只校验存在性；custom 只登记待结算 Effect。
 * 任一类型不满足即返回 ok:false，整个 intent.submit 事务回滚，不产生部分冻结。
 */
export function freezeCost(
  scopeId: Id,
  costs: CostSpec[],
  ctx: OpContext,
  bindings: Record<string, Value> = {},
): Result<Reservation> {
  const entries: FrozenCostEntry[] = [];
  const scopeRef: Ref = { $: scopeId };
  let draft = ctx.tx.getDraft();

  for (const cost of costs) {
    if ('pool' in cost) {
      const amount = exprEngine.eval(cost.amount, evalCtxFor(ctx, scopeRef, bindings));
      if (typeof amount !== 'number') return err('E_COST_INSUFFICIENT', `代价数值求值失败: pool=${cost.pool}`);
      const availablePath = poolPath(cost.pool, scopeId, 'available');
      const current = getPath(draft, availablePath);
      const currentAvailable = typeof current === 'number' ? current : 0;
      if (currentAvailable < amount) {
        return err('E_COST_INSUFFICIENT', `pool ${cost.pool} 可用额度不足: 需要 ${amount}，现有 ${currentAvailable}`);
      }
      draft = setPath(draft, availablePath, currentAvailable - amount);
      ctx.tx.setDraft(draft);
      entries.push({ kind: 'pool', pool: cost.pool, scopeId, amount });
    } else if ('items' in cost) {
      const evaluated = exprEngine.eval(cost.items, evalCtxFor(ctx, scopeRef, bindings));
      const itemIds = normalizeItemIds(evaluated);
      if (itemIds === null) return err('E_COST_INSUFFICIENT', 'items 代价求值结果不是物品引用或引用列表');
      for (const itemId of itemIds) {
        if (!draft.items[itemId]) return err('E_COST_INSUFFICIENT', `items 代价引用的物品 ${itemId} 不存在`);
      }
      entries.push({ kind: 'items', itemIds });
    } else if ('attach' in cost) {
      const match = (Object.values(draft.world.attachments) as Attachment[])
        .filter((attachment) => attachment.def === cost.attach && attachment.target.$ === scopeId)
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (!match) return err('E_COST_INSUFFICIENT', `attach 代价要求的 Attachment ${cost.attach} 不存在于 ${scopeId}`);
      entries.push({ kind: 'attach', attachmentId: match.id });
    } else {
      // custom：freeze 不改状态，仅登记 settle 时要运行的 Effect（需求26.1 的 custom 形态）。
      entries.push({ kind: 'custom', effects: cost.custom });
    }
  }
  return ok({ entries });
}

/**
 * settleCost：解算成功时真正兑现代价（需求26.3）。intent.resolve 成功分支内部调用。
 * pool 扣减 real；items 通过 item.destroy 消耗；attach 通过 attach.del 移除；custom 运行其 Effect。
 * items/attach/custom 走真实 Op / Flow（deps），因此级联清理、不变量校验、Hook 分发一致生效；
 * 任一步失败即返回 ok:false，由外层 intent.resolve 事务整体回滚。
 */
export function settleCost(reservation: Reservation, ctx: OpContext, deps: CostSettleDeps): Result<void> {
  for (const entry of reservation.entries) {
    if (entry.kind === 'pool') {
      const realPath = poolPath(entry.pool, entry.scopeId, 'real');
      const current = getPath(ctx.tx.getDraft(), realPath);
      const currentReal = typeof current === 'number' ? current : 0;
      ctx.tx.setDraft(setPath(ctx.tx.getDraft(), realPath, currentReal - entry.amount));
      // available 已在 freeze 时扣减，settle 不再动 available：冻结期的差值在 real 同步扣减后归零。
    } else if (entry.kind === 'items') {
      for (const itemId of entry.itemIds) {
        const destroyed = deps.invokeInline('item.destroy', { id: itemId }, ctx);
        if (!destroyed.ok) return destroyed as Result<void>;
      }
    } else if (entry.kind === 'attach') {
      const removed = deps.invokeInline('attach.del', { id: entry.attachmentId }, ctx);
      if (!removed.ok) return removed as Result<void>;
    } else {
      if (entry.effects.length === 0) continue;
      if (!deps.runEffects) {
        return err('E_COST_INSUFFICIENT', 'custom 代价需要 runEffects 接线才能结算');
      }
      const ran = deps.runEffects([...entry.effects], ctx, {});
      if (!ran.ok) return ran;
    }
  }
  return ok(undefined);
}

/**
 * refundCost：前提失效时回退代价（需求26.4-26.5），发出 cost.refunded 诊断，intent.void 内部调用。
 * 只有 pool 需要把冻结的 available 加回；items/attach/custom 在 freeze 阶段未改状态，无需回补。
 * 无论涉及哪种类型都发出 cost.refunded 事件——不存在静默退回路径（需求26.6）。
 */
export function refundCost(reservation: Reservation, reason: string, ctx: OpContext, intentId?: Id): void {
  for (const entry of reservation.entries) {
    if (entry.kind !== 'pool') continue;
    const availablePath = poolPath(entry.pool, entry.scopeId, 'available');
    const current = getPath(ctx.tx.getDraft(), availablePath);
    const currentAvailable = typeof current === 'number' ? current : 0;
    ctx.tx.setDraft(setPath(ctx.tx.getDraft(), availablePath, currentAvailable + entry.amount));
  }
  ctx.emit('cost.refunded', {
    intentId: intentId ?? null,
    reason,
    entries: reservation.entries.map(summarizeEntry),
  });
}

function summarizeEntry(entry: FrozenCostEntry): Value {
  switch (entry.kind) {
    case 'pool':
      return { kind: 'pool', pool: entry.pool, scopeId: entry.scopeId, amount: entry.amount };
    case 'items':
      return { kind: 'items', itemIds: [...entry.itemIds] };
    case 'attach':
      return { kind: 'attach', attachmentId: entry.attachmentId };
    case 'custom':
      return { kind: 'custom', effectCount: entry.effects.length };
  }
}
