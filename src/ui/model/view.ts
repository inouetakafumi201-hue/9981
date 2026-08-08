/**
 * UI 只读视图形状，以及对上游**契约类型**的单一引用点。
 *
 * 两条边界纪律：
 *
 * 1. 本文件是 `src/ui` 内唯一 `import type` 上游 L2 契约模块的地方。`src/l2/model/projection.ts`
 *    是纯类型契约文件（不含任何写入能力），因此引用它不是"依赖内部实现形状"，而是依赖
 *    已冻结的跨层契约；重新声明一套镜像类型反而会制造第二处真相来源。
 * 2. `src/ui/ports/**` 只从本文件取上游形状，因此端口文件的 import 列表里不出现
 *    `src/l2` 与 `src/core`（tasks.md 任务 2.1）。
 */

import type {
  ActionDescriptor,
  AuthorizationScope,
  BeliefFact,
  BeliefSlice,
  PresentationDescriptor,
  ReadOnlySemanticProjection,
  ResourceDescriptor,
  SemanticProperty,
  SemanticStateEntry,
  TargetDescriptor,
  VisibilityEntry,
} from '../../l2/model/projection.js';
import type {
  ActionCostCategory,
  InteractionIntent,
  ResourceSemanticRole,
} from '../../l2/model/family-contracts.js';
import type { GameplayValue, InternalMetric } from '../presentation/gameplay-value.js';
import type { StateRevision } from './revision.js';
import type { SalienceTier } from './profile.js';
import type { UiDiagnostic } from './diagnostic.js';

export type {
  ActionDescriptor,
  AuthorizationScope,
  BeliefFact,
  BeliefSlice,
  PresentationDescriptor,
  ReadOnlySemanticProjection,
  ResourceDescriptor,
  SemanticProperty,
  SemanticStateEntry,
  TargetDescriptor,
  VisibilityEntry,
};
export type { ActionCostCategory, InteractionIntent, ResourceSemanticRole };

/**
 * 上游 Agent 授权令牌。
 *
 * 全知视角与已授权开发面**只能**由上游 Agent 投影授予（Requirement 3.9、12.4）。
 * 令牌带 brand 且没有公开构造函数：`src/ui` 内没有任何路径能从本地开关造出它，
 * 只有 `ProjectionPort` 的实现（宿主侧）能提供。这使"本地开关开全知"在类型层不可达。
 */
export interface UpstreamAgentAuthority {
  readonly __brand: 'UpstreamAgentAuthority';
  readonly omniscient: boolean;
  readonly developmentSurface: boolean;
}

/** 本地调试设置。它**不含**任何能提升可见范围的字段，只影响呈现。 */
export interface LocalDebugSettings {
  readonly showInternalMetrics: boolean;
  readonly verbosePresentationLog: boolean;
  readonly overlayGrid: boolean;
}

export const DEFAULT_LOCAL_DEBUG_SETTINGS: LocalDebugSettings = Object.freeze({
  showInternalMetrics: false,
  verbosePresentationLog: false,
  overlayGrid: false,
});

/** 当前窗口代表的、已由权威运行时确认的 Agent。 */
export interface AuthorizedAgent {
  readonly agentId: string;
  readonly scope: AuthorizationScope;
  readonly authority: UpstreamAgentAuthority;
  readonly localDebug: LocalDebugSettings;
}

export function createAuthorizedAgent(
  agentId: string,
  scope: AuthorizationScope,
  authority: UpstreamAgentAuthority,
  localDebug: LocalDebugSettings = DEFAULT_LOCAL_DEBUG_SETTINGS,
): AuthorizedAgent {
  return Object.freeze({ agentId, scope, authority, localDebug: Object.freeze({ ...localDebug }) });
}

/** Agent 作用域缓存键。不同 Agent 不共享缓存条目（Requirement 3.8）。 */
export function agentScopeCacheKey(agentId: string, scopeId: string): string {
  return `${agentId}\u0000${scopeId}`;
}

/** 已验证的目标绑定。取值只能是投影中出现过的标识或值。 */
export interface UiBinding {
  readonly key: string;
  readonly value: string | number | boolean;
}

/** 已验证的资源呈现项。 */
export interface UiResourceView {
  readonly entityId: string;
  readonly role: ResourceSemanticRole;
  readonly amount: GameplayValue;
  readonly accessibleLabel: string;
}

/** 已验证的动作呈现项。语义字段全部来自显式描述符字段。 */
export interface UiActionView {
  readonly actionId: string;
  readonly costCategory: ActionCostCategory;
  /** 上游契约中该字段可缺省；缺省表示"该动作未声明交互意图"，不构成语义拒绝。 */
  readonly interactionIntent?: InteractionIntent;
  /** 姿态是开放字符串，原样透传（J-15）。 */
  readonly posture?: string;
  readonly available: boolean;
  /** 已安全化的不可用原因文案；原文不进入视图。 */
  readonly unavailabilityText?: string;
  readonly accessibleLabel: string;
  readonly assetRefs: readonly string[];
  readonly bindings: readonly UiBinding[];
  readonly targets: readonly UiTargetView[];
}

export interface UiTargetView {
  readonly targetId: string;
  readonly intent: InteractionIntent;
  readonly executable: boolean;
  readonly accessibleLabel: string;
}

/** Decision 呈现项。`status !== 'open'` 的 Decision 不得产生可提交控件。 */
export const UI_DECISION_STATUSES = ['open', 'resolved', 'timeout', 'void'] as const;
export type UiDecisionStatus = (typeof UI_DECISION_STATUSES)[number];

export interface UiDecisionView {
  readonly decisionId: string;
  readonly status: UiDecisionStatus;
  readonly optionIds: readonly string[];
  readonly accessibleLabel: string;
}

/** 规则显著状态呈现项。分层只从显式字段读取，不从规则效果推断（Requirement 3.10）。 */
export interface UiSalientStateView {
  readonly stateSemanticId: string;
  readonly ownerEntityId: string;
  readonly tier: SalienceTier;
  readonly renderer: string | null;
  readonly accessibleLabel: string;
}

/** 实体呈现项。`viewToken` 由稳定标识确定性派生，因此跨修订天然可复用（Requirement 15.5）。 */
export interface UiEntityView {
  readonly entityId: string;
  readonly viewToken: string;
  readonly definitionId?: string;
  readonly locationNodeId?: string;
  readonly posture?: string;
  readonly statusIds: readonly string[];
  readonly resources: readonly UiResourceView[];
  readonly salientStates: readonly UiSalientStateView[];
  /** true 表示这是 Knowledge 显式授权的记忆表示，而非当前可见实体（Requirement 15.6）。 */
  readonly remembered: boolean;
}

/** 轮次栏条目。预算耗尽只改 `spent`，条目恒保留在列（Requirement 6.11、6.12）。 */
export interface UiTurnOrderEntry {
  readonly participantId: string;
  readonly portraitAssetRef: string;
  readonly displayName: string;
  readonly resources: readonly UiResourceView[];
  readonly spent: boolean;
  readonly accessibleLabel: string;
}

/**
 * UI 只读视图。
 *
 * 它**不含**任何演出队列字段：增量事件只驱动演出、不驱动状态（J-6），因此
 * "全量渲染"与"全量 + 增量重放"必然产出逐字段相等的 `UiView`（Property 21）。
 */
export interface UiView {
  readonly revision: StateRevision;
  readonly agentId: string;
  readonly scopeId: string;
  /** 回合编号是 Internal_Metric，不受 1—5 约束（Requirement 10.7）。 */
  readonly turn: InternalMetric<number>;
  readonly entities: readonly UiEntityView[];
  readonly actions: readonly UiActionView[];
  readonly decisions: readonly UiDecisionView[];
  readonly turnOrder: readonly UiTurnOrderEntry[];
  readonly diagnostics: readonly UiDiagnostic[];
}

export function entityViewToken(entityId: string): string {
  return `view:${entityId}`;
}
