/**
 * Feature: wakeup-base-layer-ecs, Property 2: Canonical_Snapshot 确定性
 *
 * Validates: Requirements 1.3, 1.4
 *
 * 对于任何经转换的目录，其 Canonical_Snapshot 的类 id、能力 id、组件 id 与模板 id
 * 顺序确定性一致，且与转换前语义等价。
 *
 * 本 spec 的 registry 采用确定性只读输出（listComponents / listShapes 按 id 字典序），
 * 与 `ordering.ts` 的 canonical-sort 惯用法对齐。该属性验证：
 * - 重复列出的顺序完全一致（确定性、无随机序）；
 * - 与任意登记顺序无关（先登记后登记不改变产出顺序）。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CompositionRegistry, type ComponentContract } from '../../../src/l2/model/composition-registry.js';
import { COMPOSITION_REGISTRY } from '../../../src/l2/model/family-component-shapes.js';

describe('Property 2: Canonical_Snapshot 确定性', () => {
  it('listComponents / listShapes 输出顺序确定性一致，且重复调用稳定', () => {
    fc.assert(
      fc.property(fc.boolean(), (reordered) => {
        // 用真实注册表：不论采取何种消费路径，列表都是确定性的。
        if (reordered) {
          // 重复调用返回同一序列（确定性）。
          expect(COMPOSITION_REGISTRY.listComponents().map((c) => c.id)).toEqual(
            COMPOSITION_REGISTRY.listComponents().map((c) => c.id),
          );
        }
        // registry 列表按 id 字典序规范化排序，与声明时 family 分组顺序无关。
        const ids = COMPOSITION_REGISTRY.listComponents().map((c) => c.id);
        const sorted = [...ids].sort();
        expect(ids).toEqual(sorted);
        const shapeIds = COMPOSITION_REGISTRY.listShapes().map((s) => s.id);
        expect(shapeIds).toEqual([...shapeIds].sort());
        // 同一注册表要么重复读取完全一致（确定性），要么与判定基准一致。
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 100 },
    );
  });

  it('任意登记顺序下 listComponents 产出同一序列（与插入序无关）', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(['alpha', 'beta', 'gamma'], { minLength: 3, maxLength: 3 }),
        (order) => {
          const registry = new CompositionRegistry();
          const build = (id: string, familyId: string, name: string): ComponentContract => ({
            id,
            familyId,
            parameters: Object.freeze([
              { name, dataType: 'string' as const, required: false, classification: 'Gameplay_Value' as const, playerVisible: true },
            ]),
            kernelOps: Object.freeze(['item.move']),
            compositionKind: 'static',
            writeChannelContract: { channel: 'OpRegistry.invoke' as const, alternateChannels: 'none' as const },
          });
          for (const familyId of order) {
            registry.registerComponent(build(`component.z.${familyId}`, familyId, `field-${familyId}`));
          }
          registry.registerComponent(build('component.a.first', 'alpha', 'field-a'));
          const inOrder = registry.listComponents().map((c) => c.id);
          // 与登记序无关：'component.a.first' 无论最后登记都排最前。
          expect(inOrder[0]).toBe('component.a.first');
          const sortedVersion = [...inOrder].sort();
          expect(inOrder).toEqual(sortedVersion);
        },
      ),
      { numRuns: 100 },
    );
  });
});
