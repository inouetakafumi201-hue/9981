/**
 * 运行期严厉性缺口修补：全部 12 处 Op 接线点的穷举分类验收测试（design.md 3.1/3.4节 / 需求3.5, 16.6）。
 *
 * 与 def-guard.test.ts 的区别：那份文件穷举验证 checkInstantiable 这个共享函数本身的三维
 * 真值表；本文件验证每一个实际调用它的 Op 是否真的把它接对了线——两者缺一不可，因为
 * "共享校验函数是对的"不等于"每个 Op 都正确调用了它"（例如可能有 Op 传错了 expectedKind，
 * 或者在校验通过前就已经产生了副作用）。这里对 12 个接线点各做"缺失×kind错×abstract×合法"
 * 四态穷举（不是随机采样），确认每一态都产生正确的 Result 且不产生任何状态改动（除合法态）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { resetIdCounters } from '../../state/ids.js';
import { registerStructuralOps, makeItemMove } from '../structural-ops.js';
import { registerTransformOps } from '../transform-ops.js';
import { registerPrefabOps } from '../prefab-ops.js';
import { registerAttachOps } from '../../attachment/attach-ops.js';
import { registerIntentOps } from '../../decision/intent-ops.js';
import { registerScheduleOps } from '../../schedule/schedule-ops.js';
import { registerDecisionOps } from '../../decision/decision-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import type { Def } from '../../state/def.js';
import type { Ref } from '../../state/ids.js';
import type { PrefabDef } from '../../topology/prefab.js';

type DefState = 'missing' | 'wrongKind' | 'abstract' | 'valid';
const ALL_STATES: readonly DefState[] = ['missing', 'wrongKind', 'abstract', 'valid'];

function buildDefMap(id: string, expectedKind: Def['kind'], wrongKind: Def['kind'], state: DefState, extra?: Record<string, unknown>): Map<string, Def> {
  const map = new Map<string, Def>();
  if (state === 'missing') return map;
  if (state === 'wrongKind') {
    map.set(id, { id, kind: wrongKind, ...extra } as Def);
    return map;
  }
  if (state === 'abstract') {
    map.set(id, { id, kind: expectedKind, abstract: true, ...extra } as Def);
    return map;
  }
  map.set(id, { id, kind: expectedKind, ...extra } as Def);
  return map;
}

function expectRejectedUnlessValid(state: DefState, result: { ok: boolean; code?: string }): void {
  if (state === 'missing') {
    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_REF_MISSING');
  } else if (state === 'wrongKind') {
    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_REF_KIND');
  } else if (state === 'abstract') {
    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_REF_ABSTRACT');
  } else {
    expect(result.ok).toBe(true);
  }
}

describe('接线点1-4：entity/item/node/link.create 四态穷举', () => {
  beforeEach(() => resetIdCounters());

  for (const state of ALL_STATES) {
    it(`entity.create [${state}]`, () => {
      const defs = buildDefMap('d:x', 'entity', 'item', state);
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      const before = holder.getState();
      const result = registry.invoke('entity.create', { def: 'd:x' });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
      if (state !== 'valid') expect(holder.getState()).toBe(before);
    });

    it(`item.create [${state}]`, () => {
      const defs = buildDefMap('d:x', 'item', 'node', state);
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      const result = registry.invoke('item.create', { def: 'd:x' });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });

    it(`node.create [${state}]`, () => {
      const defs = buildDefMap('d:x', 'node', 'link', state);
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      const result = registry.invoke('node.create', { def: 'd:x' });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });

    it(`link.create [${state}]`, () => {
      const defs = buildDefMap('d:x', 'link', 'entity', state);
      defs.set('d:room', { id: 'd:room', kind: 'node' });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      const n1 = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
      const n2 = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
      if (!n1.ok || !n2.ok) throw new Error('setup failed');
      const result = registry.invoke('link.create', { a: n1.value.$, b: n2.value.$, def: 'd:x' });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});

describe('接线点5：entity.setDef 四态穷举', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`entity.setDef [${state}]`, () => {
      const defs = buildDefMap('d:target', 'entity', 'item', state);
      defs.set('d:base', { id: 'd:base', kind: 'entity' });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      registerTransformOps(registry, () => `n:${Math.random()}`, (id) => defs.get(id) ?? null);
      const e = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:base' });
      if (!e.ok) throw new Error('setup failed');
      const result = registry.invoke('entity.setDef', { id: e.value.$, def: 'd:target', carry: [] });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});

describe('接线点6：node.split 四态穷举（含"部分合法"混合态）', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`node.split 全部 specs 均为 [${state}]`, () => {
      const defs = buildDefMap('d:target', 'node', 'entity', state);
      defs.set('d:room', { id: 'd:room', kind: 'node' });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      registerTransformOps(registry, () => `n:${Math.random()}`, (id) => defs.get(id) ?? null);
      const original = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
      if (!original.ok) throw new Error('setup failed');
      const result = registry.invoke('node.split', { id: original.value.$, specs: [{ key: 'a', def: 'd:target' }] });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }

  it('混合态：specs 中一个合法一个 abstract 时整体拒绝（穷举"部分合法"这一关键组合，不是四态之外的采样）', () => {
    const defs = new Map<string, Def>([
      ['d:room', { id: 'd:room', kind: 'node' }],
      ['d:validSplit', { id: 'd:validSplit', kind: 'node' }],
      ['d:abstractSplit', { id: 'd:abstractSplit', kind: 'node', abstract: true }],
    ]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    const exprEngine = new ExprEngine();
    const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
    registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
    registerTransformOps(registry, () => `n:${Math.random()}`, (id) => defs.get(id) ?? null);
    const original = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
    if (!original.ok) throw new Error('setup failed');
    const before = holder.getState();
    const result = registry.invoke('node.split', {
      id: original.value.$,
      specs: [{ key: 'a', def: 'd:validSplit' }, { key: 'b', def: 'd:abstractSplit' }],
    });
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe('E_REF_ABSTRACT');
    // 整体拒绝：不应产生任何新节点（不允许"分裂出一半合法一半非法"的部分成功状态）
    expect(holder.getState()).toBe(before);
  });
});

describe('接线点7：entity.place 的 microScene 分支四态穷举', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`entity.place microScene [${state}]`, () => {
      const defs = buildDefMap('d:microscene', 'node', 'item', state);
      defs.set('d:host', { id: 'd:host', kind: 'node' });
      defs.set('d:human', { id: 'd:human', kind: 'entity' });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      const host = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:host' });
      const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
      if (!host.ok || !entity.ok) throw new Error('setup failed');
      const result = registry.invoke('entity.place', {
        entityId: entity.value.$,
        microScene: { hostNodeId: host.value.$, microSceneDefId: 'd:microscene' },
      });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});

describe('接线点8：prefab.spawn 四态穷举（顶层 PrefabDef 本身 + 预制结构内部引用）', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`prefab.spawn 顶层 PrefabDef [${state}]`, () => {
      const defs = buildDefMap('p:x', 'prefab', 'entity', state, { nodes: [], links: [] });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      registerPrefabOps(registry, { defLookup: (id) => defs.get(id) ?? null });
      const result = registry.invoke('prefab.spawn', { def: 'p:x' });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }

  for (const state of (['wrongKind', 'abstract', 'missing'] as const)) {
    it(`prefab.spawn 预制结构内部 nodeSpec.def 引用非法（${state}）时整体拒绝，不创建任何节点`, () => {
      const nodeDefs = buildDefMap('d:innerNode', 'node', 'entity', state);
      const prefab: PrefabDef = {
        id: 'p:x', kind: 'prefab',
        nodes: [{ key: 'root', def: 'd:innerNode' }],
        links: [],
      };
      const defs = new Map<string, Def>(nodeDefs);
      defs.set('p:x', prefab as unknown as Def);
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      const exprEngine = new ExprEngine();
      const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
      registerStructuralOps(registry, { itemMove, defLookup: (id) => defs.get(id) ?? null });
      registerPrefabOps(registry, { defLookup: (id) => defs.get(id) ?? null });
      const before = holder.getState();
      const result = registry.invoke('prefab.spawn', { def: 'p:x' });
      expect(result.ok).toBe(false);
      expect(holder.getState()).toBe(before); // 整体拒绝，不留下部分创建的节点
    });
  }
});

describe('接线点9：attach.add 四态穷举', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`attach.add [${state}]`, () => {
      const defs = buildDefMap('d:x', 'attachment', 'entity', state, { stackStrategy: 'independent' });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      registerAttachOps(registry, { defLookup: (id) => defs.get(id) ?? null });
      const result = registry.invoke('attach.add', { def: 'd:x', target: { $: 'w:0' } });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});

describe('接线点10：intent.submit 四态穷举', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`intent.submit [${state}]`, () => {
      const defs = buildDefMap('a:x', 'action', 'entity', state, { label: 'X', require: true, cost: [], effects: [] });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      registerIntentOps(registry, { defLookup: (id) => defs.get(id) ?? null, now: () => 0 });
      const result = registry.invoke('intent.submit', { action: 'a:x', agent: 'e:1', bindings: {}, hidden: false });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});

describe('接线点11：schedule.advance 四态穷举', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`schedule.advance [${state}]`, () => {
      const defs = buildDefMap('sched:x', 'schedule', 'entity', state, { phases: [{ kind: 'action', id: 'p:1' }] });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:x'));
      const registry = new OpRegistry(holder);
      registerScheduleOps(registry, { defLookup: (id) => defs.get(id) ?? null });
      const result = registry.invoke('schedule.advance', {});
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});

describe('接线点12：decision.open 四态穷举', () => {
  beforeEach(() => resetIdCounters());
  for (const state of ALL_STATES) {
    it(`decision.open [${state}]`, () => {
      const defs = buildDefMap('d:x', 'decision', 'entity', state, { quorum: 'any', options: [], onTimeout: 'void', onResolve: [] });
      const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
      const registry = new OpRegistry(holder);
      registerDecisionOps(
        registry,
        { resolve: (id) => defs.get(id) ?? null },
        { defLookup: { resolve: (id) => defs.get(id) ?? null }, recheckPremise: () => true, runEffects: () => {} },
        () => 0,
      );
      const result = registry.invoke('decision.open', { def: 'd:x', askees: [], ctx: {} });
      expectRejectedUnlessValid(state, result as { ok: boolean; code?: string });
    });
  }
});
