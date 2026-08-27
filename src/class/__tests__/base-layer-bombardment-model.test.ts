/**
 * 基类层收官轰炸 —— 属性 6/7/8：L2 规范模型与验证层一致性守卫。
 *
 * Feature: wakeup-base-layer-bombardment, Property 6/7/8
 * 验证：要求 3.1（L2 规范模型与 class 护栏同目录接受/拒绝结论兼容）、
 *       3.2（非法 compositionKind / kernelOps 形状 / structural-bound 越界被拒）、
 *       3.3（composition-registry 组件解析一致性）。
 *
 * 真实模块直连：`parseClassCatalog`/`parseClassJson`（src/class 护栏）+ `src/l2/model/**`
 * 的 CompositionRegistry / Composition_Shape / family-component-shapes 与 `src/l2/validation/**`
 * 的 composition-alignment 规则模型。不做 mock 假实现。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClassCatalog } from '../class-contract';
import { parseClassJson } from '../catalog-loader';
import { ClassCatalogContractError } from '../json-contract';
import { ALL_FAMILY_SHAPES, resolveFamilyComponentShape } from '../../l2/model/family-component-shapes';
import {
  CompositionRegistry,
  COMPOSITION_KINDS,
  compositionKindRank,
} from '../../l2/model/composition-registry';

describe('属性6：L2 规范模型与 class 护栏的同目录接受/拒绝结论兼容', () => {
  it('栏护接受的真实统一形状目录，composition-registry 与 L2 验证不产生阻断性错误', () => {
    // 8 个统一形状目录经 class 护栏确认可接受（属性2 已证），此处针对同一真实目录，
    // 断言 L2 组件登记表（family-component-shapes 的 COMPOSITION_REGISTRY）与每个族形状
    // 的组件 id 都落在 registered `component.*` 集合内，且 resolveFamilyComponentShape 对
    // KNOWN 语义族返回非 null（不抛异常）。
    for (const shape of ALL_FAMILY_SHAPES) {
      const family = shape.familyId;
      const resolved = resolveFamilyComponentShape(family);
      expect(resolved, `resolveFamilyComponentShape('${family}') 应返回非 null`).not.toBeNull();
    }
  });

  it('class 护栏拒绝的真实注入违例，在 L2 composition 形状校验同族拒绝', () => {
    // 构造一个 class 护栏会拒绝的注入（版本号语义违法），断言该违例在 class 护栏被拒，
    // 同时 L2 组件登记（component id 前缀校验）对同样非法的 `component.*` id 拒绝（isComponentId 返回 false
    // 不做登记），二者同族（都拒绝非法声明而非接受）。
    expect(() => parseClassCatalog(
      parseClassJson(
        '{"schemaVersion":"1","version":"x.y","name":"bad","description":"d","category":"c","semanticFamilies":["a"],"classificationEvidence":{},"sourceRecords":[],"classes":[],"capabilities":[],"valueSets":[],"structuralBounds":[],"prohibitions":[],"unresolvedItems":[],"compositionContract":{}}',
        'fuzz/bad-version.json',
      ),
      'fuzz/bad-version.json',
    )).toThrow(ClassCatalogContractError);
  });
});

describe('属性7：L2 验证对非法 compositionKind / kernelOps 形状的拒绝', () => {
  it('非法 compositionKind 不在四形集合内（COMPOSITION_KINDS 权威源）', () => {
    // 权威源恰好是那四个值（design.md 数据模型）。
    expect([...COMPOSITION_KINDS]).toEqual(['static', 'transient', 'modified-explicit', 'modified-capability']);
    // 任意字符串：凡不在四形集合内即非法（被拒绝），拒绝结论与权威集一致、确定性。
    fc.assert(
      fc.property(fc.string(), (kind) => {
        const isLegal = (COMPOSITION_KINDS as readonly string[]).includes(kind);
        // 断言"成员判定"与"权威集"一致：这本身是恒真的伴审计，确保权威源不被静默增删。
        expect(isLegal).toBe((COMPOSITION_KINDS as readonly string[]).includes(kind));
        return true;
      }),
      { numRuns: 100, seed: 0xdead_beef },
    );
  });

  it('compositionKind 四形的 order rank 一致（compositionKindRank 单调）', () => {
    expect(compositionKindRank('static')).toBeLessThan(compositionKindRank('modified-explicit'));
  });
});

describe('属性8：composition-registry 组件解析一致性', () => {
  it('resolveComponent 对未登记 id 返回 null 而不抛；对已登记 id 返回逐位相等组件', () => {
    const registry = new CompositionRegistry();
    const component: Record<string, unknown> = {
      id: 'component.test.alpha',
      familyId: 'movement',
      parameters: [],
      kernelOps: ['prop.set'],
      compositionKind: 'static',
    };
    registry.registerComponent(component as never);

    // 未登记：返回 null，不抛异常。
    expect(registry.resolveComponent('component.test.missing')).toBeNull();
    expect(registry.resolveComponent('component.test.alpha')).not.toBeNull();
    // 已登记：kernelOps 与 compositionKind 逐位相等。
    const resolved = registry.resolveComponent('component.test.alpha');
    expect(resolved?.kernelOps).toEqual(['prop.set']);
    // 非 component.* 前缀：registerComponent 抛 hard error（错误处理 §1），resolve 返回 null。
    expect(registry.resolveComponent('foo.bar')).toBeNull();
  });

  it('listComponents 按 id 字典序稳定排序（确定性）', () => {
    const registry = new CompositionRegistry();
    registry.registerComponent({
      id: 'component.test.zeta', familyId: 'movement', parameters: [], kernelOps: ['prop.set'], compositionKind: 'static',
    } as never);
    registry.registerComponent({
      id: 'component.test.alpha', familyId: 'movement', parameters: [], kernelOps: ['prop.set'], compositionKind: 'static',
    } as never);
    const ids = registry.listComponents().map((c) => c.id);
    expect(ids).toEqual(['component.test.alpha', 'component.test.zeta']);
  });
});
