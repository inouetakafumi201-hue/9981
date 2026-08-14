/**
 * Feature: wakeup-base-layer-ecs, Property 3: 转换失败原子性
 *
 * Validates: Requirements 1.5, 1.6
 *
 * 对于任何候选包，若转换后出现语义差异或依赖证据失效，则 WakeUp_System 归还
 * 最后有效的已激活状态并返回 Structured_Rejection。
 *
 * `Composition_Registry` 的组件 id 冲突是转换失败的确定性触发器（错误处理 §1）：
 * 重复 `component.*` id 且契约不一致时抛 `Error`，且不改变已登记状态 ——
 * 即失败是原子的：要么成功登记、要么不产生任何部分效果。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CompositionRegistry,
  type ComponentContract,
  COMPOSITION_KINDS,
} from '../../../src/l2/model/composition-registry.js';
import type { CompositionKind } from '../../../src/l2/model/composition-registry.js';

function contract(id: string, kind: CompositionKind, field: string): ComponentContract {
  return {
    id,
    familyId: 'alpha',
    parameters: Object.freeze([
      { name: field, dataType: 'string' as const, required: false, classification: 'Gameplay_Value' as const, playerVisible: true },
    ]),
    kernelOps: Object.freeze(['item.move']),
    compositionKind: kind,
    writeChannelContract: { channel: 'OpRegistry.invoke' as const, alternateChannels: 'none' as const },
  };
}

describe('Property 3: 转换失败原子性', () => {
  it('同 id 不同契约的后续登记抛错，且先登记的状态被保留（原子性）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COMPOSITION_KINDS),
        fc.constantFrom(...COMPOSITION_KINDS),
        (kindA, kindB) => {
          const registry = new CompositionRegistry();
          registry.registerComponent(contract('component.atom.a', kindA, 'fieldA'));
          const before = registry.listComponents();
          let threw = false;
          try {
            registry.registerComponent(contract('component.atom.a', kindB, 'fieldB'));
          } catch {
            threw = true;
          }
          // 失败情形：契约不一致 → 必须抛错（转换失败信号）。
          expect(threw).toBe(true);
          // 原子性：失败后登记表回到「最后一次有效状态」。
          expect(registry.listComponents()).toEqual(before);
          // 且失败未产生任何残留的共享字段提取或部分登记。
          expect(registry.resolveComponent('component.atom.a')).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('推导的依赖证据失效（重复 id 且字段指纹不同）不产生错误的状态变更', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('x', 'y', 'z'),
        fc.constantFrom('A', 'B', 'C'),
        (suffix, fieldSuffix) => {
          const registry = new CompositionRegistry();
          const id = `component.atom.${suffix}`;
          registry.registerComponent(contract(id, 'static', `field${suffix}`));
          // 同 id 再以不同字段形状登记 → 字段指纹变化，属依赖证据失效。
          let threw = false;
          try {
            registry.registerComponent(contract(id, 'modified-explicit', `other${fieldSuffix}`));
          } catch {
            threw = true;
          }
          expect(threw).toBe(true);
          // 归还上一次有效状态：仍保留最初登记的契约，不被部分覆盖。
          const surviving = registry.resolveComponent(id);
          expect(surviving!.parameters[0]!.name).toBe(`field${suffix}`);
        },
      ),
      { numRuns: 100 },
    );
  });
});
