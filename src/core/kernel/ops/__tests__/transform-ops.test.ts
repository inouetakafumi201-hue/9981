import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerStructuralOps, makeItemMove } from '../structural-ops.js';
import { registerTransformOps } from '../transform-ops.js';
import { registerRelationOps } from '../relation-ops.js';
import { registerPropOps } from '../prop-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import { nextId } from '../../state/ids.js';
import { DefRegistry } from '../../state/def.js';
import type { Ref } from '../../state/ids.js';
import type { Def } from '../../state/def.js';

const TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:zombie', { id: 'd:zombie', kind: 'entity' }],
  ['d:robot', { id: 'd:robot', kind: 'entity' }],
  ['d:room', { id: 'd:room', kind: 'node' }],
  ['d:door', { id: 'd:door', kind: 'link' }],
]);
const testDefLookup = (id: string) => TEST_DEFS.get(id) ?? null;

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(registry, { itemMove, defLookup: testDefLookup });
  registerRelationOps(registry);
  registerTransformOps(registry, () => nextId('n'), testDefLookup);
  registerPropOps(registry, new DefRegistry());
  return { holder, registry };
}

describe('entity.setDef / node.merge / node.split：引用完整性（需求18.1-18.5）', () => {
  it('entity.setDef 保留 id，carry 声明的字段被保留，未声明的重置', () => {
    const { holder, registry } = setupRegistry();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const id = (entity as { value: Ref }).value.$;
    expect(registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 42 }).ok).toBe(true);
    expect(registry.invoke('tag.add', { ref: { collection: 'entities', id }, tag: 'wounded' }).ok).toBe(true);

    const result = registry.invoke('entity.setDef', { id, def: 'd:zombie', carry: ['props', 'tags'] });
    expect(result.ok).toBe(true);
    const after = holder.getState().entities[id];
    expect(after?.def).toBe('d:zombie');
    expect(after?.props.hp).toBe(42); // carry 保留
    expect(after?.tags).toContain('wounded');
  });

  it('entity.setDef 未声明 carry 的字段被重置', () => {
    const { holder, registry } = setupRegistry();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const id = (entity as { value: Ref }).value.$;
    expect(registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 42 }).ok).toBe(true);

    registry.invoke('entity.setDef', { id, def: 'd:zombie', carry: [] });
    const after = holder.getState().entities[id];
    expect(after?.props).toEqual({});
  });

  it('node.merge 保留原本指向 absorb 的 Link/占位者/子节点引用（不产生悬空引用，需求18.5）', () => {
    const { holder, registry } = setupRegistry();
    const keep = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const absorb = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const keepId = (keep as { value: Ref }).value.$;
    const absorbId = (absorb as { value: Ref }).value.$;
    const outside = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const outsideId = (outside as { value: Ref }).value.$;

    const linkResult = registry.invoke<{ a: string; b: string; def: string }, Ref>('link.create', { a: absorbId, b: outsideId, def: 'd:door' });
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const entityId = (entity as { value: Ref }).value.$;
    registry.invoke('prop.set', { path: `entities.${entityId}.props.dummy`, value: 1 }); // 占位写入以便后续手动设置 node
    // 手动放置占位者到 absorb（entity.place 未实现，这里直接改 draft 模拟）
    holder.setState({ ...holder.getState(), entities: { ...holder.getState().entities, [entityId]: { ...holder.getState().entities[entityId]!, node: absorbId } } });

    const mergeResult = registry.invoke('node.merge', { keep: keepId, absorb: absorbId, carry: ['attachments'] });
    expect(mergeResult.ok).toBe(true);
    expect(holder.getState().nodes[absorbId]).toBeUndefined();
    // Link 的端点应重定向到 keep
    const link = holder.getState().links[(linkResult as { value: Ref }).value.$];
    expect(link?.a === keepId || link?.b === keepId).toBe(true);
    // 占位者应重定向到 keep
    expect(holder.getState().entities[entityId]?.node).toBe(keepId);
  });

  it('node.split 将占位者按 spec 重新分配到新节点', () => {
    const { holder, registry } = setupRegistry();
    const original = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const originalId = (original as { value: Ref }).value.$;
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const entityId = (entity as { value: Ref }).value.$;
    holder.setState({ ...holder.getState(), entities: { ...holder.getState().entities, [entityId]: { ...holder.getState().entities[entityId]!, node: originalId } } });

    const splitResult = registry.invoke<{ id: string; specs: { key: string; def: string; entities?: string[] }[] }, string[]>('node.split', {
      id: originalId,
      specs: [
        { key: 'roomA', def: 'd:room', entities: [entityId] },
        { key: 'roomB', def: 'd:room' },
      ],
    });
    expect(splitResult.ok).toBe(true);
    expect(holder.getState().nodes[originalId]).toBeUndefined();
    if (splitResult.ok) {
      expect(holder.getState().entities[entityId]?.node).toBe(splitResult.value[0]);
    }
  });

  it('Property: 对于任意 entity.setDef 调用，调用前存在的 Relation（carry 包含 relations 时）应在调用后仍指向该 id', () => {
    fc.assert(
      fc.property(fc.constantFrom('d:human', 'd:zombie', 'd:robot'), (newDef) => {
        const { holder, registry } = setupRegistry();
        const a = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const b = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        const aId = (a as { value: Ref }).value.$;
        const bId = (b as { value: Ref }).value.$;
        registry.invoke('relation.set', { from: aId, to: bId, kind: 'knows' });

        registry.invoke('entity.setDef', { id: aId, def: newDef, carry: ['relations'] });
        const afterA = holder.getState().entities[aId];
        expect(afterA?.relations['knows']?.out).toContainEqual({ $: bId });
      }),
      { numRuns: 50 },
    );
  });
});
