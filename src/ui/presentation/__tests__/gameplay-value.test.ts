import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GAMEPLAY_VALUE_RANGE } from '../../../l2/model/constitution';
import {
  discreteSegments,
  isGameplayValue,
  isInternalMetric,
  makeGameplayValue,
  makeInternalMetric,
  type GameplayValue,
  type GameplayValueOwnership,
} from '../gameplay-value';

const RESOURCE_OWNERSHIP: GameplayValueOwnership = { category: 'resource', playerVisible: true, role: 'hp' };
const COST_OWNERSHIP: GameplayValueOwnership = { category: 'cost', playerVisible: true };

function accepted(raw: unknown, ownership = COST_OWNERSHIP): GameplayValue {
  const result = makeGameplayValue(raw, ownership);
  if (!result.ok) throw new Error('expected the gameplay value to be accepted');
  return result.value;
}

describe('玩家可见玩法数值构造', () => {
  it('范围常量取自 L0 宪法，不在本层重新裁决', () => {
    expect(GAMEPLAY_VALUE_RANGE).toEqual({ min: 1, max: 5 });
  });

  it('六类非法输入全部被拒绝并携带 GAMEPLAY_VALUE_OUT_OF_RANGE', () => {
    const cases: readonly (readonly [string, unknown, GameplayValueOwnership | undefined])[] = [
      ['低于下界', 0, COST_OWNERSHIP],
      ['高于上界', 6, COST_OWNERSHIP],
      ['非整数', 2.5, COST_OWNERSHIP],
      ['NaN', Number.NaN, COST_OWNERSHIP],
      ['Infinity', Number.POSITIVE_INFINITY, COST_OWNERSHIP],
      ['缺归属分类', 3, undefined],
    ];
    for (const [label, raw, ownership] of cases) {
      const result = makeGameplayValue(raw, ownership);
      expect(result.ok, label).toBe(false);
      expect(result.diagnostics[0]?.code, label).toBe('GAMEPLAY_VALUE_OUT_OF_RANGE');
      expect(result.diagnostics[0]?.severity, label).toBe('error');
    }
  });

  it('边界值 1 与 5 被接受', () => {
    expect(accepted(1).value).toBe(1);
    expect(accepted(5).value).toBe(5);
  });
});

describe('归属分类与内部度量隔离', () => {
  it('未被上游分类为玩家可见的数值被拒绝', () => {
    const result = makeGameplayValue(3, { category: 'cost', playerVisible: false });
    expect(result.ok).toBe(false);
  });

  it('资源类数值缺少资源语义角色时被拒绝', () => {
    const result = makeGameplayValue(3, { category: 'resource', playerVisible: true });
    expect(result.ok).toBe(false);
  });

  it('InternalMetric 无法传入接受 GameplayValue 的位置', () => {
    const frames = makeInternalMetric(60, 'fps');
    expect(isInternalMetric(frames)).toBe(true);
    expect(isGameplayValue(frames)).toBe(false);
    // @ts-expect-error 内部度量与玩法数值靠 brand 隔离，类型层拒绝互换
    const segments = discreteSegments(frames);
    expect(segments).toBeTruthy();
  });

  it('GameplayValue 无法被当作 InternalMetric 使用', () => {
    const value = accepted(3, RESOURCE_OWNERSHIP);
    const consume = (metric: ReturnType<typeof makeInternalMetric<number>>): number => metric.value;
    // @ts-expect-error 玩法数值不是内部度量
    const consumed = consume(value);
    expect(consumed).toBeTruthy();
  });

  it('允许的离散呈现是布尔分段而非比例', () => {
    expect(discreteSegments(accepted(3, RESOURCE_OWNERSHIP))).toEqual([true, true, true, false, false]);
    expect(discreteSegments(accepted(5, RESOURCE_OWNERSHIP))).toEqual([true, true, true, true, true]);
  });
});

describe('不存在伪精确转换路径', () => {
  it('源文件中不出现百分比、比例或定点小数转换', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../gameplay-value.ts'),
      'utf8',
    );
    const forbidden = [
      /\btoPercent\b/u,
      /\bpercent(?:age)?\s*[:(=]/iu,
      /\bratio\b/iu,
      /\btoFixed\b/u,
      /[*/]\s*100\b/u,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(source), pattern.source).toBe(false);
    }
  });
});
