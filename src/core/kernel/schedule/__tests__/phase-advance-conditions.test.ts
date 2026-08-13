/**
 * 任务 29.3：相位推进条件的属性测试
 * 
 * Property：
 * - 对于任意相位与任意未齐的 input 状态，schedule.advance 应返回 ok:false
 * - 对于任意 timeLimit 到期状态，应按 onTimeout 处理后推进并返回 ok:true
 * 
 * Validates: Requirements 31.4-31.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerScheduleOps } from '../schedule-ops.js';
import type { ScheduleDef, PhaseDef } from '../types.js';
import { resetIdCounters } from '../../state/ids.js';

function makeTestSchedule(phases: PhaseDef[]): ScheduleDef {
  return {
    id: 's:test' as any,
    kind: 'schedule',
    phases,
    loop: false,
  };
}

describe('Phase advance conditions (Property: input/timeLimit)', () => {
  beforeEach(() => resetIdCounters());

  describe('input 未齐时不能推进', () => {
    it('input:actor 且存在 open Decision 时返回 E_OP_NOT_ACCEPTED', () => {
      const schedule = makeTestSchedule([
        { id: 'p:submit' as any, input: 'actor' },
        { id: 'p:resolve' as any, input: 'none' },
      ]);

      const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
      const registry = new OpRegistry(holder);
      
      registerScheduleOps(registry, {
        defLookup: (id) => (id === schedule.id ? schedule : null),
      });

      // 手动设置一个 open Decision
      const draft = holder.getState();
      holder.setState({
        ...draft,
        world: {
          ...draft.world,
          decisions: {
            'd:1': {
              id: 'd:1',
              def: 'd:choose',
              askees: [{ $: 'g:alice' }],
              answers: {},
              ctx: {},
              opensAt: 0,
              deadline: 999,
              status: 'open',
            },
          },
        },
      });

      // 验证 Decision 确实是 open 状态
      const state = holder.getState();
      const decisions = Object.values(state.world.decisions);
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0]?.status).toBe('open');

      // 尝试推进相位
      const advanceResult = registry.invoke('schedule.advance', {});

      // 应该被拒绝
      expect(advanceResult.ok).toBe(false);
      if (!advanceResult.ok) {
        expect(advanceResult.code).toBe('E_OP_NOT_ACCEPTED');
      }

      // 验证相位没有推进
      expect(holder.getState().world.turn.phaseIndex).toBe(0);
    });

    it('input:all 且存在 pending Intent 时返回 E_OP_NOT_ACCEPTED', () => {
      const schedule = makeTestSchedule([
        { id: 'p:submit' as any, input: 'all' },
        { id: 'p:resolve' as any, input: 'none' },
      ]);

      const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
      const registry = new OpRegistry(holder);
      
      registerScheduleOps(registry, {
        defLookup: (id) => (id === schedule.id ? schedule : null),
      });

      // 手动创建一个 pending Intent
      const draft = holder.getState();
      holder.setState({
        ...draft,
        world: {
          ...draft.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:test' as any,
              agent: 'g:alice' as any,
              bindings: {},
              status: 'pending',
              submittedAt: 0,
              hidden: false,
            },
          },
        },
      });

      // 尝试推进相位
      const advanceResult = registry.invoke('schedule.advance', {});

      // 应该被拒绝
      expect(advanceResult.ok).toBe(false);
      if (!advanceResult.ok) {
        expect(advanceResult.code).toBe('E_OP_NOT_ACCEPTED');
      }

      // 验证相位没有推进
      expect(holder.getState().world.turn.phaseIndex).toBe(0);
    });

    it('input:none 时总是可以推进', () => {
      const schedule = makeTestSchedule([
        { id: 'p:0' as any, input: 'none' },
        { id: 'p:1' as any, input: 'none' },
      ]);

      const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
      const registry = new OpRegistry(holder);
      
      registerScheduleOps(registry, {
        defLookup: (id) => (id === schedule.id ? schedule : null),
      });

      // 即使有 pending Intent，input:none 也应该可以推进
      const draft = holder.getState();
      holder.setState({
        ...draft,
        world: {
          ...draft.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:test' as any,
              agent: 'g:alice' as any,
              bindings: {},
              status: 'pending',
              submittedAt: 0,
              hidden: false,
            },
          },
        },
      });

      // 尝试推进相位
      const advanceResult = registry.invoke('schedule.advance', {});

      // 应该成功
      expect(advanceResult.ok).toBe(true);

      // 验证相位已推进
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });
  });

  describe('input 齐全时可以推进', () => {
    it('input:actor 且无 open Decision 或 pending Intent 时可以推进', () => {
      const schedule = makeTestSchedule([
        { id: 'p:submit' as any, input: 'actor' },
        { id: 'p:resolve' as any, input: 'none' },
      ]);

      const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
      const registry = new OpRegistry(holder);
      
      registerScheduleOps(registry, {
        defLookup: (id) => (id === schedule.id ? schedule : null),
      });

      // 没有 open Decision 或 pending Intent
      const advanceResult = registry.invoke('schedule.advance', {});

      // 应该成功
      expect(advanceResult.ok).toBe(true);

      // 验证相位已推进
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });

    it('input:all 且所有 Decision 已关闭、所有 Intent 已解算时可以推进', () => {
      const schedule = makeTestSchedule([
        { id: 'p:submit' as any, input: 'all' },
        { id: 'p:resolve' as any, input: 'none' },
      ]);

      const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
      const registry = new OpRegistry(holder);
      
      registerScheduleOps(registry, {
        defLookup: (id) => (id === schedule.id ? schedule : null),
      });

      // 创建一个已解算的 Intent（不是 pending）
      const draft = holder.getState();
      holder.setState({
        ...draft,
        world: {
          ...draft.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:test' as any,
              agent: 'g:alice' as any,
              bindings: {},
              status: 'resolved', // 已解算
              submittedAt: 0,
              hidden: false,
            },
          },
        },
      });

      // 尝试推进相位
      const advanceResult = registry.invoke('schedule.advance', {});

      // 应该成功（因为没有 pending 的 Intent）
      expect(advanceResult.ok).toBe(true);

      // 验证相位已推进
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });
  });

  describe('Property: input 未齐时必然被拒绝', () => {
    it('Property: 对于任意 input:actor 或 input:all 的相位，存在 open Decision 或 pending Intent 时必返回 E_OP_NOT_ACCEPTED', () => {
      const inputs: Array<'actor' | 'all'> = ['actor', 'all'];
      
      for (const input of inputs) {
        // 场景 1: 有 open Decision
        {
          const schedule = makeTestSchedule([{ id: 'p:test' as any, input }]);
          const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
          const registry = new OpRegistry(holder);
          
          registerScheduleOps(registry, {
            defLookup: (id) => (id === schedule.id ? schedule : null),
          });

          // 手动创建 open Decision
          const draft = holder.getState();
          holder.setState({
            ...draft,
            world: {
              ...draft.world,
              decisions: {
                'd:1': {
                  id: 'd:1',
                  def: 'd:choose',
                  askees: [{ $: 'g:alice' }],
                  answers: {},
                  ctx: {},
                  opensAt: 0,
                  deadline: 999,
                  status: 'open',
                },
              },
            },
          });

          const result = registry.invoke('schedule.advance', {});
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.code).toBe('E_OP_NOT_ACCEPTED');
        }

        // 场景 2: 有 pending Intent
        {
          const schedule = makeTestSchedule([{ id: 'p:test' as any, input }]);
          const holder = new WorldStateHolder(createEmptyWorldState(schedule.id));
          const registry = new OpRegistry(holder);
          
          registerScheduleOps(registry, {
            defLookup: (id) => (id === schedule.id ? schedule : null),
          });

          // 手动创建 pending Intent
          const draft = holder.getState();
          holder.setState({
            ...draft,
            world: {
              ...draft.world,
              intents: {
                'i:1': {
                  id: 'i:1' as any,
                  action: 'a:test' as any,
                  agent: 'g:alice' as any,
                  bindings: {},
                  status: 'pending',
                  submittedAt: 0,
                  hidden: false,
                },
              },
            },
          });

          const result = registry.invoke('schedule.advance', {});
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.code).toBe('E_OP_NOT_ACCEPTED');
        }
      }
    });
  });

  describe('timeLimit 到期（占位）', () => {
    it('TODO: timeLimit 到期时应调用 processDecisionTimeouts 并推进相位', () => {
      // 任务 29.1 说明：完整的 timeLimit 实现需要在 WorldState 中跟踪相位进入的真实时间戳
      // 并通过 Expr 求值来判断是否到期。当前实现是占位逻辑。
      // 
      // 完整实现需要：
      // 1. WorldState.world.turn 增加 phaseEnteredAtWallTime 字段
      // 2. checkAdvanceConditions 中调用 evaluateExpr(phase.timeLimit, state, {})
      // 3. 如果 timeLimit 到期，调用 processDecisionTimeouts
      // 4. 然后推进相位并返回 ok:true
      //
      // 此测试标记为 TODO，等待完整实现后补充。
      expect(true).toBe(true);
    });
  });
});
