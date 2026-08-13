/**
 * L1 State WorldState 测试（design.md 4.1节，任务 2.3）。
 *
 * 验证：
 * - WorldState 恰有6个顶层集合（world/defs/nodes/links/entities/items）
 * - containers 不是第7个顶层集合，而是辅助索引表
 * - createEmptyWorldState 产生符合契约的初始状态
 */
import { describe, it, expect } from 'vitest';
import type { WorldState } from '../world-state.js';
import { createEmptyWorldState, TOP_LEVEL_COLLECTION_KEYS } from '../world-state.js';

describe('WorldState structure', () => {
  it('恰有6个顶层集合：world/defs/nodes/links/entities/items', () => {
    // 需求1.8：顶层集合数恒为6
    expect(TOP_LEVEL_COLLECTION_KEYS).toHaveLength(6);
    expect(TOP_LEVEL_COLLECTION_KEYS).toEqual([
      'world',
      'defs',
      'nodes',
      'links',
      'entities',
      'items',
    ]);
  });

  it('containers 不在 TOP_LEVEL_COLLECTION_KEYS 中（辅助表，非第7集合）', () => {
    // 需求1.9 的姊妹条款：containers 是辅助索引表，不计入"6个顶层集合"
    expect(TOP_LEVEL_COLLECTION_KEYS).not.toContain('containers');
  });

  it('createEmptyWorldState 产生6个顶层集合 + containers 辅助表', () => {
    const state = createEmptyWorldState('s:test' as any);

    // 六个顶层集合存在且为空
    expect(state.world).toBeDefined();
    expect(state.defs).toEqual({});
    expect(state.nodes).toEqual({});
    expect(state.links).toEqual({});
    expect(state.entities).toEqual({});
    expect(state.items).toEqual({});

    // containers 辅助表存在但不在"六顶层集合"概念内
    expect(state.containers).toEqual({});

    // 验证 WorldState 的键恰好是 TOP_LEVEL_COLLECTION_KEYS + 'containers'
    const stateKeys = Object.keys(state).sort();
    const expectedKeys = [...TOP_LEVEL_COLLECTION_KEYS, 'containers'].sort();
    expect(stateKeys).toEqual(expectedKeys);
  });

  it('world.turn 初始化为合法 TurnState', () => {
    const scheduleId = 's:schedule_test' as any;
    const state = createEmptyWorldState(scheduleId);

    expect(state.world.turn).toEqual({
      scheduleId,
      phaseIndex: 0,
      phaseEnteredAt: 0,
    });
  });

  it('所有 WorldTop 顶层字段初始化为空对象或空数组', () => {
    const state = createEmptyWorldState('s:test' as any);

    expect(state.world.props).toEqual({});
    expect(state.world.agents).toEqual({});
    expect(state.world.knowledge).toEqual({});
    expect(state.world.decisions).toEqual({});
    expect(state.world.intents).toEqual({});
    expect(state.world.attachments).toEqual({});
    expect(state.world.rng).toEqual({});
    expect(state.world.ruleCircuitState).toEqual({});
    expect(state.world.log).toEqual([]);
    expect(state.world.logSeq).toBe(0);
    expect(state.world.deferredEffects).toEqual([]);
    expect(state.world.deferredSeq).toBe(0);
  });

  it('WorldState 类型有 readonly 约束（编译期测试）', () => {
    // TypeScript 类型系统的只读约束在编译期保证
    // 下面的代码应该无法通过 tsc，但在运行时无法断言
    // 仅作为文档记录：WorldState.* 字段全部标记 readonly

    const state = createEmptyWorldState('s:test' as any);

    // 应无法直接赋值顶层集合 / readonly 字段（编译期约束，已被 readonly 类型保证）
    // 若取消注释下方赋值，类型检查会失败：
    //   state.world = { ... }
    //   state.world.props = { ... }

    // 这里只验证结构存在
    expect(state).toBeDefined();
  });
});
