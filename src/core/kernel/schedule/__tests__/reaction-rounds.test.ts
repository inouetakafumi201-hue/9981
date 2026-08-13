/**
 * 任务 29.2：响应相位 reactionRounds 功能测试（需求28.5）
 * 
 * 验证：
 * 1. 定义了 reactionRounds > 0 的相位是响应相位
 * 2. 响应相位的推进条件：没有 pending Intent 即可推进
 * 3. 响应相位优先级高于 input 检查
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { resetIdCounters } from '../../state/ids.js';
import { registerScheduleOps } from '../schedule-ops.js';
import type { ScheduleDef } from '../types.js';
import type { IntentState, DecisionState } from '../../state/world-state.js';

describe('Response Phase (reactionRounds)', () => {
  beforeEach(() => resetIdCounters());

  describe('基础功能', () => {
    it('reactionRounds > 0 且无 pending Intent 时可以推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:response',
        kind: 'schedule',
        phases: [
          { id: 'phase:response', reactionRounds: 3 },
          { id: 'phase:resolve' },
        ],
        loop: false,
      };

      const state = createEmptyWorldState('sched:response');
      const holder = new WorldStateHolder(state);
      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });

    it('reactionRounds > 0 且有 pending Intent 时不能推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:response',
        kind: 'schedule',
        phases: [
          { id: 'phase:response', reactionRounds: 3 },
          { id: 'phase:resolve' },
        ],
        loop: false,
      };

      let state = createEmptyWorldState('sched:response');
      const holder = new WorldStateHolder(state);
      
      // 添加一个 pending Intent（反应 Intent）
      const updatedState = holder.getState();
      holder.setState({
        ...updatedState,
        world: {
          ...updatedState.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:reaction' as any,
              agent: 'g:agent1' as any,
              bindings: {},
              status: 'pending',
              submittedAt: 1000,
              hidden: false,
            },
          },
        },
      });

      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
      expect(holder.getState().world.turn.phaseIndex).toBe(0);
    });

    it('reactionRounds > 0 且所有 Intent 已解算时可以推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:response',
        kind: 'schedule',
        phases: [
          { id: 'phase:response', reactionRounds: 2 },
          { id: 'phase:resolve' },
        ],
        loop: false,
      };

      const state = createEmptyWorldState('sched:response');
      const holder = new WorldStateHolder(state);
      
      // 添加一个 resolved Intent
      const updatedState = holder.getState();
      holder.setState({
        ...updatedState,
        world: {
          ...updatedState.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:reaction' as any,
              agent: 'g:agent1' as any,
              bindings: {},
              status: 'resolved',
              submittedAt: 1000,
              hidden: false,
            },
          },
        },
      });

      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });
  });

  describe('优先级：reactionRounds 高于 input 检查', () => {
    it('reactionRounds > 0 时忽略 input 字段（即使定义了 input:actor）', () => {
      const schedule: ScheduleDef = {
        id: 'sched:mixed',
        kind: 'schedule',
        phases: [
          // 同时定义了 reactionRounds 和 input：reactionRounds 优先
          { id: 'phase:response', reactionRounds: 3, input: 'actor' },
          { id: 'phase:next' },
        ],
        loop: false,
      };

      const state = createEmptyWorldState('sched:mixed');
      const holder = new WorldStateHolder(state);
      
      // 添加一个 open Decision（如果只看 input:actor，应该阻止推进）
      const updatedState = holder.getState();
      holder.setState({
        ...updatedState,
        world: {
          ...updatedState.world,
          decisions: {
            'd:1': {
              id: 'd:1',
              def: 'd:test',
              askees: [{ $: 'g:1' }],
              answers: {},
              ctx: {},
              opensAt: 0,
              status: 'open',
            },
          },
        },
      });

      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      // 因为定义了 reactionRounds，应该忽略 Decision 的存在
      // 只看 Intent：没有 pending Intent，所以可以推进
      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });

    it('reactionRounds > 0 时有 pending Intent 会阻止推进（即使没有 input 字段）', () => {
      const schedule: ScheduleDef = {
        id: 'sched:response-only',
        kind: 'schedule',
        phases: [
          // 只定义 reactionRounds，没有 input
          { id: 'phase:response', reactionRounds: 2 },
          { id: 'phase:next' },
        ],
        loop: false,
      };

      const state = createEmptyWorldState('sched:response-only');
      const holder = new WorldStateHolder(state);
      
      // 添加一个 pending Intent
      const updatedState = holder.getState();
      holder.setState({
        ...updatedState,
        world: {
          ...updatedState.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:test' as any,
              agent: 'g:1' as any,
              bindings: {},
              status: 'pending',
              submittedAt: 0,
              hidden: false,
            },
          },
        },
      });

      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
    });
  });

  describe('Property: 响应相位只检查 pending Intent', () => {
    it('Property: reactionRounds > 0 时，阻塞取决于 pending Intent 而非 Decision', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.boolean(),
          fc.boolean(),
          (reactionRounds, hasPendingIntent, hasOpenDecision) => {
            resetIdCounters();
            
            const schedule: ScheduleDef = {
              id: 'sched:prop',
              kind: 'schedule',
              phases: [
                { id: 'phase:response', reactionRounds },
                { id: 'phase:resolve' },
              ],
              loop: false,
            };

            const state = createEmptyWorldState('sched:prop');
            const holder = new WorldStateHolder(state);
            
            let updatedState = holder.getState();
            
            if (hasPendingIntent) {
              updatedState = {
                ...updatedState,
                world: {
                  ...updatedState.world,
                  intents: {
                    'i:1': {
                      id: 'i:1' as any,
                      action: 'a:test' as any,
                      agent: 'g:1' as any,
                      bindings: {},
                      status: 'pending',
                      submittedAt: 0,
                      hidden: false,
                    },
                  },
                },
              };
            }
            
            if (hasOpenDecision) {
              updatedState = {
                ...updatedState,
                world: {
                  ...updatedState.world,
                  decisions: {
                    'd:1': {
                      id: 'd:1',
                      def: 'd:test',
                      askees: [{ $: 'g:1' }],
                      answers: {},
                      ctx: {},
                      opensAt: 0,
                      status: 'open',
                    },
                  },
                },
              };
            }
            
            holder.setState(updatedState);

            const registry = new OpRegistry(holder);
            registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

            const result = registry.invoke('schedule.advance', {});
            const finalPhase = holder.getState().world.turn.phaseIndex;

            // 验证：只有 pending Intent 影响推进，Decision 不影响
            if (hasPendingIntent) {
              // 有 pending Intent：不能推进
              return result.ok === false && finalPhase === 0;
            } else {
              // 没有 pending Intent：可以推进（即使有 open Decision）
              return result.ok === true && finalPhase === 1;
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('边界情况', () => {
    it('reactionRounds = 0 时不作为响应相位（使用普通 input 检查）', () => {
      const schedule: ScheduleDef = {
        id: 'sched:zero',
        kind: 'schedule',
        phases: [
          { id: 'phase:test', reactionRounds: 0, input: 'actor' },
          { id: 'phase:next' },
        ],
        loop: false,
      };

      const state = createEmptyWorldState('sched:zero');
      const holder = new WorldStateHolder(state);
      
      // 添加一个 open Decision
      const updatedState = holder.getState();
      holder.setState({
        ...updatedState,
        world: {
          ...updatedState.world,
          decisions: {
            'd:1': {
              id: 'd:1',
              def: 'd:test',
              askees: [{ $: 'g:1' }],
              answers: {},
              ctx: {},
              opensAt: 0,
              status: 'open',
            },
          },
        },
      });

      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      // reactionRounds=0，应该使用 input:actor 逻辑
      // 有 open Decision，应该阻止推进
      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
    });

    it('reactionRounds undefined 时不作为响应相位', () => {
      const schedule: ScheduleDef = {
        id: 'sched:no-rounds',
        kind: 'schedule',
        phases: [
          { id: 'phase:test', input: 'none' },
          { id: 'phase:next' },
        ],
        loop: false,
      };

      const state = createEmptyWorldState('sched:no-rounds');
      const holder = new WorldStateHolder(state);
      
      // 添加一个 pending Intent
      const updatedState = holder.getState();
      holder.setState({
        ...updatedState,
        world: {
          ...updatedState.world,
          intents: {
            'i:1': {
              id: 'i:1' as any,
              action: 'a:test' as any,
              agent: 'g:1' as any,
              bindings: {},
              status: 'pending',
              submittedAt: 0,
              hidden: false,
            },
          },
        },
      });

      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => (id === schedule.id ? schedule : null) });

      // input:none，即使有 pending Intent 也应该可以推进
      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });
  });
});
