import { describe, expect, it } from 'vitest';

import { ACTION_COST_CATEGORIES, INTERACTION_INTENTS } from '../../../l2/model/family-contracts.js';
import {
  MAX_SIMULTANEOUS_OPTIONS,
  ROOT_OPTION_CURSOR,
  buildOptionSet,
  reachableActionSignatures,
  type OptionCursor,
} from '../option-set.js';
import type { UiActionView } from '../view.js';

function action(index: number): UiActionView {
  const costCategory = ACTION_COST_CATEGORIES[index % ACTION_COST_CATEGORIES.length];
  const intentIndex = index % (INTERACTION_INTENTS.length + 1);
  const interactionIntent = INTERACTION_INTENTS[intentIndex];
  if (costCategory === undefined) throw new Error('cost category fixture must exist');
  return {
    actionId: `act.${String(index).padStart(3, '0')}`,
    costCategory,
    ...(interactionIntent === undefined ? {} : { interactionIntent }),
    available: true,
    accessibleLabel: `动作 ${String(index)}`,
    assetRefs: [],
    bindings: [{ key: 'target', value: `node.${String(index % 8)}` }],
    targets: [],
  };
}

function actions(count: number): readonly UiActionView[] {
  return Array.from({ length: count }, (_unused, index) => action(index));
}

function walkAll(all: readonly UiActionView[]): {
  readonly signatures: readonly string[];
  readonly maxVisible: number;
} {
  const seen = new Set<string>();
  const signatures = new Set<string>();
  const queue: OptionCursor[] = [ROOT_OPTION_CURSOR];
  let maxVisible = 0;
  while (queue.length > 0) {
    const cursor = queue.shift();
    if (cursor === undefined) break;
    const key = `${cursor.path.join('/')}#${String(cursor.page)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const set = buildOptionSet(all, cursor);
    maxVisible = Math.max(maxVisible, set.visible.length);
    for (const option of set.visible) {
      if (option.kind === 'action' && option.bindingSignature !== undefined) {
        signatures.add(option.bindingSignature);
      }
      if (option.kind === 'descend' && option.groupKey !== undefined) {
        queue.push({ path: [...cursor.path, option.groupKey], page: 0 });
      }
      if (option.kind === 'next-page' || option.kind === 'previous-page') {
        queue.push({ path: cursor.path, page: option.targetPage ?? 0 });
      }
    }
  }
  return { signatures: [...signatures].sort(), maxVisible };
}

const SIZES = [0, 1, 5, 6, 37, 200] as const;

describe('SelectableOptionSet 的 ≤5 不变量', () => {
  it('任意规模输入下每一屏可选项都不超过 5（含导航控件）', () => {
    for (const size of SIZES) {
      const all = actions(size);
      const walked = walkAll(all);
      expect(walked.maxVisible, `size=${String(size)}`).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPTIONS);
    }
  });

  it('totalLegalOptions 恒等于输入动作数，且是 Internal_Metric', () => {
    for (const size of SIZES) {
      const set = buildOptionSet(actions(size), ROOT_OPTION_CURSOR);
      expect(set.totalLegalOptions.value).toBe(size);
      expect(set.totalLegalOptions.__brand).toBe('InternalMetric');
      expect(set.totalLegalOptions.unit).toBe('legal-action-count');
    }
  });

  it('没有任何选项被丢弃或截断：全部动作都可经导航到达', () => {
    for (const size of SIZES) {
      const all = actions(size);
      const walked = walkAll(all);
      expect(walked.signatures, `size=${String(size)}`).toEqual(reachableActionSignatures(all));
    }
  });

  it('同输入同输出（排序确定性，与输入顺序无关）', () => {
    const all = actions(37);
    const shuffled = [...all].reverse();
    const cursor: OptionCursor = { path: ['paid', 'traversal'], page: 0 };
    expect(buildOptionSet(shuffled, cursor)).toEqual(buildOptionSet(all, cursor));
  });

  it('空输入在根层产出零选项且不报错', () => {
    const set = buildOptionSet([], ROOT_OPTION_CURSOR);
    expect(set.visible).toEqual([]);
    expect(set.navigation.level).toBe('cost-category');
    expect(set.navigation.canAscend).toBe(false);
  });

  it('分级顺序固定为成本分类 → 交互意图 → 叶层分页', () => {
    const all = actions(37);
    expect(buildOptionSet(all, ROOT_OPTION_CURSOR).navigation.level).toBe('cost-category');
    expect(buildOptionSet(all, { path: ['paid'], page: 0 }).navigation.level).toBe('interaction-intent');
    expect(buildOptionSet(all, { path: ['paid', 'traversal'], page: 0 }).navigation.level).toBe('leaf');
  });

  it('越界页码被夹取到合法范围，而不是产出空屏', () => {
    const all = actions(200);
    const cursor: OptionCursor = { path: ['paid', 'traversal'], page: 9_999 };
    const set = buildOptionSet(all, cursor);
    expect(set.navigation.page).toBe(set.navigation.pageCount - 1);
    expect(set.visible.some((option) => option.kind === 'action')).toBe(true);
  });

  it('导航控件计入预算：分页屏上动作项不超过 2', () => {
    const set = buildOptionSet(actions(200), { path: ['paid', 'traversal'], page: 1 });
    expect(set.visible.filter((option) => option.kind === 'action').length).toBeLessThanOrEqual(2);
    expect(set.visible.map((option) => option.kind)).toContain('ascend');
    expect(set.visible.map((option) => option.kind)).toContain('previous-page');
    expect(set.visible.map((option) => option.kind)).toContain('next-page');
  });
});
