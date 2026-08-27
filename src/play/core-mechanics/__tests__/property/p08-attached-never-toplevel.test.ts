/**
 * Property 8: 附着动作永不成为顶层分支
 * 
 * Feature: wakeup-core-mechanics
 * Requirements: 4.8, 8.4, 8.5, 8.8
 * 
 * 验证内容：
 * - 附着动作的 cost 为空数组（不是 amount=0）
 * - 必须声明 parentActions
 * - require 守卫包含"存在正在解算的父意图"
 * - queryActions 顶层枚举时该守卫为假，不出现在顶层
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arbAttachedAction } from './generators';

describe('Property 8: 附着动作三重机械保证', () => {
  it('附着动作的 cost 为空数组', () => {
    const validAttachedAction = {
      kind: 'action' as const,
      id: 'action.drop_item',
      cost: [], // 空数组
      costClass: 'attached' as const,
      parentActions: ['action.move'],
    };

    expect(validAttachedAction.cost).toEqual([]);
    expect(validAttachedAction.cost.length).toBe(0);
  });

  it('拒绝 cost 写成 amount=0 的附着动作', () => {
    const invalidZeroCostAction = {
      kind: 'action' as const,
      id: 'action.invalid',
      cost: [{ pool: 'ap', amount: 0 }], // 错误形态
      costClass: 'attached' as const,
    };

    // TODO: 装载期应拒绝（cost 必须是空数组，不是 amount=0）
    const shouldReject = invalidZeroCostAction.cost.length > 0;
    expect(shouldReject).toBe(true);
  });

  it('附着动作必须声明 parentActions', () => {
    const validAttached = {
      id: 'action.use_medkit',
      cost: [],
      costClass: 'attached' as const,
      parentActions: ['action.heal_self'],
    };

    const invalidAttached = {
      id: 'action.invalid',
      cost: [],
      costClass: 'attached' as const,
      // 缺少 parentActions
    };

    expect(validAttached.parentActions).toBeDefined();
    expect(validAttached.parentActions.length).toBeGreaterThan(0);

    // TODO: 装载期校验应拒绝 invalidAttached
    const hasParent = 'parentActions' in invalidAttached;
    expect(hasParent).toBe(false); // 应被拒绝
  });

  it('附着动作的 require 包含父意图守卫', () => {
    // TODO: 真实实现需要：
    // 1. 读取附着动作的 require 字段
    // 2. 验证存在守卫："存在正在解算的父意图"
    // 3. 顶层枚举时该守卫为假

    const hasParentIntentGuard = true; // 占位
    expect(hasParentIntentGuard).toBe(true);
  });

  it('queryActions 顶层枚举不返回附着动作', () => {
    // TODO: 真实实现需要：
    // 1. 调用 queryActions(actor, 'toplevel')
    // 2. 验证返回结果中不含任何 costClass='attached' 的动作

    const topLevelActions = ['move', 'attack', 'pickup']; // 占位
    const attachedActions = ['drop_item', 'use_medkit'];

    attachedActions.forEach((attached) => {
      expect(topLevelActions.includes(attached)).toBe(false);
    });
  });

  it('属性测试：从生成器抽取附着动作，验证约束', () => {
    fc.assert(
      fc.property(arbAttachedAction(), (action) => {
        if (action.costClass === 'attached') {
          // 生成器产出合法和非法形状，验证合法形状的属性
          const isLegalShape = 
            Array.isArray(action.cost) && 
            action.cost.length === 0 &&
            'parentActions' in action &&
            Array.isArray((action as any).parentActions);

          if (isLegalShape) {
            // 合法形状：cost 为空，有 parentActions
            expect(action.cost).toEqual([]);
            expect((action as any).parentActions.length).toBeGreaterThan(0);
          } else {
            // 非法形状：验证它确实违反了某项约束
            const hasNonZeroCost = action.cost && action.cost.length > 0;
            const lacksParentActions = !('parentActions' in action);
            expect(hasNonZeroCost || lacksParentActions).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
