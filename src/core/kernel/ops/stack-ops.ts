/**
 * L3 Ops: stack.split / stack.merge 原子性（design.md 3.4节 / 需求17.1-17.5）。
 * 单事务内"扣减-创建-放置"三步，任一步失败整体回滚（不落地不吞掉）。
 */
import type { OpImpl } from './registry.js';
import type { OpRegistry } from './registry.js';
import { ok, err } from './result.js';
import type { Id } from '../state/ids.js';
import { nextId } from '../state/ids.js';
import { setSlotHolds } from '../topology/container.js';
import type { ItemMoveArgs } from './structural-ops.js';

export interface StackSplitArgs {
  id: Id;
  n: number;
  toContainerId: Id;
  atSlot?: number;
}

export function makeStackSplit(itemMove: OpImpl<ItemMoveArgs, void>): OpImpl<StackSplitArgs, { $: Id }> {
  return (args, ctx) => {
    ctx.tx.begin();

    const draft = ctx.tx.getDraft();
    const source = draft.items[args.id];
    if (!source) {
      ctx.tx.rollback();
      return err('E_REF_MISSING', `Item ${args.id} 不存在`);
    }
    const currentStack = source.stack ?? 1;
    if (args.n <= 0 || args.n >= currentStack) {
      ctx.tx.rollback();
      return err('E_OP_INVALID_ARGS', `拆分数量 ${args.n} 非法（必须在 1..stack-1 之间）`);
    }

    // 步骤1：扣减原栈数量
    const nextSource = { ...source, stack: currentStack - args.n };
    ctx.tx.setDraft({ ...ctx.tx.getDraft(), items: { ...ctx.tx.getDraft().items, [args.id]: nextSource } });

    // 步骤2：创建新物品（同 DefId，携带拆出的数量）
    const newId = nextId('i');
    const newItem = { ...source, id: newId, stack: args.n, containers: {}, attachments: [] };
    const draftAfterCreate = ctx.tx.getDraft();
    ctx.tx.setDraft({ ...draftAfterCreate, items: { ...draftAfterCreate.items, [newId]: newItem } });

    // 步骤3：放入目标槎位（复用 item.move 的合法槎位选取逻辑）
    const moveResult = itemMove({ itemId: newId, toContainerId: args.toContainerId, atSlot: args.atSlot }, ctx);
    if (!moveResult.ok) {
      // 无合法槎位 → 整体回滚：原栈数量恢复、新物品不存在（需求17.2-17.3）
      ctx.tx.rollback();
      return moveResult;
    }

    ctx.tx.commit();
    ctx.tx.logOp('stack.split', args, () => {});
    return ok({ $: newId });
  };
}

export interface StackMergeArgs {
  fromId: Id;
  intoId: Id;
}

export const stackMerge: OpImpl<StackMergeArgs, void> = (args, ctx) => {
  ctx.tx.begin();
  const draft = ctx.tx.getDraft();
  const from = draft.items[args.fromId];
  const into = draft.items[args.intoId];
  if (!from || !into) {
    ctx.tx.rollback();
    return err('E_REF_MISSING', '合并的物品不存在');
  }
  if (from.def !== into.def) {
    ctx.tx.rollback();
    return err('E_OP_INVALID_ARGS', 'stack.merge 要求同一 DefId');
  }
  const fromStack = from.stack ?? 1;
  const intoStack = into.stack ?? 1;
  const maxStack = into.stackMax;
  const total = fromStack + intoStack;
  if (maxStack !== undefined && total > maxStack) {
    ctx.tx.rollback();
    return err('E_OP_INVALID_ARGS', `合并后数量 ${total} 超出 stackMax ${maxStack}`);
  }

  // 步骤1：目标数量增加
  let nextDraft = ctx.tx.getDraft();
  nextDraft = { ...nextDraft, items: { ...nextDraft.items, [args.intoId]: { ...into, stack: total } } };
  ctx.tx.setDraft(nextDraft);

  // 步骤2：清空来源在容器中的槎位占用
  let nextContainers = nextDraft.containers;
  for (const [cid, c] of Object.entries(nextDraft.containers)) {
    const idx = c.slots.findIndex((s) => s?.holds?.$ === args.fromId);
    if (idx !== -1) nextContainers = { ...nextContainers, [cid]: setSlotHolds(c, idx, undefined) };
  }
  nextDraft = { ...nextDraft, containers: nextContainers };
  ctx.tx.setDraft(nextDraft);

  // 步骤3：销毁来源物品
  const { [args.fromId]: _removed, ...restItems } = nextDraft.items;
  ctx.tx.setDraft({ ...nextDraft, items: restItems });

  ctx.tx.commit();
  ctx.tx.logOp('stack.merge', args, () => {});
  return ok(undefined);
};

export function registerStackOps(registry: OpRegistry, itemMove: OpImpl<ItemMoveArgs, void>): void {
  // structural:true 缺失修补，见 ops/structural-ops.ts 顶部同类说明与 决策与风险记录.md：
  // design.md 3.4节 Op 全集清单把 stack.split/stack.merge 列入结构类，此前漏标记。
  registry.register('stack.split', makeStackSplit(itemMove), { structural: true });
  registry.register('stack.merge', stackMerge, { structural: true });
}
