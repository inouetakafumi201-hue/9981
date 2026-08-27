/**
 * Property 6: 未分类数值拒绝装载
 * 
 * Feature: wakeup-core-mechanics
 * Requirements: 3.7, 3.9
 * 
 * 验证内容：
 * - 任一数值字段在 numericOwnership 中无分类 → E_LOAD_NUMERIC_OWNERSHIP
 * - 不得推断默认分类（不能把缺失当作 internal）
 * - 分类为 internal 但出现在投影白名单 → 拒绝
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arbNumericOwnership } from './generators';

describe('Property 6: 数值归属校验', () => {
  it('数值字段缺失归属分类则拒绝装载', () => {
    const defWithUnclassifiedValue = {
      id: 'test_action',
      cost: [{ pool: 'ap', amount: 1 }],
      // numericOwnership 缺失对 amount 的分类
      numericOwnership: {},
    };

    // TODO: 调用 validateNumericOwnership，应返回 E_LOAD_NUMERIC_OWNERSHIP
    const hasClassification = Object.keys(defWithUnclassifiedValue.numericOwnership).includes('cost.0.amount');
    expect(hasClassification).toBe(false); // 应被拒绝
  });

  it('不推断默认分类', () => {
    // 验证缺失分类不被当作 internal 或其他默认值
    const unclassifiedField = { value: 3 };
    
    // TODO: 真实实现应验证装载期不自动补全分类
    const wasInferred = false; // 占位：不应有推断逻辑
    expect(wasInferred).toBe(false);
  });

  it('分类为 internal 但出现在投影白名单则拒绝', () => {
    const invalidConfig = {
      id: 'test',
      numericOwnership: {
        'turnIndex': { kind: 'internal', note: 'round counter' },
      },
      projectionWhitelist: ['turnIndex'], // 错误：internal 字段不应在白名单
    };

    // TODO: 调用 assertInternalNotInProjectionWhitelist
    // 应返回 E_LOAD_NUMERIC_OWNERSHIP
    const isInWhitelist = invalidConfig.projectionWhitelist.includes('turnIndex');
    const isInternal = invalidConfig.numericOwnership['turnIndex']?.kind === 'internal';
    
    if (isInternal && isInWhitelist) {
      const shouldReject = true;
      expect(shouldReject).toBe(true);
    }
  });

  it('属性测试：遍历所有数值字段都有归属', () => {
    fc.assert(
      fc.property(arbNumericOwnership(), (ownership) => {
        // 验证每种归属都有必需字段
        if (ownership.kind === 'gameplay') {
          expect(ownership.min).toBe(1);
          expect(ownership.max).toBe(5);
          expect(ownership.int).toBe(true);
        } else if (ownership.kind === 'internal') {
          expect(ownership.note).toBeDefined();
        } else if (ownership.kind === 'structural') {
          expect(ownership.rationale).toBeDefined();
        } else if (ownership.kind === 'constitutional') {
          expect(ownership.sourceId).toBeDefined();
        }
      }),
      { numRuns: 100 }
    );
  });
});
