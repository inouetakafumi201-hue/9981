/**
 * L12 Persistence tests: Property 18 (snapshot immutability), Property 28 (migration atomicity).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  takeSnapshot,
  Journal,
  replay,
  InMemoryCheckpointStore,
  applyMigration,
  compareVersions,
  LogStore,
} from '../persistence.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { setPath } from '../../ops/path.js';

describe('L12 snapshot: Property 18 (immutability)', () => {
  it('takeSnapshot 返回的状态与原状态引用相同（结构共享）', () => {
    const state = createEmptyWorldState('sched:1');
    const snap = takeSnapshot(state, 'initial');
    expect(snap.state).toBe(state); // structural sharing
  });

  it('Property 18: 快照后修改原状态不影响快照', () => {
    let state = createEmptyWorldState('sched:1');
    const snap = takeSnapshot(state);
    // "Modify" by producing a new state (immutable pattern)
    state = setPath(state, 'world.props.x', 999);
    // Snapshot should still have original state
    const snapX = (snap.state.world.props as Record<string, unknown>)['x'];
    expect(snapX).toBeUndefined();
  });

  it('Property 18 属性测试：任意状态修改后快照不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        (val) => {
          let state = createEmptyWorldState('sched:1');
          const snap = takeSnapshot(state);
          state = setPath(state, 'world.props.counter', val);
          expect((snap.state.world.props as Record<string, unknown>)['counter']).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('每次 takeSnapshot 生成唯一 id', () => {
    const state = createEmptyWorldState('sched:1');
    const s1 = takeSnapshot(state);
    const s2 = takeSnapshot(state);
    expect(s1.id).not.toBe(s2.id);
  });
});

describe('L12 Journal: append / since / trim', () => {
  it('Journal.append 记录 Op 条目', () => {
    const journal = new Journal();
    journal.append([{ op: 'prop.set', args: { path: 'x', value: 1 }, inverse: () => {} }]);
    expect(journal.getAll()).toHaveLength(1);
    expect(journal.getAll()[0]!.op).toBe('prop.set');
  });

  it('Journal.since 只返回 seq > n 的记录', () => {
    const journal = new Journal();
    journal.append([
      { op: 'a', args: {}, inverse: () => {} },
      { op: 'b', args: {}, inverse: () => {} },
      { op: 'c', args: {}, inverse: () => {} },
    ]);
    const since2 = journal.since(2);
    expect(since2).toHaveLength(1);
    expect(since2[0]!.op).toBe('c');
  });

  it('Journal.trim 保留最后 N 条记录', () => {
    const journal = new Journal();
    for (let i = 0; i < 10; i++) {
      journal.append([{ op: `op:${i}`, args: {}, inverse: () => {} }]);
    }
    journal.trim(3);
    expect(journal.getAll()).toHaveLength(3);
  });
});

describe('L12 replay', () => {
  it('replay 按顺序调用 invoke', () => {
    const journal = new Journal();
    journal.append([
      { op: 'op:1', args: { x: 1 }, inverse: () => {} },
      { op: 'op:2', args: { x: 2 }, inverse: () => {} },
    ]);
    const invoked: string[] = [];
    const count = replay(journal.getAll(), {
      invoke: (op, _args) => { invoked.push(op); return { ok: true }; },
    });
    expect(count).toBe(2);
    expect(invoked).toEqual(['op:1', 'op:2']);
  });
});

describe('L12 CheckpointStore: checkpoint / restore / rewind', () => {
  it('checkpoint 保存状态，restore 恢复', () => {
    const store = new InMemoryCheckpointStore();
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.props.hp', 100);
    store.checkpoint('before-battle', state);
    const restored = store.restore('before-battle');
    expect(restored).not.toBeNull();
    const hp = (restored!.world.props as Record<string, unknown>)['hp'];
    expect(hp).toBe(100);
  });

  it('restore 不存在的 checkpoint 返回 null', () => {
    const store = new InMemoryCheckpointStore();
    expect(store.restore('ghost')).toBeNull();
  });

  it('list 按创建顺序返回 checkpoint 名称', () => {
    const store = new InMemoryCheckpointStore();
    const state = createEmptyWorldState('sched:1');
    store.checkpoint('c1', state);
    store.checkpoint('c2', state);
    store.checkpoint('c3', state);
    expect(store.list()).toEqual(['c1', 'c2', 'c3']);
  });

  it('remove 删除指定 checkpoint', () => {
    const store = new InMemoryCheckpointStore();
    const state = createEmptyWorldState('sched:1');
    store.checkpoint('c1', state);
    store.remove('c1');
    expect(store.restore('c1')).toBeNull();
  });
});

describe('L12 MigrationDef: Property 28 (migration atomicity)', () => {
  it('applyMigration 成功时返回 ok:true 与新状态', () => {
    const state = createEmptyWorldState('sched:1');
    const result = applyMigration(state, {
      id: 'mig:1',
      fromVersion: '1.0',
      toVersion: '2.0',
      transform: (s) => setPath(s, 'world.props.migrated', true),
    });
    expect(result.ok).toBe(true);
    const migrated = (result.state!.world.props as Record<string, unknown>)['migrated'];
    expect(migrated).toBe(true);
  });

  it('Property 28: transform 抛异常时返回 ok:false，原状态不变', () => {
    const state = createEmptyWorldState('sched:1');
    const result = applyMigration(state, {
      id: 'mig:bad',
      fromVersion: '1.0',
      toVersion: '2.0',
      transform: () => { throw new Error('migration failed'); },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('migration failed');
  });

  it('Property 28 属性测试：失败迁移不修改原状态', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
        let state = createEmptyWorldState('sched:1');
        state = setPath(state, 'world.props.val', n);
        const result = applyMigration(state, {
          id: 'mig:fail',
          fromVersion: '1.0',
          toVersion: '2.0',
          transform: () => { throw new Error('fail'); },
        });
        expect(result.ok).toBe(false);
        // State parameter is unchanged (we can check by re-reading)
        const val = (state.world.props as Record<string, unknown>)['val'];
        expect(val).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});

describe('L12 compareVersions', () => {
  it('compareVersions 正确比较版本号', () => {
    expect(compareVersions('1.0', '2.0')).toBeLessThan(0);
    expect(compareVersions('2.0', '1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2.1', '2.0.99')).toBeGreaterThan(0);
  });
});

describe('L12 LogStore: logRetention', () => {
  it('LogStore 追加并查询日志', () => {
    const store = new LogStore(100);
    store.append('player.moved', { x: 1, y: 2 });
    store.append('entity.created', { id: 'e:1' });
    expect(store.getAll()).toHaveLength(2);
  });

  it('LogStore 达到 maxCapacity 时丢弃最旧条目（环形缓冲）', () => {
    const store = new LogStore(3);
    store.append('a', {});
    store.append('b', {});
    store.append('c', {});
    store.append('d', {}); // exceeds capacity
    expect(store.getAll()).toHaveLength(3);
    expect(store.getAll()[0]!.type).toBe('b');
  });
});

describe('L12 property tests: rewind / journal / checkpoint invariants', () => {
  it('rewind 多次调用返回相同状态（幂等性）', () => {
    const store = new InMemoryCheckpointStore();
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.props.rewind_test', 42);
    store.checkpoint('branch-a', state);

    const r1 = store.restore('branch-a');
    const r2 = store.restore('branch-a');
    const r3 = store.restore('branch-a');
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();
    expect((r1!.world.props as Record<string, unknown>)['rewind_test']).toBe(42);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('Property: rewind 幂等性（随机状态多次恢复一致）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (val) => {
        const store = new InMemoryCheckpointStore();
        let state = createEmptyWorldState('sched:1');
        state = setPath(state, 'world.props.rand', val);
        store.checkpoint('cp', state);

        const r1 = store.restore('cp');
        const r2 = store.restore('cp');
        expect(r1).not.toBeNull();
        expect(r2).not.toBeNull();
        expect((r1!.world.props as Record<string, unknown>)['rand']).toBe(val);
        expect(r1).toEqual(r2);
      }),
      { numRuns: 100 },
    );
  });

  it('Property: Journal.trim 任意 N 保留最后 N 条（截断正确性）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10 }),
        (appendCount, keepLast) => {
          const journal = new Journal();
          for (let i = 0; i < appendCount; i++) {
            journal.append([{ op: `op:${i}`, args: {}, inverse: () => {} }]);
          }
          if (appendCount > 0) journal.trim(keepLast);
          const all = journal.getAll();
          if (appendCount === 0) {
            expect(all).toHaveLength(0);
          } else if (keepLast === 0) {
            expect(all).toHaveLength(0);
          } else if (appendCount <= keepLast) {
            expect(all).toHaveLength(appendCount);
          } else {
            expect(all).toHaveLength(keepLast);
            // The first remaining entry should be the (appendCount - keepLast)-th entry
            expect(all[0]!.op).toBe(`op:${appendCount - keepLast}`);
            // The last remaining entry should be the (appendCount-1)-th entry
            expect(all[all.length - 1]!.op).toBe(`op:${appendCount - 1}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Journal.since(0) 返回全部记录', () => {
    const journal = new Journal();
    journal.append([
      { op: 'a', args: {}, inverse: () => {} },
      { op: 'b', args: {}, inverse: () => {} },
    ]);
    const all = journal.since(0);
    expect(all).toHaveLength(2);
  });

  it('Journal.since(负数) 返回全部记录', () => {
    const journal = new Journal();
    journal.append([{ op: 'x', args: {}, inverse: () => {} }]);
    expect(journal.since(-999)).toHaveLength(1);
  });

  it('Journal.clear 重置状态', () => {
    const journal = new Journal();
    journal.append([{ op: 'a', args: {}, inverse: () => {} }]);
    journal.clear();
    expect(journal.getAll()).toHaveLength(0);
    expect(journal.since(0)).toHaveLength(0);
  });

  it('CheckpointStore.remove 对不存在的 checkpoint 无害', () => {
    const store = new InMemoryCheckpointStore();
    store.remove('ghost'); // should not throw
    store.remove('ghost'); // idempotent
    expect(store.list()).toHaveLength(0);
  });

  it('CheckpointStore.list 在空状态下返回空数组', () => {
    const store = new InMemoryCheckpointStore();
    expect(store.list()).toEqual([]);
  });

  it('Property: checkpoint 多次同名覆盖后 restore 结果一致', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (val) => {
        const store = new InMemoryCheckpointStore();
        let state1 = createEmptyWorldState('sched:1');
        state1 = setPath(state1, 'world.props.val', val);
        let state2 = createEmptyWorldState('sched:1');
        state2 = setPath(state2, 'world.props.val', val + 999);

        store.checkpoint('same-name', state1);
        store.checkpoint('same-name', state2); // overwrite

        const restored = store.restore('same-name');
        expect(restored).not.toBeNull();
        expect((restored!.world.props as Record<string, unknown>)['val']).toBe(val + 999);
      }),
      { numRuns: 100 },
    );
  });

  it('Property: replay 在部分 Op 失败时返回成功计数', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        (failAt) => {
          const journal = new Journal();
          const seqs: number[] = [];
          journal.append([{ op: 'op:0', args: {}, inverse: () => {} }]);
          journal.append([{ op: 'op:1', args: {}, inverse: () => {} }]);
          journal.append([{ op: 'op:2', args: {}, inverse: () => {} }]);
          const records = journal.getAll();
          for (const r of records) seqs.push(r.seq);

          let count = 0;
          const result = replay(records, {
            invoke: (_op, _args) => {
              count++;
              // Fail at the specified position
              if (count - 1 === failAt) return { ok: false };
              return { ok: true };
            },
          });

          // If failAt is beyond the count, all succeed
          if (failAt >= records.length) {
            expect(result).toBe(records.length);
          } else {
            expect(result).toBe(records.length - 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('LogStore query 方法正确过滤', () => {
    const store = new LogStore(100);
    store.append('attack', { damage: 10 });
    store.append('heal', { amount: 5 });
    store.append('attack', { damage: 20 });

    const attacks = store.query((e) => e.type === 'attack');
    expect(attacks).toHaveLength(2);
    expect(attacks[0]!.type).toBe('attack');
    expect(attacks[1]!.type).toBe('attack');
  });

  it('Property: LogStore 环形缓冲在大容量时保持最新条目', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (capacity) => {
        const store = new LogStore(capacity);
        const N = capacity * 2;
        for (let i = 0; i < N; i++) {
          store.append(`type:${i}`, { index: i });
        }
        const entries = store.getAll();
        expect(entries).toHaveLength(capacity);
        // The oldest entry should be index = N - capacity (first entry after wrap)
        expect(entries[0]!.payload['index']).toBe(N - capacity);
      }),
      { numRuns: 50 },
    );
  });
});
