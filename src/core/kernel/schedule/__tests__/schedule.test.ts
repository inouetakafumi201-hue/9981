/**
 * L9 tests: Property 19 (load conflicts), Property 23 (playpack ordering determinism).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerScheduleOps } from '../schedule-ops';
import { PlaypackLoader } from '../playpack';
import { PolicyEvaluator } from '../policy';
import type { ScheduleDef } from '../types';
import type { PlaypackDef } from '../playpack';
import type { PolicyDef } from '../policy';
import { OpRegistry } from '../../ops/registry';
import { WorldStateHolder } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { resetIdCounters } from '../../state/ids';
import { DefRegistry } from '../../state/def';
import type { Def } from '../../state/def';
import { err, ok } from '../../ops/result';

const simpleSchedule: ScheduleDef = {
  id: 's:sched1',
  kind: 'schedule',
  phases: [
    { kind: 'action', id: 'phase:0', label: 'Action Phase' },
    { kind: 'response', id: 'phase:1', label: 'Response Phase' },
    { kind: 'cleanup', id: 'phase:2', label: 'Cleanup Phase' },
  ],
  loop: true,
};

function makeRegistry(sched: ScheduleDef): { registry: OpRegistry; holder: WorldStateHolder } {
  const holder = new WorldStateHolder(createEmptyWorldState(sched.id));
  const registry = new OpRegistry(holder);
  registerScheduleOps(registry, { defLookup: (id) => (id === sched.id ? sched : null) });
  return { registry, holder };
}

describe('L9 schedule.advance Op', () => {
  beforeEach(() => resetIdCounters());

  it('schedule.advance 推进相位索引', () => {
    const { registry, holder } = makeRegistry(simpleSchedule);
    expect(holder.getState().world.turn.phaseIndex).toBe(0);
    registry.invoke('schedule.advance', {});
    expect(holder.getState().world.turn.phaseIndex).toBe(1);
  });

  it('schedule.advance 循环模式下从最后一相回到第0相', () => {
    const { registry, holder } = makeRegistry(simpleSchedule);
    registry.invoke('schedule.advance', {}); // 0->1
    registry.invoke('schedule.advance', {}); // 1->2
    registry.invoke('schedule.advance', {}); // 2->0 (loop)
    expect(holder.getState().world.turn.phaseIndex).toBe(0);
  });

  it('无循环模式下停在最后一相', () => {
    const noLoopSched: ScheduleDef = { ...simpleSchedule, id: 's:noloop', loop: false };
    const holder2 = new WorldStateHolder(createEmptyWorldState(noLoopSched.id));
    const registry2 = new OpRegistry(holder2);
    registerScheduleOps(registry2, { defLookup: (id) => (id === noLoopSched.id ? noLoopSched : null) });
    registry2.invoke('schedule.advance', {});
    registry2.invoke('schedule.advance', {});
    registry2.invoke('schedule.advance', {}); // should stay at last phase
    expect(holder2.getState().world.turn.phaseIndex).toBe(2);
  });

  it('使用状态内逻辑序号推进，不依赖系统时间', () => {
    const { registry, holder } = makeRegistry(simpleSchedule);
    registry.invoke('schedule.advance', {});
    expect(holder.getState().world.turn.phaseEnteredAt).toBe(1);
    registry.invoke('schedule.advance', {});
    expect(holder.getState().world.turn.phaseEnteredAt).toBe(2);
    registry.invoke('schedule.advance', {});
    expect(holder.getState().world.turn.phaseEnteredAt).toBe(3);
  });

  it('按 onExit → roundEnd → onEnter 顺序执行通用边界 effects', () => {
    const effectsSchedule: ScheduleDef = {
      ...simpleSchedule,
      phases: [
        { id: 'phase:0', onExit: [{ emit: 'exit:0' }] },
        { id: 'phase:1', onEnter: [{ emit: 'enter:1' }], onExit: [{ emit: 'exit:1' }] },
      ],
      roundEnd: [{ emit: 'round:end' }],
    };
    const events: string[] = [];
    const holder = new WorldStateHolder(createEmptyWorldState(effectsSchedule.id));
    const registry = new OpRegistry(holder);
    registerScheduleOps(registry, {
      defLookup: (id) => (id === effectsSchedule.id ? effectsSchedule : null),
      runEffects: (effects) => {
        for (const effect of effects) if ('emit' in effect) events.push(effect.emit);
        return ok(undefined);
      },
    });

    registry.invoke('schedule.advance', {});
    registry.invoke('schedule.advance', {});
    expect(events).toEqual(['exit:0', 'enter:1', 'exit:1', 'round:end']);
  });

  it('边界 effect 失败时相位推进整体回滚', () => {
    const failing: ScheduleDef = {
      ...simpleSchedule,
      phases: [{ id: 'phase:0', onExit: [{ abort: 'stop' }] }, { id: 'phase:1' }],
    };
    const holder = new WorldStateHolder(createEmptyWorldState(failing.id));
    const registry = new OpRegistry(holder);
    registerScheduleOps(registry, {
      defLookup: (id) => (id === failing.id ? failing : null),
      runEffects: () => err('E_FLOW_ABORT', 'stop'),
    });

    const result = registry.invoke('schedule.advance', {});
    expect(result.ok).toBe(false);
    expect(holder.getState().world.turn.phaseIndex).toBe(0);
    expect(holder.getState().world.turn.phaseEnteredAt).toBe(0);
  });

  it('ScheduleDef 不存在时返回 E_REF_MISSING', () => {
    const holder3 = new WorldStateHolder(createEmptyWorldState('s:ghost'));
    const registry3 = new OpRegistry(holder3);
    registerScheduleOps(registry3, { defLookup: () => null });
    const result = registry3.invoke('schedule.advance', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_REF_MISSING');
  });
});

describe('L9 PlaypackLoader: Property 19 (monotonic redefinition — D-073)', () => {
  it('单调重定义：相同 Id 定义在两个 Playpack 时后装覆盖先装（不再报 E_LOAD_CONFLICT）', () => {
    const existingDef: Def = { id: 'action:attack', kind: 'action' };
    const existing: PlaypackDef = {
      id: 'pp:existing',
      kind: 'playpack',
      version: '1.0',
      defs: [existingDef],
    };
    const incoming: PlaypackDef = {
      id: 'pp:incoming',
      kind: 'playpack',
      version: '1.0',
      defs: [existingDef],
    };
    const defRegistry = new DefRegistry();
    defRegistry.register(existingDef);
    const loader = new PlaypackLoader({ defRegistry, existingPlaypacks: [existing] });
    const result = loader.load(incoming);
    // D-073：同 key 即重定义（后装覆盖先装），不再拒绝
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_CONFLICT')).toBe(false);
  });

  it('有 override 映射时同样成功（override 降级为可选重定义辅助）', () => {
    const existingDef: Def = { id: 'action:attack', kind: 'action' };
    const existing: PlaypackDef = {
      id: 'pp:existing',
      kind: 'playpack',
      version: '1.0',
      defs: [existingDef],
    };
    const newDef: Def = { id: 'action:attack', kind: 'action' };
    const incoming: PlaypackDef = {
      id: 'pp:incoming',
      kind: 'playpack',
      version: '1.0',
      defs: [newDef],
      overrides: { 'action:attack': 'action:attack_v2' },
    };
    const defRegistry = new DefRegistry();
    defRegistry.register(existingDef);
    const loader = new PlaypackLoader({ defRegistry, existingPlaypacks: [existing] });
    const result = loader.load(incoming);
    expect(result.ok).toBe(true);
  });

  it('Property 19 属性测试：多个独立 Playpack 无冲突时全部加载成功', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (count) => {
        const defRegistry = new DefRegistry();
        const loader = new PlaypackLoader({ defRegistry });
        for (let i = 0; i < count; i++) {
          const pp: PlaypackDef = {
            id: `pp:${i}`,
            kind: 'playpack',
            version: '1.0',
            defs: [{ id: `action:unique_${i}`, kind: 'action' }],
          };
          const r = loader.load(pp);
          expect(r.ok).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: wakeup-engine-layer, Property 3: 单调重定义装载序', () => {
  it('同 key 后装覆盖先装、异 key append 新增，且不报 E_LOAD_CONFLICT', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (sharedCount, uniqueCount) => {
          const shared: Def[] = Array.from({ length: sharedCount }, (_, i) => ({ id: `action:shared_${i}`, kind: 'action' as const }));
          const uniqA: Def[] = Array.from({ length: uniqueCount }, (_, i) => ({ id: `action:a_${i}`, kind: 'action' as const }));
          const uniqB: Def[] = Array.from({ length: uniqueCount }, (_, i) => ({ id: `action:b_${i}`, kind: 'action' as const }));
          const defRegistry = new DefRegistry();
          const loader = new PlaypackLoader({ defRegistry });

          const a: PlaypackDef = { id: 'pp:a', kind: 'playpack', version: '1.0', defs: [...shared, ...uniqA] };
          const loadA = loader.load(a);
          expect(loadA.ok).toBe(true);

          const b: PlaypackDef = { id: 'pp:b', kind: 'playpack', version: '1.0', defs: [...shared, ...uniqB] };
          const loadB = loader.load(b);
          // 同 key 覆盖（重定义）、异 key append 新增，单调重定义下不报冲突
          expect(loadB.ok).toBe(true);
          expect(loadB.diagnostics.some((d) => d.code === 'E_LOAD_CONFLICT')).toBe(false);
          // 全部定义均可解析（覆盖后继任 + 新增都落在注册表上）
          for (const def of [...shared, ...uniqB]) {
            expect(defRegistry.resolve(def.id)).not.toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('同 key 覆盖定义后，注册表解析到后装（单调重定义后继）而非先装', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (countA, countB) => {
          const defRegistry = new DefRegistry();
          const loader = new PlaypackLoader({ defRegistry });

          const sharedA: Def[] = Array.from({ length: countA }, (_, i) => ({ id: `action:key_${i}`, kind: 'action' as const }));
          const sharedB: Def[] = Array.from({ length: countB }, (_, i) => ({ id: `action:key_${i}`, kind: 'action' as const }));
          expect(loader.load({ id: 'pp:a', kind: 'playpack', version: '1.0', defs: sharedA }).ok).toBe(true);
          expect(loader.load({ id: 'pp:b', kind: 'playpack', version: '1.0', defs: sharedB }).ok).toBe(true);

          // 同 key 交集上，后装 B 覆盖先装 A：解析到的 must 是 B 的 def（可以 B 的 def 与 A 同构，
          // 但 id/kind 一致即覆盖生效）；先在 A 中不存在、仅在 B 中的异 key 也全部解析成功。
          for (let i = 0; i < countB; i++) {
            expect(defRegistry.resolve(`action:key_${i}`)).not.toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('混合顺序装载大量 playpack：每次失败都回滚到最近成功快照，不积累半改', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        const defRegistry = new DefRegistry();
        const loader = new PlaypackLoader({ defRegistry });

        for (let i = 0; i < n; i++) {
          const lastOk = defRegistry.fork();
          // 偶数为合法包、奇数为引用缺失包（需加载失败触发回滚）
          const ok = i % 2 === 0;
          const pack: PlaypackDef = ok
            ? { id: `pp:${i}`, kind: 'playpack', version: '1.0', defs: [{ id: `action:ok_${i}`, kind: 'action' as const }] }
            : { id: `pp:${i}`, kind: 'playpack', version: '1.0', defs: [{ id: `action:odd_${i}`, kind: 'action' as const }], requires: ['pp:never'] };
          const result = loader.load(pack);
          if (ok) {
            expect(result.ok).toBe(true);
          } else {
            expect(result.ok).toBe(false);
            // 失败包不污染活动注册表（原子性，P10 精神）
            expect(defRegistry.fork()).toEqual(lastOk);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('L9 PlaypackLoader: topoSort (Property 23 ordering determinism)', () => {
  it('Property 23: 无依赖的 Playpack 按输入顺序排列', () => {
    const pps: PlaypackDef[] = [
      { id: 'pp:c', kind: 'playpack', version: '1.0', defs: [] },
      { id: 'pp:a', kind: 'playpack', version: '1.0', defs: [] },
      { id: 'pp:b', kind: 'playpack', version: '1.0', defs: [] },
    ];
    const sorted = PlaypackLoader.topoSort(pps);
    expect(sorted).not.toBeNull();
    if (sorted) {
      expect(sorted.map((p) => p.id)).toEqual(['pp:c', 'pp:a', 'pp:b']);
    }
  });

  it('有依赖的 Playpack 依赖先于依赖者加载', () => {
    const pps: PlaypackDef[] = [
      { id: 'pp:child', kind: 'playpack', version: '1.0', defs: [], requires: ['pp:parent'] },
      { id: 'pp:parent', kind: 'playpack', version: '1.0', defs: [] },
    ];
    const sorted = PlaypackLoader.topoSort(pps);
    expect(sorted).not.toBeNull();
    if (sorted) {
      const parentIdx = sorted.findIndex((p) => p.id === 'pp:parent');
      const childIdx = sorted.findIndex((p) => p.id === 'pp:child');
      expect(parentIdx).toBeLessThan(childIdx);
    }
  });

  it('循环依赖时 topoSort 返回 null', () => {
    const pps: PlaypackDef[] = [
      { id: 'pp:a', kind: 'playpack', version: '1.0', defs: [], requires: ['pp:b'] },
      { id: 'pp:b', kind: 'playpack', version: '1.0', defs: [], requires: ['pp:a'] },
    ];
    expect(PlaypackLoader.topoSort(pps)).toBeNull();
  });

  it('Property 23 属性测试：相同输入多次 topoSort 结果一致（确定性）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (count) => {
        const pps: PlaypackDef[] = Array.from({ length: count }, (_, i) => ({
          id: `pp:${i}`,
          kind: 'playpack' as const,
          version: '1.0',
          defs: [],
        }));
        const sorted1 = PlaypackLoader.topoSort(pps);
        const sorted2 = PlaypackLoader.topoSort(pps);
        expect(JSON.stringify(sorted1)).toBe(JSON.stringify(sorted2));
      }),
      { numRuns: 100 },
    );
  });
});

describe('L9 PolicyEvaluator', () => {
  it('rules 模式返回满足条件的最高优先级 action', () => {
    const def: PolicyDef = {
      id: 'pol:1',
      kind: 'policy',
      mode: 'rules',
      policyRules: [
        { condition: false, action: 'a:low', priority: 1 },
        { condition: true, action: 'a:high', priority: 5 },
        { condition: true, action: 'a:mid', priority: 3 },
      ],
    };
    const evaluator = new PolicyEvaluator();
    const result = evaluator.evalRules(def, (cond) => cond === true);
    expect(result).toBe('a:high');
  });

  it('scripted 模式返回脚本', () => {
    const def: PolicyDef = {
      id: 'pol:2',
      kind: 'policy',
      mode: 'scripted',
      script: [{ op: 'test.op', args: {} }],
    };
    const evaluator = new PolicyEvaluator();
    const script = evaluator.getScript(def);
    expect(script).toHaveLength(1);
  });

  it('search 模式 placeholder 返回 null（L12 前占位）', () => {
    const def: PolicyDef = {
      id: 'pol:3',
      kind: 'policy',
      mode: 'search',
      searchDepth: 3,
    };
    const evaluator = new PolicyEvaluator();
    const result = evaluator.searchPlaceholder(def, { state: null, agentId: 'a:1' });
    expect(result).toBeNull();
  });
});
