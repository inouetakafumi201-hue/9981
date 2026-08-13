/**
 * 单元测试：space-items-structural-bounds 边界稳定性与连接计数端口纯函数性。
 *
 * 实施前要求 1.2：measureConnectionCount 只接受纯数据输入，不依赖引擎层拓扑模块的运行时状态或方法。
 */

import { describe, it, expect } from 'vitest';
import {
  SPACE_ITEMS_SCENE_SCALES,
  SCENE_CONNECTION_CEILING,
  MICRO_SCENE_PARENT_CARDINALITY,
  MICRO_SCENE_LIFECYCLE_DETERMINANT_CARDINALITY,
  TRANSITION_ENDPOINT_COUNT,
  SPACE_ITEMS_STRUCTURAL_BOUNDS,
  SCENE_SCALE_IDENTITY,
  ADMITTED_MICRO_SCENE_PARENT_SCALES,
  findStructuralBound,
  isWellSourcedBound,
  isSpaceItemsSceneScale,
  sceneScaleRank,
  measureConnectionCount,
  validateScaleTightening,
  type ConnectionEndpoints,
  type ConnectionCountMetric,
  type ScaleTighteningVerdict,
} from '../../../../src/l2/model/space-items-structural-bounds.js';
import { NODE_CONNECTION_BOUND } from '../../../../src/l2/model/constitution.js';

describe('space-items-structural-bounds: 基本导出', () => {
  it('导出三档尺度', () => {
    expect(SPACE_ITEMS_SCENE_SCALES).toEqual(['large', 'medium', 'small']);
  });

  it('导出四个结构边界', () => {
    expect(SPACE_ITEMS_STRUCTURAL_BOUNDS).toHaveLength(4);
  });

  it('导出场景尺度身份映射', () => {
    expect(SCENE_SCALE_IDENTITY.large).toBeDefined();
    expect(SCENE_SCALE_IDENTITY.medium).toBeDefined();
    expect(SCENE_SCALE_IDENTITY.small).toBeDefined();
  });

  it('导出合法微型场景父级尺度', () => {
    expect(ADMITTED_MICRO_SCENE_PARENT_SCALES).toEqual(['large', 'medium', 'small']);
  });
});

describe('space-items-structural-bounds: 结构边界取值正确性', () => {
  it('场景连接数天花板 = 5（D-057）', () => {
    expect(SCENE_CONNECTION_CEILING.value).toBe(5);
    expect(SCENE_CONNECTION_CEILING.value).toBe(NODE_CONNECTION_BOUND);
    expect(SCENE_CONNECTION_CEILING.structuralRationale).toContain('五并列原则');
  });

  it('微型场景父级基数 = 1', () => {
    expect(MICRO_SCENE_PARENT_CARDINALITY.value).toBe(1);
    expect(MICRO_SCENE_PARENT_CARDINALITY.structuralRationale).toContain('恰好一个父级');
  });

  it('微型场景生命周期判据基数 = 2', () => {
    expect(MICRO_SCENE_LIFECYCLE_DETERMINANT_CARDINALITY.value).toBe(2);
    expect(MICRO_SCENE_LIFECYCLE_DETERMINANT_CARDINALITY.structuralRationale).toContain(
      '有效父级',
    );
    expect(MICRO_SCENE_LIFECYCLE_DETERMINANT_CARDINALITY.structuralRationale).toContain('占用');
  });

  it('过渡端点数 = 2', () => {
    expect(TRANSITION_ENDPOINT_COUNT.value).toBe(2);
    expect(TRANSITION_ENDPOINT_COUNT.structuralRationale).toContain('端点数');
  });
});

describe('space-items-structural-bounds: 所有边界都具备权威来源与结构理由', () => {
  it('四个边界全部通过 isWellSourcedBound', () => {
    for (const bound of SPACE_ITEMS_STRUCTURAL_BOUNDS) {
      expect(
        isWellSourcedBound(bound),
        `${bound.boundId} 缺少权威来源或结构理由`,
      ).toBe(true);
      expect(bound.authoritativeSources.length).toBeGreaterThan(0);
      expect(bound.structuralRationale.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('space-items-structural-bounds: 查询与谓词', () => {
  it('findStructuralBound 返回正确边界', () => {
    const bound = findStructuralBound('structural-bound.scene.connection_limit');
    expect(bound).toBeDefined();
    expect(bound?.value).toBe(5);
  });

  it('findStructuralBound 对不存在的 ID 返回 undefined', () => {
    expect(findStructuralBound('non-existent-bound')).toBeUndefined();
  });

  it('isSpaceItemsSceneScale 正确识别尺度', () => {
    expect(isSpaceItemsSceneScale('large')).toBe(true);
    expect(isSpaceItemsSceneScale('medium')).toBe(true);
    expect(isSpaceItemsSceneScale('small')).toBe(true);
    expect(isSpaceItemsSceneScale('unknown')).toBe(false);
    expect(isSpaceItemsSceneScale(null)).toBe(false);
    expect(isSpaceItemsSceneScale(123)).toBe(false);
  });

  it('sceneScaleRank 返回正确序位', () => {
    expect(sceneScaleRank('large')).toBe(0);
    expect(sceneScaleRank('medium')).toBe(1);
    expect(sceneScaleRank('small')).toBe(2);
    expect(sceneScaleRank('unknown' as any)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('space-items-structural-bounds: 连接计数端口（实施前要求 1.2）', () => {
  it('measureConnectionCount 是纯函数，不依赖引擎层运行时状态', () => {
    const links: ConnectionEndpoints[] = [
      { a: 'node-1', b: 'node-2' },
      { a: 'node-2', b: 'node-3' },
      { a: 'node-1', b: 'node-3' },
    ];

    const metric: ConnectionCountMetric = measureConnectionCount(links, 'node-1');

    expect(metric.kind).toBe('Internal_Metric');
    expect(metric.metric).toBe('natural-scene-connection-count');
    expect(metric.nodeId).toBe('node-1');
    expect(metric.count).toBe(2);
  });

  it('每个端点对最多计数一次', () => {
    const links: ConnectionEndpoints[] = [
      { a: 'node-1', b: 'node-2' },
      { a: 'node-1', b: 'node-2' }, // 重复
    ];

    const metric = measureConnectionCount(links, 'node-1');
    expect(metric.count).toBe(2); // 两条连接分别计数
  });

  it('自环只计数一次', () => {
    const links: ConnectionEndpoints[] = [{ a: 'node-1', b: 'node-1' }];

    const metric = measureConnectionCount(links, 'node-1');
    expect(metric.count).toBe(1);
  });

  it('不相关节点的连接不计入', () => {
    const links: ConnectionEndpoints[] = [
      { a: 'node-2', b: 'node-3' },
      { a: 'node-3', b: 'node-4' },
    ];

    const metric = measureConnectionCount(links, 'node-1');
    expect(metric.count).toBe(0);
  });

  it('空连接集合产生零计数', () => {
    const metric = measureConnectionCount([], 'node-1');
    expect(metric.count).toBe(0);
  });
});

describe('space-items-structural-bounds: 玩法层收紧判定', () => {
  it('合法收紧：至少一档小于天花板', () => {
    const verdict: ScaleTighteningVerdict = validateScaleTightening({
      large: 5,
      medium: 4,
      small: 3,
    });

    expect(verdict.acceptable).toBe(true);
    expect(verdict.tightensAtLeastOnce).toBe(true);
    expect(verdict.outOfRange).toHaveLength(0);
  });

  it('非法收紧：全部等于天花板', () => {
    const verdict = validateScaleTightening({
      large: 5,
      medium: 5,
      small: 5,
    });

    expect(verdict.acceptable).toBe(false);
    expect(verdict.tightensAtLeastOnce).toBe(false);
  });

  it('非法收紧：有档位超过天花板', () => {
    const verdict = validateScaleTightening({
      large: 6,
      medium: 4,
      small: 3,
    });

    expect(verdict.acceptable).toBe(false);
    expect(verdict.outOfRange.length).toBeGreaterThan(0);
    expect(verdict.outOfRange[0]?.scale).toBe('large');
    expect(verdict.outOfRange[0]?.value).toBe(6);
  });

  it('非法收紧：有档位小于 1', () => {
    const verdict = validateScaleTightening({
      large: 5,
      medium: 0,
      small: 3,
    });

    expect(verdict.acceptable).toBe(false);
    expect(verdict.outOfRange.length).toBeGreaterThan(0);
  });

  it('非法收紧：非整数或非有限值', () => {
    const verdict = validateScaleTightening({
      large: 5.5,
      medium: 4,
      small: 3,
    });

    expect(verdict.acceptable).toBe(false);
    expect(verdict.outOfRange.length).toBeGreaterThan(0);
  });
});

describe('space-items-structural-bounds: 冻结与稳定性', () => {
  it('SPACE_ITEMS_STRUCTURAL_BOUNDS 被冻结', () => {
    expect(Object.isFrozen(SPACE_ITEMS_STRUCTURAL_BOUNDS)).toBe(true);
  });

  it('每个结构边界对象被冻结', () => {
    for (const bound of SPACE_ITEMS_STRUCTURAL_BOUNDS) {
      expect(Object.isFrozen(bound)).toBe(true);
      expect(Object.isFrozen(bound.authoritativeSources)).toBe(true);
    }
  });

  it('SCENE_SCALE_IDENTITY 被冻结', () => {
    expect(Object.isFrozen(SCENE_SCALE_IDENTITY)).toBe(true);
    expect(Object.isFrozen(SCENE_SCALE_IDENTITY.large)).toBe(true);
    expect(Object.isFrozen(SCENE_SCALE_IDENTITY.medium)).toBe(true);
    expect(Object.isFrozen(SCENE_SCALE_IDENTITY.small)).toBe(true);
  });
});
