/**
 * L12 自检器的损坏注入测试。
 *
 * 为什么必须有这一层：`expect(store.checkInvariants()).toEqual([])` 在
 * 一个恒返回 `[]` 的自检器上同样全绿。不主动破坏内部状态，就无法区分
 * "不变量成立"与"自检器什么都没查"。
 *
 * 手法：用 Guts 断言穿透 private，逐条破坏，断言对应违规被报出来。
 * 每条注入都必须只破坏一个不变量，否则无法定位是哪条判据在起作用。
 */
import { describe, it, expect } from 'vitest';
import {
  Journal,
  CheckpointStore,
  PhaseBoundaryLog,
  SnapshotStore,
  checkWorldState,
  isWellFormedVersion,
  VERSION_PATTERN,
  type WorldState,
  type JournalEntry,
} from '../src/persistence';

/** 内部结构的最小暴露面，仅测试使用。 */
interface JournalGuts { records: JournalEntry[]; seq: number }
interface CheckpointGuts { checkpoints: Map<string, WorldState>; order: string[] }
interface BoundaryGuts { snapshots: WorldState[] }
interface SnapshotGuts { counter: number }

const guts = <T>(o: unknown): T => o as T;

function good(version = '1.0.0'): WorldState {
  return { version, playpackId: 'pp:1', phaseIndex: 0, props: { a: 1 }, randomCounter: 0 };
}

const noopOp = { id: 'noop', apply: (s: WorldState) => s };

describe('checkWorldState 的判据逐条有效', () => {
  it('良构状态无违规', () => {
    expect(checkWorldState(good())).toEqual([]);
  });

  const cases: Array<[string, Partial<Record<keyof WorldState, unknown>>, RegExp]> = [
    ['version 非三段', { version: '1.0' }, /version 非法/],
    ['version 含非数字', { version: '1.0.x' }, /version 非法/],
    ['version 为空', { version: '' }, /version 非法/],
    ['version 非字符串', { version: 100 }, /version 非法/],
    ['playpackId 为空串', { playpackId: '' }, /playpackId 非法/],
    ['playpackId 非字符串', { playpackId: null }, /playpackId 非法/],
    ['phaseIndex 为负', { phaseIndex: -1 }, /phaseIndex 必须为非负整数/],
    ['phaseIndex 非整数', { phaseIndex: 1.5 }, /phaseIndex 必须为非负整数/],
    ['phaseIndex 为 NaN', { phaseIndex: NaN }, /phaseIndex 必须为非负整数/],
    ['randomCounter 为负', { randomCounter: -3 }, /randomCounter 必须为非负整数/],
    ['randomCounter 非整数', { randomCounter: 0.5 }, /randomCounter 必须为非负整数/],
    ['props 为 null', { props: null }, /props 必须为对象/],
    ['props 非对象', { props: 7 }, /props 必须为对象/],
  ];

  for (const [name, patch, pattern] of cases) {
    it(`注入「${name}」必须被报出`, () => {
      const s = { ...good(), ...patch } as unknown as WorldState;
      const violations = checkWorldState(s);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => pattern.test(v))).toBe(true);
    });
  }

  it('注入 props 内非有限数必须被报出（NaN / Infinity / 字符串）', () => {
    for (const bad of [NaN, Infinity, -Infinity, '3', null, {}]) {
      const s = { ...good(), props: { a: 1, bad } } as unknown as WorldState;
      const violations = checkWorldState(s);
      expect(violations.some((v) => /props\["bad"\] 必须为有限数/.test(v))).toBe(true);
    }
  });

  it('多重损坏一次全部报出，而非只报第一条', () => {
    const s = { version: '?', playpackId: '', phaseIndex: -1, randomCounter: -1, props: { a: NaN } } as unknown as WorldState;
    expect(checkWorldState(s).length).toBe(5);
  });

  it('where 参数进入违规描述，便于定位是哪份状态坏了', () => {
    const v = checkWorldState({ ...good(), phaseIndex: -1 }, '检查点["c1"]');
    expect(v[0]).toContain('检查点["c1"]');
  });
});

describe('版本判据本身有效', () => {
  it('接受三段十进制，拒绝其余形状', () => {
    for (const ok of ['0.0.0', '1.2.3', '10.20.30', '01.0.0']) {
      expect(isWellFormedVersion(ok)).toBe(true);
    }
    for (const bad of ['1.0', '1.0.0.0', '', 'v1.0.0', '1.0.x', ' 1.0.0', '1.0.0 ', '-1.0.0', '1..0']) {
      expect(isWellFormedVersion(bad)).toBe(false);
    }
  });

  it('正则带首尾锚，不接受子串命中', () => {
    expect(VERSION_PATTERN.source.startsWith('^')).toBe(true);
    expect(VERSION_PATTERN.source.endsWith('$')).toBe(true);
    expect(isWellFormedVersion('x1.0.0y')).toBe(false);
  });
});

describe('Journal.checkInvariants 的判据逐条有效', () => {
  it('正常日志无违规', () => {
    const j = new Journal();
    j.append(noopOp);
    j.append(noopOp);
    expect(j.checkInvariants()).toEqual([]);
  });

  it('注入重复 seq 必须被报出', () => {
    const j = new Journal();
    j.append(noopOp);
    j.append(noopOp);
    guts<JournalGuts>(j).records[1]!.seq = 1;
    expect(j.checkInvariants().some((v) => /非严格递增/.test(v))).toBe(true);
  });

  it('注入逆序 seq 必须被报出', () => {
    const j = new Journal();
    j.append(noopOp);
    j.append(noopOp);
    j.append(noopOp);
    guts<JournalGuts>(j).records[2]!.seq = 1;
    expect(j.checkInvariants().some((v) => /非严格递增/.test(v))).toBe(true);
  });

  it('注入非整数 seq 必须被报出', () => {
    const j = new Journal();
    j.append(noopOp);
    guts<JournalGuts>(j).records[0]!.seq = 1.5;
    expect(j.checkInvariants().some((v) => /非整数/.test(v))).toBe(true);
  });

  it('注入非法 op 必须被报出', () => {
    const j = new Journal();
    j.append(noopOp);
    guts<JournalGuts>(j).records[0]!.op = null as never;
    expect(j.checkInvariants().some((v) => /op 非法/.test(v))).toBe(true);
  });

  it('注入发号器回退必须被报出（否则 append 会发重号）', () => {
    const j = new Journal();
    j.append(noopOp);
    j.append(noopOp);
    guts<JournalGuts>(j).seq = 1;
    expect(j.checkInvariants().some((v) => /会发重号/.test(v))).toBe(true);
  });

  it('trim 与 clear 之后不变量仍然成立', () => {
    const j = new Journal();
    for (let i = 0; i < 5; i++) j.append(noopOp);
    j.trim(2);
    expect(j.checkInvariants()).toEqual([]);
    j.clear();
    expect(j.checkInvariants()).toEqual([]);
    j.append(noopOp);
    expect(j.checkInvariants()).toEqual([]);
  });
});

describe('CheckpointStore.checkInvariants 的判据逐条有效', () => {
  const filled = (): CheckpointStore => {
    const s = new CheckpointStore();
    s.checkpoint('c1', good());
    s.checkpoint('c2', good());
    return s;
  };

  it('正常库无违规', () => {
    expect(filled().checkInvariants()).toEqual([]);
  });

  it('注入 order 多余标签必须被报出', () => {
    const s = filled();
    guts<CheckpointGuts>(s).order.push('ghost');
    const v = s.checkInvariants();
    expect(v.some((x) => /order 含无对应状态的标签/.test(x))).toBe(true);
  });

  it('注入 order 缺失标签必须被报出（否则该检查点在 list 中隐身）', () => {
    const s = filled();
    guts<CheckpointGuts>(s).order.length = 1;
    const v = s.checkInvariants();
    expect(v.some((x) => /未登记进 order/.test(x))).toBe(true);
  });

  it('注入 order 重复标签必须被报出', () => {
    const s = filled();
    guts<CheckpointGuts>(s).order.push('c1');
    expect(s.checkInvariants().some((x) => /order 内标签重复/.test(x))).toBe(true);
  });

  it('注入损坏的检查点状态必须被报出', () => {
    const s = filled();
    guts<CheckpointGuts>(s).checkpoints.set('c1', { ...good(), phaseIndex: -5 });
    const v = s.checkInvariants();
    expect(v.some((x) => /检查点\["c1"\].*phaseIndex/.test(x))).toBe(true);
  });

  it('remove 之后 order 与检查点集合仍一致', () => {
    const s = filled();
    s.remove('c1');
    expect(s.checkInvariants()).toEqual([]);
    expect(s.list()).toEqual(['c2']);
  });

  it('同标签重复 checkpoint 不产生重复 order 项', () => {
    const s = new CheckpointStore();
    s.checkpoint('c1', good());
    s.checkpoint('c1', good('2.0.0'));
    expect(s.list()).toEqual(['c1']);
    expect(s.checkInvariants()).toEqual([]);
    expect(s.restore('c1').version).toBe('2.0.0');
  });
});

describe('PhaseBoundaryLog / SnapshotStore 自检有效', () => {
  it('注入损坏边界快照必须被报出，且带下标', () => {
    const log = new PhaseBoundaryLog();
    log.markBoundary(good());
    log.markBoundary(good());
    guts<BoundaryGuts>(log).snapshots[1] = { ...good(), version: 'bad' };
    const v = log.checkInvariants();
    expect(v.some((x) => /边界\[1\].*version 非法/.test(x))).toBe(true);
  });

  it('正常边界日志无违规', () => {
    const log = new PhaseBoundaryLog();
    log.markBoundary(good());
    expect(log.checkInvariants()).toEqual([]);
  });

  it('注入负计数必须被报出', () => {
    const s = new SnapshotStore();
    s.take(good());
    expect(s.checkInvariants()).toEqual([]);
    guts<SnapshotGuts>(s).counter = -1;
    expect(s.checkInvariants().some((v) => /必须为非负整数/.test(v))).toBe(true);
  });

  it('注入非整数计数必须被报出', () => {
    const s = new SnapshotStore();
    guts<SnapshotGuts>(s).counter = 1.5;
    expect(s.checkInvariants().some((v) => /必须为非负整数/.test(v))).toBe(true);
  });
});
