/** Cost freeze / resolve / void lifecycle. */
import type { Result, World } from '../world.js';
import { err, ok } from '../world.js';
import type { Transaction } from '../transaction.js';

export interface FreezeArgs {
  entityId: string;
  resources: Record<string, number>;
}

export interface ResolveArgs {
  entityId: string;
}

export interface VoidArgs {
  entityId: string;
}

export function freeze(world: World, args: FreezeArgs, tx: Transaction): Result<void> {
  const entity = world.entities.get(args.entityId);
  if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);
  for (const [key, amount] of Object.entries(args.resources)) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5) {
      return err('E_OP_INVALID_AMOUNT', `${key}=${amount}; expected a value in [1, 5]`);
    }
    const available = (entity.attr[key] ?? 0) - (entity.frozenResources.get(key) ?? 0);
    if (available < amount) return err('E_COST_INSUFFICIENT', `${key}: need=${amount}, available=${available}`);
  }

  tx.begin();
  try {
    for (const [key, amount] of Object.entries(args.resources)) {
      entity.frozenResources.set(key, (entity.frozenResources.get(key) ?? 0) + amount);
    }
    tx.commit();
    return ok(undefined);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}

export function resolve(world: World, args: ResolveArgs, tx: Transaction): Result<void> {
  const entity = world.entities.get(args.entityId);
  if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);

  tx.begin();
  try {
    for (const [key, amount] of entity.frozenResources) {
      const current = entity.attr[key] ?? 0;
      if (current < amount) {
        tx.rollback();
        return err('E_COST_FROZEN_GONE', `${key}: frozen=${amount}, current=${current}`);
      }
      entity.attr[key] = current - amount;
    }
    entity.frozenResources.clear();
    tx.commit();
    return ok(undefined);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}

export function voidFreeze(world: World, args: VoidArgs, tx: Transaction): Result<void> {
  const entity = world.entities.get(args.entityId);
  if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);

  tx.begin();
  try {
    entity.frozenResources.clear();
    tx.commit();
    return ok(undefined);
  } catch (cause) {
    tx.rollback();
    return err('E_OP_INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}
