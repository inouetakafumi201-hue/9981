/**
 * L11 Knowledge tests: cognitive query consistency property.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { WorldKnowledgeStore } from '../knowledge-store.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { setPath } from '../../ops/path.js';
import { QueryEngine } from '../../expr/query-engine.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import type { Value } from '../../state/value.js';

describe('L11 KnowledgeStore: getFacts / knows', () => {
  const store = new WorldKnowledgeStore();

  it('未知 agent 返回空 facts', () => {
    const state = createEmptyWorldState('sched:1');
    expect(store.getFacts(state, 'a:nobody')).toEqual({});
    expect(store.knows(state, 'a:nobody', 'hp')).toBeNull();
  });

  it('getFacts 返回 agent 的 facts', () => {
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.knowledge.a:agent1.facts.hp', 100);
    state = setPath(state, 'world.knowledge.a:agent1.facts.mp', 50);
    const facts = store.getFacts(state, 'a:agent1');
    expect(facts['hp']).toBe(100);
    expect(facts['mp']).toBe(50);
  });

  it('knows 返回已知 fact 的值', () => {
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.knowledge.a:agent1.facts.position', 'zone-A');
    expect(store.knows(state, 'a:agent1', 'position')).toBe('zone-A');
    expect(store.knows(state, 'a:agent1', 'unknown')).toBeNull();
  });

  it('getSeen 返回 seen 记录', () => {
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.knowledge.a:agent1.seen.enemy1', true);
    const seen = store.getSeen(state, 'a:agent1');
    expect(seen['enemy1']).toBe(true);
  });

  it('纯读结果深层隔离，不能借对象别名绕过 OpRegistry.invoke 改写 Knowledge', () => {
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.knowledge.a:agent1.facts.target', {
      location: 'n:hidden',
      trail: ['n:old'],
    });
    state = setPath(state, 'world.knowledge.a:agent1.seen.targets', ['e:one']);

    const facts = store.getFacts(state, 'a:agent1');
    const known = store.knows(state, 'a:agent1', 'target');
    const seen = store.getSeen(state, 'a:agent1');
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts['target'])).toBe(true);
    expect(Object.isFrozen((facts['target'] as { trail: Value }).trail)).toBe(true);
    expect(Object.isFrozen(known)).toBe(true);
    expect(Object.isFrozen(seen['targets'])).toBe(true);

    expect(() => {
      (facts['target'] as { location: string }).location = 'n:forged';
    }).toThrow();
    expect(() => {
      (seen['targets'] as Value[]).push('e:forged');
    }).toThrow();

    expect(state.world.knowledge['a:agent1']?.facts['target']).toEqual({
      location: 'n:hidden',
      trail: ['n:old'],
    });
    expect(state.world.knowledge['a:agent1']?.seen['targets']).toEqual(['e:one']);
  });

  it('Property: cognitive query consistency — getFacts 包含所有 knows 为非 null 的 keys', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.string({ minLength: 1, maxLength: 8 }), fc.oneof(fc.integer({ min: 0, max: 100 }), fc.string({ maxLength: 5 }))),
          { minLength: 0, maxLength: 8 },
        ),
        (pairs) => {
          let state = createEmptyWorldState('sched:1');
          for (const [key, value] of pairs) {
            state = setPath(state, `world.knowledge.a:ag1.facts.${key}`, value as never);
          }
          const facts = store.getFacts(state, 'a:ag1');
          for (const [key] of pairs) {
            const val = store.knows(state, 'a:ag1', key);
            if (val !== null) {
              expect(Object.prototype.hasOwnProperty.call(facts, key)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('L11 visibleTo filter in QueryEngine', () => {
  it('visibleTo 过滤掉结果为 false 的 refs', async () => {
    const { QueryEngine } = await import('../../expr/query-engine.js');
    const { ExprEngine, makeDefaultEvalContext } = await import('../../expr/engine.js');

    let state = createEmptyWorldState('sched:1');
    // Add two intents: one hidden, one visible
    state = {
      ...state,
      world: {
        ...state.world,
        intents: {
          'g:1': { id: 'g:1', agent: 'a:1', action: 'act:1', bindings: {}, submittedAt: 0, hidden: true, status: 'pending' },
          'g:2': { id: 'g:2', agent: 'a:2', action: 'act:1', bindings: {}, submittedAt: 0, hidden: false, status: 'pending' },
        },
      },
    };

    const exprEngine = new ExprEngine();
    const engine = new QueryEngine();
    const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });

    // Query intents where hidden=false via visibleTo
    const refs = engine.run(state, {
      from: 'intents',
      visibleTo: { op: 'eq', args: [false, { path: 'hidden' }] },
    }, {
      exprEngine,
      baseCtx,
      ctxForSelf: (ref) => makeDefaultEvalContext({
        vars: { self: ref },
        resolvePath: (path) => {
          const parts = path.split('.');
          const intent = (state.world.intents as unknown as Record<string, Record<string, unknown>>)[ref.$];
          if (!intent) return null;
          return (intent[parts[0]!] ?? null) as never;
        },
      }),
    });
    // g:1 is hidden=true so visibleTo(false eq hidden=true) = false eq true = false => filtered out
    // g:2 is hidden=false so visibleTo(false eq hidden=false) = false eq false = true => kept
    expect(refs.map((r) => r.$)).toEqual(['g:2']);
  });

  it('visibleTo 仅严格 true 放行；null、缺失路径和其他非布尔值全部失败关闭', () => {
    const state = {
      ...createEmptyWorldState('sched:1'),
      entities: {
        'e:1': { id: 'e:1', def: 'd:entity', tags: [], props: {}, containers: {}, attachments: [], relations: {} },
      },
    };
    const exprEngine = new ExprEngine();
    const engine = new QueryEngine();
    const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });
    const deps = {
      exprEngine,
      baseCtx,
      ctxForSelf: () => makeDefaultEvalContext({ resolvePath: () => null }),
    };

    expect(engine.run(state, { from: 'entities', visibleTo: true }, deps)).toEqual([{ $: 'e:1' }]);
    for (const visibility of [false, null, 0, 1, '', 'true', { path: 'missing' }] as const) {
      expect(engine.run(state, { from: 'entities', visibleTo: visibility }, deps)).toEqual([]);
    }
  });

  it('Property: 任意非 true JSON 标量都不能越过 visibleTo', () => {
    const state = {
      ...createEmptyWorldState('sched:1'),
      entities: {
        'e:1': { id: 'e:1', def: 'd:entity', tags: [], props: {}, containers: {}, attachments: [], relations: {} },
      },
    };
    const exprEngine = new ExprEngine();
    const engine = new QueryEngine();
    const deps = {
      exprEngine,
      baseCtx: makeDefaultEvalContext(),
      ctxForSelf: () => makeDefaultEvalContext(),
    };

    fc.assert(fc.property(
      fc.oneof(
        fc.constant(false),
        fc.constant(null),
        fc.integer(),
        fc.string(),
      ),
      (visibility) => {
        expect(engine.run(state, { from: 'entities', visibleTo: visibility }, deps)).toEqual([]);
      },
    ), { numRuns: 200 });
  });
});

describe('L11 KnowledgeStore property tests: consistency and isolation', () => {
  const store = new WorldKnowledgeStore();

  it('getFacts 返回空 facts 时 knows 返回 null（无 entry agent）', () => {
    let state = createEmptyWorldState('sched:1');
    // No knowledge entry at all
    expect(store.getFacts(state, 'a:ghost')).toEqual({});
    expect(store.knows(state, 'a:ghost', 'anything')).toBeNull();
    expect(store.getSeen(state, 'a:ghost')).toEqual({});
  });

  it('facts 为空对象（entry 存在但 facts={}）时 knows 返回 null', () => {
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.knowledge.a:empty.facts', {});
    expect(store.getFacts(state, 'a:empty')).toEqual({});
    expect(store.knows(state, 'a:empty', 'x')).toBeNull();
  });

  it('Property: 多 agent facts 隔离（每个 agent 的 facts 独立）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (valA, valB) => {
          let state = createEmptyWorldState('sched:1');
          state = setPath(state, 'world.knowledge.a:A.facts.score', valA);
          state = setPath(state, 'world.knowledge.a:B.facts.score', valB);
          const factsA = store.getFacts(state, 'a:A');
          const factsB = store.getFacts(state, 'a:B');
          expect(factsA['score']).toBe(valA);
          expect(factsB['score']).toBe(valB);
          // Isolation: A's fact should NOT contain B's value
          expect(Object.prototype.hasOwnProperty.call(factsA, 'score')).toBe(true);
          expect(Object.prototype.hasOwnProperty.call(factsB, 'score')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: 同一 agent 多次 setPath 后 knows 返回最新值', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 9999 }),
        (first, second) => {
          let state = createEmptyWorldState('sched:1');
          state = setPath(state, 'world.knowledge.a:update.facts.health', first);
          state = setPath(state, 'world.knowledge.a:update.facts.health', second);
          const latest = store.knows(state, 'a:update', 'health');
          expect(latest).toBe(second);
          const facts = store.getFacts(state, 'a:update');
          expect(facts['health']).toBe(second);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: getSeen 与 getFacts 返回不同记录（facts/seen 字段独立）', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasFact, hasSeen) => {
        let state = createEmptyWorldState('sched:1');
        if (hasFact) state = setPath(state, 'world.knowledge.a:test.facts.visible', true);
        if (hasSeen) state = setPath(state, 'world.knowledge.a:test.seen.enemy', true);
        const facts = store.getFacts(state, 'a:test');
        const seen = store.getSeen(state, 'a:test');
        expect(Object.prototype.hasOwnProperty.call(facts, 'visible')).toBe(hasFact);
        expect(Object.prototype.hasOwnProperty.call(seen, 'enemy')).toBe(hasSeen);
      }),
      { numRuns: 100 },
    );
  });

  it('Property: visibleTo 过滤多个 intent 时 hidden/intentId 多样性覆盖', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 5 }),
        (hiddenArr) => {
          // Deduplicate into a Set
          const hiddenIndices = new Set(hiddenArr);
          // Build state with 5 intents, some hidden
          const intents: Record<string, unknown> = {};
          for (let i = 1; i <= 5; i++) {
            intents[`g:${i}`] = {
              id: `g:${i}`,
              agent: `a:${i}`,
              action: 'act:1',
              bindings: {},
              submittedAt: 0,
              hidden: hiddenIndices.has(i),
              status: 'pending',
            };
          }
          let state: ReturnType<typeof createEmptyWorldState> = createEmptyWorldState('sched:1');
          state = { ...state, world: { ...state.world, intents: intents as never } };

          const exprEngine = new ExprEngine();
          const engine = new QueryEngine();
          const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });

          const refs = engine.run(state, {
            from: 'intents',
            visibleTo: { op: 'eq', args: [false, { path: 'hidden' }] },
          }, {
            exprEngine,
            baseCtx,
            ctxForSelf: (ref: { $: string }) => makeDefaultEvalContext({
              vars: { self: ref },
              resolvePath: (path: string) => {
                const parts = path.split('.');
                const intent = (state.world.intents as unknown as Record<string, Record<string, unknown>>)[ref.$];
                if (!intent) return null;
                return (intent[parts[0]!] ?? null) as never;
              },
            }),
          });

          const visibleIds = refs.map((r: { $: string }) => r.$);
          // Should contain exactly the non-hidden intents
          expect(visibleIds.length).toBe(5 - hiddenIndices.size);
          for (let i = 1; i <= 5; i++) {
            const id = `g:${i}`;
            if (hiddenIndices.has(i)) {
              expect(visibleIds).not.toContain(id);
            } else {
              expect(visibleIds).toContain(id);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
