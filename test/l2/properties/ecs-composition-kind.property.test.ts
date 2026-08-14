/**
 * Feature: wakeup-base-layer-ecs, Property 6: compositionKind 四形
 *
 * Validates: Requirements 5.1, 5.2
 *
 * 对于任何能力组件，其 `compositionKind` 取 `static`、`transient`、`modified-explicit`、
 * `modified-capability` 四形之一，否则返回 `COMPOSITION_KIND_*` 系 Structured_Rejection。
 *
 * 单一权威源是 `composition-registry.ts` 的 `COMPOSITION_KINDS`；验证器
 * `validateCompositionAlignment` 从同一来源导入，不在规则内重复定义（防漂移）。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { COMPOSITION_KINDS } from '../../../src/l2/model/composition-registry.js';
import { ALL_FAMILY_SHAPES } from '../../../src/l2/model/family-component-shapes.js';
import { baseDefinition, singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';

describe('Property 6: compositionKind 四形', () => {
  it('全部真实族组件 compositionKind 均为四形之一', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        (component) => {
          expect((COMPOSITION_KINDS as readonly string[]).includes(component.compositionKind)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('component.* 缺 compositionKind 触发 COMPOSITION_KIND_NOT_DECLARED', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbId, fc.constantFrom('damage', 'status', 'action')).map(([id, fam]) => ({ id, fam })),
        (seed) => {
          const raw = {
            id: `component.nokind.${seed.id}`,
            defKind: 'rule',
            semanticFamily: { familyId: seed.fam },
            kernelOps: Object.freeze(['item.move']),
            familyId: seed.fam,
          } as Parameters<typeof baseDefinition>[0];
          const def = baseDefinition(raw);
          // 不声明 compositionKind
          const result = validateStructure(singleDefinitionPackage(`pkg-${seed.id}`, def));
          expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.COMPOSITION_KIND_NOT_DECLARED)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('compositionKind 取四形外的值触发 COMPOSITION_KIND_INVALID', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('static-invalid', 'persistent', 'capability', '', 'MODIFIED'),
        (badKind) => {
          const raw = {
            id: 'component.badkind.x',
            defKind: 'rule',
            semanticFamily: { familyId: 'damage' },
            kernelOps: Object.freeze(['item.move']),
            familyId: 'damage',
            compositionKind: badKind,
          } as Parameters<typeof baseDefinition>[0];
          const def = baseDefinition(raw);
          const result = validateStructure(singleDefinitionPackage('pkg-badkind', def));
          expect(hasCode(result.diagnostics, DIAGNOSTIC_CODES.COMPOSITION_KIND_INVALID)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
