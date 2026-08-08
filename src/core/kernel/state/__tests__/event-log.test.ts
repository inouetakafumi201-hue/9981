/**
 * L1 State: world.log 有界环形缓冲的写入与保留窗口（需求15.1-15.4）。
 *
 * 本次修补前 world.log 是 `readonly unknown[]` 且恒为空数组，QueryEngine 的 from:'log' 分支
 * 直接 `return []`——"查最近一条 intent.resolved""战斗日志"这类需求15 的核心用例完全不可用。
 * 这里锁定：Event 写入进环形缓冲、seq 单调不复用、两种保留窗口（按条数/按相位）正确裁剪。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_RETENTION,
  appendLogEntry,
  applyLogRetention,
  logEntryToValue,
} from '../event-log.js';
import type { LogEntry } from '../world-state.js';
import { createEmptyWorldState } from '../world-state.js';

function entry(seq: number, phase: number, type = 'e'): LogEntry {
  return { seq, type, phase, payload: {} };
}

describe('appendLogEntry', () => {
  it('把事件追加到 world.log 并推进 logSeq', () => {
    let state = createEmptyWorldState('sched:t');
    state = appendLogEntry(state, 'damage', { amount: 3 });
    state = appendLogEntry(state, 'death', { who: { $: 'e:1' } });
    expect(state.world.log.map((e) => e.type)).toEqual(['damage', 'death']);
    expect(state.world.log.map((e) => e.seq)).toEqual([1, 2]);
    expect(state.world.logSeq).toBe(2);
  });

  it('seq 在窗口裁剪后仍单调递增、不复用被裁掉条目的序号', () => {
    let state = createEmptyWorldState('sched:t');
    for (let i = 0; i < 5; i++) state = appendLogEntry(state, 'e', {}, { max: 2 });
    // 只保留最后两条，但它们的 seq 是 4、5，而不是被重置成 1、2
    expect(state.world.log.map((e) => e.seq)).toEqual([4, 5]);
    expect(state.world.logSeq).toBe(5);
  });

  it('默认窗口有界，不退化成无限缓冲', () => {
    let state = createEmptyWorldState('sched:t');
    const cap = DEFAULT_LOG_RETENTION.max as number;
    for (let i = 0; i < cap + 50; i++) state = appendLogEntry(state, 'e', {});
    expect(state.world.log.length).toBe(cap);
    expect(state.world.logSeq).toBe(cap + 50);
  });

  it('事件被回滚时不应留在日志里（写在 draft 上，随事务回滚）', () => {
    // appendLogEntry 是纯函数：它返回新状态而不改旧状态。回滚等价于丢弃返回值。
    const base = createEmptyWorldState('sched:t');
    const withEntry = appendLogEntry(base, 'e', {});
    expect(base.world.log).toEqual([]); // 原状态不被污染
    expect(withEntry.world.log).toHaveLength(1);
  });
});

describe('applyLogRetention', () => {
  const log = [entry(1, 0), entry(2, 1), entry(3, 2), entry(4, 3), entry(5, 4)];

  it('按 max 裁掉最旧条目，保留相对顺序', () => {
    const kept = applyLogRetention(log, { max: 3 }, 4);
    expect(kept.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('按 phases 裁掉早于窗口的条目', () => {
    // nowPhase=4, phases=2 -> 保留 phase>=2 的条目（seq 3/4/5）
    const kept = applyLogRetention(log, { phases: 2 }, 4);
    expect(kept.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('两个维度同时声明时取交集（更严格者胜）', () => {
    // phases=3 -> phase>=1 (seq 2..5)；max=2 -> 再砍到最后两条 (seq 4,5)
    const kept = applyLogRetention(log, { phases: 3, max: 2 }, 4);
    expect(kept.map((e) => e.seq)).toEqual([4, 5]);
  });

  it('窗口足够大时返回原数组引用（无多余拷贝）', () => {
    expect(applyLogRetention(log, { max: 100 }, 4)).toBe(log);
  });
});

describe('logEntryToValue', () => {
  it('投影成自描述映射，供 from:log 查询的 $.type / $.payload 访问', () => {
    expect(logEntryToValue(entry(7, 2, 'death'))).toEqual({
      seq: 7, type: 'death', phase: 2, payload: {},
    });
  });
});


describe('state-driven retention (需求15.2 的落点)', () => {
  it('world.logRetention 设置后，appendLogEntry 按它裁剪而非默认窗口', () => {
    let state = createEmptyWorldState('sched:t');
    // 模拟玩法包激活写入 world.logRetention 后的状态
    state = { ...state, world: { ...state.world, logRetention: { max: 3 } } };
    for (let i = 0; i < 6; i++) {
      state = appendLogEntry(state, 'e', {}, state.world.logRetention ?? DEFAULT_LOG_RETENTION);
    }
    expect(state.world.log.map((e) => e.seq)).toEqual([4, 5, 6]);
  });
});
