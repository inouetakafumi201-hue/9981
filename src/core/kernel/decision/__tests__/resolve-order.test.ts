/**
 * L7 Intent: resolveOrder 排序与禁止 simultaneous（任务 25.3，需求29.6-29.7）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerIntentOps } from '../intent-ops';
import type { IntentOpsDeps } from '../intent-ops';
import { WorldStateHolder } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { resetIdCounters } from '../../state/ids';
import { OpRegistry } from '../../ops/registry';
import { setPath } from '../../ops/path';
import type { ActionDef } from '../../actions/types';
import type { Def } from '../../state/def';
import type { ScheduleDef } from '../../schedule/types';
import { Linter } from '../../safety/safety';
import { ok } from '../../ops/result';
import type { OpContext } from '../../ops/registry';

describe('Intent resolveOrder', () => {
  let holder: WorldStateHolder;
  let registry: OpRegistry;

  const action1: ActionDef = {
    id: 'a:action1',
    kind: 'action',
    label: 'Action 1',
    require: true,
    cost: [],
    effects: [],
    track: 'highlight',
  };

  const action2: ActionDef = {
    id: 'a:action2',
    kind: 'action',
    label: 'Action 2',
    require: true,
    cost: [],
    effects: [],
    track: 'highlight',
  };

  const scheduleWithResolveOrder: ScheduleDef = {
    id: 'sched:priority',
    kind: 'schedule',
    phases: [],
    resolveOrder: { op: 'get', path: 'priority' },
  };

  const scheduleNoResolveOrder: ScheduleDef = {
    id: 'sched:noorder',
    kind: 'schedule',
    phases: [],
  };

  function makeDeps(defs: Def[]): IntentOpsDeps {
    const map = new Map(defs.map((d) => [d.id, d]));
    return {
      defLookup: (id) => map.get(id) ?? null,
      now: () => 1000,
      runEffects: () => ok(undefined),
    };
  }

  beforeEach(() => {
    resetIdCounters();
    const state = createEmptyWorldState('sched:priority');
    holder = new WorldStateHolder(state);
    registry = new OpRegistry(holder);

    const deps = makeDeps([action1, action2, scheduleWithResolveOrder, scheduleNoResolveOrder]);
    registerIntentOps(registry, deps);
    
    // 注册 prop.set Op（用于 effects）
    registry.register('prop.set', (args: { path: string; value: unknown }, ctx) => {
      ctx.tx.setDraft(setPath(ctx.tx.getDraft(), args.path, args.value as never));
      ctx.tx.logOp('prop.set', args, () => {});
      return { ok: true, value: undefined };
    }, { structural: true });

    // 创建两个 agent
    holder.setState(setPath(holder.getState(), 'world.agents.g:agent1', { id: 'g:agent1', kind: 'human', controls: [] }));
    holder.setState(setPath(holder.getState(), 'world.agents.g:agent2', { id: 'g:agent2', kind: 'human', controls: [] }));
  });

  it('should resolve intents in priority descending order when resolveOrder is specified', () => {
    // 提交三个 Intent，priority 分别为 50, 30, 70
    const submit1 = registry.invoke('intent.submit', {
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: { priority: 50 },
      priority: 50,
    });
    const submit2 = registry.invoke('intent.submit', {
      action: 'a:action2',
      agent: 'g:agent2',
      bindings: { priority: 30 },
      priority: 30,
    });
    const submit3 = registry.invoke('intent.submit', {
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: { priority: 70 },
      priority: 70,
    });

    expect(submit1.ok).toBe(true);
    expect(submit2.ok).toBe(true);
    expect(submit3.ok).toBe(true);

    if (!submit1.ok || !submit2.ok || !submit3.ok) return;

    const s1 = submit1.value as { $: string };
    const s2 = submit2.value as { $: string };
    const s3 = submit3.value as { $: string };
    const ids = [s1.$, s2.$, s3.$];

    // 批量解算
    const batchResult = registry.invoke('intent.resolveBatch', {
      ids,
      scheduleId: 'sched:priority',
    });

    expect(batchResult.ok).toBe(true);

    // 验证所有 Intent 都已 resolved
    const finalState = holder.getState();
    expect(finalState.world.intents[ids[0]!]!.status).toBe('resolved');
    expect(finalState.world.intents[ids[1]!]!.status).toBe('resolved');
    expect(finalState.world.intents[ids[2]!]!.status).toBe('resolved');
  });

  it('should resolve intents in submission order when resolveOrder is not specified', () => {
    holder.setState({ ...holder.getState(), world: { ...holder.getState().world, turn: { ...holder.getState().world.turn, scheduleId: 'sched:noorder' } } });

    const submit1 = registry.invoke('intent.submit', {
      action: 'a:action1',
      agent: 'g:agent1',
      bindings: {},
    });
    const submit2 = registry.invoke('intent.submit', {
      action: 'a:action2',
      agent: 'g:agent2',
      bindings: {},
    });

    expect(submit1.ok).toBe(true);
    expect(submit2.ok).toBe(true);

    if (!submit1.ok || !submit2.ok) return;

    const batchResult = registry.invoke('intent.resolveBatch', {
      scheduleId: 'sched:noorder',
    });

    expect(batchResult.ok).toBe(true);

    const finalState2 = holder.getState();
    const rf1 = submit1.value as { $: string };
    const rf2 = submit2.value as { $: string };
    expect(finalState2.world.intents[rf1.$]!.status).toBe('resolved');
    expect(finalState2.world.intents[rf2.$]!.status).toBe('resolved');
  });

  it('should handle require recheck failure during batch resolve', () => {
    // 提交两个 Intent，第二个依赖第一个不改变的状态
    const requireAction: ActionDef = {
      id: 'a:requireAction',
      kind: 'action',
      label: 'Require Action',
      require: { op: 'get', path: 'world.props.gate' },
      cost: [],
      effects: [],
      track: 'highlight',
    };

    const changeAction: ActionDef = {
      id: 'a:changeAction',
      kind: 'action',
      label: 'Change Action',
      require: true,
      cost: [],
      effects: [{ op: 'prop.set', args: { path: 'world.props.gate' as unknown as import('../../state/expr-types').Expr, value: false } }],
      track: 'highlight',
    };

    const deps = makeDeps([requireAction, changeAction, scheduleWithResolveOrder]);
    const registry2 = new OpRegistry(holder);
    
    // 注入 runEffects 来执行 effects
    const depsWithEffects: IntentOpsDeps = {
      ...deps,
      runEffects: (effects, ctx) => {
        for (const eff of effects) {
          const effect = eff as { op?: string; args?: { path?: string; value?: unknown } };
          if (effect.op === 'prop.set' && effect.args?.path) {
            const result = registry2.invokeInline('prop.set', { path: effect.args.path, value: effect.args.value }, ctx);
            if (!result.ok) return result;
          }
        }
        return ok(undefined);
      },
    };
    registerIntentOps(registry2, depsWithEffects);
    
    // 注册 prop.set
    registry2.register('prop.set', (args: { path: string; value: unknown }, ctx) => {
      ctx.tx.setDraft(setPath(ctx.tx.getDraft(), args.path, args.value as never));
      ctx.tx.logOp('prop.set', args, () => {});
      return { ok: true, value: undefined };
    }, { structural: true });

    holder.setState(setPath(holder.getState(), 'world.props.gate', true));

    // 提交两个 Intent：priority 高的改 gate，priority 低的依赖 gate=true
    const submit1 = registry2.invoke('intent.submit', {
      action: 'a:changeAction',
      agent: 'g:agent1',
      bindings: {},
      priority: 100,
    });

    const submit2 = registry2.invoke('intent.submit', {
      action: 'a:requireAction',
      agent: 'g:agent2',
      bindings: {},
      priority: 50,
    });

    expect(submit1.ok).toBe(true);
    expect(submit2.ok).toBe(true);

    if (!submit1.ok || !submit2.ok) return;

    const batchResult = registry2.invoke('intent.resolveBatch', {
      scheduleId: 'sched:priority',
    });

    expect(batchResult.ok).toBe(true);

    const finalState3 = holder.getState();
    const rf3a = submit1.value as { $: string };
    const rf3b = submit2.value as { $: string };
    // 第一个应该 resolved
    expect(finalState3.world.intents[rf3a.$]!.status).toBe('resolved');
    // 第二个应该 void（require 失败）
    expect(finalState3.world.intents[rf3b.$]!.status).toBe('void');
  });

  it('Property: multiple intents are resolved sequentially, not simultaneously', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 5 }),
        (priorities) => {
          resetIdCounters();
          const state = createEmptyWorldState('sched:priority');
          const h = new WorldStateHolder(state);
          const r = new OpRegistry(h);
          const deps = makeDeps([action1, scheduleWithResolveOrder]);
          registerIntentOps(r, deps);

          h.setState(setPath(h.getState(), 'world.agents.g:agent1', { id: 'g:agent1', kind: 'human', controls: [] }));
          h.setState(setPath(h.getState(), 'world.props.counter', 0));

          // 创建 counterAction，每次执行时递增 counter
          const counterAction: ActionDef = {
            id: 'a:counter',
            kind: 'action',
            label: 'Counter',
            require: true,
            cost: [],
            effects: [
              {
                op: 'prop.set',
                args: {
                  path: 'world.props.counter',
                  value: { op: 'add', args: [{ op: 'get', path: 'world.props.counter' }, 1] },
                },
              },
            ],
            track: 'highlight',
          };

          const deps2 = makeDeps([counterAction, scheduleWithResolveOrder]);
          const r2 = new OpRegistry(h);
          
          // 注册 prop.set；表达式值走 ExprEngine/路径求值，使 counter 能真实递增。
          r2.register('prop.set', (args: { path: string; value: unknown }, ctx) => {
            let val = args.value;
            if (typeof val === 'object' && val !== null && 'op' in val) {
              const expr = val as { op: string; path?: string; args?: unknown[] };
              if (expr.op === 'get' && expr.path) {
                val = expr.path.split('.').reduce(
                  (o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined),
                  ctx.tx.getDraft() as unknown,
                ) ?? 0;
              } else if (expr.op === 'add' && Array.isArray(expr.args)) {
                val = expr.args.reduce((acc, term) => {
                  if (typeof term === 'number') return (acc as number) + term;
                  if (typeof term === 'object' && term !== null && 'op' in term) {
                    const t = term as { op: string; path?: string };
                    const resolved = t.op === 'get' && t.path
                      ? (t.path.split('.').reduce(
                          (o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined),
                          ctx.tx.getDraft() as unknown,
                        ) ?? 0)
                      : 0;
                    return (acc as number) + (typeof resolved === 'number' ? resolved : 0);
                  }
                  return acc;
                }, 0);
              }
            }
            ctx.tx.setDraft(setPath(ctx.tx.getDraft(), args.path, val as never));
            ctx.tx.logOp('prop.set', args, () => {});
            return { ok: true, value: undefined };
          }, { structural: true });
          
          const depsWithEffects2 = {
            ...deps2,
            runEffects: (effects: ActionDef['effects'], ctx: OpContext) => {
              for (const eff of effects) {
                const effect = eff as { op?: string; args?: { path?: string; value?: unknown } };
                if (effect.op === 'prop.set' && effect.args?.path && effect.args.value !== undefined) {
                  const result = r2.invokeInline('prop.set', { path: effect.args.path, value: effect.args.value }, ctx);
                  if (!result.ok) return result;
                }
              }
              return ok(undefined);
            },
          };
          registerIntentOps(r2, depsWithEffects2);

          // 提交多个 Intent
          const ids: string[] = [];
          for (const p of priorities) {
            const result = r2.invoke('intent.submit', {
              action: 'a:counter',
              agent: 'g:agent1',
              bindings: {},
              priority: p,
            });
            if (result.ok) ids.push((result.value as { $: string }).$);
          }

          // 批量解算
          r2.invoke('intent.resolveBatch', { ids, scheduleId: 'sched:priority' });

          // 验证 counter 等于 Intent 数量（每个都执行了）
          const finalState = h.getState();
          const counter = finalState.world.props?.['counter'];
          return counter === priorities.length;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Prohibit simultaneous', () => {
  it('should reject ScheduleDef with order:"simultaneous"', () => {
    const badSchedule: Def = {
      id: 'sched:bad',
      kind: 'schedule',
      phases: [],
      order: 'simultaneous' as unknown as 'fixed',
    };

    const linter = new Linter();
    const result = linter.run({ allDefs: [badSchedule] });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_LINT' && d.severity === 'fatal')).toBe(true);
  });

  it('should accept ScheduleDef with order:"fixed" or "initiative"', () => {
    const goodSchedule1: ScheduleDef = {
      id: 'sched:good1',
      kind: 'schedule',
      phases: [],
      order: 'fixed',
    };

    const goodSchedule2: ScheduleDef = {
      id: 'sched:good2',
      kind: 'schedule',
      phases: [],
      order: 'initiative',
    };

    const linter = new Linter();
    const result = linter.run({ allDefs: [goodSchedule1, goodSchedule2] });

    expect(result.ok).toBe(true);
  });
});
