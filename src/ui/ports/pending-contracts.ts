/**
 * `core` / `space-items` / `AI` 三方的待汇合能力端口（design.md §14.1–14.4）。
 *
 * 三个端口只声明**所需能力**，不定名任何具体字段：本文件里没有一个字段名常量。
 * 理由见 §14.3——一旦表现层先给待汇合字段起了名字，后续跨 Spec 审查会被迫接受
 * 表现层的命名，等于让表现层反向决定基类层契约。
 *
 * 任一能力不可用时，依赖它的功能被标记为不可用并产生结构化集成诊断，
 * **不做本地规则替代**（Requirement 14.5）。因此所有返回类型统一为 `ConvergenceResult<T>`，
 * 没有任何"返回空映射"或"返回默认值"的分支。
 */

import type { UiDecisionView, UiResourceView } from '../model/view.js';
import type { ConvergenceResult } from './convergence.js';
import type { LegalActionProjection } from './action-query-port.js';

/** 相位/流程语义的只读摘要。UI 只消费它，不复制相位推进规则。 */
export interface PhaseSemanticProjection {
  readonly phaseSemanticId: string;
  readonly accessibleLabel: string;
}

/**
 * `core` 能力端口。
 *
 * 它提供的是"已投影的资源角色 / 相位语义 / 合法动作 / 安全不可用原因键 / 可见 Decision"，
 * 而**不是**"任意 `props` 路径读取"（Requirement 14.2）。
 */
export interface CoreCapabilityPort {
  projectedResources(entityId: string): ConvergenceResult<readonly UiResourceView[]>;
  phaseSemantics(): ConvergenceResult<PhaseSemanticProjection>;
  legalActions(actorEntityId: string): ConvergenceResult<readonly LegalActionProjection[]>;
  /** 不可用原因到 Visibility_Safe 通用原因的**映射键**（§14.4 第 3 项，仍缺）。 */
  safeUnavailabilityReasonKey(actionId: string): ConvergenceResult<string>;
  visibleDecisions(): ConvergenceResult<readonly UiDecisionView[]>;
}

/** 空间实体的只读呈现摘要。UI 不重算距离、容量、阻挡、负重或目标范围。 */
export interface SpatialProjection {
  readonly nodeId: string;
  readonly accessibleLabel: string;
  readonly containedEntityIds: readonly string[];
}

export interface SpaceItemsCapabilityPort {
  visibleScenes(): ConvergenceResult<readonly SpatialProjection[]>;
  visibleContainers(): ConvergenceResult<readonly SpatialProjection[]>;
  /** 已由上游判定合法的交互；UI 不自行判定物品移动或穿越合法性（Requirement 14.3）。 */
  legalInteractions(actorEntityId: string): ConvergenceResult<readonly LegalActionProjection[]>;
}

/** AI 的**公开**行动状态。搜索树、隐藏评估、影子随机流与未公开目标不在其中。 */
export interface AiPublicActionState {
  readonly actorEntityId: string;
  readonly publicStateLabel: string;
}

export interface AiCapabilityPort {
  visibleActionState(): ConvergenceResult<readonly AiPublicActionState[]>;
  publicIntents(): ConvergenceResult<readonly AiPublicActionState[]>;
  /** 可公开解释标签。不得暴露隐藏评估或策略内部状态（Requirement 14.4）。 */
  safeExplanationLabels(actorEntityId: string): ConvergenceResult<readonly string[]>;
}

/** 三个待汇合端口的集合，供组合根一次性注入。 */
export interface PendingContractPorts {
  readonly core: CoreCapabilityPort;
  readonly spaceItems: SpaceItemsCapabilityPort;
  readonly ai: AiCapabilityPort;
}
