import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ActionCatalog } from '../catalog';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import { QueryEngine } from '../../expr/query-engine';
import { createEmptyWorldState } from '../../state/world-state';
import { createEntityShape } from '../../state/entity';
import type { ActionDef } from '../types';
import type { WorldState } from '../../state/world-state';

function setup(state: WorldState, actions: ActionDef[]) {
  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const catalog = new ActionCatalog({
    getState: () => state,
    exprEngine,
    queryEngine,
    listActionDefs: () => actions,
    ctxForActor: (actor, bindings) =>
      makeDefaultEvalContext({
        self: actor,
        vars: bindings,
        resolvePath: (path) => {
          const parts = path.split('.');
          let cur: unknown = state;
          for (const p of parts) {
            if (cur === null || typeof cur !== 'object') return null;
            cur = (cur as Record<string, unknown>)[p];
          }
          return (cur ?? null) as never;
        },
      }),
  });
  return catalog;
}

describe('ActionCatalog.queryActions（需求25.1-25.7, 44.1）', () => {
  it('require 满足时着法出现在结果中（需求25.4 的正向情形）', () => {
    let state = createEmptyWorldState('sched:1');
    const e = { ...createEntityShape('e:1', 'd:human'), props: { hp: 50 } };
    state = { ...state, entities: { 'e:1': e } };
    const action: ActionDef = { id: 'a:heal', kind: 'action', label: 'Heal', require: { op: 'gt', args: [{ path: 'entities.e:1.props.hp' }, 0] }, effects: [], track: 'highlight' };
    const catalog = setup(state, [action]);
    const result = catalog.queryActions({ $: 'e:1' }, 'ui');
    expect(result.some((r) => r.action === 'a:heal')).toBe(true);
  });

  it('require 不满足且 visible 未声明（默认不可见）时不出现在结果中（需求25.4）', () => {
    let state = createEmptyWorldState('sched:1');
    const e = { ...createEntityShape('e:1', 'd:human'), props: { hp: 0 } };
    state = { ...state, entities: { 'e:1': e } };
    const action: ActionDef = { id: 'a:heal', kind: 'action', label: 'Heal', require: { op: 'gt', args: [{ path: 'entities.e:1.props.hp' }, 0] }, effects: [], track: 'highlight' };
    const catalog = setup(state, [action]);
    const result = catalog.queryActions({ $: 'e:1' }, 'ui');
    expect(result.some((r) => r.action === 'a:heal')).toBe(false);
  });

  it('visible 满足但 require 不满足时灰显出现，携带 reason（需求25.5）', () => {
    let state = createEmptyWorldState('sched:1');
    const e = { ...createEntityShape('e:1', 'd:human'), props: { hp: 0 } };
    state = { ...state, entities: { 'e:1': e } };
    const action: ActionDef = {
      id: 'a:heal',
      kind: 'action',
      label: 'Heal',
      require: { op: 'gt', args: [{ path: 'entities.e:1.props.hp' }, 0] },
      visible: true,
      reason: '生命值为零，无法治疗',
      effects: [], track: 'highlight',
    };
    const catalog = setup(state, [action]);
    const result = catalog.queryActions({ $: 'e:1' }, 'ui');
    const found = result.find((r) => r.action === 'a:heal');
    expect(found).toBeDefined();
    expect(found?.reason).toBe('生命值为零，无法治疗');
  });

  it('Property 13: queryActions 对 ui/ai 模式一致性（忽略 range/count 展开粒度差异后应完全相同，需求25.3, 44.1）', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10, max: 100 }), (hp) => {
        let state = createEmptyWorldState('sched:1');
        const e = { ...createEntityShape('e:1', 'd:human'), props: { hp } };
        state = { ...state, entities: { 'e:1': e } };
        const action: ActionDef = {
          id: 'a:heal',
          kind: 'action',
          label: 'Heal',
          require: { op: 'gt', args: [{ path: 'entities.e:1.props.hp' }, 0] },
          effects: [], track: 'highlight',
        };
        const catalog = setup(state, [action]);
        const uiResult = catalog.queryActions({ $: 'e:1' }, 'ui');
        const aiResult = catalog.queryActions({ $: 'e:1' }, 'ai');
        // 无 range/count 的 target，两种模式的结果集合应完全一致
        expect(uiResult.map((r) => r.action).sort()).toEqual(aiResult.map((r) => r.action).sort());
      }),
      { numRuns: 100 },
    );
  });

  it('range TargetSpec：ai 模式只采样有限点，ui 模式返回完整区间（需求25.7）', () => {
    const state = createEmptyWorldState('sched:1');
    const action: ActionDef = {
      id: 'a:throw',
      kind: 'action',
      label: 'Throw',
      targets: [{ name: 'power', range: { min: 1, max: 100, step: 1 } }],
      effects: [], track: 'highlight',
    };
    const catalog = setup(state, [action]);
    const uiResult = catalog.queryActions({ $: 'w:0' }, 'ui');
    const aiResult = catalog.queryActions({ $: 'w:0' }, 'ai');
    expect(uiResult.length).toBe(100); // 完整区间
    expect(aiResult.length).toBeLessThan(20); // 有限采样点
  });

  it('新增 ActionDef 后自动纳入 queryActions 结果，不需要修改 catalog 本身（需求44.2 的雏形，完整 Policy 接线在 L9）', () => {
    const state = createEmptyWorldState('sched:1');
    const actionsRef: ActionDef[] = [{ id: 'a:old', kind: 'action', label: 'Old', effects: [], track: 'highlight' }];
    const catalog = new ActionCatalog({
      getState: () => state,
      queryEngine: new QueryEngine(),
      listActionDefs: () => actionsRef,
      ctxForActor: () => makeDefaultEvalContext(),
    });
    const before = catalog.queryActions({ $: 'w:0' }, 'ui');
    actionsRef.push({ id: 'a:new', kind: 'action', label: 'New', effects: [], track: 'highlight' });
    const after = catalog.queryActions({ $: 'w:0' }, 'ui');
    expect(before.some((r) => r.action === 'a:new')).toBe(false);
    expect(after.some((r) => r.action === 'a:new')).toBe(true);
  });
});
