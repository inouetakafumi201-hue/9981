/**
 * L4 不变量检查器自校验：损坏注入
 *
 * 为什么需要这个文件：
 * `checkInvariants()` 恒返回 [] 的实现也能让上面所有测试通过。
 * 一个检查器如果从未在损坏状态上报过违规，它就没有证明任何东西。
 * 本文件直接改写私有状态，逐条制造违规，断言检查器精确报出对应码。
 */
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { HookPhase, HookSystem } from '../src/index.js';
import type { HookDef } from '../src/index.js';

interface Guts {
  hooks: Map<string, Array<{ hook: HookDef; order: number }>>;
  defaultHandlers: Map<string, (ctx: unknown) => unknown>;
  callStack: Array<{ type: string; hookId: string }>;
  reactionQueue: Array<{ type: string; data: unknown }>;
  registrationOrder: number;
  depth: number;
  reactionRounds: number;
}

const guts = (system: HookSystem): Guts => system as unknown as Guts;

const noop = (): void => undefined;

function withHooks(count = 2, on = 'A'): HookSystem {
  const system = new HookSystem();
  for (let index = 0; index < count; index++) {
    system.registerHook({ id: `h${index}`, on, phase: HookPhase.After, effect: noop });
  }
  return system;
}

/** 断言违规列表中存在且仅存在给定的一组码（顺序无关）。 */
function assertCodes(violations: string[], expected: string[]): void {
  const codes = violations.map((v) => v.split(':')[0]).sort();
  assert.deepEqual(codes, [...expected].sort(), `实际违规=${violations.join(' | ')}`);
}

describe('L4 检查器：干净态必须无违规', () => {
  test('空系统无违规', () => {
    assert.deepEqual(new HookSystem().checkInvariants(), []);
  });

  test('注册若干 Hook 后无违规', () => {
    const system = withHooks(3);
    system.registerHook({ id: 'x', on: 'B', phase: HookPhase.Before, effect: noop });
    system.registerDefaultHandler('A', noop);
    assert.deepEqual(system.checkInvariants(), []);
  });

  test('正常 emit 之后无违规', () => {
    const system = withHooks(2);
    system.emit('A');
    assert.deepEqual(system.checkInvariants(), []);
  });
});

describe('L4 检查器：depth 与调用栈', () => {
  test('depth 未归零被报出', () => {
    const system = withHooks(1);
    guts(system).depth = 3;
    assertCodes(system.checkInvariants(), ['E_INV_DEPTH_NOT_RESET']);
  });

  test('depth 为负被报出', () => {
    const system = withHooks(1);
    guts(system).depth = -1;
    assertCodes(system.checkInvariants(), ['E_INV_DEPTH_NEGATIVE', 'E_INV_DEPTH_NOT_RESET']);
  });

  test('depth 超上限被报出', () => {
    const system = withHooks(1);
    guts(system).depth = 33;
    assertCodes(system.checkInvariants(), ['E_INV_DEPTH_OVERFLOW', 'E_INV_DEPTH_NOT_RESET']);
  });

  test('空闲态调用栈泄漏被报出', () => {
    const system = withHooks(1);
    guts(system).callStack.push({ type: 'A', hookId: 'h0' });
    assertCodes(system.checkInvariants(), ['E_INV_STACK_LEAKED', 'E_INV_STACK_DEPTH_MISMATCH']);
  });

  test('调用栈深于 depth 被报出（idle=false 下仍成立）', () => {
    const system = withHooks(1);
    guts(system).depth = 1;
    guts(system).callStack.push({ type: 'A', hookId: 'h0' }, { type: 'A', hookId: 'h1' });
    assertCodes(system.checkInvariants(false), ['E_INV_STACK_DEPTH_MISMATCH']);
  });

  test('idle=false 时不再报 depth/栈/队列的空闲态专属违规', () => {
    const system = withHooks(1);
    guts(system).depth = 2;
    guts(system).callStack.push({ type: 'A', hookId: 'h0' });
    guts(system).reactionQueue.push({ type: 'A', data: {} });
    assert.deepEqual(system.checkInvariants(false), []);
  });
});

describe('L4 检查器：反应队列与轮次', () => {
  test('空闲态反应队列残留被报出', () => {
    const system = withHooks(1);
    guts(system).reactionQueue.push({ type: 'A', data: {} });
    assertCodes(system.checkInvariants(), ['E_INV_QUEUE_LEAKED']);
  });

  test('反应轮数超上限被报出', () => {
    const system = withHooks(1);
    guts(system).reactionRounds = 9;
    assertCodes(system.checkInvariants(), ['E_INV_ROUNDS_OVERFLOW']);
  });

  test('反应轮数正好等于上限不算违规', () => {
    const system = withHooks(1);
    guts(system).reactionRounds = 8;
    assert.deepEqual(system.checkInvariants(), []);
  });
});

describe('L4 检查器：注册表结构', () => {
  test('registrationOrder 与实际 Hook 数不符被报出', () => {
    const system = withHooks(2);
    guts(system).registrationOrder = 99;
    assertCodes(system.checkInvariants(), ['E_INV_ORDER_COUNT_MISMATCH']);
  });

  test('Hook 挂错事件桶被报出', () => {
    const system = withHooks(2);
    const entries = guts(system).hooks.get('A')!;
    entries[0].hook.on = 'WRONG';
    assertCodes(system.checkInvariants(), ['E_INV_BUCKET_MISKEYED']);
  });

  test('空事件桶被报出', () => {
    const system = withHooks(1);
    guts(system).hooks.set('EMPTY', []);
    assertCodes(system.checkInvariants(), ['E_INV_BUCKET_EMPTY']);
  });

  test('桶内 order 非递增被报出', () => {
    const system = withHooks(2);
    const entries = guts(system).hooks.get('A')!;
    [entries[0], entries[1]] = [entries[1], entries[0]];
    assertCodes(system.checkInvariants(), ['E_INV_ORDER_NOT_MONOTONIC']);
  });

  test('order 全局重复被报出', () => {
    const system = new HookSystem();
    system.registerHook({ id: 'a', on: 'A', phase: HookPhase.After, effect: noop });
    system.registerHook({ id: 'b', on: 'B', phase: HookPhase.After, effect: noop });
    guts(system).hooks.get('B')![0].order = 0;
    assertCodes(system.checkInvariants(), ['E_INV_ORDER_DUPLICATE']);
  });

  test('非法 phase 被报出', () => {
    const system = withHooks(1);
    guts(system).hooks.get('A')![0].hook.phase = 'nonsense' as HookPhase;
    assertCodes(system.checkInvariants(), ['E_INV_PHASE_INVALID']);
  });

  test('多处同时损坏时全部报出，互不掩盖', () => {
    const system = withHooks(2);
    guts(system).depth = 1;
    guts(system).reactionQueue.push({ type: 'A', data: {} });
    guts(system).hooks.get('A')![0].hook.phase = 'nope' as HookPhase;
    guts(system).registrationOrder = 42;
    assertCodes(system.checkInvariants(), [
      'E_INV_DEPTH_NOT_RESET',
      'E_INV_QUEUE_LEAKED',
      'E_INV_PHASE_INVALID',
      'E_INV_ORDER_COUNT_MISMATCH',
    ]);
  });
});

describe('L4 快照面', () => {
  test('snapshot 按事件名排序、桶内保持注册序', () => {
    const system = new HookSystem();
    system.registerHook({ id: 'z', on: 'Z', phase: HookPhase.After, effect: noop });
    system.registerHook({ id: 'a1', on: 'A', phase: HookPhase.Before, priority: 5, effect: noop });
    system.registerHook({ id: 'a2', on: 'A', phase: HookPhase.After, effect: noop });
    system.registerDefaultHandler('Z', noop);
    system.registerDefaultHandler('A', noop);

    const snap = system.snapshot();
    assert.deepEqual(snap.hooks.map((bucket) => bucket.on), ['A', 'Z']);
    assert.deepEqual(snap.hooks[0].entries.map((e) => e.id), ['a1', 'a2']);
    assert.deepEqual(snap.hooks[0].entries.map((e) => e.order), [1, 2]);
    assert.equal(snap.hooks[0].entries[0].priority, 5, 'priority 缺省应规范化为显式值');
    assert.equal(snap.hooks[0].entries[1].priority, 0, '未给 priority 应规范化为 0');
    assert.deepEqual(snap.defaultHandlers, ['A', 'Z']);
    assert.equal(snap.registrationOrder, 3);
    assert.equal(snap.depth, 0);
    assert.equal(snap.queueLength, 0);
    assert.deepEqual(snap.callStack, []);
  });

  test('snapshot 不泄漏内部引用：改动返回值不影响系统', () => {
    const system = withHooks(1);
    const snap = system.snapshot();
    snap.hooks.length = 0;
    snap.callStack.push({ type: 'X', hookId: 'X' });
    assert.deepEqual(system.checkInvariants(), []);
    assert.equal(system.snapshot().hooks.length, 1);
  });
});

describe('L4 轨迹面', () => {
  test('默认不记录轨迹', () => {
    const system = withHooks(1);
    system.emit('A');
    assert.deepEqual(system.takeTrace(), []);
  });

  test('takeTrace 取出后清空', () => {
    const system = withHooks(1);
    system.startRecording();
    system.emit('A');
    assert.equal(system.takeTrace().length, 1);
    assert.deepEqual(system.takeTrace(), []);
    system.stopRecording();
  });

  test('startRecording 重置既有轨迹', () => {
    const system = withHooks(1);
    system.startRecording();
    system.emit('A');
    system.startRecording();
    assert.deepEqual(system.takeTrace(), []);
    system.stopRecording();
  });

  test('stopRecording 后不再记录', () => {
    const system = withHooks(1);
    system.startRecording();
    system.stopRecording();
    system.emit('A');
    assert.deepEqual(system.takeTrace(), []);
  });

  test('轨迹包含 default 调用且 phase 标为 default', () => {
    const system = new HookSystem();
    system.registerDefaultHandler('A', noop);
    system.startRecording();
    system.emit('A');
    const trace = system.takeTrace();
    assert.equal(trace.length, 1);
    assert.equal(trace[0].kind, 'default');
    assert.equal(trace[0].phase, 'default');
    assert.equal(trace[0].hookId, '<default:A>');
    system.stopRecording();
  });

  test('无 default handler 时不产生 default 轨迹条目', () => {
    const system = withHooks(1);
    system.startRecording();
    system.emit('A');
    const trace = system.takeTrace();
    assert.deepEqual(trace.map((e) => e.kind), ['hook']);
    system.stopRecording();
  });

  test('轨迹记录嵌套深度', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'outer',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => ctx.emit('B'),
    });
    system.registerHook({ id: 'inner', on: 'B', phase: HookPhase.After, effect: noop });
    system.startRecording();
    system.emit('A');
    assert.deepEqual(system.takeTrace().map((e) => `${e.hookId}@${e.depth}`), ['outer@1', 'inner@2']);
    system.stopRecording();
  });

  test('被 when 跳过的 Hook 不进轨迹', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'skipped',
      on: 'A',
      phase: HookPhase.After,
      when: () => false,
      effect: noop,
    });
    system.startRecording();
    system.emit('A');
    assert.deepEqual(system.takeTrace(), []);
    system.stopRecording();
  });

  test('重入被拒的 Hook 不产生第二条轨迹', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'self',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => ctx.emit('A'),
    });
    system.startRecording();
    assert.throws(() => system.emit('A'), /E_HOOK_REENTRY/);
    assert.deepEqual(system.takeTrace().map((e) => e.hookId), ['self']);
    system.stopRecording();
  });
});
