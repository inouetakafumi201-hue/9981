import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerOutcomeOps } from '../outcome-ops.js';

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  registerOutcomeOps(registry);
  return { holder, registry };
}

describe('outcome.reach（需求32.4-32.6, 16.6）', () => {
  it('记录一次结局达成事实', () => {
    const { holder, registry } = setupRegistry();
    const result = registry.invoke('outcome.reach', { outcomeName: 'victory', scope: { $: 'a:1' }, ends: true });
    expect(result.ok).toBe(true);
    const outcomes = holder.getState().world.props['outcomes'] as Record<string, unknown[]>;
    expect(outcomes['victory']?.length).toBe(1);
  });

  it('scope 为 agent 且 ends:false 时记录的事实本身不影响其它 scope 的记录（需求32.6：内核允许该行动者淘汰后整局继续，不代内核判断"是否结束"）', () => {
    const { holder, registry } = setupRegistry();
    registry.invoke('outcome.reach', { outcomeName: 'eliminated', scope: { $: 'a:1' }, ends: false });
    const outcomes = holder.getState().world.props['outcomes'] as Record<string, { scope: { $: string }; ends: boolean }[]>;
    expect(outcomes['eliminated']?.[0]?.scope.$).toBe('a:1');
    expect(outcomes['eliminated']?.[0]?.ends).toBe(false);
    // 其它 scope（如 a:2）完全不受影响：outcomes 记录里不存在任何关于 a:2 的条目
    const allScopeIds = Object.values(outcomes).flatMap((list) => list.map((r) => r.scope.$));
    expect(allScopeIds).not.toContain('a:2');
  });

  it('ends 字段原样记录，内核不据此推导任何"游戏是否结束"的派生状态', () => {
    const { holder, registry } = setupRegistry();
    registry.invoke('outcome.reach', { outcomeName: 'victory', scope: { $: 'a:1' }, ends: true });
    const outcomes = holder.getState().world.props['outcomes'] as Record<string, { ends: boolean }[]>;
    expect(outcomes['victory']?.[0]?.ends).toBe(true);
  });

  it('对同一 scope 重复调用同一 outcomeName 是幂等的（不产生重复记录）', () => {
    const { holder, registry } = setupRegistry();
    registry.invoke('outcome.reach', { outcomeName: 'victory', scope: { $: 'a:1' }, ends: true });
    registry.invoke('outcome.reach', { outcomeName: 'victory', scope: { $: 'a:1' }, ends: true });
    const outcomes = holder.getState().world.props['outcomes'] as Record<string, unknown[]>;
    expect(outcomes['victory']?.length).toBe(1);
  });

  it('不同 scope 对同一 outcomeName 分别记录（支持 rank 排名）', () => {
    const { holder, registry } = setupRegistry();
    registry.invoke('outcome.reach', { outcomeName: 'finish', scope: { $: 'a:1' }, ends: false, rank: 1 });
    registry.invoke('outcome.reach', { outcomeName: 'finish', scope: { $: 'a:2' }, ends: false, rank: 2 });
    const outcomes = holder.getState().world.props['outcomes'] as Record<string, { scope: { $: string }; rank?: number }[]>;
    expect(outcomes['finish']?.length).toBe(2);
  });

  it('Property: 对于任意 outcomeName/scope 序列，outcomes 记录数恒等于去重后的 (outcomeName, scope) 对数量', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ outcomeName: fc.constantFrom('victory', 'defeat', 'draw'), scopeId: fc.constantFrom('a:1', 'a:2', 'a:3'), ends: fc.boolean() }), { maxLength: 30 }),
        (calls) => {
          const { holder, registry } = setupRegistry();
          for (const c of calls) {
            registry.invoke('outcome.reach', { outcomeName: c.outcomeName, scope: { $: c.scopeId }, ends: c.ends });
          }
          const outcomes = (holder.getState().world.props['outcomes'] as Record<string, { scope: { $: string } }[]>) ?? {};
          const uniquePairs = new Set(calls.map((c) => `${c.outcomeName}::${c.scopeId}`));
          const totalRecorded = Object.values(outcomes).reduce((sum, list) => sum + list.length, 0);
          expect(totalRecorded).toBe(uniquePairs.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});
