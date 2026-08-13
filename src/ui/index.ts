/**
 * UI 组合根（design.md §3、§17、J-19，tasks.md 任务 7.3）。
 *
 * 这里只依赖端口契约，不绑定任何上游具体实现。所有返回面均冻结；查询、事件、诊断与交互入口
 * 分区暴露，使宿主能够替换回放端口而不改动表现模块。
 */

import type { DiagnosticSink } from './diagnostics/sink.js';
import type { InteractionIntent } from './model/intent.js';
import { freezePresentationProfile, type PresentationProfile } from './model/profile.js';
import type { ActionPort, SubmissionOutcome } from './ports/action-port.js';
import type {
  ActionQueryPort,
  ActorRef,
  LegalActionQueryOutcome,
  ScopedQueryOutcome,
  ScopedQuerySpec,
} from './ports/action-query-port.js';
import type { ConvergenceResult } from './ports/convergence.js';
import type { EventPort, EventSubscription } from './ports/event-port.js';
import type { PendingContractPorts } from './ports/pending-contracts.js';
import type {
  DescriptorOutcome,
  DescriptorRequest,
  ProjectionOutcome,
  ProjectionPort,
  ProjectionRequest,
} from './ports/projection-port.js';
import type { RevisionPort } from './ports/revision-port.js';
import type { RuleEventProjection } from './model/event-projection.js';

export interface UiSystemPorts {
  readonly projection: ProjectionPort;
  readonly events: EventPort;
  readonly actionQuery: ActionQueryPort;
  readonly revision: RevisionPort;
  readonly actions: ActionPort;
  readonly pendingContracts: PendingContractPorts;
  readonly diagnostics: DiagnosticSink;
}

export interface UiQueryApi {
  projection(request: ProjectionRequest): ProjectionOutcome;
  descriptor(request: DescriptorRequest): DescriptorOutcome;
  legalActions(actor: ActorRef): LegalActionQueryOutcome;
  scopedRefs(spec: ScopedQuerySpec): ScopedQueryOutcome;
  currentRevisionSequence(): ConvergenceResult<number>;
  events(listener: (event: RuleEventProjection) => void): EventSubscription;
}

export interface UiInteractionApi {
  sendIntent(intent: InteractionIntent): SubmissionOutcome;
}

export interface UiSystem {
  readonly profile: PresentationProfile;
  readonly query: UiQueryApi;
  readonly interaction: UiInteractionApi;
  readonly pendingContracts: PendingContractPorts;
  readonly diagnostics: DiagnosticSink;
}

export function createUiSystem(ports: UiSystemPorts, profile: PresentationProfile): UiSystem {
  const loadedProfile = freezePresentationProfile(profile);
  const query: UiQueryApi = Object.freeze({
    projection: (request: ProjectionRequest): ProjectionOutcome =>
      ports.projection.fetchProjection(request),
    descriptor: (request: DescriptorRequest): DescriptorOutcome =>
      ports.projection.fetchDescriptor(request),
    legalActions: (actor: ActorRef): LegalActionQueryOutcome =>
      ports.actionQuery.queryActions(actor),
    scopedRefs: (spec: ScopedQuerySpec): ScopedQueryOutcome =>
      ports.actionQuery.scopedQuery(spec),
    currentRevisionSequence: (): ConvergenceResult<number> =>
      ports.revision.currentSequence(),
    events: (listener: (event: RuleEventProjection) => void): EventSubscription =>
      ports.events.subscribe(listener),
  });
  const interaction: UiInteractionApi = Object.freeze({
    sendIntent: (intent: InteractionIntent): SubmissionOutcome => ports.actions.submit(intent),
  });
  return Object.freeze({
    profile: loadedProfile,
    query,
    interaction,
    pendingContracts: ports.pendingContracts,
    diagnostics: ports.diagnostics,
  });
}
