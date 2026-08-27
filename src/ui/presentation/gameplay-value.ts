/**
 * 玩家可见玩法数值与内部度量的**类型隔离**（design.md §11.1、J-17）。
 *
 * 隔离靠不同的 brand，而不是命名约定（Requirement 10.6）：`InternalMetric` 无法被传入
 * 接受 `GameplayValue` 的位置，因此"把帧率当血量渲染"在类型层不可表达。
 *
 * 范围常量取 `src/l2/model/constitution.ts` 的 `GAMEPLAY_VALUE_RANGE`，本文件**不重新裁决**。
 *
 * 本文件不导出任何把 1—5 转百分比、小数评分或大标度评级的函数（Requirement 10.3）；
 * 该约束由 `__tests__/gameplay-value.test.ts` 的源文本扫描机械保证。
 */

import { GAMEPLAY_VALUE_RANGE } from '../../l2/model/constitution';
import type { ResourceSemanticRole } from '../../l2/model/family-contracts';
import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiResult,
} from '../model/diagnostic';

/**
 * 玩法数值的合法取值域。
 *
 * 写成字面量联合而非 `number`，使越界值在类型层就无法构造。
 * 与 `GAMEPLAY_VALUE_RANGE` 的一致性由 `GAMEPLAY_VALUE_SCALARS` 与运行时断言保证。
 */
export type GameplayValueScalar = 1 | 2 | 3 | 4 | 5;

export const GAMEPLAY_VALUE_SCALARS: readonly GameplayValueScalar[] = Object.freeze([1, 2, 3, 4, 5]);

/**
 * 数值归属分类。
 *
 * Requirement 10.2 要求"缺少归属分类"的数值被拒绝，因此归属是构造的必填输入，
 * 不是可选标注。分类集合闭合：新增分类需要显式改这里。
 */
export const GAMEPLAY_VALUE_OWNERSHIP_CATEGORIES = [
  'resource',
  'cost',
  'duration',
  'capacity',
  'threshold',
] as const;

export type GameplayValueOwnershipCategory = (typeof GAMEPLAY_VALUE_OWNERSHIP_CATEGORIES)[number];

export interface GameplayValueOwnership {
  readonly category: GameplayValueOwnershipCategory;
  /** 上游描述符是否把该数值分类为玩家可见（Requirement 10.1）。 */
  readonly playerVisible: boolean;
  /** 资源语义角色；`category === 'resource'` 时必填。 */
  readonly role?: ResourceSemanticRole;
}

/** 玩家可见玩法数值。构造入口唯一，越界即拒绝。 */
export interface GameplayValue {
  readonly __brand: 'GameplayValue';
  readonly value: GameplayValueScalar;
  readonly ownership: GameplayValueOwnership;
}

/** 内部度量。必须带单位，且不能被当作玩法数值渲染（Requirement 10.7）。 */
export interface InternalMetric<T> {
  readonly __brand: 'InternalMetric';
  readonly value: T;
  readonly unit: string;
}

export function makeInternalMetric<T>(value: T, unit: string): InternalMetric<T> {
  return Object.freeze({ __brand: 'InternalMetric' as const, value, unit });
}

export function isGameplayValue(candidate: unknown): candidate is GameplayValue {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as { __brand?: unknown }).__brand === 'GameplayValue'
  );
}

export function isInternalMetric(candidate: unknown): candidate is InternalMetric<unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as { __brand?: unknown }).__brand === 'InternalMetric'
  );
}

function rangeRejection(reason: string, location: string): UiResult<GameplayValue> {
  return uiRejected([
    uiDiagnostic({
      code: UI_DIAGNOSTIC_CODES.GAMEPLAY_VALUE_OUT_OF_RANGE,
      presentationLocation: location,
      reason,
      correctionSuggestion: `玩家可见玩法数值必须是 ${String(GAMEPLAY_VALUE_RANGE.min)}—${String(
        GAMEPLAY_VALUE_RANGE.max,
      )} 的整数，且由上游描述符声明归属分类`,
    }),
  ]);
}

/**
 * 构造玩家可见玩法数值。以下六类输入全部被拒绝：
 * 低于下界、高于上界、非整数、非有限（`NaN` / `Infinity`）、非数字、缺归属分类。
 *
 * `presentationLocation` 让诊断可定位到具体呈现位置（Requirement 12.2）。
 */
export function makeGameplayValue(
  raw: unknown,
  ownership: GameplayValueOwnership | undefined,
  presentationLocation = 'presentation/gameplay-value',
): UiResult<GameplayValue> {
  if (ownership === undefined) {
    return rangeRejection('玩法数值缺少归属分类', presentationLocation);
  }
  if (!ownership.playerVisible) {
    return rangeRejection('上游描述符未把该数值分类为玩家可见', presentationLocation);
  }
  if (ownership.category === 'resource' && ownership.role === undefined) {
    return rangeRejection('资源类玩法数值缺少资源语义角色', presentationLocation);
  }
  if (typeof raw !== 'number') {
    return rangeRejection('玩法数值不是数字', presentationLocation);
  }
  if (!Number.isFinite(raw)) {
    return rangeRejection('玩法数值非有限', presentationLocation);
  }
  if (!Number.isInteger(raw)) {
    return rangeRejection('玩法数值不是整数', presentationLocation);
  }
  if (raw < GAMEPLAY_VALUE_RANGE.min || raw > GAMEPLAY_VALUE_RANGE.max) {
    return rangeRejection('玩法数值越出宪法范围', presentationLocation);
  }
  return uiOk(
    Object.freeze({
      __brand: 'GameplayValue' as const,
      value: raw as GameplayValueScalar,
      ownership: Object.freeze({ ...ownership }),
    }),
  );
}

/**
 * 允许的离散呈现：把 1—5 展开为"已填充 / 未填充"分段（Requirement 10.4）。
 *
 * 返回的是布尔分段而不是比例，因此不可能退化成百分比或小数评分。
 * 上界取 `GAMEPLAY_VALUE_RANGE.max`，段数恒为 5。
 */
export function discreteSegments(value: GameplayValue): readonly boolean[] {
  const segments: boolean[] = [];
  for (let index = 1; index <= GAMEPLAY_VALUE_RANGE.max; index++) {
    segments.push(index <= value.value);
  }
  return Object.freeze(segments);
}
