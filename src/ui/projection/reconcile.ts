/**
 * 视图归约与重同步（design.md §15、§17、J-6，tasks.md 任务 3.2、3.3）。
 *
 * 全量与增量共用**唯一一个**归约函数 `reduceView`：全量路径以空事件数组调用它。
 * 两条路径写两份归约实现，是本类系统最常见的分叉来源。
 *
 * 关键设计（J-6）：增量事件只驱动**演出**，不驱动**状态**。因此 `UiView` 完全由全量投影
 * 决定，事件只产出演出队列。由此直接得到两条性质：丢掉任意事件子集不改变最终视图
 * （只少几段动画），以及全量渲染与"全量 + 增量重放"逐字段相等（Property 21）。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnostic,
} from '../model/diagnostic.js';
import type { RuleEventProjection } from '../model/event-projection.js';
import { compareRevision, type StateRevision } from '../model/revision.js';
import {
  entityViewToken,
  type UiActionView,
  type UiDecisionView,
  type UiEntityView,
  type UiTurnOrderEntry,
  type UiView,
} from '../model/view.js';
import type { InternalMetric } from '../presentation/gameplay-value.js';
import { classifyStaleness } from './staleness.js';

/** 由已验证全量投影 + 已验证描述符组装出的归约输入。 */
export interface ProjectedViewBase {
  readonly revision: StateRevision;
  readonly agentId: string;
  readonly scopeId: string;
  readonly turn: InternalMetric<number>;
  readonly entities: readonly UiEntityView[];
  /**
   * 当前 Knowledge **显式授权**的记忆表示（Requirement 15.6）。
   * 只有稳定标识不在 `entities` 中时才进入视图；其语义字段来自认知切片，
   * 不是上一版视图的残留——复用视图表示不等于复用陈旧语义字段（Requirement 15.5）。
   */
  readonly rememberedEntities: readonly UiEntityView[];
  readonly actions: readonly UiActionView[];
  readonly decisions: readonly UiDecisionView[];
  readonly turnOrder: readonly UiTurnOrderEntry[];
  readonly diagnostics: readonly UiDiagnostic[];
}

export interface ViewReduction {
  readonly view: UiView;
  /** 可立即播放的演出队列，按权威因果顺序。 */
  readonly presentation: readonly RuleEventProjection[];
  /** 超前事件：其修订晚于当前投影，需缓冲等待对应投影到达。 */
  readonly deferred: readonly RuleEventProjection[];
  readonly diagnostics: readonly UiDiagnostic[];
}

function normalizeEntity(entity: UiEntityView, remembered: boolean): UiEntityView {
  return Object.freeze({
    ...entity,
    viewToken: entityViewToken(entity.entityId),
    remembered,
  });
}

function eventSortKey(event: RuleEventProjection): string {
  return `${String(event.sequence).padStart(16, '0')}\u0000${event.semanticType}`;
}

/**
 * 唯一的视图归约。
 *
 * `events` 为空数组时就是全量渲染路径——刻意不给它单独的函数入口，
 * 这样"两条路径产出同一视图"是结构上的必然，而不是需要额外维护的一致性。
 */
export function reduceView(
  base: ProjectedViewBase,
  events: readonly RuleEventProjection[],
): ViewReduction {
  const liveIds = new Set(base.entities.map((entity) => entity.entityId));
  const entities = [
    ...base.entities.map((entity) => normalizeEntity(entity, false)),
    ...base.rememberedEntities
      .filter((entity) => !liveIds.has(entity.entityId))
      .map((entity) => normalizeEntity(entity, true)),
  ].sort((left, right) => (left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0));

  const view: UiView = Object.freeze({
    revision: base.revision,
    agentId: base.agentId,
    scopeId: base.scopeId,
    turn: base.turn,
    entities: Object.freeze(entities),
    actions: Object.freeze([...base.actions]),
    decisions: Object.freeze([...base.decisions]),
    turnOrder: Object.freeze([...base.turnOrder]),
    diagnostics: Object.freeze([...base.diagnostics]),
  });

  const ordered = [...events].sort((left, right) =>
    eventSortKey(left) < eventSortKey(right) ? -1 : eventSortKey(left) > eventSortKey(right) ? 1 : 0,
  );
  const presentation: RuleEventProjection[] = [];
  const deferred: RuleEventProjection[] = [];
  const diagnostics: UiDiagnostic[] = [];
  for (const event of ordered) {
    switch (compareRevision(event.observedAtRevision, base.revision)) {
      case 'same':
        presentation.push(event);
        break;
      case 'older':
        diagnostics.push(
          uiDiagnostic({
            code: UI_DIAGNOSTIC_CODES.EVENT_ARRIVED_STALE,
            presentationLocation: `animation/${event.semanticType}`,
            reason: '增量事件的修订令牌早于当前投影，已丢弃且不回退显示',
            correctionSuggestion: '迟到事件属正常竞态，无需处理；持续出现说明事件通道落后',
            revision: event.observedAtRevision,
          }),
        );
        break;
      default:
        deferred.push(event);
        break;
    }
  }

  return Object.freeze({
    view,
    presentation: Object.freeze(presentation),
    deferred: Object.freeze(deferred),
    diagnostics: Object.freeze(diagnostics),
  });
}

export const RECONCILE_REASONS = [
  'initial',
  'stale',
  'revision-gap',
  'out-of-order',
  'buffer-timeout',
  'full-resync',
  'submission-stale',
  'resume-after-suspension',
] as const;
export type ReconcileReason = (typeof RECONCILE_REASONS)[number];

export interface ReconcileRequest {
  readonly kind: 'full-projection';
  readonly reason: ReconcileReason;
}

export interface ReconcileState {
  readonly view?: UiView;
  readonly presentation: readonly RuleEventProjection[];
  readonly pendingRequests: readonly ReconcileRequest[];
  /**
   * 是否允许启用影响规则的输入。
   *
   * 只有"已观察到新鲜投影且没有未完成的全量请求"时才为真：陈旧、修订间隙、缓冲超时、
   * 窗口挂起恢复（Requirement 8.8）都会先关掉它，等新投影到达再打开。
   */
  readonly interactionEnabled: boolean;
  readonly diagnostics: readonly UiDiagnostic[];
}

export interface Reconciler {
  state(): ReconcileState;
  /** 收到新鲜全量投影。返回归约后的新状态。 */
  onProjection(base: ProjectedViewBase): ReconcileState;
  /** 收到增量事件。`nowMs` 用于超前事件的缓冲计时，不参与任何规则判定。 */
  onEvent(event: RuleEventProjection, nowMs: number): ReconcileState;
  /** 推进缓冲计时。超时即丢弃缓冲并请求全量投影。 */
  tick(nowMs: number): ReconcileState;
  /** 由提交流程或窗口生命周期触发的显式重同步请求。 */
  requestFullProjection(reason: ReconcileReason): ReconcileState;
}

interface BufferedEvent {
  readonly event: RuleEventProjection;
  readonly arrivedAtMs: number;
}

export interface ReconcilerDeps {
  /** 超前事件缓冲超时，单位由 `InternalMetric.unit` 声明（毫秒）。 */
  readonly eventBufferTimeout: InternalMetric<number>;
}

export function createReconciler(deps: ReconcilerDeps): Reconciler {
  let base: ProjectedViewBase | undefined;
  let view: UiView | undefined;
  let presentation: readonly RuleEventProjection[] = Object.freeze([]);
  let buffer: BufferedEvent[] = [];
  let lastAppliedSequence: number | undefined;
  let requests: ReconcileRequest[] = [{ kind: 'full-projection', reason: 'initial' }];
  let diagnostics: readonly UiDiagnostic[] = Object.freeze([]);

  function snapshot(): ReconcileState {
    return Object.freeze({
      ...(view === undefined ? {} : { view }),
      presentation,
      pendingRequests: Object.freeze([...requests]),
      interactionEnabled: view !== undefined && requests.length === 0,
      diagnostics,
    });
  }

  function requestFull(reason: ReconcileReason, extra: readonly UiDiagnostic[] = []): ReconcileState {
    if (!requests.some((request) => request.reason === reason)) {
      requests = [...requests, { kind: 'full-projection', reason }];
    }
    diagnostics = Object.freeze([...extra]);
    return snapshot();
  }

  function gapDiagnostic(reason: string, event: RuleEventProjection): UiDiagnostic {
    return uiDiagnostic({
      code: UI_DIAGNOSTIC_CODES.PROJECTION_REVISION_GAP,
      presentationLocation: `animation/${event.semanticType}`,
      reason,
      correctionSuggestion: '请求全量投影；不得从增量事件推断缺失的语义迁移',
      revision: event.observedAtRevision,
      internalFields: { eventSequence: event.sequence },
    });
  }

  return Object.freeze({
    state: snapshot,

    onProjection(next: ProjectedViewBase): ReconcileState {
      if (base !== undefined && classifyStaleness(base.revision, next.revision) === 'requires-full-resync') {
        // 回退或不可判序：丢弃更晚的本地演出状态与缓冲（Requirement 8.4）。
        buffer = [];
        presentation = Object.freeze([]);
        lastAppliedSequence = undefined;
      }
      const applicable = buffer.map((entry) => entry.event);
      const reduction = reduceView(next, applicable);
      base = next;
      view = reduction.view;
      presentation = reduction.presentation;
      buffer = buffer.filter((entry) =>
        reduction.deferred.some((event) => event.sequence === entry.event.sequence),
      );
      for (const event of reduction.presentation) {
        lastAppliedSequence = Math.max(lastAppliedSequence ?? event.sequence, event.sequence);
      }
      requests = [];
      diagnostics = reduction.diagnostics;
      return snapshot();
    },

    onEvent(event: RuleEventProjection, nowMs: number): ReconcileState {
      if (base === undefined) {
        // 增量流早于全量投影：按声明的有界策略缓冲，绝不推断缺失的初始状态（Requirement 15.4）。
        buffer = [...buffer, { event, arrivedAtMs: nowMs }];
        return requestFull('initial');
      }
      const reduction = reduceView(base, [event]);
      diagnostics = reduction.diagnostics;
      if (reduction.deferred.length > 0) {
        buffer = [...buffer, { event, arrivedAtMs: nowMs }];
        return snapshot();
      }
      if (reduction.presentation.length === 0) return snapshot();

      const expected = lastAppliedSequence === undefined ? event.sequence : lastAppliedSequence + 1;
      if (event.sequence < expected) {
        return requestFull('out-of-order', [
          gapDiagnostic('增量事件乱序到达（序号不大于已应用序号），请求全量投影', event),
        ]);
      }
      if (event.sequence > expected) {
        return requestFull('revision-gap', [
          gapDiagnostic('增量事件报告修订间隙，请求全量投影', event),
        ]);
      }
      lastAppliedSequence = event.sequence;
      presentation = Object.freeze([...presentation, event]);
      return snapshot();
    },

    tick(nowMs: number): ReconcileState {
      if (buffer.length === 0) return snapshot();
      const oldest = buffer.reduce(
        (earliest, entry) => (entry.arrivedAtMs < earliest.arrivedAtMs ? entry : earliest),
        buffer[0] as BufferedEvent,
      );
      if (nowMs - oldest.arrivedAtMs < deps.eventBufferTimeout.value) return snapshot();
      const droppedCount = buffer.length;
      buffer = [];
      return requestFull('buffer-timeout', [
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.EVENT_BUFFER_TIMEOUT,
          presentationLocation: 'animation/event-buffer',
          reason: `缓冲的超前事件等待超时，已丢弃缓冲并触发一次全量重拉（丢弃 ${String(droppedCount)} 条）`,
          correctionSuggestion: '超前事件长期等不到对应投影，说明投影通道已落后；重拉比继续等待更快收敛',
          internalFields: { timeoutValue: deps.eventBufferTimeout.value, timeoutUnit: deps.eventBufferTimeout.unit },
        }),
      ]);
    },

    requestFullProjection(reason: ReconcileReason): ReconcileState {
      return requestFull(reason);
    },
  });
}
