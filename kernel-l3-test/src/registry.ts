/** The sole runtime write gateway for L3 operations. */
import type { Result, World } from './world.js';
import { err } from './world.js';
import { Transaction } from './transaction.js';
import { stackAdjust, stackMerge, stackSplit, type StackAdjustArgs, type StackMergeArgs, type StackSplitArgs } from './ops/stack.js';
import { entityPlace, type EntityPlaceArgs } from './ops/entity.js';
import { freeze, resolve, voidFreeze, type FreezeArgs, type ResolveArgs, type VoidArgs } from './ops/cost.js';

export interface OpArgsMap {
  'stack.split': StackSplitArgs;
  'stack.merge': StackMergeArgs;
  'stack.adjust': StackAdjustArgs;
  'entity.place': EntityPlaceArgs;
  'cost.freeze': FreezeArgs;
  'cost.resolve': ResolveArgs;
  'cost.void': VoidArgs;
}

export interface OpResultMap {
  'stack.split': string;
  'stack.merge': void;
  'stack.adjust': void;
  'entity.place': void;
  'cost.freeze': void;
  'cost.resolve': void;
  'cost.void': void;
}

export type OpName = keyof OpArgsMap;

function dispatch<K extends OpName>(world: World, tx: Transaction, name: K, args: OpArgsMap[K]): Result<OpResultMap[K]> {
  switch (name) {
    case 'stack.split': return stackSplit(world, args as StackSplitArgs, tx) as Result<OpResultMap[K]>;
    case 'stack.merge': return stackMerge(world, args as StackMergeArgs, tx) as Result<OpResultMap[K]>;
    case 'stack.adjust': return stackAdjust(world, args as StackAdjustArgs, tx) as Result<OpResultMap[K]>;
    case 'entity.place': return entityPlace(world, args as EntityPlaceArgs, tx) as Result<OpResultMap[K]>;
    case 'cost.freeze': return freeze(world, args as FreezeArgs, tx) as Result<OpResultMap[K]>;
    case 'cost.resolve': return resolve(world, args as ResolveArgs, tx) as Result<OpResultMap[K]>;
    case 'cost.void': return voidFreeze(world, args as VoidArgs, tx) as Result<OpResultMap[K]>;
  }
}

export class OpTransaction {
  private done = false;

  constructor(private readonly world: World, private readonly tx: Transaction) {}

  invoke<K extends OpName>(name: K, args: OpArgsMap[K]): Result<OpResultMap[K]> {
    if (this.done) return err('E_TX_CLOSED', 'Transaction is closed');
    return this.tx.exec((world, tx) => dispatch(world, tx, name, args));
  }

  commit(): Result<void> {
    if (this.done) return err('E_TX_CLOSED', 'Transaction is closed');
    this.done = true;
    return this.tx.commit();
  }

  rollback(): void {
    if (this.done) return;
    this.done = true;
    this.tx.rollbackAll();
  }
}

export class OpRegistry {
  constructor(private readonly world: World) {}

  begin(): OpTransaction {
    return new OpTransaction(this.world, new Transaction(this.world));
  }

  invoke<K extends OpName>(name: K, args: OpArgsMap[K]): Result<OpResultMap[K]> {
    const transaction = this.begin();
    const result = transaction.invoke(name, args);
    if (!result.ok) {
      transaction.rollback();
      return result;
    }
    const committed = transaction.commit();
    return committed.ok ? result : committed;
  }
}
