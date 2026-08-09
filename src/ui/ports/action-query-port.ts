/**
 * 合法动作与作用域查询端口（design.md §3.0、§6.1、J-23、J-24）。
 *
 * 两条关键设计：
 *
 * 1. 端口**不暴露**接受裸 `Query` 的方法，只暴露 `scopedQuery(spec)`。`visibleTo` 由端口
 *    内部强制注入，因此"忘记传 visibleTo"这一失效形态在类型层就不存在——不是靠代码评审
 *    （J-23）。本文件从头到尾不引用任何内核查询类型，正是为了让裸 `Query` 无法被表达。
 * 2. 目标绑定取 `LegalAction.bindings`，不等 `ActionDescriptor.targets`——后者在
 *    `src/l2/adapters/ui-adapter.ts` 中恒为空数组（C-6），而前者真实可用（J-24）。
 */

import type { UiResult } from '../model/diagnostic.js';
import type { ProjectedBindingValue } from '../model/intent.js';
import type { ActionCostCategory, UiBinding } from '../model/view.js';

export const SCOPED_QUERY_SOURCES = ['entity', 'node', 'attachment', 'log'] as const;
export type ScopedQuerySource = (typeof SCOPED_QUERY_SOURCES)[number];

/**
 * 作用域查询声明。
 *
 * 它刻意**没有** `visibleTo` 字段：可见性谓词不是调用方的选项，而是端口实现的义务。
 * 同理它也没有任意表达式字段——UI 只能声明"我要哪一类东西、按哪些已投影字段筛"。
 */
export interface ScopedQuerySpec {
  readonly from: ScopedQuerySource;
  readonly wherePropertyEquals?: Readonly<Record<string, ProjectedBindingValue>>;
  readonly limit?: number;
}

export interface ScopedRef {
  readonly refId: string;
  readonly kind: ScopedQuerySource;
}

export type ScopedQueryOutcome = UiResult<readonly ScopedRef[]>;

export interface ActorRef {
  readonly entityId: string;
}

/** 合法动作投影。`safeReasonKey` 是安全原因映射键，不是自由文本原文（J-16）。 */
export interface LegalActionProjection {
  readonly actionId: string;
  readonly bindings: readonly UiBinding[];
  readonly costCategory: ActionCostCategory;
  readonly safeReasonKey?: string;
}

export type LegalActionQueryOutcome = UiResult<readonly LegalActionProjection[]>;

export interface ActionQueryPort {
  scopedQuery(spec: ScopedQuerySpec): ScopedQueryOutcome;
  /** 绑定 `PresentationGateway.queryActions(actor, 'ui')`。 */
  queryActions(actor: ActorRef): LegalActionQueryOutcome;
}
