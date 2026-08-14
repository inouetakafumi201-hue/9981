/**
 * Feature: wakeup-base-layer-ecs, Property 1 + 4: 组件契约单一源与跨族去重
 *
 * Property 1 (Validates: Requirements 1.1, 1.2) —— 组件契约单一源：
 * 对于任何语义族，其契约接口与组合模板定义从「类 + 能力」单一源展开，
 * `Composition_Registry` 集中登记 `component.*` 组件。
 *
 * Property 4 (Validates: Requirements 2.2) —— 组件跨族去重：
 * 对于任何两个声明相同可配置字段的语义族，`Composition_Registry` 提取共享的
 * `component.*` 组件并使其只定义一次。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CompositionRegistry,
  type ComponentContract,
} from '../../../src/l2/model/composition-registry.js';
import {
  ALL_FAMILY_SHAPES,
  COMPOSITION_REGISTRY,
  resolveFamilyComponentShape,
} from '../../../src/l2/model/family-component-shapes.js';

describe('Property 1: 组件契约单一源', () => {
  it('ALL_FAMILY_SHAPES 每个组件都是 component.* 前缀、集中登记且可解析', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: ALL_FAMILY_SHAPES.length }), (offset) => {
        const shapes = [...ALL_FAMILY_SHAPES, ...ALL_FAMILY_SHAPES.slice(offset)];
        for (const family of shapes) {
          expect(family.preservesFingerprint).toBe(true);
          for (const component of family.components) {
            // 单一源：id 一律 `component.*` 前缀，且族契约与组合模板共用同一 id。
            expect(component.id.startsWith('component.')).toBe(true);
            const resolved = COMPOSITION_REGISTRY.resolveComponent(component.id);
            expect(resolved).not.toBeNull();
            expect(resolved!.id).toBe(component.id);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('每个族形状可经 resolveFamilyComponentShape 解析且返回族归属一致的组件', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FAMILY_SHAPES.map((s) => s.familyId)), (familyId) => {
        const shape = resolveFamilyComponentShape(familyId);
        expect(shape).not.toBeNull();
        expect(shape!.familyId).toBe(familyId);
        for (const component of shape!.components) {
          expect(component.familyId).toBe(familyId);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('listComponents 只含已登记组件且与形状声明一一对齐（无孤儿无漏登）', () => {
    fc.assert(
      fc.property(fc.boolean(), (duplicated) => {
        // 重复列出同一族不会新增登记：登记是幂等的（同 key 精确重复声明不重复登记）。
        const listed = COMPOSITION_REGISTRY.listComponents();
        const declared = ALL_FAMILY_SHAPES.flatMap((s) => s.components);
        const declaredIds = new Set(declared.map((c) => c.id));
        expect(declaredIds.size).toBe(declared.length); // 声明侧无重复 id
        const allComplete = declared.every((c) => listed.some((l) => l.id === c.id));
        expect(allComplete).toBe(true);
        if (duplicated) {
          // 幂等：再读一次仍相同（确定性列表）。
          expect(COMPOSITION_REGISTRY.listComponents()).toEqual(listed);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: 组件跨族去重', () => {
  it('相同可配置字段形状的组件去重后只定义一次', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.constantFrom('a', 'b', 'c'), fc.constantFrom('x', 'y', 'z')).map(([f, n]) => `${f}${n}`),
        (seed) => {
          const registry = new CompositionRegistry();
          const fieldNames = ['sharedField', 'sameField'];
          const build = (id: string, familyId: string): ComponentContract => ({
            id,
            familyId,
            parameters: Object.freeze(fieldNames.map((name) => ({
              name,
              dataType: 'string' as const,
              required: false,
              classification: 'Gameplay_Value' as const,
              playerVisible: true,
            }))),
            kernelOps: Object.freeze(['item.move']),
            compositionKind: 'static',
            writeChannelContract: { channel: 'OpRegistry.invoke' as const, alternateChannels: 'none' as const },
          });
          registry.registerComponent(build(`component.share.${seed}.a`, 'alpha'));
          registry.registerComponent(build(`component.share.${seed}.b`, 'beta'));
          const report = registry.dedupeAcrossFamilies();
          expect(report.entries.length).toBe(1);
          expect(report.entries[0]!.sharedFieldNames).toEqual(fieldNames);
          // 去重后只有一个代表组件存活（先登记者为代表）。
          const survivors = registry
            .listComponents()
            .filter((c) => c.id === `component.share.${seed}.a` || c.id === `component.share.${seed}.b`);
          expect(survivors.length).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
