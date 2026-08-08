/**
 * `SelectableOptionSet` 与 ≤5 分级导航（design.md §4.4、J-13、J-14）。
 *
 * 铁律：分级只改变"同时呈现多少"，**绝不改变合法动作集本身**（Requirement 10.10）。
 * `totalLegalOptions` 恒等于输入动作数，且不存在任何丢弃或截断分支——所有动作都可经导航到达。
 *
 * 导航控件**计入**同时可选项预算（J-13）：如果"下一页"不计数，实际同时可选项就是 6。
 */

import { ACTION_COST_CATEGORIES, INTERACTION_INTENTS } from '../../l2/model/family-contracts.js';
import { makeInternalMetric, type InternalMetric } from '../presentation/gameplay-value.js';
import { bindingsKey } from './intent.js';
import type { ActionCostCategory, UiActionView } from './view.js';

/** 任一时刻同时可选项上限（Requirement 10.10）。 */
export const MAX_SIMULTANEOUS_OPTIONS = 5;

/** 未声明交互意图的动作所归入的分档键。 */
export const UNSPECIFIED_INTENT_GROUP = 'unspecified-intent';

export const OPTION_SET_LEVELS = ['cost-category', 'interaction-intent', 'leaf'] as const;
export type OptionSetLevel = (typeof OPTION_SET_LEVELS)[number];

export const SELECTABLE_OPTION_KINDS = [
  'action',
  'descend',
  'ascend',
  'previous-page',
  'next-page',
] as const;
export type SelectableOptionKind = (typeof SELECTABLE_OPTION_KINDS)[number];

export interface SelectableOption {
  readonly optionId: string;
  readonly kind: SelectableOptionKind;
  /** Visibility_Safe 的呈现文案；动作项取其无障碍标签，导航项取分档键。 */
  readonly label: string;
  /** 仅 `kind === 'action'` 时存在。 */
  readonly actionId?: string;
  /** 仅 `kind === 'action'` 时存在：区分同一动作的不同绑定。 */
  readonly bindingSignature?: string;
  /** 仅 `kind === 'descend'` 时存在：下钻到的分档键。 */
  readonly groupKey?: string;
  /** 仅分页控件存在：目标页序号。 */
  readonly targetPage?: number;
}

export interface OptionCursor {
  /** 分级路径：[0] 为成本分类，[1] 为交互意图分档。 */
  readonly path: readonly string[];
  readonly page: number;
}

export const ROOT_OPTION_CURSOR: OptionCursor = Object.freeze({
  path: Object.freeze([]) as readonly string[],
  page: 0,
});

export interface OptionNavigation {
  readonly level: OptionSetLevel;
  readonly path: readonly string[];
  readonly page: number;
  readonly pageCount: number;
  readonly canAscend: boolean;
}

export interface SelectableOptionSet {
  /** 当前这一屏可选项，长度恒 ≤ `MAX_SIMULTANEOUS_OPTIONS`（含导航控件）。 */
  readonly visible: readonly SelectableOption[];
  readonly navigation: OptionNavigation;
  /** 该 Set 覆盖的完整合法动作数量，作为 Internal_Metric 标注。 */
  readonly totalLegalOptions: InternalMetric<number>;
}

function actionSortKey(action: UiActionView): string {
  return `${action.actionId}\u0000${bindingsKey(
    Object.fromEntries(action.bindings.map((binding) => [binding.key, binding.value])),
  )}`;
}

function intentGroupOf(action: UiActionView): string {
  return action.interactionIntent ?? UNSPECIFIED_INTENT_GROUP;
}

/** 分档键的固定顺序：与 L2 闭合取值域一致，因此排序结果与输入顺序无关。 */
const INTENT_GROUP_ORDER: readonly string[] = Object.freeze([
  ...INTERACTION_INTENTS,
  UNSPECIFIED_INTENT_GROUP,
]);

function groupKeysInFixedOrder(
  actions: readonly UiActionView[],
  level: 'cost-category' | 'interaction-intent',
): readonly string[] {
  const order: readonly string[] =
    level === 'cost-category' ? ACTION_COST_CATEGORIES : INTENT_GROUP_ORDER;
  const present = new Set(
    actions.map((action) =>
      level === 'cost-category' ? (action.costCategory as string) : intentGroupOf(action),
    ),
  );
  return Object.freeze(order.filter((key) => present.has(key)));
}

function selectByPath(
  actions: readonly UiActionView[],
  path: readonly string[],
): readonly UiActionView[] {
  let selected = actions;
  if (path.length >= 1) {
    const costCategory = path[0] as ActionCostCategory;
    selected = selected.filter((action) => action.costCategory === costCategory);
  }
  if (path.length >= 2) {
    const intentGroup = path[1] as string;
    selected = selected.filter((action) => intentGroupOf(action) === intentGroup);
  }
  return selected;
}

interface PageLayout {
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly needsPaging: boolean;
}

/**
 * 计算分页布局。
 *
 * 预留槽位按**最坏情形**计算（上一层控件 + 上一页 + 下一页），因此每页容量恒定、
 * `pageCount` 不依赖当前页码。首页无"上一页"、末页无"下一页"，这些页只会更少于 5，
 * 不会破坏上限。
 */
function pageLayout(entryCount: number, canAscend: boolean, requestedPage: number): PageLayout {
  const ascendSlots = canAscend ? 1 : 0;
  if (entryCount + ascendSlots <= MAX_SIMULTANEOUS_OPTIONS) {
    return { page: 0, pageCount: 1, pageSize: Math.max(entryCount, 1), needsPaging: false };
  }
  const pageSize = MAX_SIMULTANEOUS_OPTIONS - ascendSlots - 2;
  const pageCount = Math.max(1, Math.ceil(entryCount / pageSize));
  const page = Math.min(Math.max(Number.isInteger(requestedPage) ? requestedPage : 0, 0), pageCount - 1);
  return { page, pageCount, pageSize, needsPaging: true };
}

function assemble(
  entries: readonly SelectableOption[],
  layout: PageLayout,
  canAscend: boolean,
  path: readonly string[],
  level: OptionSetLevel,
  totalLegalOptions: number,
): SelectableOptionSet {
  const visible: SelectableOption[] = [];
  if (canAscend) {
    visible.push({
      optionId: `nav:ascend:${path.join('/')}`,
      kind: 'ascend',
      label: 'ascend',
    });
  }
  if (layout.needsPaging && layout.page > 0) {
    visible.push({
      optionId: `nav:previous:${path.join('/')}:${String(layout.page - 1)}`,
      kind: 'previous-page',
      label: 'previous-page',
      targetPage: layout.page - 1,
    });
  }
  const start = layout.needsPaging ? layout.page * layout.pageSize : 0;
  const end = layout.needsPaging ? start + layout.pageSize : entries.length;
  visible.push(...entries.slice(start, end));
  if (layout.needsPaging && layout.page < layout.pageCount - 1) {
    visible.push({
      optionId: `nav:next:${path.join('/')}:${String(layout.page + 1)}`,
      kind: 'next-page',
      label: 'next-page',
      targetPage: layout.page + 1,
    });
  }
  return Object.freeze({
    visible: Object.freeze(visible.map((option) => Object.freeze(option))),
    navigation: Object.freeze({
      level,
      path: Object.freeze([...path]),
      page: layout.page,
      pageCount: layout.pageCount,
      canAscend,
    }),
    totalLegalOptions: makeInternalMetric(totalLegalOptions, 'legal-action-count'),
  });
}

/**
 * 构建当前一屏的可选项集合。
 *
 * 分级顺序固定为 `costCategory`（2 值）→ `interactionIntent`（4 值 + 未声明档）→
 * 稳定标识分页（J-14）。排序完全由固定枚举顺序与稳定标识决定，因此同输入必得同输出。
 */
export function buildOptionSet(
  actions: readonly UiActionView[],
  cursor: OptionCursor = ROOT_OPTION_CURSOR,
): SelectableOptionSet {
  const total = actions.length;
  const path = cursor.path.slice(0, 2);
  const scoped = selectByPath(actions, path);
  const canAscend = path.length > 0;

  if (path.length === 0) {
    const keys = groupKeysInFixedOrder(actions, 'cost-category');
    const entries = keys.map<SelectableOption>((key) => ({
      optionId: `nav:descend:${key}`,
      kind: 'descend',
      label: key,
      groupKey: key,
    }));
    return assemble(entries, pageLayout(entries.length, false, cursor.page), false, path, 'cost-category', total);
  }

  if (path.length === 1) {
    const keys = groupKeysInFixedOrder(scoped, 'interaction-intent');
    const entries = keys.map<SelectableOption>((key) => ({
      optionId: `nav:descend:${path[0] ?? ''}/${key}`,
      kind: 'descend',
      label: key,
      groupKey: key,
    }));
    return assemble(
      entries,
      pageLayout(entries.length, canAscend, cursor.page),
      canAscend,
      path,
      'interaction-intent',
      total,
    );
  }

  const leaves = [...scoped]
    .sort((left, right) => (actionSortKey(left) < actionSortKey(right) ? -1 : actionSortKey(left) > actionSortKey(right) ? 1 : 0))
    .map<SelectableOption>((action) => ({
      optionId: `action:${actionSortKey(action)}`,
      kind: 'action',
      label: action.accessibleLabel,
      actionId: action.actionId,
      bindingSignature: actionSortKey(action),
    }));
  return assemble(leaves, pageLayout(leaves.length, canAscend, cursor.page), canAscend, path, 'leaf', total);
}

/** 枚举某个游标下的全部可达动作标识，供"没有任何选项被丢弃"的断言使用。 */
export function reachableActionSignatures(actions: readonly UiActionView[]): readonly string[] {
  return Object.freeze([...actions].map(actionSortKey).sort());
}
