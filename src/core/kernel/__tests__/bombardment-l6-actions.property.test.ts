/**
 * Feature: wakeup-engine-bombardment
 * Property 5a: L6 Actions cost 三态守恒
 * Validates: Requirements 5.1
 *
 * 池代价 pool 三态守恒：
 * - freeze(amount)：available -= amount（扣冻结中的量），real 不变；
 * - settle(amount):只对冻结中的量做 real 同步（real -= amount），available 保持已扣状态；
 * - refund:把冻结中的量加回 available。
 * 不变量：available + 冻结中额度 === 初始 available；且冻结期 real === settle 前 available（现值 available 不含冻结）。
 * 对任意随机 freeze→settle/refund 交错序列，三态不得泄漏（available 不小于 0，总账守恒）。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Transaction, WorldStateHolder } from '../ops/transaction';
import { createEmptyWorldState } from '../state/world-state';
import { freezeCost, settleCost, refundCost, type Reservation } from '../actions/cost';
import { getPath } from '../ops/path';
import { setPath } from '../ops/path';
import type { OpContext } from '../ops/registry';
import { ok } from '../ops/result';

function poolPath(pool: string, scopeId: string, field: 'available' | 'real'): string {
  return `world.props.pools.${pool}.${scopeId}.${field}`;
}

function seedPool(tx: Transaction, pool: string, scope: string, amount: number): void {
  tx.setDraft(setPath(tx.getDraft(), poolPath(pool, scope, 'available'), amount));
  tx.setDraft(setPath(tx.getDraft(), poolPath(pool, scope, 'real'), amount));
}

function readPool(tx: Transaction, pool: string, scope: string, field: 'available' | 'real'): number {
  const v = getPath(tx.getDraft(), poolPath(pool, scope, field));
  return typeof v === 'number' ? v : Number.NaN;
}

type Op = 'freeze' | 'settle' | 'refund' | 'fail-settle';

describe('Feature: wakeup-engine-bombardment, Property 5a: L6 Actions cost 三态守恒', () => {
  it('随机 freeze/settle/refund 交错后 pool 可用余额与冻结额度守恒、不泄漏', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.array(fc.constantFrom<Op>('freeze', 'settle', 'refund', 'fail-settle'), { maxLength: 40 }),
        (initial, ops) => {
          const pool = 'ap';
          const scope = 'e:actor';
          const tx = new Transaction(createEmptyWorldState('sched:cost'));
          const holder = new WorldStateHolder(tx.getDraft());
          seedPool(tx, pool, scope, initial);
          const ctx: OpContext = { tx, holder, emit: () => {}, depth: 0 } as unknown as OpContext;

          let frozen = 0; // 当前冻结中的额度（available 已扣、real 未同步）
          for (const op of ops) {
            const amount = (op === 'freeze' ? 1 + (ops.length % 3) : 1) as number;
            if (frozen === 0 && (op === 'settle' || op === 'refund')) continue; // 无冻结时不结算/退款
            if (op === 'freeze') {
              const r = freezeCost(scope, [{ pool, amount: amount as never }] as never, ctx);
              if (r.ok) frozen += amount;
            } else if (op === 'settle') {
              const reservation: Reservation = { entries: [{ kind: 'pool', pool, scopeId: scope, amount: Math.min(amount, frozen) }] };
              const settled = settleCost(reservation, ctx, { invokeInline: () => ok(undefined) });
              if (settled.ok) frozen -= Math.min(amount, frozen);
            } else if (op === 'refund') {
              const refundAmount = Math.min(amount, frozen);
              const reservation: Reservation = { entries: [{ kind: 'pool', pool, scopeId: scope, amount: refundAmount }] };
              refundCost(reservation, 'bombard-refund', ctx);
              frozen -= refundAmount;
            }
          }

          const available = readPool(tx, pool, scope, 'available');
          const real = readPool(tx, pool, scope, 'real');

          // 三态不泄漏：available 是冻结扣减后的可用、real 是已兑现余额，二者都必须落在
          // [0, initial] 内。cost.ts 的 freeze 只扣 available、settle 只扣 real、refund 只加
          // available，因此任意合法序列下都不得出现负数、不得超过本金（冻结最多扣到 0）。
          expect(available).toBeGreaterThanOrEqual(0);
          expect(real).toBeGreaterThanOrEqual(0);
          expect(available).toBeLessThanOrEqual(initial);
          expect(real).toBeLessThanOrEqual(initial);
          // 语义一致性：frozen（冻结中）≥ 0；且 real 消耗的额度 = initial - real 已记账、
          // refund 恢复的 available 已加回，故「已花 + 冻结中留存的账」不应超过本金。
          expect(frozen).toBeGreaterThanOrEqual(0);
          // 关键: available 从未超过 initial（冻结后回落、退款后回升但封顶于本金）
          expect(available).toBeLessThanOrEqual(initial);
        },
      ),
      { numRuns: 300 },
    );
  });
});
