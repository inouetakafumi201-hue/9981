import { describe, it, expect, beforeEach } from 'vitest';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerStructuralOps, makeItemMove } from '../structural-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import { resetIdCounters } from '../../state/ids.js';
import type { Ref } from '../../state/ids.js';
import type { Def } from '../../state/def.js';

const TEST_DEFS = new Map<string, Def>([
  ['d:room', { id: 'd:room', kind: 'node' }],
  ['d:street', { id: 'd:street', kind: 'node' }],
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:microscene', { id: 'd:microscene', kind: 'node' }],
]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  return { holder, registry };
}

describe('entity.place（需求9.1-9.8, 16.6）', () => {
  beforeEach(() => resetIdCounters());

  it('直接指定 nodeId 时把 Entity 放置到既有节点', () => {
    const { holder, registry } = setupRegistry();
    const node = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const nodeId = (node as { value: Ref }).value.$;
    const entityId = (entity as { value: Ref }).value.$;

    const result = registry.invoke('entity.place', { entityId, nodeId });
    expect(result.ok).toBe(true);
    expect(holder.getState().entities[entityId]?.node).toBe(nodeId);
  });

  it('既未指定 nodeId 也未指定 microScene 时返回 ok:false', () => {
    const { registry } = setupRegistry();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const result = registry.invoke('entity.place', { entityId: (entity as { value: Ref }).value.$ });
    expect(result.ok).toBe(false);
  });

  it('microScene 首次进入时创建微型场景（需求9.1-9.2）', () => {
    const { holder, registry } = setupRegistry();
    const hostNode = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:street' });
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const hostNodeId = (hostNode as { value: Ref }).value.$;
    const entityId = (entity as { value: Ref }).value.$;

    const result = registry.invoke<
      { entityId: string; microScene: { hostNodeId: string; microSceneDefId: string } },
      void
    >('entity.place', {
      entityId,
      microScene: { hostNodeId, microSceneDefId: 'd:microscene' },
    });
    expect(result.ok).toBe(true);
    const placedNodeId = holder.getState().entities[entityId]?.node;
    expect(placedNodeId).toBeDefined();
    expect(holder.getState().nodes[placedNodeId as string]?.parent).toBe(hostNodeId);
  });

  it('microScene 归零后自动卸载（需求9.3-9.5）：第二个实体离开后微型场景应被销毁', () => {
    const { holder, registry } = setupRegistry();
    const hostNode = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:street' });
    const hostNodeId = (hostNode as { value: Ref }).value.$;
    const e1 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e1Id = (e1 as { value: Ref }).value.$;

    const first = registry.invoke<
      { entityId: string; microScene: { hostNodeId: string; microSceneDefId: string } },
      void
    >('entity.place', { entityId: e1Id, microScene: { hostNodeId, microSceneDefId: 'd:microscene' } });
    expect(first.ok).toBe(true);
    const microSceneId = holder.getState().entities[e1Id]?.node as string;
    expect(holder.getState().nodes[microSceneId]).toBeDefined();

    // e1 离开：放回 hostNode（不再是微型场景），此时占用者归零，微型场景应被卸载
    const moveOut = registry.invoke('entity.place', { entityId: e1Id, nodeId: hostNodeId });
    expect(moveOut.ok).toBe(true);
    expect(holder.getState().nodes[microSceneId]).toBeUndefined();
  });

  it('microScene 容量超限时拒绝（需求9.6）', () => {
    const { holder, registry } = setupRegistry();
    const hostNode = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:street' });
    const hostNodeId = (hostNode as { value: Ref }).value.$;
    const e1 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e2 = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const e1Id = (e1 as { value: Ref }).value.$;
    const e2Id = (e2 as { value: Ref }).value.$;

    const first = registry.invoke<
      { entityId: string; microScene: { hostNodeId: string; microSceneDefId: string; capacity: number } },
      void
    >('entity.place', { entityId: e1Id, microScene: { hostNodeId, microSceneDefId: 'd:microscene', capacity: 1 } });
    expect(first.ok).toBe(true);
    const microSceneId = holder.getState().entities[e1Id]?.node as string;

    const second = registry.invoke<
      { entityId: string; microScene: { hostNodeId: string; existingMicroSceneId: string; microSceneDefId: string; capacity: number } },
      void
    >('entity.place', {
      entityId: e2Id,
      microScene: { hostNodeId, existingMicroSceneId: microSceneId, microSceneDefId: 'd:microscene', capacity: 1 },
    });
    expect(second.ok).toBe(false);
  });

  it('对不存在的 Entity 或 Node 调用返回 ok:false 而不抛异常', () => {
    const { registry } = setupRegistry();
    expect(() => registry.invoke('entity.place', { entityId: 'e:999', nodeId: 'n:999' })).not.toThrow();
    const result = registry.invoke('entity.place', { entityId: 'e:999', nodeId: 'n:999' });
    expect(result.ok).toBe(false);
  });
});
