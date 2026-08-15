/**
 * 能力声明 ↔ ECS 组件契约单一源的机器对齐属性守卫（T-CaS-01/03）。
 *
 * 覆盖 `alignCapabilityToComponentContract`（src/l2/model/component-alignment.ts）与它在
 * class-contract / play-audit 两侧的真实消费。用 fast-check 全称量化把「能力声明必须与 ECS 组件
 * 契约单一源一致」钉成可证伪的不变量：
 * - 属性对齐：精确指认的组件必须是 ECS 单一源同一族内的真实组件；
 * - 声明与单一源全一致 → 通过；任何一项偏离 → 拒绝且可定位；
 * - 未声明 ECS 字段（familyId 缺失 / 族未登记 / 组件缺失 → 空操作）→ 不误报。
 *
 * 属性标签统一 `Feature: wakeup-cas-gap-closure, Alignment Property N: <标题>`，`numRuns≥100`。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  alignCapabilityToComponentContract,
  type AlignmentComponent,
  type AlignmentFamilyShape,
} from '../../../src/l2/model/component-alignment.js';
import {
  ALL_FAMILY_SHAPES,
  compileFamilyComponentShapeIndex,
} from '../../../src/l2/model/family-component-shapes.js';

/** 从 ECS 单一源构建的解析器（测试真实消费路径）。 */
const INDEX = compileFamilyComponentShapeIndex();
function resolve(familyId: string): AlignmentFamilyShape | null {
  const family = INDEX.get(familyId);
  if (family === undefined || family === null) return null;
  return family as AlignableFamilyShape;
}

// FamilyShape 与 AlignmentFamilyShape 结构兼容：components 的 parameters/kernelOps/compositionKind/id 字段同名。
type AlignableFamilyShape = AlignmentFamilyShape;

const ANY_FAMILY = fc.constantFrom(...ALL_FAMILY_SHAPES.map((s) => s.familyId));
const COMPOSITION_KINDS = ['static', 'transient', 'modified-explicit', 'modified-capability'] as const;

/** 把一个真实族单源组件转成可注入的对齐输入（参数集 / kernelOps / kind）。 */
function componentToInput(component: AlignmentComponent, familyId: string, componentId?: string) {
  return {
    capabilityId: `probe.${component.id}`,
    familyId,
    componentId,
    compositionKind: component.compositionKind,
    declaredParameterSlots: new Set(component.parameters.map((p) => p.name)),
    declaredKernelOps: new Set(component.kernelOps),
  };
}

describe('Feature: wakeup-cas-gap-closure, Alignment Property: T-CaS-01 能力声明与 ECS 组件契约单一源一致', () => {
  it('Property A1: 解析某个族后，任一真实组件原样注入即通过（声明与单一源全一致）', () => {
    fc.assert(
      fc.property(ANY_FAMILY, (familyId) => {
        const component = INDEX.get(familyId)?.components[0];
        if (component === undefined) return;
        const result = alignCapabilityToComponentContract(
          componentToInput(component as AlignmentComponent, familyId),
          resolve,
        );
        expect(result.ok).toBe(true);
        expect(result.issues).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it('Property A2: 偏离 compositionKind 必被拒（覆盖真实组件 + 任意其他 kind）', () => {
    fc.assert(
      fc.property(ANY_FAMILY, fc.constantFrom(...COMPOSITION_KINDS), (familyId, kind) => {
        const component = INDEX.get(familyId)?.components[0];
        if (component === undefined) return;
        if (kind === component.compositionKind) return; // 同 kind 不构成偏离
        const result = alignCapabilityToComponentContract(
          componentToInput({ ...component, compositionKind: kind } as AlignmentComponent, familyId),
          resolve,
        );
        expect(result.ok).toBe(false);
        expect(result.issues.some((i) => i.code === 'ECS_ALIGN_COMPOSITION_KIND_MISMATCH')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('Property A3: 声明 ECS 未登记的 componentId 必被拒（引用完整性）', () => {
    fc.assert(
      fc.property(ANY_FAMILY, fc.string(), (familyId, junk) => {
        const family = INDEX.get(familyId);
        if (family === undefined) return;
        const existing = new Set(family.components.map((c) => c.id));
        const badId = `component.nonexistent.${junk.replace(/[^a-z0-9_]/gi, '')}`;
        if (existing.has(badId)) return;
        const result = alignCapabilityToComponentContract(
          componentToInput(family.components[0] as AlignmentComponent, familyId, badId),
          resolve,
        );
        expect(result.ok).toBe(false);
        expect(result.issues.some((i) => i.code === 'ECS_ALIGN_COMPONENT_NOT_FOUND')).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('Property A4: 未声明 familyId / 族未登记 → 空操作（向后兼容，不误报）', () => {
    fc.assert(
      fc.property(fc.string(), (familyId) => {
        const withMissingFamily = alignCapabilityToComponentContract(
          {
            capabilityId: 'probe.missing',
            familyId: undefined,
            componentId: undefined,
            compositionKind: undefined,
            declaredParameterSlots: new Set(),
            declaredKernelOps: new Set(),
          },
          resolve,
        );
        expect(withMissingFamily.ok).toBe(true);
        // 族未登记（family 不在单一源）同样空操作：不在单一源的不强求 ECS 绑定。
        const unregistered = alignCapabilityToComponentContract(
          {
            capabilityId: 'probe.unregistered',
            familyId,
            componentId: undefined,
            compositionKind: undefined,
            declaredParameterSlots: new Set(),
            declaredKernelOps: new Set(),
          },
          (fid) => (INDEX.has(fid) ? resolve(fid) : null),
        );
        if (!INDEX.has(familyId)) expect(unregistered.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
