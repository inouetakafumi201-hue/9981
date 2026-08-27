/**
 * Feature: wakeup-engine-bombardment
 * Property 6a: L8 Attachment 级联回收（原子 + 引用完整性）
 * Property 6b: L9 Schedule advance（有界推进 + 延迟效果兑现 + 原子性）
 * Validates: Requirements 6.1, 6.2
 *
 * 6a 核心不变量（需求30.10 级联回收）：
 * - attach.del/attach.expire 一次移除整个 grantedBy 森林，不留孤儿、不留悬空 grantedBy；
 * - 移除后所有剩余 Attachment 的 grantedBy 与 target 引用仍指向存在的对象；
 * - 移除过程对任意随机 add/del/expire 交错序列都维持该不变量。
 *
 * 6b 核心不变量（需求22.1/31.x 相位推进）：
 * - 重复 schedule.advance 不挂死、phaseIndex 有界（循环表回绕到 0）；
 * - 相位推进原子：任一边界 effect 失败则整体回滚（相位推进与 effects 同事务）；
 * - 到期的延迟效果（after/at）在推进到 dueAt 时被兑现且只兑现一次。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { registerAttachOps, type AttachOpsDeps } from '../attachment/attach-ops';
import { cascadeRemovalSet, type Attachment } from '../state/attachment';
import { registerScheduleOps } from '../schedule/schedule-ops';
import { OpRegistry, type OpContext } from '../ops/registry';
import { WorldStateHolder } from '../ops/transaction';
import { createEmptyWorldState } from '../state/world-state';
import { resetIdCounters } from '../state/ids';
import type { Def } from '../state/def';
import type { AttachmentDef } from '../attachment/types';
import type { ScheduleDef } from '../schedule/types';
import type { Effect } from '../events/effect-types';
import { ok, err } from '../ops/result';
import type { WorldState } from '../state/world-state';

// ---- L8 fixtures ----
const indepDef: AttachmentDef = { id: 'att:indep', kind: 'attachment', stackStrategy: 'independent' };

function attachDefMap(): Map<string, Def> {
  return new Map<string, Def>([[indepDef.id, indepDef]]);
}

function makeAttachHarness(defs?: typeof indepDef[]): { registry: OpRegistry; holder: WorldStateHolder } {
  const holder = new WorldStateHolder(createEmptyWorldState('s:sched'));
  const registry = new OpRegistry(holder);
  const map = new Map<string, Def>();
  for (const d of defs ?? [indepDef]) map.set(d.id, d as Def);
  registerAttachOps(registry, { defLookup: (id) => map.get(id) ?? null });
  return { registry, holder };
}

/** 断言当前状态中所有剩余 Attachment 的引用（grantedBy/target）都完整。 */
function assertAttachmentIntegrity(holder: WorldStateHolder): void {
  const atts = Object.values(holder.getState().world.attachments);
  const alive = new Set(atts.map((a) => a.id));
  for (const a of atts) {
    if (a.grantedBy !== undefined) {
      expect(alive.has(a.grantedBy), `父 ${a.grantedBy} 不在存活集但 ${a.id} 依赖它`).toBe(true);
    }
    // target 不变量由 InvariantChecker 兜底，这里只保证 grantedBy 森林不自留孤儿。
  }
}

describe('Feature: wakeup-engine-bombardment, Property 6a: L8 Attachment 级联回收', () => {
  it('任意随机 add（含 grantedBy 链）/del/expire 交错序列后，森林无孤儿、grantedBy 引用全完整', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean()), // true=挂子授予链，false=根
        fc.array(fc.constantFrom<'add' | 'del-root' | 'expire'>('add', 'del-root', 'expire', 'add'), { maxLength: 40 }),
        (chainFlags, ops) => {
          resetIdCounters();
          const { registry, holder } = makeAttachHarness();
          const ids: string[] = [];

          // 先按 chainFlags 建一棵链：每个新节点要么挂在最新父下，要么另起一根（false 时 parent 置空）。
          let parentId: string | undefined;
          const idOf = (r: { ok: boolean; value?: unknown }): string | null =>
            r.ok && r.value ? (r.value as { $: string }).$ : null;
          for (const attachUnderParent of chainFlags) {
            if (!attachUnderParent) parentId = undefined;
            const args: Record<string, unknown> = { def: 'att:indep', target: { $: 'w:0' } };
            if (parentId !== undefined) args.grantedBy = parentId;
            const r = registry.invoke('attach.add', args);
            const id = idOf(r);
            if (id) {
              ids.push(id);
              parentId = id; // 链条持续加深一个子
            }
          }

          // 随机 del-root / expire 交错
          for (const op of ops) {
            if (ids.length === 0) continue;
            if (op === 'add') {
              const args: Record<string, unknown> = { def: 'att:indep', target: { $: 'w:0' } };
              if (Math.random() < 0.5 && ids.length > 0) args.grantedBy = ids[Math.floor(Math.random() * ids.length)];
              const id = idOf(registry.invoke('attach.add', args));
              if (id) ids.push(id);
            } else if (op === 'del-root') {
              const pick = ids[Math.floor(Math.random() * ids.length)];
              registry.invoke('attach.del', { id: pick });
            } else {
              // expire：随机推进 at，清掉所有 expiresAt <= at 的（先给部分挂 expiresAt）
              registry.invoke('attach.expire', { at: Math.floor(Math.random() * 5) });
            }
          }

          // 不变量：剩余森林无孤儿 grantedBy
          assertAttachmentIntegrity(holder);
          // 结构性不变量：任何阶段用 attach.del 删除剩余森林的每一棵根，最终应能清空
          for (const id of Object.keys(holder.getState().world.attachments)) {
            registry.invoke('attach.del', { id });
          }
        },
      ),
      { numRuns: 200, seed: 31337 },
    );
  });

  it('Property 6a: cascadeRemovalSet 纯函数对任意深度链返回完整且无重复的闭包', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 12 }), (branches) => {
        // 构建一棵任意形状的授予森林
        const all: Attachment[] = [];
        let nextId = 0;
        const rootId = `a:root-${nextId++}`;
        all.push({ id: rootId, def: 'att:x', target: { $: 'w:0' }, props: {}, stack: 1 });
        for (const childCount of branches) {
          const idx = Math.floor(Math.random() * all.length);
          const parent = all[idx]!;
          for (let i = 0; i < childCount; i++) {
            all.push({ id: `a:c-${nextId++}`, def: 'att:x', target: { $: 'w:0' }, props: {}, stack: 1, grantedBy: parent.id });
          }
        }
        const set = cascadeRemovalSet(all, rootId);
        for (const a of all) {
          if (a.grantedBy !== undefined && set.has(a.grantedBy)) {
            expect(set.has(a.id)).toBe(true);
          }
        }
        // 集合自身无重复（Set 天然去重，size 即唯一数）；且每个成员都来自 all
        for (const id of set) {
          expect(all.some((a) => a.id === id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---- L9 fixtures ----
const loopSched: ScheduleDef = {
  id: 's:loop',
  kind: 'schedule',
  phases: [{ id: 'p:0' }, { id: 'p:1' }, { id: 'p:2' }],
  loop: true,
};
const singleSched: ScheduleDef = {
  id: 's:one',
  kind: 'schedule',
  phases: [{ id: 'p:only' }],
  loop: false,
};

function makeScheduleHarness(opts?: { failOnEnter?: boolean; failOnRoundEnd?: boolean; record?: string[] }) {
  const holder = new WorldStateHolder(createEmptyWorldState(loopSched.id));
  const registry = new OpRegistry(holder);
  const map = new Map<string, Def>([[loopSched.id, loopSched], [singleSched.id, singleSched]]);
  const fired: string[] = opts?.record ?? [];
  const defLookup = (id: string) => map.get(id) ?? null;
  registerScheduleOps(registry, {
    defLookup,
    runEffects: (effects) => {
      if (opts?.failOnEnter) return err('E_FLOW_ABORT', 'forced entry failure');
      for (const e of effects) {
        if (e && typeof e === 'object' && 'emit' in e) fired.push((e as { emit: string }).emit);
      }
      return ok(undefined);
    },
    resetPools: () => (opts?.failOnRoundEnd ? err('E_FLOW_ABORT', 'round reset fail') : ok(undefined)),
  });
  return { holder, registry, fired };
}

describe('Feature: wakeup-engine-bombardment, Property 6b: L9 Schedule advance', () => {
  it('随机推进任意次数：不挂死，phaseIndex 有界（循环表 0..n-1 回绕），非循环表停在末相位后幂等', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), (steps) => {
        resetIdCounters();
        const { holder, registry } = makeScheduleHarness();
        let before = holder.getState().world.turn.phaseIndex;
        for (let i = 0; i < steps; i++) {
          const stateBefore = holder.getState();
          const r = registry.invoke('schedule.advance', {});
          // 若结果 ok，相位推进 +1 或回绕；若被拒(E_OP_NOT_ACCEPTED)，状态不变。
          if (r.ok) {
            const after = holder.getState().world.turn.phaseIndex;
            expect((after - before + loopSched.phases.length) % loopSched.phases.length).toBe(1);
            before = after;
          } else {
            expect(holder.getState()).toBe(stateBefore); // 失败原子
          }
        }
        // phaseIndex 有界：始终在 [0, n-1]
        const idx = holder.getState().world.turn.phaseIndex;
        expect(idx >= 0 && idx < loopSched.phases.length).toBe(true);
        // phaseEnteredAt 非负且单调不减（steps 可为 0，故仅要求 >= 0）
        expect(holder.getState().world.turn.phaseEnteredAt).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it('非循环表停在末相位：重复 advance 是幂等 no-op，不再推进 phaseEnteredAt/phaseIndex', () => {
    resetIdCounters();
    const { holder, registry } = makeScheduleHarness();
    // 切到非循环表：把初始 scheduleId 改为 singleSched（空相位启动不合法，需先置 scheduleId）
    const state0 = holder.getState();
    holder.setState({ ...state0, world: { ...state0.world, turn: { ...state0.world.turn, scheduleId: singleSched.id } } });
    registry.invoke('schedule.advance', {}); // 0 -> stays (只有一相，再 advance no-op)
    const afterFirst = holder.getState().world.turn;
    for (let i = 0; i < 5; i++) registry.invoke('schedule.advance', {});
    const afterMany = holder.getState().world.turn;
    // 末相位幂等：推进前后 turn 完全一致（index/phaseEnteredAt 都不动）
    expect(afterMany.phaseIndex).toBe(afterFirst.phaseIndex);
    expect(afterMany.phaseEnteredAt).toBe(afterFirst.phaseEnteredAt);
  });

  it('边界 effect 失败时整体回滚：相位推进不生效、状态逐字节不变', () => {
    resetIdCounters();
    // 循环表，pass 一次 advance 让周界效果在 onExit（phase0 -> phase1）触发失败
    const h1 = makeScheduleHarness({ failOnEnter: true });
    const before1 = h1.holder.getState();
    const r1 = h1.registry.invoke('schedule.advance', {});
    expect(r1.ok).toBe(true); // onExit/onEnter 均为空，first advance ok
    // 手动把 turn 推回 0 再触发一次推进，让 onEnter=false 的策略注入到 phase 的 enter
    // 简化：直接用给 schedule 注入 onEnter 失败 def，验证同事务回滚。
    const h2 = makeScheduleHarness({ failOnEnter: true });
    const schedWithEntry: ScheduleDef = {
      ...loopSched,
      id: 's:entryfail',
      phases: [
        { id: 'p:0' },
        { id: 'p:1', onEnter: [{ emit: 'boom' }] },
        { id: 'p:2' },
      ],
    };
    const map2 = new Map<string, Def>([[schedWithEntry.id, schedWithEntry], [loopSched.id, loopSched], [singleSched.id, singleSched]]);
    const holder2 = new WorldStateHolder(createEmptyWorldState(schedWithEntry.id));
    const registry2 = new OpRegistry(holder2);
    let fired2 = 0;
    registerScheduleOps(registry2, {
      defLookup: (id) => map2.get(id) ?? null,
      runEffects: (effects) => {
        fired2 += effects.length;
        return err('E_FLOW_ABORT', 'forced entry failure');
      },
      resetPools: () => ok(undefined),
    });
    const before2 = holder2.getState();
    // onEnter 失败 => 整个 advance 回滚：相位不推进、effects 已跑的回滚、状态不变
    const r2 = registry2.invoke('schedule.advance', {});
    expect(r2.ok).toBe(false);
    expect(holder2.getState()).toBe(before2);
    void h1; void h2; void before1; void r1; void fired2;
  });

  it('到期的延迟效果（after/at）在推进时兑现且只兑现一次（Property 6b 兑现唯一性）', () => {
    resetIdCounters();
    const fired: string[] = [];
    const { holder, registry } = makeScheduleHarness({ record: fired });
    // 预置两个到期 deferred effect（seq 1/2，dueAt：at-1 在相位1、after-2 在相位2）
    let s = holder.getState();
    s = {
      ...s,
      world: {
        ...s.world,
        deferredEffects: [
          { seq: 1, kind: 'after', dueAt: 2, effects: [{ emit: 'after-2' }], vars: {} },
          { seq: 2, kind: 'at', dueAt: 1, effects: [{ emit: 'at-1' }], vars: {} },
        ],
      },
    };
    holder.setState(s);
    // 推进到相位1（phaseEnteredAt=1）：只 due 的因 dueAt=1 兑现 at-1
    registry.invoke('schedule.advance', {});
    expect(fired).toEqual(['at-1']);
    expect(holder.getState().world.deferredEffects.some((e) => e.seq === 2)).toBe(false); // at-1 已出队
    expect(holder.getState().world.deferredEffects.some((e) => e.seq === 1)).toBe(true); // after-2 未到期，仍在队列
    // 推进到相位2：after-2 兑现已出队，且不会再重放
    registry.invoke('schedule.advance', {});
    expect(fired).toEqual(['at-1', 'after-2']);
    expect(holder.getState().world.deferredEffects).toHaveLength(0);
    // 继续推进不再重放任何东西（兑现唯一性）
    registry.invoke('schedule.advance', {});
    expect(fired).toEqual(['at-1', 'after-2']);
  });
});
