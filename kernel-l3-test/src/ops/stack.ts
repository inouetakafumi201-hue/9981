/** Atomic stack.split / stack.merge / stack.adjust operations. */
import type { Result, World } from '../world.js';
import { err, ok } from '../world.js';
import type { Transaction } from '../transaction.js';

export interface StackSplitArgs {
  sourceId: string;
  amount: number;
  targetContainerId: string;
}

export interface StackMergeArgs {
  sourceId: string;
  targetId: string;
}

export interface StackAdjustArgs {
  itemId: string;
  delta: number;
}

export function stackSplit(world: World, args: StackSplitArgs, tx: Transaction): Result<string> {
  const source = world.items.get(args.sourceId);
  const target = world.containers.get(args.targetContainerId);
  if (!source) return err('E_REF_MISSING', `Item ${args.sourceId} 不存在`);
  if (!target) return err('E_REF_MISSING', `Container ${args.targetContainerId} 不存在`);
  if (!Number.isInteger(args.amount) || args.amount <= 0 || args.amount > source.stack) {
    return err('E_OP_INVALID_AMOUNT', `amount=${args.amount}, stack=${source.stack}`);
  }
  const def = world.getDef(source.def);
  if (!def) return err('E_REF_MISSING', `Def ${source.def} 不存在`);
  if (args.amount > def.stackMax) return err('E_OP_STACK_OVERFLOW', `stack=${args.amount}, max=${def.stackMax}`);
  const slot = world.findEmptySlot(target);
  if (!slot) return err('E_OP_NO_LEGAL_SLOT', `Container ${target.id} 无合法空槽位`);

  tx.begin();
  try {
    source.stack -= args.amount;
    const created = world.createItem({ def: source.def, stack: args.amount });
    created.slot = slot.id;
    slot.holds = created;
    if (source.stack === 0) world.destroyItem(source);
    tx.commit();
    return ok(created.id);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}

export function stackMerge(world: World, args: StackMergeArgs, tx: Transaction): Result<void> {
  const source = world.items.get(args.sourceId);
  const target = world.items.get(args.targetId);
  if (!source || !target) return err('E_REF_MISSING', '合并物品不存在');
  if (source.id === target.id) return err('E_OP_INVALID_ARGS', '不能将物品合并到自身');
  if (source.def !== target.def) return err('E_OP_DEF_MISMATCH', `${source.def} != ${target.def}`);
  const def = world.getDef(source.def);
  if (!def) return err('E_REF_MISSING', `Def ${source.def} 不存在`);
  const total = source.stack + target.stack;
  if (total > def.stackMax) return err('E_OP_STACK_OVERFLOW', `stack=${total}, max=${def.stackMax}`);

  tx.begin();
  try {
    target.stack = total;
    world.destroyItem(source);
    tx.commit();
    return ok(undefined);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}

export function stackAdjust(world: World, args: StackAdjustArgs, tx: Transaction): Result<void> {
  const item = world.items.get(args.itemId);
  if (!item) return err('E_REF_MISSING', `Item ${args.itemId} 不存在`);
  if (!Number.isInteger(args.delta)) return err('E_OP_INVALID_AMOUNT', `delta=${args.delta}`);
  const def = world.getDef(item.def);
  if (!def) return err('E_REF_MISSING', `Def ${item.def} 不存在`);
  const next = item.stack + args.delta;
  if (next > def.stackMax) return err('E_OP_STACK_OVERFLOW', `stack=${next}, max=${def.stackMax}`);

  tx.begin();
  try {
    if (next <= 0) world.destroyItem(item);
    else item.stack = next;
    tx.commit();
    return ok(undefined);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}
