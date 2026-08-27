import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OpRegistry } from '../registry';
import { WorldStateHolder } from '../transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { registerAgentOps } from '../agent-ops';
import { registerStructuralOps, makeItemMove } from '../structural-ops';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import { resetIdCounters } from '../../state/ids';
import type { Ref } from '../../state/ids';
import type { Def } from '../../state/def';

const TEST_DEFS = new Map<string, Def>([['d:human', { id: 'd:human', kind: 'entity' }]]);

function setupRegistry() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  registerAgentOps(registry);
  return { holder, registry };
}

describe('agent.create / agent.bind / agent.unbind（需求5.1-5.7, 16.6）', () => {
  beforeEach(() => resetIdCounters());

  it('agent.bind 把 Entity 的 Ref 加入 Agent.controls 数组（需求5.2）', () => {
    const { holder, registry } = setupRegistry();
    const agent = registry.invoke<{ kind: string; knowledgeScope: string }, Ref>('agent.create', { kind: 'human', knowledgeScope: 'k:1' });
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    const agentId = (agent as { value: Ref }).value.$;
    const entityId = (entity as { value: Ref }).value.$;

    const result = registry.invoke('agent.bind', { agentId, entityRef: { $: entityId } });
    expect(result.ok).toBe(true);
    expect(holder.getState().world.agents[agentId]?.controls).toContainEqual({ $: entityId });
  });

  it('agent.bind 对同一 Entity 重复绑定是幂等的（不产生重复条目）', () => {
    const { holder, registry } = setupRegistry();
    const agent = registry.invoke<{ kind: string; knowledgeScope: string }, Ref>('agent.create', { kind: 'human', knowledgeScope: 'k:1' });
    const agentId = (agent as { value: Ref }).value.$;
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:1' } });
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:1' } });
    expect(holder.getState().world.agents[agentId]?.controls.length).toBe(1);
  });

  it('agent.unbind 移除指定 Entity 的 Ref', () => {
    const { holder, registry } = setupRegistry();
    const agent = registry.invoke<{ kind: string; knowledgeScope: string }, Ref>('agent.create', { kind: 'human', knowledgeScope: 'k:1' });
    const agentId = (agent as { value: Ref }).value.$;
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:1' } });
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:2' } });
    registry.invoke('agent.unbind', { agentId, entityRef: { $: 'e:1' } });
    expect(holder.getState().world.agents[agentId]?.controls).toEqual([{ $: 'e:2' }]);
  });

  it('一个 Agent 的 controls 数组支持多个 Entity 的 Ref（需求5.5）', () => {
    const { holder, registry } = setupRegistry();
    const agent = registry.invoke<{ kind: string; knowledgeScope: string }, Ref>('agent.create', { kind: 'ai', knowledgeScope: 'k:1' });
    const agentId = (agent as { value: Ref }).value.$;
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:1' } });
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:2' } });
    registry.invoke('agent.bind', { agentId, entityRef: { $: 'e:3' } });
    expect(holder.getState().world.agents[agentId]?.controls.length).toBe(3);
  });

  it('对不存在的 Agent 调用 bind/unbind 返回 ok:false', () => {
    const { registry } = setupRegistry();
    expect(registry.invoke('agent.bind', { agentId: 'a:999', entityRef: { $: 'e:1' } }).ok).toBe(false);
    expect(registry.invoke('agent.unbind', { agentId: 'a:999', entityRef: { $: 'e:1' } }).ok).toBe(false);
  });

  it('Property: 对于任意 bind/unbind 操作序列，controls 数组恒不含重复元素', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ op: fc.constantFrom('bind', 'unbind'), entityId: fc.constantFrom('e:1', 'e:2', 'e:3') }), { maxLength: 20 }),
        (ops) => {
          resetIdCounters();
          const { holder, registry } = setupRegistry();
          const agent = registry.invoke<{ kind: string; knowledgeScope: string }, Ref>('agent.create', { kind: 'human', knowledgeScope: 'k:1' });
          const agentId = (agent as { value: Ref }).value.$;
          for (const o of ops) {
            registry.invoke(o.op === 'bind' ? 'agent.bind' : 'agent.unbind', { agentId, entityRef: { $: o.entityId } });
          }
          const controls = holder.getState().world.agents[agentId]?.controls ?? [];
          const uniqueIds = new Set(controls.map((r) => r.$));
          expect(uniqueIds.size).toBe(controls.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
