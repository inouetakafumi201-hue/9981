/**
 * L9 Schedule: 相位推进条件的属性测试（任务 29.3，需求31.4-31.5）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import type { DecisionState, IntentState } from '../../state/world-state.js';
import { registerScheduleOps } from '../schedule-ops.js';
import type { ScheduleDef } from '../types.js';
import { DefRegistry } from '../../state/def.js';
import { resetIdCounters } from '../../state/ids.js';

function makeRegistry(sched: ScheduleDef): { registry: OpRegistry; holder: WorldStateHolder; defRegistry: DefRegistry } {
  const holder = new WorldStateHolder(createEmptyWorldState(sched.id));
  const registry = new OpRegistry(holder);
  const defRegistry = new DefRegistry();
  defRegistry.register(sched);
  registerScheduleOps(registry, {
    defLookup: (id) => defRegistry.resolve(id),
  });
  return { registry, holder, defRegistry };
}

describe('L9 Schedule: 相位推进条件（任务 29.3）', () => {
  beforeEach(() => resetIdCounters());

  describe('input 条件检查', () => {
    it('input:"none" 时总是可以推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          { id: 'phase:1', input: 'none' },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });

    it('input:"actor" 且有 open Decision 时不能推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          { id: 'phase:1', input: 'actor' },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      const decision: DecisionState = {
        id: 'd:1',
        def: 'def:test',
        askees: [{ $: 'g:1' }],
        answers: {},
        ctx: {},
        opensAt: 1000,
        status: 'open',
      };

      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
          decisions: { 'd:1': decision },
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
      expect(holder.getState().world.turn.phaseIndex).toBe(0); // 没有推进
    });

    it('input:"actor" 且有 pending Intent 时不能推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          { id: 'phase:1', input: 'actor' },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      const intent: IntentState = {
        id: 'g:1',
        action: 'a:test',
        agent: 'g:agent1',
        bindings: {},
        status: 'pending',
        submittedAt: 1000,
        hidden: false,
      };

      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
          intents: { 'g:1': intent },
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
      expect(holder.getState().world.turn.phaseIndex).toBe(0);
    });

    it('input:"actor" 且无 pending 时可以推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          { id: 'phase:1', input: 'actor' },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1);
    });

    it('input:"all" 且有任何 open Decision 或 pending Intent 时不能推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          { id: 'phase:1', input: 'all' },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      const intent: IntentState = {
        id: 'g:1',
        action: 'a:test',
        agent: 'g:agent1',
        bindings: {},
        status: 'pending',
        submittedAt: 1000,
        hidden: false,
      };

      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
          intents: { 'g:1': intent },
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
    });
  });

  describe('timeLimit 条件检查', () => {
    it('timeLimit 到期时可以推进（即使 input 未齐）', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          {
            id: 'phase:1',
            input: 'actor',
            timeLimit: 0, // 立即到期
          },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      const intent: IntentState = {
        id: 'g:1',
        action: 'a:test',
        agent: 'g:agent1',
        bindings: {},
        status: 'pending',
        submittedAt: 1000,
        hidden: false,
      };

      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
          intents: { 'g:1': intent }, // 有 pending intent，但 timeLimit 到期
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(true);
      expect(holder.getState().world.turn.phaseIndex).toBe(1); // 成功推进
    });

    it('timeLimit 未到期且 input 未齐时不能推进', () => {
      const schedule: ScheduleDef = {
        id: 'sched:test',
        kind: 'schedule',
        phases: [
          {
            id: 'phase:1',
            input: 'actor',
            timeLimit: 100, // 未到期
          },
          { id: 'phase:2', input: 'none' },
        ],
        loop: false,
      };
      const { registry, holder } = makeRegistry(schedule);

      const state = holder.getState();
      const intent: IntentState = {
        id: 'g:1',
        action: 'a:test',
        agent: 'g:agent1',
        bindings: {},
        status: 'pending',
        submittedAt: 1000,
        hidden: false,
      };

      holder.setState({
        ...state,
        world: {
          ...state.world,
          turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
          intents: { 'g:1': intent },
        },
      });

      const result = registry.invoke('schedule.advance', {});
      expect(result.ok).toBe(false);
      expect((result as { code?: string }).code).toBe('E_OP_NOT_ACCEPTED');
    });
  });

  describe('Property: input 未齐时 schedule.advance 返回 ok:false', () => {
    it('属性测试：有 pending Decision/Intent 时 input:actor/all 阻止推进', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('actor', 'all'),
          fc.boolean(), // 是否有 pending Decision
          fc.boolean(), // 是否有 pending Intent
          fc.boolean(), // 是否有 timeLimit 到期
          (inputType, hasPendingDecision, hasPendingIntent, timeLimitReached) => {
            resetIdCounters();

            const schedule: ScheduleDef = {
              id: 'sched:test',
              kind: 'schedule',
              phases: [
                {
                  id: 'phase:1',
                  input: inputType as 'actor' | 'all',
                  timeLimit: timeLimitReached ? 0 : 100,
                },
                { id: 'phase:2', input: 'none' },
              ],
              loop: false,
            };
            const { registry, holder } = makeRegistry(schedule);

            let state = holder.getState();
            state = {
              ...state,
              world: {
                ...state.world,
                turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 0 },
                decisions: hasPendingDecision
                  ? {
                      'd:1': {
                        id: 'd:1',
                        def: 'def:test',
                        askees: [{ $: 'g:1' }],
                        answers: {},
                        ctx: {},
                        opensAt: 1000,
                        status: 'open',
                      },
                    }
                  : {},
                intents: hasPendingIntent
                  ? {
                      'g:1': {
                        id: 'g:1',
                        action: 'a:test',
                        agent: 'g:agent1',
                        bindings: {},
                        status: 'pending',
                        submittedAt: 1000,
                        hidden: false,
                      },
                    }
                  : {},
              },
            };
            holder.setState(state);

            const result = registry.invoke('schedule.advance', {});

            const hasPending = hasPendingDecision || hasPendingIntent;

            // 如果 timeLimit 到期，无论 input 是否齐都能推进
            if (timeLimitReached) {
              if (!result.ok) return false;
              if (holder.getState().world.turn.phaseIndex !== 1) return false;
              return true;
            }

            // timeLimit 未到期，有 pending 时不能推进
            if (hasPending) {
              if (result.ok) return false;
              if (result.code !== 'E_OP_NOT_ACCEPTED') return false;
              if (holder.getState().world.turn.phaseIndex !== 0) return false;
              return true;
            }

            // timeLimit 未到期，无 pending 时可以推进
            if (!result.ok) return false;
            if (holder.getState().world.turn.phaseIndex !== 1) return false;
            return true;
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
