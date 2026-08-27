/**
 * checkInstantiable 穷举分类测试（design.md 3.1节 / 需求3.5, 16.6）。
 *
 * 方法论说明：本文件不使用 fast-check 随机采样，而是对三维校验空间做完整笛卡尔积穷举——
 * DefKind 全部 13 种取值 × 13 种取值（actual kind × expected kind）× abstract 布尔值 ×
 * 存在性布尔值。这是"推理榨干完备性"而非"随机碰撞"的具体做法：checkInstantiable 的实现
 * 不针对任何特定 DefKind 分支，因此若能证明它在全部 13×13×2 种 (actualKind, expectedKind,
 * abstractFlag) 组合、外加"Def 不存在"这一种情形下都返回正确分类，就是对该函数整个输入空间
 * 的完全覆盖，不存在"随机采样没跑到的角落"。
 */
import { describe, it, expect } from 'vitest';
import { checkInstantiable } from '../def-guard';
import type { Def, DefKind } from '../../state/def';

const ALL_DEF_KINDS: readonly DefKind[] = [
  'entity', 'item', 'node', 'link', 'attachment', 'action', 'rule',
  'playpack', 'decision', 'prefab', 'expr', 'schedule', 'policy',
] as const;

describe('checkInstantiable: 三维穷举分类（存在性 × kind匹配 × abstract）', () => {
  it('维度1：Def 不存在时，对全部 13 种 expectedKind 都返回 E_REF_MISSING（13 种穷举，非采样）', () => {
    for (const expectedKind of ALL_DEF_KINDS) {
      const lookup = () => null;
      const result = checkInstantiable(lookup, 'x:missing', expectedKind);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('E_REF_MISSING');
    }
  });

  it('维度2+3：对全部 13×13=169 种 (actualKind, expectedKind) 组合 × abstract∈{true,false} 完整穷举，验证四态分类恒正确', () => {
    let totalCases = 0;
    for (const actualKind of ALL_DEF_KINDS) {
      for (const expectedKind of ALL_DEF_KINDS) {
        for (const abstractFlag of [true, false, undefined] as const) {
          totalCases++;
          const def: Def = { id: 'x:test', kind: actualKind, abstract: abstractFlag };
          const lookup = (id: string) => (id === 'x:test' ? def : null);
          const result = checkInstantiable(lookup, 'x:test', expectedKind);

          if (actualKind !== expectedKind) {
            // kind 不匹配：无论 abstract 取值如何，都应报 E_REF_KIND（kind 检查先于 abstract 检查）
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.code).toBe('E_REF_KIND');
          } else if (abstractFlag === true) {
            // kind 匹配但 abstract:true：必须拒绝
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.code).toBe('E_REF_ABSTRACT');
          } else {
            // kind 匹配且非 abstract（false 或 undefined）：必须通过
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value).toBe(def);
          }
        }
      }
    }
    // 断言穷举确实跑满了全部组合数，防止未来误改循环范围而悄悄少测
    expect(totalCases).toBe(ALL_DEF_KINDS.length * ALL_DEF_KINDS.length * 3);
  });

  it('校验顺序性：不存在 > kind不匹配 > abstract，三者同时触发时按此优先级返回对应错误（穷举全部 2^3-1=7 种"至少一个条件成立"的组合中可同时触发多个条件的情形）', () => {
    // 情形A：不存在（此时无法同时判断 kind/abstract，因为对象本身就不存在）
    expect(checkInstantiable(() => null, 'x:1', 'entity').ok).toBe(false);

    // 情形B：存在但 kind 不匹配 + abstract:true 同时成立 -> 应报 kind 不匹配（顺序在前）
    const defBothWrong: Def = { id: 'x:1', kind: 'item', abstract: true };
    const resultB = checkInstantiable(() => defBothWrong, 'x:1', 'entity');
    expect(resultB.ok).toBe(false);
    if (!resultB.ok) expect(resultB.code).toBe('E_REF_KIND');

    // 情形C：存在、kind 匹配、abstract:true -> 应报 abstract
    const defAbstractOnly: Def = { id: 'x:1', kind: 'entity', abstract: true };
    const resultC = checkInstantiable(() => defAbstractOnly, 'x:1', 'entity');
    expect(resultC.ok).toBe(false);
    if (!resultC.ok) expect(resultC.code).toBe('E_REF_ABSTRACT');

    // 情形D：存在、kind 匹配、非 abstract -> 通过
    const defValid: Def = { id: 'x:1', kind: 'entity' };
    expect(checkInstantiable(() => defValid, 'x:1', 'entity').ok).toBe(true);
  });
});
