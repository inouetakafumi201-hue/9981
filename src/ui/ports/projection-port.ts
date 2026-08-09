/**
 * 投影端口（design.md §3.0、§3.1）。
 *
 * 绑定关系：`fetchProjection` → `createProjection(active, runtimeState, scope)`；
 * `fetchDescriptor` → `uiDescriptor({active, runtimeState, query, scope, ...})`。
 * 绑定发生在组合根的**调用方**（宿主），UI 内部只见本文件的接口。
 *
 * 端口实现必须返回**深冻结**结构；UI 侧仍会在 `projection/projection-cache.ts` 再做一次
 * `Object.isFrozen` 断言，因为端口契约靠文档保证，边界断言靠代码保证。
 */

import type { UiResult } from '../model/diagnostic.js';
import type { StateRevision } from '../model/revision.js';
import type {
  AuthorizationScope,
  PresentationDescriptor,
  ReadOnlySemanticProjection,
  UpstreamAgentAuthority,
} from '../model/view.js';

export interface ProjectionRequest {
  readonly agentId: string;
  /** 由权威运行时给出，UI 不自行构造授权范围。 */
  readonly scopeId: string;
}

export interface DescriptorRequest {
  readonly agentId: string;
  readonly scopeId: string;
  readonly actorId: string;
  readonly includeUnavailable: boolean;
  /** 只进入诊断与回归对比，不进入任何判定分支（Requirement 2.7、13.6）。 */
  readonly rendererId?: string;
}

/**
 * 投影结果。
 *
 * `authority` 是上游 Agent 投影授予的令牌：全知视角与已授权开发面只能由它开启，
 * UI 侧没有任何本地开关能构造它（Requirement 3.9、12.4）。
 */
export interface ProjectionEnvelope {
  readonly projection: ReadOnlySemanticProjection;
  readonly scope: AuthorizationScope;
  readonly revision: StateRevision;
  readonly authority: UpstreamAgentAuthority;
}

/**
 * 描述符结果。
 *
 * `descriptorVersion` 是**可选**的兼容判别符（Requirement 14.7）。上游
 * `PresentationDescriptor` 目前没有版本字段，因此缺省表示"当前唯一受支持的版本"；
 * 一旦上游开始声明版本，超出受支持范围的描述符会被拒绝而其余投影继续渲染（§10.1）。
 * 该字段的最终归属属于待汇合契约（§14.4 第 4 项），UI 侧不为它在上游定名。
 */
export interface DescriptorEnvelope {
  readonly descriptor: PresentationDescriptor;
  readonly revision: StateRevision;
  readonly descriptorVersion?: string;
}

export type ProjectionOutcome = UiResult<ProjectionEnvelope>;
export type DescriptorOutcome = UiResult<DescriptorEnvelope>;

export interface ProjectionPort {
  /** 取当前 Agent 授权范围内的完整只读投影。失败返回结构化拒绝，不抛异常。 */
  fetchProjection(request: ProjectionRequest): ProjectionOutcome;
  /** 取该 Agent 当前可选的合法动作描述符。 */
  fetchDescriptor(request: DescriptorRequest): DescriptorOutcome;
}
