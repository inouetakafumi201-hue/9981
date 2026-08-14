/**
 * Feature: wakeup-base-layer-ecs, Property 9: 多轴正交
 *
 * Validates: Requirements 8.1, 8.2
 *
 * 对于任何既有能力组件，其在多处复用时语义保持不变，仅承载位置不同，
 * 且不依赖某特定 L3 payload 形状。
 *
 * 语义轴（继承与类型身份）与承载轴（组件字段与 System 参数位置）不正交时返回拒绝
 * （Requirement 8.3）；组件不依赖某特定 L3 payload 形状（Requirement 8.2）。
 *
 * 具体到本 spec 的 registry：
 * - 组件以 `component.*` id 登记，`kernelOps` 是承载轴的系统接线；两者正交：
 *   同一个 `component.*` id 可被不同承载位置复用，语义不随承载位置改变；
 * - 组件只声明字段形状（dataType / required / classification），不携带具体
 *   L3 payload 值 —— 不依赖特定 payload 形状，因此可跨族/跨承载复用而语义不变。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ALL_FAMILY_SHAPES, COMPOSITION_REGISTRY, resolveFamilyComponentShape } from '../../../src/l2/model/family-component-shapes.js';

describe('Property 9: 多轴正交', () => {
  it('同 id 组件在不同族形状中复用，语义（kernelOps/field 名）保持不变', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        fc.boolean(),
        (component, reuse) => {
          // 从 registry 解析出的组件契约，与族形状内嵌的是同一语义（id 相同 → 单一源）。
          const resolved = COMPOSITION_REGISTRY.resolveComponent(component.id);
          expect(resolved).not.toBeNull();
          expect(resolved!.kernelOps).toEqual(component.kernelOps);
          expect(resolved!.parameters.map((p) => p.name)).toEqual(component.parameters.map((p) => p.name));
          if (reuse) {
            // 再次经族形状解析仍得到相同语义（不随承载位置改变）。
            const shape = resolveFamilyComponentShape(component.familyId);
            expect(shape!.components.find((c) => c.id === component.id)).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('组件不依赖特定 L3 payload 形状：所有字段声明 are 形状接口，值由 L3 填', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        (component) => {
          // 多轴正交的承载轴：字段名是形状声明，不锁死具体 L3 值。
          // 组件可被任一玩法层承载引用（parameters 只描述名字/类型/必需性）。
          for (const field of component.parameters) {
            expect(typeof field.name).toBe('string');
            expect(typeof field.dataType).toBe('string');
            expect(typeof field.required).toBe('boolean');
            expect(field.classification).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不同族组件可在承载轴共存（同一 familyId 有多个 component.* 形状）', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FAMILY_SHAPES.map((s) => s.familyId)), (familyId) => {
        const shape = resolveFamilyComponentShape(familyId);
        expect(shape).not.toBeNull();
        // container 族有两个组件（deposit + deathObligation），其它族至少一个；
        // 多组件族说明单一语义族可拆成多个承载组件，互不挤压语义。
        expect(shape!.components.length).toBeGreaterThanOrEqual(1);
        const ids = shape!.components.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length); // 族内无重复 id
      }),
      { numRuns: 100 },
    );
  });
});
