/**
 * 双菜单面（design.md §8.4、D-042，tasks.md 任务 5.5）。
 *
 * 分面直接落在**已有的** `costCategory` 语义字段上，UI 不引入第二套分类。
 * 因为 `ACTION_COST_CATEGORIES` 只有两个取值，分类天然全覆盖且互斥——
 * 两面交集为空、并集等于全部可用动作（Property 14），不需要额外的归类规则。
 *
 * 最容易做错的一条（Requirement 5.10、5.11）：零费面**在任何时候可用**，
 * 不存在"预算耗尽才可用"的分支。本文件因此**不读取任何预算**——预算是否耗尽由上游的
 * `available` 字段体现（Requirement 10.5：成本只从已验证投影读取，不在本地重算）。
 * 预算耗尽的表现只是付费面为空，零费面与结束回合按键照旧保留。
 */

import type { UiActionView } from '../model/view';

export const MENU_FACES = ['paid', 'zero-cost'] as const;
export type MenuFace = (typeof MENU_FACES)[number];

export interface MenuFaces {
  readonly paid: readonly UiActionView[];
  readonly zeroCost: readonly UiActionView[];
  readonly activeFace: MenuFace;
  /** 零费面恒可用。写成字面量 `true`，使"仅在预算耗尽后可用"无法被表达。 */
  readonly zeroCostAlwaysAvailable: true;
  /** 结束回合控件恒保留（Requirement 5.11）。 */
  readonly endTurnAvailable: true;
  readonly paidSurfaceEmpty: boolean;
}

function byActionId(left: UiActionView, right: UiActionView): number {
  return left.actionId < right.actionId ? -1 : left.actionId > right.actionId ? 1 : 0;
}

export function buildMenuFaces(
  actions: readonly UiActionView[],
  activeFace: MenuFace = 'paid',
): MenuFaces {
  const available = actions.filter((action) => action.available);
  const paid = available.filter((action) => action.costCategory === 'paid').sort(byActionId);
  const zeroCost = available.filter((action) => action.costCategory === 'attached').sort(byActionId);
  return Object.freeze({
    paid: Object.freeze(paid),
    zeroCost: Object.freeze(zeroCost),
    activeFace,
    zeroCostAlwaysAvailable: true as const,
    endTurnAvailable: true as const,
    paidSurfaceEmpty: paid.length === 0,
  });
}

/** 切换分面。它是纯表现偏好，**不产生任何交互意图**（Requirement 5.10）。 */
export function toggleFace(current: MenuFace): MenuFace {
  return current === 'paid' ? 'zero-cost' : 'paid';
}

/** 当前分面呈现的动作。 */
export function activeFaceActions(faces: MenuFaces): readonly UiActionView[] {
  return faces.activeFace === 'paid' ? faces.paid : faces.zeroCost;
}
