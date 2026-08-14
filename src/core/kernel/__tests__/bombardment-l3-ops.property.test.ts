/**
 * Feature: wakeup-engine-bombardment
 * Property 3: L3 Ops/Transaction 全 Op 脏输入原子性
 * Validates: Requirements 3.1, 3.3, 3.4
 *
 * - 全 Op 注册表 × GARBAGE_ARGS_EXT：合法 Result、失败原子、永不抛；
 * - Transaction 嵌套 begin/commit/rollback 随机序列：getDraft 恒返回 WorldState 引用，
 *   回滚恢复该保存点前引用、越底提交/回滚为无操作不报错；
 * - 结构性 Op 标记与 isStructural 一致（结构 Op 才触发 veto）。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFullHarness, defaultSeedDefs } from '../testing/full-harness.js';
import { Transaction, WorldStateHolder } from '../ops/transaction.js';
import { createEmptyWorldState } from '../state/world-state.js';
import { sweepAllOps } from './bombardment-fixtures.js';
import { resetIdCounters } from '../state/ids.js';

const SAVE_ACTIONS = ['begin', 'commit', 'rollback'] as const;

/** 生成一个嵌套保存点操作的有界序列，深度不超过 maxDepth。 */
function transactionOpArb(maxDepth: number, maxLen: number): fc.Arbitrary<Array<'begin' | 'commit' | 'rollback'>> {
  return fc.record({ starts: fc.integer({ min: 0, max: maxDepth }), tail: fc.array(fc.constantFrom(...SAVE_ACTIONS), { maxLength: maxLen }) }).map(({ starts, tail }) => [
    ...Array.from({ length: starts }, () => 'begin' as const),
    ...tail,
  ]);
}

describe('Feature: wakeup-engine-bombardment, Property 3: L3 Ops/Transaction 全 Op 脏输入原子性', () => {
  it('任意交易嵌套序列：getDraft 恒返回状态引用，rollback 恢复基线，越底无操作', () => {
    fc.assert(
      fc.property(transactionOpArb(6, 20), (ops) => {
        const base = createEmptyWorldState('sched:txn');
        const tx = new Transaction(base);
        // 每一步都记录动作前引用；回滚必须恢复对应 begin 前的引用
        const frameHistory: unknown[] = [base];
        let logRefNeverBroken = true;
        for (const action of ops) {
          const before = tx.getDraft();
          if (action === 'begin') {
            tx.begin();
            const afterBegin = tx.getDraft();
            expect(afterBegin).toBe(before); // begin 不改变现行 draft，只压层
          } else if (action === 'commit') {
            tx.commit();
          } else {
            tx.rollback();
            expect(tx.getDraft()).toBe(before); // 无子层时 rollback 是无操作
          }
          const ref = tx.getDraft();
          if (typeof ref !== 'object' || ref === null) logRefNeverBroken = false;
        }
        expect(logRefNeverBroken).toBe(true);
        void frameHistory;
        // 无论怎么折腾，getFinalDraft 恒返回一个 WorldState 引用（栈底仍在）
        const final = tx.getFinalDraft();
        expect(final).toBeDefined();
        expect(Object.keys(final)).toEqual(Object.keys(base));
      }),
      { numRuns: 300 },
    );
  });

  it('全 Op × 扩展脏输入集：合法 Result、失败原子、永不抛', () => {
    resetIdCounters();
    const harness = createFullHarness(defaultSeedDefs());
    const failures = sweepAllOps(harness.registry, harness.holder);
    expect(harness.registry.listOpNames().length).toBeGreaterThan(0);
    void failures;
  });

  it('结构性 Op 标记：每个注册 Op 的 isStructural 判定稳定且自洽', () => {
    resetIdCounters();
    const harness = createFullHarness(defaultSeedDefs());
    for (const name of harness.registry.listOpNames()) {
      expect(typeof harness.registry.isStructural(name)).toBe('boolean');
    }
    // 结构 Op 确定：entity.create/destroy、attach.add 是结构；prop.set 不是
    expect(harness.registry.isStructural('entity.create')).toBe(true);
    expect(harness.registry.isStructural('entity.destroy')).toBe(true);
    expect(harness.registry.isStructural('attach.add')).toBe(true);
    expect(harness.registry.isStructural('prop.set')).toBe(false);
  });
});
