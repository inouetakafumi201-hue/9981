import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerStructuralOps, makeItemMove } from '../structural-ops.js';
import { registerRelationOps, relOut, relIn } from '../relation-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import type { Ref } from '../../state/ids.js';
import type { Def } from '../../state/def.js';

const TEST_DEFS = new Map<string, Def>([['d:human', { id: 'd:human', kind: 'entity' }]]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  registerRelationOps(registry);
  return { holder, registry };
}

describe('relation.set/del 作为公开 Op（需求6.1-6.7, 16.1）', () => {
  it('relation.set 同时更新双方 Entity.relations，对称镜像（需求6.2, 20.8）', () => {
    const { holder, registry } = setupRegistry();
    const a = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const b = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const aId = (a as { value: Ref }).value.$;
    const bId = (b as { value: Ref }).value.$;

    const result = registry.invoke('relation.set', { from: aId, to: bId, kind: 'knows' });
    expect(result.ok).toBe(true);
    expect(relOut(holder.getState().entities, { $: aId }, 'knows')).toContainEqual({ $: bId });
    expect(relIn(holder.getState().entities, { $: bId }, 'knows')).toContainEqual({ $: aId });
  });

  it('relation.del 移除双方镜像', () => {
    const { holder, registry } = setupRegistry();
    const a = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const b = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const aId = (a as { value: Ref }).value.$;
    const bId = (b as { value: Ref }).value.$;
    registry.invoke('relation.set', { from: aId, to: bId, kind: 'knows' });
    registry.invoke('relation.del', { from: aId, to: bId, kind: 'knows' });
    expect(relOut(holder.getState().entities, { $: aId }, 'knows')).toEqual([]);
    expect(relIn(holder.getState().entities, { $: bId }, 'knows')).toEqual([]);
  });

  it('销毁 Entity 时级联移除以其为端点的全部 Relation（需求6.6）', () => {
    const { holder, registry } = setupRegistry();
    const a = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const b = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const aId = (a as { value: Ref }).value.$;
    const bId = (b as { value: Ref }).value.$;
    registry.invoke('relation.set', { from: aId, to: bId, kind: 'knows' });

    registry.invoke('entity.destroy', { id: aId });
    expect(relIn(holder.getState().entities, { $: bId }, 'knows')).toEqual([]);
  });

  it('relation.set 引用不存在的对象时返回 ok:false', () => {
    const { registry } = setupRegistry();
    const result = registry.invoke('relation.set', { from: 'e:999', to: 'e:998', kind: 'knows' });
    expect(result.ok).toBe(false);
  });

  it('Property: 对于任意 relation.set(a,b,k) 调用，relOut(a,k) 应包含 b 且 relIn(b,k) 应包含 a；销毁 a 后以 a 为端点的关系应消失（需求6.6, 20.8）', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('knows', 'owns', 'allies'), { minLength: 1, maxLength: 5 }), (kinds) => {
        const { holder, registry } = setupRegistry();
        const a = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const b = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const aId = (a as { value: Ref }).value.$;
        const bId = (b as { value: Ref }).value.$;
        for (const kind of kinds) {
          registry.invoke('relation.set', { from: aId, to: bId, kind });
        }
        for (const kind of kinds) {
          expect(relOut(holder.getState().entities, { $: aId }, kind)).toContainEqual({ $: bId });
          expect(relIn(holder.getState().entities, { $: bId }, kind)).toContainEqual({ $: aId });
        }
        registry.invoke('entity.destroy', { id: aId });
        for (const kind of kinds) {
          expect(relIn(holder.getState().entities, { $: bId }, kind)).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
