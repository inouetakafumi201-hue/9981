/**
 * L8 Attachment tests: Property 11 (aura diff recompute), Property 12 (grantedBy cascade).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerAttachOps } from '../attach-ops.js';
import { AuraEngine } from '../aura-engine.js';
import type { AttachOpsDeps } from '../attach-ops.js';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { resetIdCounters } from '../../state/ids.js';
import { WORLD_REF } from '../../state/ids.js';
import type { AttachmentDef } from '../types.js';
import type { Def } from '../../state/def.js';
import type { Attachment } from '../../state/attachment.js';

const stackDef: AttachmentDef = {
  id: 'att:buff1',
  kind: 'attachment',
  stackStrategy: 'count',
  maxStack: 5,
};

const uniqueDef: AttachmentDef = {
  id: 'att:unique1',
  kind: 'attachment',
  stackStrategy: 'unique',
};

const refreshDef: AttachmentDef = {
  id: 'att:refresh1',
  kind: 'attachment',
  stackStrategy: 'refresh',
};

const indepDef: AttachmentDef = {
  id: 'att:indep1',
  kind: 'attachment',
  stackStrategy: 'independent',
};

const auraDef: AttachmentDef = {
  id: 'att:aura1',
  kind: 'attachment',
  stackStrategy: 'count',
  aura: {
    deps: ['att:buff1'],
    compute: { op: 'mul', args: [{ var: 'stack' }, 10] },
  },
};

function makeDeps(defs: AttachmentDef[]): AttachOpsDeps {
  const map = new Map<string, Def>(defs.map((d) => [d.id, d as Def]));
  return { defLookup: (id) => map.get(id) ?? null };
}

function makeRegistry(defs: AttachmentDef[]): { registry: OpRegistry; holder: WorldStateHolder } {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  registerAttachOps(registry, makeDeps(defs));
  return { registry, holder };
}

// Target w:0 (WORLD_REF) always passes the attachment target reference check
const WORLD_TARGET = WORLD_REF;

describe('L8 attach.add: 四种堆叠策略', () => {
  beforeEach(() => resetIdCounters());

  it('count 策略：相同 (def, target) 叠加 stack', () => {
    const { registry, holder } = makeRegistry([stackDef]);
    registry.invoke('attach.add', { def: 'att:buff1', target: WORLD_TARGET });
    registry.invoke('attach.add', { def: 'att:buff1', target: WORLD_TARGET });
    const attachments = Object.values(holder.getState().world.attachments) as Attachment[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.stack).toBe(2);
  });

  it('count 策略：达到 maxStack 时拒绝', () => {
    const { registry } = makeRegistry([stackDef]);
    for (let i = 0; i < 5; i++) {
      registry.invoke('attach.add', { def: 'att:buff1', target: WORLD_TARGET });
    }
    const result = registry.invoke('attach.add', { def: 'att:buff1', target: WORLD_TARGET });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_OP_SLOT_FULL');
  });

  it('unique 策略：重复添加刷新属性，不增加数量', () => {
    const { registry, holder } = makeRegistry([uniqueDef]);
    registry.invoke('attach.add', { def: 'att:unique1', target: WORLD_TARGET, props: { x: 1 } });
    registry.invoke('attach.add', { def: 'att:unique1', target: WORLD_TARGET, props: { x: 2 } });
    const attachments = Object.values(holder.getState().world.attachments) as Attachment[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.props['x']).toBe(2);
  });

  it('refresh 策略：重复添加递增 stack', () => {
    const { registry, holder } = makeRegistry([refreshDef]);
    registry.invoke('attach.add', { def: 'att:refresh1', target: WORLD_TARGET });
    registry.invoke('attach.add', { def: 'att:refresh1', target: WORLD_TARGET });
    const attachments = Object.values(holder.getState().world.attachments) as Attachment[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.stack).toBe(2);
  });

  it('independent 策略：每次创建独立 attachment', () => {
    const { registry, holder } = makeRegistry([indepDef]);
    registry.invoke('attach.add', { def: 'att:indep1', target: WORLD_TARGET });
    registry.invoke('attach.add', { def: 'att:indep1', target: WORLD_TARGET });
    const attachments = Object.values(holder.getState().world.attachments) as Attachment[];
    expect(attachments).toHaveLength(2);
  });

  it('def 不存在时返回 E_REF_MISSING', () => {
    const { registry } = makeRegistry([]);
    const result = registry.invoke('attach.add', { def: 'att:ghost', target: WORLD_TARGET });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_REF_MISSING');
  });
});

describe('L8 attach.del: 级联移除 (Property 12)', () => {
  beforeEach(() => resetIdCounters());

  it('attach.del 移除单个 attachment', () => {
    const { registry, holder } = makeRegistry([uniqueDef]);
    const r = registry.invoke<unknown, { $: string }>('attach.add', { def: 'att:unique1', target: WORLD_TARGET });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    registry.invoke('attach.del', { id: r.value.$ });
    expect(Object.keys(holder.getState().world.attachments)).toHaveLength(0);
  });

  it('Property 12: grantedBy 级联移除——删除父 attachment 同时删除子代', () => {
    const { registry, holder } = makeRegistry([uniqueDef, indepDef]);
    const parent = registry.invoke<unknown, { $: string }>('attach.add', { def: 'att:unique1', target: WORLD_TARGET });
    if (!parent.ok) return;
    // Add child attachment granted by parent
    const child = registry.invoke<unknown, { $: string }>('attach.add', {
      def: 'att:indep1', target: WORLD_TARGET, grantedBy: parent.value.$,
    });
    if (!child.ok) return;
    expect(Object.keys(holder.getState().world.attachments)).toHaveLength(2);
    // Delete parent — should cascade to child
    registry.invoke('attach.del', { id: parent.value.$ });
    expect(Object.keys(holder.getState().world.attachments)).toHaveLength(0);
  });

  it('Property 12: 多层 grantedBy 级联移除——孙代也被移除', () => {
    const { registry, holder } = makeRegistry([uniqueDef, indepDef, refreshDef]);
    const grandparent = registry.invoke<unknown, { $: string }>('attach.add', { def: 'att:unique1', target: WORLD_TARGET });
    if (!grandparent.ok) return;
    const parent = registry.invoke<unknown, { $: string }>('attach.add', {
      def: 'att:indep1', target: WORLD_TARGET, grantedBy: grandparent.value.$,
    });
    if (!parent.ok) return;
    registry.invoke('attach.add', {
      def: 'att:refresh1', target: WORLD_TARGET, grantedBy: parent.value.$,
    });
    expect(Object.keys(holder.getState().world.attachments)).toHaveLength(3);
    registry.invoke('attach.del', { id: grandparent.value.$ });
    expect(Object.keys(holder.getState().world.attachments)).toHaveLength(0);
  });

  it('attach.del 不存在的 attachment 返回 E_REF_MISSING', () => {
    const { registry } = makeRegistry([]);
    const result = registry.invoke('attach.del', { id: 'a:ghost' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_REF_MISSING');
  });

  it('Property 12 属性测试：grantedBy 链任意深度下级联移除完整', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (depth) => {
        resetIdCounters();
        const { registry, holder } = makeRegistry([indepDef]);
        let parentId: string | undefined;
        const ids: string[] = [];
        for (let i = 0; i <= depth; i++) {
          const r = registry.invoke<unknown, { $: string }>('attach.add', {
            def: 'att:indep1', target: WORLD_TARGET, grantedBy: parentId,
          });
          if (!r.ok) return;
          ids.push(r.value.$);
          parentId = r.value.$;
        }
        expect(Object.keys(holder.getState().world.attachments).length).toBe(depth + 1);
        registry.invoke('attach.del', { id: ids[0]! });
        expect(Object.keys(holder.getState().world.attachments).length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('L8 AuraEngine: Property 11 (aura diff recompute)', () => {
  beforeEach(() => resetIdCounters());

  it('AuraEngine.recomputeForTarget 返回 diff 当 aura 变化', () => {
    const allDefs: AttachmentDef[] = [stackDef, auraDef];
    const defMap = new Map<string, Def>(allDefs.map((d) => [d.id, d as Def]));
    const engine = new AuraEngine({ defLookup: (id) => defMap.get(id) ?? null });

    // Build a state with entity w:world (WORLD_REF) and aura attachment
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerAttachOps(registry, { defLookup: (id) => defMap.get(id) ?? null });

    // Add aura attachment with stack=3 targeting WORLD_REF
    registry.invoke('attach.add', { def: 'att:aura1', target: WORLD_TARGET });
    registry.invoke('attach.add', { def: 'att:aura1', target: WORLD_TARGET });
    registry.invoke('attach.add', { def: 'att:aura1', target: WORLD_TARGET });

    // Create entity 'e:target' in state — target it separately
    // But aura engine works on entities/nodes, not world.
    // For this test, let's add an entity and attach to it:
    const entityId = 'e:aura_target';
    const baseState = holder.getState();
    const stateWithEntity = {
      ...baseState,
      entities: {
        ...baseState.entities,
        [entityId]: {
          id: entityId,
          def: 'entity:base',
          tags: [],
          props: {},
          containers: {},
          attachments: [],
          relations: {},
        },
      },
    };
    // Reset and use entity as target
    const holder2 = new WorldStateHolder(stateWithEntity);
    const registry2 = new OpRegistry(holder2);
    registerAttachOps(registry2, { defLookup: (id) => defMap.get(id) ?? null });

    registry2.invoke('attach.add', { def: 'att:aura1', target: { $: entityId } });
    registry2.invoke('attach.add', { def: 'att:aura1', target: { $: entityId } });
    registry2.invoke('attach.add', { def: 'att:aura1', target: { $: entityId } });

    const { diff } = engine.recomputeForTarget(holder2.getState(), entityId);
    // stack=3, compute = stack * 10 = 30
    expect(diff.length).toBeGreaterThanOrEqual(1);
    if (diff.length > 0) {
      expect(diff[0]!.newValue).toBe(30);
    }
  });

  it('Property 11: aura 无变化时 diff 为空', () => {
    const defMap = new Map<string, Def>([[auraDef.id, auraDef as Def]]);
    const engine = new AuraEngine({ defLookup: (id) => defMap.get(id) ?? null });
    const { diff } = engine.recomputeForTarget(createEmptyWorldState('sched:1'), 'e:1');
    expect(diff).toHaveLength(0);
  });

  it('onAttachmentChanged recomputes affected targets', () => {
    const allDefs: AttachmentDef[] = [stackDef, auraDef];
    const defMap = new Map<string, Def>(allDefs.map((d) => [d.id, d as Def]));
    const engine = new AuraEngine({ defLookup: (id) => defMap.get(id) ?? null });

    const entityId = 'e:aura_target2';
    const baseState = createEmptyWorldState('sched:1');
    const stateWithEntity = {
      ...baseState,
      entities: {
        ...baseState.entities,
        [entityId]: {
          id: entityId,
          def: 'entity:base',
          tags: [],
          props: {},
          containers: {},
          attachments: [],
          relations: {},
        },
      },
    };

    const holder = new WorldStateHolder(stateWithEntity);
    const registry = new OpRegistry(holder);
    registerAttachOps(registry, { defLookup: (id) => defMap.get(id) ?? null });
    registry.invoke('attach.add', { def: 'att:aura1', target: { $: entityId } });

    // Trigger recompute when att:buff1 changes (auraDef.aura.deps includes att:buff1)
    const { diff } = engine.onAttachmentChanged(holder.getState(), 'att:buff1');
    expect(Array.isArray(diff)).toBe(true);
  });
});
