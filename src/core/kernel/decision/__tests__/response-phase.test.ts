/**
 * L7 Response Phase: 响应相位判断表达式的查询接口（任务 26.1，需求28.1-28.4）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { queryPendingIntentsFor, queryAllPendingIntents } from '../response-phase.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import type { WorldState } from '../../state/world-state.js';
import type { IntentState } from '../../state/world-state.js';
import { resetIdCounters } from '../../state/ids.js';

describe('Response Phase Query Interface', () => {
  let state: WorldState;

  beforeEach(() => {
    resetIdCounters();
    state = createEmptyWorldState('sched:1');
  });

  it('should query pending intents for a specific agent', () => {
    // 添加三个 Intent：两个属于 agent1，一个属于 agent2
    const intent1: IntentState = {
      id: 'g:1',
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1000,
      hidden: false,
    };

    const intent2: IntentState = {
      id: 'g:2',
      action: 'a:action2',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1100,
      priority: 50,
      hidden: false,
    };

    const intent3: IntentState = {
      id: 'g:3',
      action: 'a:action3',
      agent: 'g:agent2',
      bindings: {},
      status: 'pending',
      submittedAt: 1200,
      hidden: false,
    };

    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': intent1,
          'g:2': intent2,
          'g:3': intent3,
        },
      },
    };

    const result = queryPendingIntentsFor(state, 'g:agent1');
    expect(result.length).toBe(2);
    expect(result[0]?.id).toBe('g:2'); // priority 50 优先
    expect(result[1]?.id).toBe('g:1');
  });

  it('should exclude hidden intents by default', () => {
    const visibleIntent: IntentState = {
      id: 'g:1',
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1000,
      hidden: false,
    };

    const hiddenIntent: IntentState = {
      id: 'g:2',
      action: 'a:action2',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1100,
      hidden: true,
    };

    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': visibleIntent,
          'g:2': hiddenIntent,
        },
      },
    };

    const result = queryPendingIntentsFor(state, 'g:agent1');
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe('g:1');
  });

  it('should include hidden intents when includeHidden is true', () => {
    const visibleIntent: IntentState = {
      id: 'g:1',
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1000,
      hidden: false,
    };

    const hiddenIntent: IntentState = {
      id: 'g:2',
      action: 'a:action2',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1100,
      hidden: true,
    };

    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': visibleIntent,
          'g:2': hiddenIntent,
        },
      },
    };

    const result = queryPendingIntentsFor(state, 'g:agent1', { includeHidden: true });
    expect(result.length).toBe(2);
  });

  it('should exclude resolved or void intents', () => {
    const pendingIntent: IntentState = {
      id: 'g:1',
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1000,
      hidden: false,
    };

    const resolvedIntent: IntentState = {
      id: 'g:2',
      action: 'a:action2',
      agent: 'g:agent1',
      bindings: {},
      status: 'resolved',
      submittedAt: 1100,
      hidden: false,
    };

    const voidIntent: IntentState = {
      id: 'g:3',
      action: 'a:action3',
      agent: 'g:agent1',
      bindings: {},
      status: 'void',
      submittedAt: 1200,
      hidden: false,
    };

    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': pendingIntent,
          'g:2': resolvedIntent,
          'g:3': voidIntent,
        },
      },
    };

    const result = queryPendingIntentsFor(state, 'g:agent1');
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe('g:1');
  });

  it('should return all pending intents across all agents', () => {
    const intent1: IntentState = {
      id: 'g:1',
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1000,
      hidden: false,
    };

    const intent2: IntentState = {
      id: 'g:2',
      action: 'a:action2',
      agent: 'g:agent2',
      bindings: {},
      status: 'pending',
      submittedAt: 1100,
      hidden: false,
    };

    const intent3: IntentState = {
      id: 'g:3',
      action: 'a:action3',
      agent: 'g:agent3',
      bindings: {},
      status: 'resolved',
      submittedAt: 1200,
      hidden: false,
    };

    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': intent1,
          'g:2': intent2,
          'g:3': intent3,
        },
      },
    };

    const result = queryAllPendingIntents(state);
    expect(result.length).toBe(2);
    expect(result.map(i => i.id)).toContain('g:1');
    expect(result.map(i => i.id)).toContain('g:2');
    expect(result.map(i => i.id)).not.toContain('g:3');
  });

  it('should sort results by priority descending, then submittedAt ascending', () => {
    const intent1: IntentState = {
      id: 'g:1',
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1000,
      priority: 30,
      hidden: false,
    };

    const intent2: IntentState = {
      id: 'g:2',
      action: 'a:action2',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 1100,
      priority: 50,
      hidden: false,
    };

    const intent3: IntentState = {
      id: 'g:3',
      action: 'a:action3',
      agent: 'g:agent1',
      bindings: {},
      status: 'pending',
      submittedAt: 900,
      priority: 50,
      hidden: false,
    };

    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': intent1,
          'g:2': intent2,
          'g:3': intent3,
        },
      },
    };

    const result = queryPendingIntentsFor(state, 'g:agent1');
    expect(result.length).toBe(3);
    // priority 50 的两个在前，且 submittedAt 早的在前
    expect(result[0]?.id).toBe('g:3'); // priority 50, submittedAt 900
    expect(result[1]?.id).toBe('g:2'); // priority 50, submittedAt 1100
    expect(result[2]?.id).toBe('g:1'); // priority 30
  });

  it('Property: queryPendingIntentsFor returns only pending intents for the given agent', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            agent: fc.constantFrom('g:agent1', 'g:agent2', 'g:agent3'),
            status: fc.constantFrom('pending', 'resolved', 'void'),
            hidden: fc.boolean(),
            priority: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
            submittedAt: fc.integer({ min: 1000, max: 2000 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (intents) => {
          resetIdCounters();
          let s = createEmptyWorldState('sched:1');

          const intentStates: Record<string, IntentState> = {};
          intents.forEach((intentData, idx) => {
            const id = `g:${idx}`;
            intentStates[id] = {
              id,
              action: 'a:test',
              agent: intentData.agent,
              bindings: {},
              status: intentData.status as 'pending' | 'resolved' | 'void',
              submittedAt: intentData.submittedAt,
              priority: intentData.priority,
              hidden: intentData.hidden,
            };
          });

          s = {
            ...s,
            world: {
              ...s.world,
              intents: intentStates,
            },
          };

          const result = queryPendingIntentsFor(s, 'g:agent1');

          // 验证所有返回的 Intent 都满足条件
          for (const intent of result) {
            if (intent.agent !== 'g:agent1') return false;
            if (intent.status !== 'pending') return false;
            if (intent.hidden) return false; // 默认不包含 hidden
          }

          // 验证没有遗漏满足条件的 Intent
          const expectedCount = intents.filter(
            (i) => i.agent === 'g:agent1' && i.status === 'pending' && !i.hidden,
          ).length;
          if (result.length !== expectedCount) return false;

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: results are always sorted by priority desc, then submittedAt asc', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            priority: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
            submittedAt: fc.integer({ min: 1000, max: 2000 }),
          }),
          { minLength: 2, maxLength: 10 },
        ),
        (intents) => {
          resetIdCounters();
          let s = createEmptyWorldState('sched:1');

          const intentStates: Record<string, IntentState> = {};
          intents.forEach((intentData, idx) => {
            const id = `g:${idx}`;
            intentStates[id] = {
              id,
              action: 'a:test',
              agent: 'g:agent1',
              bindings: {},
              status: 'pending',
              submittedAt: intentData.submittedAt,
              priority: intentData.priority,
              hidden: false,
            };
          });

          s = {
            ...s,
            world: {
              ...s.world,
              intents: intentStates,
            },
          };

          const result = queryPendingIntentsFor(s, 'g:agent1');

          // 验证排序：priority 降序，submittedAt 升序
          for (let i = 0; i < result.length - 1; i++) {
            const curr = result[i];
            const next = result[i + 1];
            const currPriority = curr?.priority ?? 0;
            const nextPriority = next?.priority ?? 0;

            if ((curr?.priority ?? 0) < (next?.priority ?? 0)) return false;
            if (currPriority === nextPriority && (curr?.submittedAt ?? 0) > (next?.submittedAt ?? 0)) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
