/**
/**
 * L8×组合根: 光环自动重算的接线（需求30.2 拓扑变化无条件重算 / 30.5 共享事务）。
 *
 * 本次修补前，AuraEngine 只在测试里被手动调用——没有任何组合根把它接到 entity.place、node.merge、
 * attach.add 等 Op 的 after 阶段，意味着生产路径下光环永不自动重算。现在 wireHooksIntoRegistry 在这些
 * Op 的 after 阶段无条件调用 auraEngine.recomputeAll，与触发它的 Op 同一事务；重算经 setPath 写
 * aura 前缀 prop 而非走 Op，因此不重新触发 after 分发、无环。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { wireHooksIntoRegistry } from '../../wire-hooks';
import { WorldStateHolder } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { DefRegistry } from '../../state/def';
import { resetIdCounters } from '../../state/ids';
import { registerPropOps } from '../../ops/prop-ops';
import { registerStructuralOps, makeItemMove } from '../../ops/structural-ops';
import { registerAttachOps } from '../attach-ops';
import { ExprEngine } from '../../expr/engine';
import type { Def } from '../../state/def';

function setup() {
  const holder = new WorldStateHolder(createEmptyWorldState('s:sched'));
  const defRegistry = new DefRegistry();
  // 一个光环 Attachment：把常量 5 计算进 aura.d:glow prop
  defRegistry.register({ id: 'd:hero', kind: 'entity' } as Def);
  defRegistry.register({ id: 'd:room', kind: 'node' } as Def);
  defRegistry.register({
    id: 'd:glow', kind: 'attachment', stackStrategy: 'unique',
    aura: { deps: [], compute: 5 },
  } as unknown as Def);
  const defLookup = (id: string) => defRegistry.resolve(id);
  const exprEngine = new ExprEngine();
  const { registry } = wireHooksIntoRegistry({ holder, defLookup, flowDeps: { exprEngine, defRegistry } });
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => ({ vars: {}, budget: { depth: 0, maxDepth: 64 }, resolvePath: () => null }) });
  registerPropOps(registry, defRegistry);
  registerStructuralOps(registry, { itemMove, defLookup });
  registerAttachOps(registry, { defLookup });
  return { holder, registry };
}

describe('光环自动重算接线（需求30.2/30.5）', () => {
  beforeEach(() => resetIdCounters());

  /** entity.place 需要已存在的实体：先 entity.create 再 entity.place(entityId,nodeId)。 */
  function placeHero(registry: ReturnType<typeof setup>['registry'], nodeId: string): string {
    const created = registry.invoke<{ def: string }, { $: string }>('entity.create', { def: 'd:hero' });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('entity.create failed');
    const placed = registry.invoke('entity.place', { entityId: created.value.$, nodeId });
    expect(placed.ok).toBe(true);
    return created.value.$;
  }

  it('attach.add 一个光环后，after 阶段自动重算并写入 aura 前缀 prop', () => {
    const { holder, registry } = setup();
    const node = registry.invoke<{ def: string }, { $: string }>('node.create', { def: 'd:room' });
    expect(node.ok).toBe(true);
    if (!node.ok) return;
    const heroId = placeHero(registry, node.value.$);

    const added = registry.invoke('attach.add', { def: 'd:glow', target: { $: heroId } });
    expect(added.ok).toBe(true);
    // attach.add 的 after 阶段触发 recomputeAll → hero 的 aura.d:glow prop 被算为 5
    expect(holder.getState().entities[heroId]?.props['aura.d:glow']).toBe(5);
  });

  it('光环重算与触发 Op 同一事务：后续拓扑变化后光环 prop 不丢', () => {
    const { holder, registry } = setup();
    const node = registry.invoke<{ def: string }, { $: string }>('node.create', { def: 'd:room' });
    expect(node.ok).toBe(true);
    if (!node.ok) return;
    const heroId = placeHero(registry, node.value.$);
    registry.invoke('attach.add', { def: 'd:glow', target: { $: heroId } });
    expect(holder.getState().entities[heroId]?.props['aura.d:glow']).toBe(5);
    // 再触发一次拓扑变化（放置另一个实体）——recomputeAll 保持 hero 光环 prop 不丢
    placeHero(registry, node.value.$);
    expect(holder.getState().entities[heroId]?.props['aura.d:glow']).toBe(5);
  });

  it('无光环 Attachment 时，触发 Op 的 after 阶段重算不产生任何 aura prop（不误写）', () => {
    const { holder, registry } = setup();
    const node = registry.invoke<{ def: string }, { $: string }>('node.create', { def: 'd:room' });
    expect(node.ok).toBe(true);
    if (!node.ok) return;
    const heroId = placeHero(registry, node.value.$);
    const props = holder.getState().entities[heroId]?.props ?? {};
    expect(Object.keys(props).some((k) => k.startsWith('aura.'))).toBe(false);
  });
});
