/**
 * 全面对抗性属性测试专项：深度嵌套探底（容器嵌套、node.merge/split 链、grantedBy 链、
 * 微型场景嵌套）。
 *
 * 与 fuzz.test.ts 的区别：fuzz.test.ts 是"广度"探底（任意 Op 混合序列），这里是"深度"探底——
 * 刻意构造需求43"拓扑可达性"关心的场景：嵌套深度增加时，触达任意要素所用的 Op/Query 调用
 * 形式应保持不变，且不应因为嵌套深度而产生专门的架构性上限或崩溃。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFullHarness, defaultSeedDefs } from '../full-harness';
import { InvariantChecker } from '../../ops/invariants';
import { resetIdCounters } from '../../state/ids';
import { createContainerForOwner } from '../../ops/structural-ops';
import type { Ref } from '../../state/ids';

const invariantChecker = new InvariantChecker();

describe('深度嵌套探底：容器嵌套（容器持有的物品自身也持有容器）', () => {
  it('Property N1: 对于任意深度 1-20 的容器嵌套链（物品 A 持有容器，容器里的物品 B 自身也持有容器...），不变量恒成立，访问最深层元素的 Op 调用形式与浅层一致', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (depth) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const { registry, holder } = harness;

        // 构造嵌套链：根 Entity 持有容器 c0，c0 里放 Item i0；i0 自身持有容器 c1，
        // c1 里放 Item i1；依此类推到 depth 层。
        const rootEntity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
        expect(rootEntity.ok).toBe(true);
        if (!rootEntity.ok) return;
        let ownerId: string = rootEntity.value.$;

        for (let level = 0; level < depth; level++) {
          const containerResult = createContainerForOwner(holder.getState(), ownerId, `layer${level}`, 'fixed');
          holder.setState(containerResult.draft);
          const slotResult = registry.invoke<{ containerId: string }, Ref>('slot.add', { containerId: containerResult.containerId });
          expect(slotResult.ok).toBe(true);

          const itemResult = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
          expect(itemResult.ok).toBe(true);
          if (!itemResult.ok) return;

          const moveResult = registry.invoke('item.move', { itemId: itemResult.value.$, toContainerId: containerResult.containerId });
          expect(moveResult.ok).toBe(true);

          ownerId = itemResult.value.$; // 下一层的宿主是这个 Item
        }

        // 访问最深层元素：用与浅层完全相同的 Op 调用形式（prop.set 写属性）
        const deepestSetResult = registry.invoke('prop.set', { path: `items.${ownerId}.props.marker`, value: 'deepest' });
        expect(deepestSetResult.ok).toBe(true);
        expect((holder.getState().items[ownerId]?.props as Record<string, unknown>)['marker']).toBe('deepest');

        const diags = invariantChecker.checkAll(holder.getState());
        const fatalDiags = diags.filter((d) => d.severity === 'fatal');
        expect(fatalDiags).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('深度嵌套探底：node.merge 连锁链', () => {
  it('Property N2: 对于任意长度 2-15 的 node.merge 连锁（A吸收B，结果再吸收C，...），最终节点应保留全部中间层的占位者引用，不产生悬空引用', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 15 }), (chainLength) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const { registry, holder } = harness;

        const keepNode = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
        expect(keepNode.ok).toBe(true);
        if (!keepNode.ok) return;
        const keepId = keepNode.value.$;

        const occupantIds: string[] = [];
        for (let i = 0; i < chainLength; i++) {
          const absorbNode = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
          expect(absorbNode.ok).toBe(true);
          if (!absorbNode.ok) return;
          const absorbId = absorbNode.value.$;

          // 每个待吸收节点上放一个占位者
          const occupant = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
          expect(occupant.ok).toBe(true);
          if (!occupant.ok) return;
          registry.invoke('entity.place', { entityId: occupant.value.$, nodeId: absorbId });
          occupantIds.push(occupant.value.$);

          const mergeResult = registry.invoke('node.merge', { keep: keepId, absorb: absorbId, carry: ['attachments'] });
          expect(mergeResult.ok).toBe(true);
        }

        // 全部占位者应最终都指向 keepId，没有一个悬空
        for (const occId of occupantIds) {
          expect(holder.getState().entities[occId]?.node).toBe(keepId);
        }

        const diags = invariantChecker.checkAll(holder.getState());
        expect(diags.filter((d) => d.severity === 'fatal')).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('深度嵌套探底：Attachment grantedBy 链', () => {
  it('Property N3: 对于任意深度 1-30 的 grantedBy 链（A授予B，B授予C，...），移除链首应级联移除全部子代，不留任何残留', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (chainLength) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const { registry, holder } = harness;

        const rootAttach = registry.invoke<{ def: string; target: Ref }, Ref>('attach.add', { def: 'd:buff', target: { $: 'w:0' } });
        expect(rootAttach.ok).toBe(true);
        if (!rootAttach.ok) return;

        let previousId = rootAttach.value.$;
        const chainIds = [previousId];
        for (let i = 0; i < chainLength; i++) {
          const draft = holder.getState();
          const nextId = `a:chain-${i}-${Math.random()}`;
          const newAttachment = {
            id: nextId,
            def: 'd:buff',
            target: { $: 'w:0' },
            props: {},
            stack: 1,
            grantedBy: previousId,
          };
          holder.setState({ ...draft, world: { ...draft.world, attachments: { ...draft.world.attachments, [nextId]: newAttachment } } });
          chainIds.push(nextId);
          previousId = nextId;
        }

        const delResult = registry.invoke('attach.del', { id: rootAttach.value.$ });
        expect(delResult.ok).toBe(true);

        for (const id of chainIds) {
          expect(holder.getState().world.attachments[id]).toBeUndefined();
        }

        const diags = invariantChecker.checkAll(holder.getState());
        expect(diags.filter((d) => d.severity === 'fatal')).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('深度嵌套探底：微型场景多层嵌套（微型场景内部再触发微型场景）', () => {
  it('Property N4: 对于任意深度 1-10 的微型场景嵌套（场景A内触发场景B，场景B内触发场景C...），每层归零都应正确级联卸载，不产生孤儿节点', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (depth) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const { registry, holder } = harness;

        const rootNode = registry.invoke<{ def: string }, Ref>('node.create', { def: 'd:room' });
        expect(rootNode.ok).toBe(true);
        if (!rootNode.ok) return;

        let hostNodeId = rootNode.value.$;
        const microSceneIds: string[] = [];
        const occupantIds: string[] = [];

        for (let level = 0; level < depth; level++) {
          const occupant = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
          expect(occupant.ok).toBe(true);
          if (!occupant.ok) return;
          occupantIds.push(occupant.value.$);

          const placeResult = registry.invoke<{ entityId: string; microScene: { hostNodeId: string; microSceneDefId: string } }, void>(
            'entity.place',
            { entityId: occupant.value.$, microScene: { hostNodeId, microSceneDefId: 'd:room' } },
          );
          expect(placeResult.ok).toBe(true);

          const microSceneId = holder.getState().entities[occupant.value.$]?.node as string;
          microSceneIds.push(microSceneId);
          hostNodeId = microSceneId; // 下一层微型场景嵌套在这一层内部
        }

        // 逐层从最深处向外移除占位者，验证每层归零都被正确级联卸载
        for (let level = depth - 1; level >= 0; level--) {
          const occupantId = occupantIds[level] as string;
          const microSceneId = microSceneIds[level] as string;
          // 把该占位者移出（放到 rootNode，脱离全部微型场景嵌套链）
          const moveResult = registry.invoke('entity.place', { entityId: occupantId, nodeId: rootNode.value.$ });
          expect(moveResult.ok).toBe(true);
          // 该层微型场景应已被卸载（除非更深层还占用着它——但我们是从最深处开始移除，
          // 所以此刻它应该已经归零）
          expect(holder.getState().nodes[microSceneId]).toBeUndefined();
        }

        const diags = invariantChecker.checkAll(holder.getState());
        expect(diags.filter((d) => d.severity === 'fatal')).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });
});
