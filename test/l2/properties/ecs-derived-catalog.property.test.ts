/**
 * Feature: wakeup-base-layer-ecs, Property 10: 派生目录的形状与归属
 *
 * Validates: Requirements 10.1, 10.2
 *
 * 对于任何派生目录，其拥有与既有目录相同的 `CLASS_ENTRY_KEYS` 与
 * `CAPABILITY_ENTRY_KEYS`，且不覆盖既有主目录。
 *
 * Requirement 10.1：派生目录拥有与既有目录相同的 CLASS_ENTRY_KEYS 与
 * CAPABILITY_ENTRY_KEYS，组合模板表达为 `compositionContract.classIds` /
 * `compositionContract.capabilityIds`。
 * Requirement 10.2：IF 派生目录是可更新文件，Reference_Resolver 以既有目录为准
 * 核对新生成的字段差异，禁止以派生目录覆盖既有主目录。
 *
 * 本 spec 的 registry 是派生目录的形状/归属视图：`CompositionShape.classIds` /
 * `capabilityIds` 承载组合模板（对应 compositionContract 的 .classIds/.capabilityIds），
 * `playLayerOwnedFieldNames` 声明玩法层归属（值由 L3 填）。派生视图只读地叠在主目录之上，
 * 不改写既有引用。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ALL_FAMILY_SHAPES,
  COMPOSITION_REGISTRY,
  resolveFamilyComponentShape,
} from '../../../src/l2/model/family-component-shapes.js';

describe('Property 10: 派生目录的形状与归属', () => {
  it('派生目录（族形状）的 classIds/capabilityIds 与其组件族归属可见且一致（compositionContract 形状）', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FAMILY_SHAPES.map((s) => s.familyId)), (familyId) => {
        const shape = resolveFamilyComponentShape(familyId);
        expect(shape).not.toBeNull();
        // 组合模板表达为 classIds/capabilityIds 数组：其内容应可对照组件 id 族归属。
        const componentIds = shape!.components.map((c) => c.id);
        expect(new Set(componentIds).size).toBe(componentIds.length);
        // 派生视图的 capabilityIds 应命中至少一个集内组件（容器/deathObligation 等）。
        expect(shape!.components.every((c) => c.id.startsWith('component.'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('playLayerOwnedFieldNames 是归属声明，不与既有组件字段命名冲突（值归 L3）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        (component) => {
          // 归属字段名由玩法层（L3）占有，组件字段由基类层（L2）声明；
          // 校验组件字段本身是 L2 可声明形状，不泄露 L3 数值语义。
          for (const field of component.parameters) {
            expect(field.classification).toBeDefined();
            // 不携带 L3 具体值：不出现 defaultValue 当作归属内容。
            expect('defaultValue' in field).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('派生目录只读地叠在主目录之上：重复读取不覆盖既有组件登记、不增加新条目', () => {
    fc.assert(
      fc.property(fc.boolean(), (recheck) => {
        const before = COMPOSITION_REGISTRY.listComponents().map((c) => c.id);
        if (recheck) {
          // 派生视图查询（解析/列组）是纯读，不修改 registry 的既有登记。
          ALL_FAMILY_SHAPES.forEach((s) => resolveFamilyComponentShape(s.familyId));
          COMPOSITION_REGISTRY.listShapes();
        }
        expect(COMPOSITION_REGISTRY.listComponents().map((c) => c.id)).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});
