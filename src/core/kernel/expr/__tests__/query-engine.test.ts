import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { QueryEngine, collectSourceRefs } from '../query-engine.js';
import { ExprEngine, makeDefaultEvalContext } from '../engine.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { createEntityShape } from '../../state/entity.js';
import type { WorldState } from '../../state/world-state.js';
import type { Ref } from '../../state/ids.js';

function makeStateWithEntities(hpValues: number[]): WorldState {
  let state = createEmptyWorldState('sched:1');
  hpValues.forEach((hp, i) => {
    const e = { ...createEntityShape(`e:${i}`, 'd:human'), props: { hp } };
    state = { ...state, entities: { ...state.entities, [e.id]: e } };
  });
  return state;
}

function makeDeps(state: WorldState) {
  const exprEngine = new ExprEngine();
  const ctxForSelf = (ref: Ref) =>
    makeDefaultEvalContext({
      self: ref,
      resolvePath: (path) => {
        const parts = path.split('.');
        let cur: unknown = state.entities[ref.$];
        for (const p of parts) {
          if (cur === null || typeof cur !== 'object') return null;
          cur = (cur as Record<string, unknown>)[p];
        }
        return (cur ?? null) as never;
      },
    });
  return { exprEngine, baseCtx: makeDefaultEvalContext(), ctxForSelf };
}

describe('QueryEngine（需求14.1-14.5）', () => {
  it('collectSourceRefs 正确分发各 from 取值', () => {
    const state = makeStateWithEntities([10, 20]);
    expect(collectSourceRefs(state, 'entities').map((r) => r.$).sort()).toEqual(['e:0', 'e:1']);
    expect(collectSourceRefs(state, 'log')).toEqual([]); // L1 阶段占位
  });

  it('where 过滤：仅保留满足谓词的结果', () => {
    const state = makeStateWithEntities([10, 20, 30]);
    const engine = new QueryEngine();
    const result = engine.run(state, { from: 'entities', where: { op: 'gt', args: [{ path: 'props.hp' }, 15] } }, makeDeps(state));
    expect(result.map((r) => r.$).sort()).toEqual(['e:1', 'e:2']);
  });

  it('orderBy/desc 排序', () => {
    const state = makeStateWithEntities([30, 10, 20]);
    const engine = new QueryEngine();
    const asc = engine.run(state, { from: 'entities', orderBy: { path: 'props.hp' } }, makeDeps(state));
    expect(asc.map((r) => r.$)).toEqual(['e:1', 'e:2', 'e:0']);
    const desc = engine.run(state, { from: 'entities', orderBy: { path: 'props.hp' }, desc: true }, makeDeps(state));
    expect(desc.map((r) => r.$)).toEqual(['e:0', 'e:2', 'e:1']);
  });

  it('limit 截断结果集', () => {
    const state = makeStateWithEntities([1, 2, 3, 4]);
    const engine = new QueryEngine();
    const result = engine.run(state, { from: 'entities', orderBy: { path: 'props.hp' }, limit: 2 }, makeDeps(state));
    expect(result.length).toBe(2);
  });

  it('Property: 对于任意 Query 与任意合法 WorldState，run 返回结果集中的每个 Ref 都应满足 where 谓词，且顺序与 orderBy/desc 一致（需求14.1-14.4）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 1, maxLength: 15 }),
        fc.integer({ min: -50, max: 50 }),
        fc.boolean(),
        (hpValues, threshold, desc) => {
          const state = makeStateWithEntities(hpValues);
          const engine = new QueryEngine();
          const result = engine.run(
            state,
            { from: 'entities', where: { op: 'gt', args: [{ path: 'props.hp' }, threshold] }, orderBy: { path: 'props.hp' }, desc },
            makeDeps(state),
          );
          // 全部满足 where
          for (const ref of result) {
            const hp = state.entities[ref.$]?.props.hp as number;
            expect(hp).toBeGreaterThan(threshold);
          }
          // 顺序正确
          const hps = result.map((r) => state.entities[r.$]?.props.hp as number);
          for (let i = 1; i < hps.length; i++) {
            if (desc) expect(hps[i - 1]).toBeGreaterThanOrEqual(hps[i] as number);
            else expect(hps[i - 1]).toBeLessThanOrEqual(hps[i] as number);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
