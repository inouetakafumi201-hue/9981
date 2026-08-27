/**
 * 内存端口替身（design.md §3、§17、J-19，tasks.md 任务 7.3）。
 *
 * 属性测试需要**可控**替身，因此即便上游已落地也保留这层替身：真实上游无法确定性地
 * 造出"陈旧提交""缓冲超时""汇合失败"这些分支。
 *
 * 回放模式的 `ActionPort` 拒绝一切提交——这是 Requirement 8.3 的机械约束，
 * 不是"约定回放期间别提交"。
 */

import { uiOk, uiRejected, uiDiagnostic, UI_DIAGNOSTIC_CODES } from '../../model/diagnostic';
import type { UiDiagnostic } from '../../model/diagnostic';
import type { InteractionIntent } from '../../model/intent';
import type { StateRevision } from '../../model/revision';
import type { ActionPort, SubmissionOutcome } from '../../ports/action-port';
import type {
  ActionQueryPort,
  ActorRef,
  LegalActionProjection,
  LegalActionQueryOutcome,
  ScopedQueryOutcome,
  ScopedQuerySpec,
  ScopedRef,
} from '../../ports/action-query-port';
import type {
  EventPort,
  EventSubscription,
  RawEventSource,
  RawGatewayEvent,
} from '../../ports/event-port';
import type {
  DescriptorOutcome,
  DescriptorRequest,
  ProjectionOutcome,
  ProjectionPort,
  ProjectionRequest,
} from '../../ports/projection-port';
import type { RevisionPort } from '../../ports/revision-port';
import { converged, pendingConvergence } from '../../ports/convergence';
import type {
  AiCapabilityPort,
  AiPublicActionState,
  CoreCapabilityPort,
  PendingContractPorts,
  PhaseSemanticProjection,
  SpaceItemsCapabilityPort,
  SpatialProjection,
} from '../../ports/pending-contracts';
import {
  createAuthorizedAgent,
  type AuthorizedAgent,
  type AuthorizationScope,
  type PresentationDescriptor,
  type ReadOnlySemanticProjection,
  type UiDecisionView,
  type UiResourceView,
  type UpstreamAgentAuthority,
} from '../../model/view';
import type { RuleEventProjection } from '../../model/event-projection';
import {
  createDiagnosticSink,
  type DiagnosticSink,
} from '../../diagnostics/sink';
import { authority, descriptor, projection, revision, scope } from './fixtures';

export interface InMemoryProjectionState {
  readonly projection: ReadOnlySemanticProjection;
  readonly descriptor: PresentationDescriptor;
  readonly scope: AuthorizationScope;
  readonly revision: StateRevision;
  readonly authority: UpstreamAgentAuthority;
  readonly descriptorVersion?: string;
}

export interface InMemoryProjectionPort extends ProjectionPort {
  /** 换一份权威状态，模拟修订推进、回退与全量重拉。 */
  setState(next: Partial<InMemoryProjectionState>): void;
  currentState(): InMemoryProjectionState;
  /** 让端口返回结构化拒绝，模拟上游失败。 */
  failWith(diagnostics: readonly UiDiagnostic[]): void;
}

export function createInMemoryProjectionPort(
  initial: Partial<InMemoryProjectionState> = {},
): InMemoryProjectionPort {
  let state: InMemoryProjectionState = {
    projection: initial.projection ?? projection(),
    descriptor: initial.descriptor ?? descriptor(),
    scope: initial.scope ?? scope(),
    revision: initial.revision ?? revision(1, 'fp-1'),
    authority: initial.authority ?? authority(),
    ...(initial.descriptorVersion === undefined ? {} : { descriptorVersion: initial.descriptorVersion }),
  };
  let failure: readonly UiDiagnostic[] | undefined;

  return Object.freeze({
    fetchProjection(_request: ProjectionRequest): ProjectionOutcome {
      if (failure !== undefined) return uiRejected(failure);
      return uiOk({
        projection: state.projection,
        scope: state.scope,
        revision: state.revision,
        authority: state.authority,
      });
    },
    fetchDescriptor(_request: DescriptorRequest): DescriptorOutcome {
      if (failure !== undefined) return uiRejected(failure);
      return uiOk({
        descriptor: state.descriptor,
        revision: state.revision,
        ...(state.descriptorVersion === undefined ? {} : { descriptorVersion: state.descriptorVersion }),
      });
    },
    setState(next: Partial<InMemoryProjectionState>): void {
      state = { ...state, ...next };
      failure = undefined;
    },
    currentState(): InMemoryProjectionState {
      return state;
    },
    failWith(diagnostics: readonly UiDiagnostic[]): void {
      failure = diagnostics;
    },
  });
}

export interface InMemoryActionPort extends ActionPort {
  /** 配置下一次（及之后）提交的返回分支。 */
  setOutcome(outcome: SubmissionOutcome): void
  /** 已提交的意图，按提交顺序。 */
  submitted(): readonly InteractionIntent[];
}

function rejectionOf(reason: string, displayText: string) {
  return Object.freeze({
    rejected: true as const,
    diagnostics: Object.freeze([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.DESCRIPTOR_SEMANTIC_FIELD_MISSING,
        presentationLocation: 'ports/action-port',
        reason,
        correctionSuggestion: '重新查询当前投影后再提交',
      }),
    ]),
    displayText,
  });
}

export function createInMemoryActionPort(
  initial: SubmissionOutcome = { kind: 'accepted', committedRevision: revision(2, 'fp-2') },
): InMemoryActionPort {
  let outcome = initial;
  const log: InteractionIntent[] = [];
  return Object.freeze({
    submit(intent: InteractionIntent): SubmissionOutcome {
      log.push(intent);
      return outcome;
    },
    setOutcome(next: SubmissionOutcome): void {
      outcome = next;
    },
    submitted(): readonly InteractionIntent[] {
      return Object.freeze([...log]);
    },
  });
}

export const STALE_OUTCOME: SubmissionOutcome = Object.freeze({
  kind: 'stale' as const,
  rejection: rejectionOf('提交所基于的修订已被取代', '状态已变化，请重试'),
});

export const REJECTED_OUTCOME: SubmissionOutcome = Object.freeze({
  kind: 'rejected' as const,
  rejection: rejectionOf('当前状态下该动作不合法', '该动作当前不可执行'),
});

/**
 * 回放模式的 `ActionPort`：拒绝一切提交（Requirement 8.3、J-19）。
 *
 * 它没有 `setOutcome`，因此无法被配置成"允许提交"——回放期间不可写是机械约束。
 */
export function createReplayModeActionPort(): ActionPort {
  return Object.freeze({
    submit(_intent: InteractionIntent): SubmissionOutcome {
      return Object.freeze({
        kind: 'rejected' as const,
        rejection: rejectionOf('回放模式下不接受任何提交', '回放中无法操作'),
      });
    },
  });
}

export interface InMemoryRawEventSource extends RawEventSource {
  /** 向全部订阅者投递一条未收窄事件，模拟 Gateway 的 `dispatch`。 */
  dispatch(event: RawGatewayEvent): void;
  subscriberCount(): number;
}

export function createInMemoryRawEventSource(): InMemoryRawEventSource {
  const listeners = new Set<(event: RawGatewayEvent) => void>();
  return Object.freeze({
    subscribe(listener: (event: RawGatewayEvent) => void): EventSubscription {
      listeners.add(listener);
      return Object.freeze({
        unsubscribe: (): void => {
          listeners.delete(listener);
        },
      });
    },
    dispatch(event: RawGatewayEvent): void {
      for (const listener of [...listeners]) listener(event);
    },
    subscriberCount(): number {
      return listeners.size;
    },
  });
}

export interface InMemoryActionQueryPort extends ActionQueryPort {
  setRefs(refs: readonly ScopedRef[]): void;
  setLegalActions(actions: readonly LegalActionProjection[]): void;
}

export function createInMemoryActionQueryPort(): InMemoryActionQueryPort {
  let refs: readonly ScopedRef[] = Object.freeze([]);
  let actions: readonly LegalActionProjection[] = Object.freeze([]);
  return Object.freeze({
    scopedQuery(_spec: ScopedQuerySpec): ScopedQueryOutcome {
      return uiOk(refs);
    },
    queryActions(_actor: ActorRef): LegalActionQueryOutcome {
      return uiOk(actions);
    },
    setRefs(next: readonly ScopedRef[]): void {
      refs = Object.freeze([...next]);
    },
    setLegalActions(next: readonly LegalActionProjection[]): void {
      actions = Object.freeze([...next]);
    },
  });
}

export interface InMemoryRevisionPort extends RevisionPort {
  setSequence(sequence: number | undefined): void;
}

/** 修订端口替身。默认**汇合失败**，因为上游确实还没暴露单调序号（§14.4 第 1 项）。 */
export function createInMemoryRevisionPort(initialSequence?: number): InMemoryRevisionPort {
  let sequence = initialSequence;
  return Object.freeze({
    currentSequence: () =>
      sequence === undefined
        ? pendingConvergence<number>(['kernel-monotonic-log-sequence'])
        : converged(sequence),
    setSequence(next: number | undefined): void {
      sequence = next;
    },
  });
}

/**
 * 三个待汇合能力端口的替身：一律返回汇合失败。
 *
 * 刻意**不提供**"让它们返回成功"的开关——那会让属性测试在一个尚不存在的契约上通过，
 * 正是 tasks.md 禁止的"把替身/默认值通过当成集成完成"。
 */
export function createPendingContractPorts(): PendingContractPorts {
  const core: CoreCapabilityPort = Object.freeze({
    projectedResources: () =>
      pendingConvergence<readonly UiResourceView[]>(['core-projected-resource-roles']),
    phaseSemantics: () => pendingConvergence<PhaseSemanticProjection>(['core-phase-semantics']),
    legalActions: () => pendingConvergence<readonly LegalActionProjection[]>(['core-legal-actions']),
    safeUnavailabilityReasonKey: () =>
      pendingConvergence<string>(['unavailability-reason-mapping-key']),
    visibleDecisions: () => pendingConvergence<readonly UiDecisionView[]>(['core-visible-decisions']),
  });
  const spaceItems: SpaceItemsCapabilityPort = Object.freeze({
    visibleScenes: () => pendingConvergence<readonly SpatialProjection[]>(['space-items-visible-scenes']),
    visibleContainers: () =>
      pendingConvergence<readonly SpatialProjection[]>(['space-items-visible-containers']),
    legalInteractions: () =>
      pendingConvergence<readonly LegalActionProjection[]>(['space-items-legal-interactions']),
  });
  const ai: AiCapabilityPort = Object.freeze({
    visibleActionState: () =>
      pendingConvergence<readonly AiPublicActionState[]>(['ai-visible-action-state']),
    publicIntents: () => pendingConvergence<readonly AiPublicActionState[]>(['ai-public-intents']),
    safeExplanationLabels: () => pendingConvergence<readonly string[]>(['ai-safe-explanation-labels']),
  });
  return Object.freeze({ core, spaceItems, ai });
}


export interface InMemoryEventPort extends EventPort {
  dispatch(event: RuleEventProjection): void;
  subscriberCount(): number;
}

/** 已完成 Agent 收窄后的事件端口替身。与 RawEventSource 分开，防止测试绕过过滤边界。 */
export function createInMemoryEventPort(): InMemoryEventPort {
  const listeners = new Set<(event: RuleEventProjection) => void>();
  return Object.freeze({
    subscribe(listener: (event: RuleEventProjection) => void): EventSubscription {
      listeners.add(listener);
      return Object.freeze({
        unsubscribe: (): void => {
          listeners.delete(listener);
        },
      });
    },
    dispatch(event: RuleEventProjection): void {
      for (const listener of [...listeners]) listener(event);
    },
    subscriberCount(): number {
      return listeners.size;
    },
  });
}

export interface RecordingDiagnosticSink extends DiagnosticSink {}

/** 记录型诊断汇替身仍复用产品过滤逻辑，避免测试替身成为隐藏信息旁路。 */
export function createRecordingDiagnosticSink(
  agent: AuthorizedAgent = createAuthorizedAgent('agent.a', scope(), authority()),
): RecordingDiagnosticSink {
  return createDiagnosticSink(agent);
}
