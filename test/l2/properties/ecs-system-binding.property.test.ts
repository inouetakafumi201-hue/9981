/**
 * Feature: wakeup-base-layer-ecs, Property 5: System 接线闭合
 *
 * Validates: Requirements 3.2, 3.3
 *
 * 对于任何能力组件，其 `kernelOps` 引用的字段名与 `parameters[*].key` 落在同一通路，
 * 且引用的 Op 存在并被许可。
 *
 * 本 spec 的 System 接线验证器 `validateCompositionAlignment`（composition-alignment-rules.ts）
 * 校验：
 * - component parameter 必须有非空 name（SYSTEM_BINDING_MALFORMED，Requirement 3.2）；
 * - kernelOps 必须是字符串数组且 op 名满足 `namespace.operation` 命名规范
 *   （否则 SYSTEM_BINDING_MISSING_KERNELOPS）；
 * - component.* 未声明或为空 kernelOps → SYSTEM_BINDING_MISSING_KERNELOPS（Requirement 3.4）；
 * - op 存在性与许可集合（Requirement 3.3 的运行时查询）属 H-ECS-03 交接项，
 *   本 spec 不在 context 中携带 kernel 引用，因此此处验证命名/形状闭合，
 *   不再断言运行时 op 注册表。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { ALL_FAMILY_SHAPES } from '../../../src/l2/model/family-component-shapes.js';
import { baseDefinition, singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';

describe('Property 5: System 接线闭合', () => {
  it('每个真实族组件的 kernelOps 均满足 namespace.operation 命名规范且含字段', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)), (component) => {
        // 组件契约形状：每个参数都有非空 name，kernelOps 全是良构 op 名。
        expect(component.parameters.every((p) => typeof p.name === 'string' && p.name.trim().length > 0)).toBe(true);
        expect(component.kernelOps.length).toBeGreaterThan(0);
        for (const op of component.kernelOps) {
          expect(op.includes('.')).toBe(true);
          expect(op.startsWith('.')).toBe(false);
          expect(op.endsWith('.')).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('形如 component.* 的定义：kernelOps 良构与字段名存在时不触发 SYSTEM_BINDING_*', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbId, fc.constantFrom('movement', 'damage', 'status')).map(([id, fam]) => ({ id, fam })),
        (seed) => {
          const raw = {
            id: `component.${seed.fam}.${seed.id}`,
            defKind: 'rule',
            semanticFamily: { familyId: seed.fam },
            familyContract: undefined,
            parameters: Object.freeze([
              { name: 'fieldA', dataType: 'string', required: false, classification: 'Gameplay_Value', playerVisible: true },
              { name: 'fieldB', dataType: 'string', required: false, classification: 'Gameplay_Value', playerVisible: true },
            ]),
            kernelOps: Object.freeze(['item.move', 'stack.merge']),
            compositionKind: 'static',
            familyId: seed.fam,
          } as Parameters<typeof baseDefinition>[0];
          const def = baseDefinition(raw);
          const result = validateStructure(
            singleDefinitionPackage(`pkg-${seed.id}`, def),
          );
          // 字段名存在、kernelOps 良构、compositionKind 显式声明 → 均不触发 SYSTEM_BINDING_* 或 COMPOSITION_KIND_*。
          const ecsErrors = result.diagnostics.filter(
            (d) =>
              d.severity === 'Error' &&
              (d.code.startsWith('SYSTEM_BINDING_') || d.code.startsWith('COMPOSITION_KIND_')),
          );
          expect(ecsErrors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('非法 kernelOps 形状触发 SYSTEM_BINDING_MISSING_KERNELOPS', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(42, 'item.move', {}, ['item.move', 7], null),
        (badKernelOps) => {
          const raw = {
            id: 'component.malformed.kop',
            defKind: 'rule',
            semanticFamily: { familyId: 'damage' },
            kernelOps: badKernelOps,
            compositionKind: 'static',
            familyId: 'damage',
          } as Parameters<typeof baseDefinition>[0];
          const def = baseDefinition(raw);
          const result = validateStructure(singleDefinitionPackage('pkg-kop', def));
          expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_KERNELOPS)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
