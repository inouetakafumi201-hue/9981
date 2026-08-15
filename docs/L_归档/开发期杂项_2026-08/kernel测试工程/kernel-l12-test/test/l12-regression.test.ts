/**
 * L12 缺陷回归测试。
 *
 * 每条对应一个 2026-08-07 实测确认的产品缺陷。原 18 项测试全绿的同时
 * 这些缺陷全部存在——因为原套件的判据不覆盖它们所在的位置。
 * 保留这些用例的意义是：它们的失败信息直接说明"哪条契约被破坏了"。
 */
import { describe, it, expect } from 'vitest';
import {
  takeSnapshot,
  SnapshotStore,
  resetSnapshotCounter,
  CheckpointStore,
  PhaseBoundaryLog,
  replay,
  cloneState,
  type WorldState,
  type Op,
} from '../src/persistence';
import { loadSnapshot, MIG_CODES, type MigrationDef } from '../src/migration';

function state(version = '1.0.0'): WorldState {
  return { version, playpackId: 'pp:1', phaseIndex: 0, props: { hp: 10 }, randomCounter: 0 };
}

/** 原地修改并返回同一引用的 Op：别名缺陷的探针。 */
const impure: Op = {
  id: 'impure',
  apply: (s) => {
    s.props['hp'] = (s.props['hp'] ?? 0) - 1;
    return s;
  },
};

describe('BUG L12#1：takeSnapshot 必须深拷贝', () => {
  it('快照不与活状态共享引用', () => {
    const live = state();
    const snap = takeSnapshot(live);
    expect(snap.state).not.toBe(live);
    expect(snap.state.props).not.toBe(live.props);
  });

  it('活状态被原地修改后快照仍是拍摄时的值', () => {
    const live = state();
    const snap = takeSnapshot(live);
    live.props['hp'] = 999;
    live.phaseIndex = 7;
    expect(snap.state.props['hp']).toBe(10);
    expect(snap.state.phaseIndex).toBe(0);
  });
});

describe('BUG L12#2：CheckpointStore 存入与取出都要拷贝', () => {
  it('存入后修改活状态不污染检查点', () => {
    const store = new CheckpointStore();
    const live = state();
    store.checkpoint('c1', live);
    live.props['hp'] = 1;
    expect(store.restore('c1').props['hp']).toBe(10);
  });

  it('修改 restore 返回值不污染检查点，两次 restore 互相独立', () => {
    const store = new CheckpointStore();
    store.checkpoint('c1', state());
    const a = store.restore('c1');
    const b = store.restore('c1');
    expect(a).not.toBe(b);
    a.props['hp'] = -1;
    expect(store.restore('c1').props['hp']).toBe(10);
    expect(b.props['hp']).toBe(10);
  });
});

describe('BUG L12#3：PhaseBoundaryLog 边界快照必须冻结', () => {
  it('markBoundary 后修改活状态不改变历史', () => {
    const log = new PhaseBoundaryLog();
    const live = state();
    log.markBoundary(live);
    log.markBoundary(state());
    live.props['hp'] = 2;
    expect(log.rewind(1).props['hp']).toBe(10);
  });

  it('修改 rewind 返回值不污染历史', () => {
    const log = new PhaseBoundaryLog();
    log.markBoundary(state());
    log.markBoundary(state());
    const w = log.rewind(1);
    w.props['hp'] = 777;
    expect(log.rewind(1).props['hp']).toBe(10);
  });
});

describe('BUG L12#4：快照编号必须是实例态', () => {
  it('两个 SnapshotStore 各自从 1 开始，互不共享编号', () => {
    const a = new SnapshotStore();
    const b = new SnapshotStore();
    expect(a.take(state()).id).toBe('snap:1');
    expect(a.take(state()).id).toBe('snap:2');
    expect(b.take(state()).id).toBe('snap:1');
    expect(a.count()).toBe(2);
    expect(b.count()).toBe(1);
  });

  it('默认发号器可重置，测试之间不互相污染', () => {
    resetSnapshotCounter();
    expect(takeSnapshot(state()).id).toBe('snap:1');
    resetSnapshotCounter();
    expect(takeSnapshot(state()).id).toBe('snap:1');
  });

  it('createdAt 与编号一致，可用于排序', () => {
    const s = new SnapshotStore();
    const s1 = s.take(state());
    const s2 = s.take(state());
    expect(s2.createdAt).toBeGreaterThan(s1.createdAt);
  });
});

describe('BUG L12#5：loadSnapshot 同版本分支也必须克隆', () => {
  it('版本相同时返回的状态不与入参共享引用', () => {
    const saved = state('2.0.0');
    const result = loadSnapshot(saved, '2.0.0', []);
    expect(result.ok).toBe(true);
    expect(result.state).not.toBe(saved);
    expect(result.state!.props).not.toBe(saved.props);
    result.state!.props['hp'] = 0;
    expect(saved.props['hp']).toBe(10);
  });
});

describe('BUG L12#6：bestEffort 跳过必须留下诊断', () => {
  it('跳过的迁移产生 W_MIG_SKIPPED', () => {
    const migrations: MigrationDef[] = [{
      id: 'm1', from: '1.0.0', to: '2.0.0',
      effects: [{ apply: () => { throw new Error('boom'); } }],
      onFail: 'bestEffort',
    }];
    const result = loadSnapshot(state('1.0.0'), '2.0.0', migrations);
    expect(result.diagnostics.map((d) => d.code)).toContain(MIG_CODES.SKIPPED);
    expect(result.diagnostics.find((d) => d.code === MIG_CODES.SKIPPED)!.detail).toContain('m1');
  });

  it('中间跳被跳过但链仍抵达目标版本时，ok 为真且诊断保留跳过记录', () => {
    const migrations: MigrationDef[] = [
      {
        id: 'm1', from: '1.0.0', to: '1.5.0',
        effects: [{ apply: () => { throw new Error('boom'); } }],
        onFail: 'bestEffort',
      },
      {
        id: 'm2', from: '1.0.0', to: '2.0.0',
        effects: [{ apply: (s) => ({ ...s, props: { ...s.props, done: 1 } }) }],
        onFail: 'reject',
      },
    ];
    const result = loadSnapshot(state('1.0.0'), '2.0.0', migrations);
    // 最短路是 m2 单跳，m1 不在链上，故无跳过记录且直达目标
    expect(result.ok).toBe(true);
    expect(result.state!.version).toBe('2.0.0');
    expect(result.diagnostics).toEqual([]);
  });
});

describe('BUG L12#7：畸形版本号必须在比较前被拒', () => {
  it('存档版本畸形时报 E_MIG_BAD_VERSION，不当作 0.0.0', () => {
    for (const bad of ['abc', '1.0', '1.0.0.0', '', 'v1.0.0', '1.0.x', ' 1.0.0']) {
      const result = loadSnapshot(state(bad), '1.0.0', []);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.BAD_VERSION]);
      expect(result.diagnostics[0]!.detail).toContain('saved');
    }
  });

  it('目标版本畸形时同样被拒，并指明是 current', () => {
    const result = loadSnapshot(state('1.0.0'), 'nope', []);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.BAD_VERSION]);
    expect(result.diagnostics[0]!.detail).toContain('current');
  });

  it('畸形版本不得进入迁移分支：任何 effect 都不许被调用', () => {
    let called = false;
    const migrations: MigrationDef[] = [{
      id: 'm1', from: '0.0.0', to: '1.0.0',
      effects: [{ apply: (s) => { called = true; return s; } }],
      onFail: 'reject',
    }];
    loadSnapshot(state('abc'), '1.0.0', migrations);
    expect(called).toBe(false);
  });
});

describe('BUG L12#8：未达目标版本不得报成功', () => {
  it('全链被跳过时 ok=false 并报 E_MIG_INCOMPLETE', () => {
    const migrations: MigrationDef[] = [{
      id: 'm1', from: '1.0.0', to: '2.0.0',
      effects: [{ apply: () => { throw new Error('boom'); } }],
      onFail: 'bestEffort',
    }];
    const result = loadSnapshot(state('1.0.0'), '2.0.0', migrations);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      MIG_CODES.SKIPPED,
      MIG_CODES.INCOMPLETE,
    ]);
    // 仍交出状态供诊断，但版本明确停在 1.0.0
    expect(result.state!.version).toBe('1.0.0');
  });

  it('末跳被跳过时同样报 INCOMPLETE，而非把状态标成新版本', () => {
    const migrations: MigrationDef[] = [
      {
        id: 'm1', from: '1.0.0', to: '1.5.0',
        effects: [{ apply: (s) => ({ ...s, props: { ...s.props, step: 1 } }) }],
        onFail: 'reject',
      },
      {
        id: 'm2', from: '1.5.0', to: '2.0.0',
        effects: [{ apply: () => { throw new Error('boom'); } }],
        onFail: 'bestEffort',
      },
    ];
    const result = loadSnapshot(state('1.0.0'), '2.0.0', migrations);
    expect(result.ok).toBe(false);
    expect(result.state!.version).toBe('1.5.0');
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      MIG_CODES.SKIPPED,
      MIG_CODES.INCOMPLETE,
    ]);
  });
});

describe('BUG L12#9：replay 必须先克隆 seed', () => {
  it('不纯 Op 不得改动调用方的 seed', () => {
    const seed = state();
    const out = replay(seed, [impure]);
    expect(seed.props['hp']).toBe(10);
    expect(out.props['hp']).toBe(9);
    expect(out).not.toBe(seed);
  });

  it('同一 seed 连续两次 replay 结果相同——不纯 Op 下才有内容', () => {
    const seed = state();
    const r1 = replay(seed, [impure]);
    const r2 = replay(seed, [impure]);
    expect(r1.props['hp']).toBe(9);
    expect(r2.props['hp']).toBe(9);
    expect(seed.props['hp']).toBe(10);
  });

  it('空 Op 序列也返回副本而非 seed 本身', () => {
    const seed = state();
    const out = replay(seed, []);
    expect(out).not.toBe(seed);
    expect(out.props).not.toBe(seed.props);
    expect(cloneState(seed).props['hp']).toBe(10);
  });
});
