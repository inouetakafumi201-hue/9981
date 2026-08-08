/** Nested savepoint transaction with invariant-checked outer commit. */
import type { Result, WorldSnapshot } from './world.js';
import { err, type World } from './world.js';
import { checkAllInvariants } from './invariants.js';

export interface Violation {
  code: string;
  detail: string;
}

export class Transaction {
  private baseline: WorldSnapshot;
  private readonly savepoints: WorldSnapshot[] = [];
  private closed = false;

  constructor(private readonly world: World) {
    this.baseline = world.snapshot();
  }

  begin(): void {
    if (this.closed) throw new Error('Transaction is closed');
    this.savepoints.push(this.world.snapshot());
  }

  exec<T>(operation: (world: World, tx: Transaction) => Result<T>): Result<T> {
    if (this.closed) return err('E_TX_CLOSED', 'Transaction is closed');
    return operation(this.world, this);
  }

  /**
   * Releases an inner savepoint. With no savepoint, validates and commits the
   * complete transaction. This lets a sequence contain transient frozen cost.
   */
  commit(): Result<void> {
    if (this.closed) return err('E_TX_CLOSED', 'Transaction is closed');
    if (this.savepoints.length > 0) {
      this.savepoints.pop();
      return { ok: true, value: undefined };
    }

    const violations = checkAllInvariants(this.world);
    if (violations.length > 0) {
      this.world.restore(this.baseline);
      this.closed = true;
      return err(violations[0]!.code, violations[0]!.detail);
    }

    this.baseline = this.world.snapshot();
    this.closed = true;
    return { ok: true, value: undefined };
  }

  rollback(): void {
    if (this.closed) return;
    const target = this.savepoints.pop() ?? this.baseline;
    this.world.restore(target);
  }

  rollbackAll(): void {
    if (this.closed) return;
    this.world.restore(this.baseline);
    this.savepoints.length = 0;
    this.closed = true;
  }

  depth(): number {
    return this.savepoints.length;
  }
}
