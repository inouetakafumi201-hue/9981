/** Atomic entity.place with node/slot mutual exclusion. */
import type { Result, World } from '../world.js';
import { err, ok } from '../world.js';
import type { Transaction } from '../transaction.js';

export type EntityPlaceArgs =
  | { entityId: string; targetNodeId: string; targetSlotId?: never }
  | { entityId: string; targetNodeId?: never; targetSlotId: string };

export function entityPlace(world: World, args: EntityPlaceArgs, tx: Transaction): Result<void> {
  const entity = world.entities.get(args.entityId);
  if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);

  const targetNode = args.targetNodeId ? world.nodes.get(args.targetNodeId) : undefined;
  const targetSlot = args.targetSlotId ? world.findSlot(args.targetSlotId) : null;
  if (args.targetNodeId && !targetNode) return err('E_REF_MISSING', `Node ${args.targetNodeId} 不存在`);
  if (args.targetSlotId && !targetSlot) return err('E_REF_MISSING', `Slot ${args.targetSlotId} 不存在`);
  if (targetSlot?.holds && targetSlot.holds.id !== entity.id) return err('E_OP_SLOT_FULL', `Slot ${targetSlot.id} 已占用`);
  if (targetSlot?.accepts && !targetSlot.accepts.has(entity.def)) {
    return err('E_OP_SLOT_REJECT', `Slot ${targetSlot.id} 不接受 ${entity.def}`);
  }

  tx.begin();
  try {
    if (entity.node) world.nodes.get(entity.node)?.entities.delete(entity.id);
    if (entity.slot) {
      const oldSlot = world.findSlot(entity.slot);
      if (oldSlot?.holds?.id === entity.id) oldSlot.holds = null;
    }
    entity.node = undefined;
    entity.slot = undefined;

    if (targetNode) {
      entity.node = targetNode.id;
      targetNode.entities.add(entity.id);
    } else if (targetSlot) {
      entity.slot = targetSlot.id;
      targetSlot.holds = entity;
    }

    tx.commit();
    return ok(undefined);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}
