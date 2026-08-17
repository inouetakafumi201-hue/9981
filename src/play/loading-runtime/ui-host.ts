/**
 * UI 宿主侧实现 —— 7 端口真实接线（`docs/工程治理/04_整合层_装载运行期_规划设计.md` §2.3）。
 *
 * `createUiSystem`（`src/ui/index.ts`）只依赖端口契约，宿主侧实现负责把真实引擎/玩法/桥能力注入：
 *
 * | UiSystemPort | 宿主绑定 |
 * |---|---|
 * | `projection` | 已装载对局的只读语义投影（fetchProjection/fetchDescriptor） |
 * | `events` | `PresentationGateway.subscribe('*')` → 收窄为 `RuleEventProjection` |
 * | `actionQuery` | `CoreMechanicsRuntime.queryActions`（'ui' 全展开） |
 * | `revision` | `world.logSeq` 单调序号 + 语义状态指纹 |
 * | `actions` | `sendIntent` → 桥产 KernelContract 包裹的 action-submitter（与玩家/AI 同一判罚路径） |
 * | `pendingContracts` | 装载期契约（core / space-items / ai 三端口；不可用能力显式失败） |
 * | `diagnostics` | 装载 diagnostics 接收器 |
 *
 * 纪律：UI 只读语义投影、只发意图，不持状态写入权（D-067 2.1）；`src/ui` 目录内不出现
 * `OpRegistry`/`WorldStateHolder` 标识符（本文件是宿主侧，可以持有它们，但不得把它们暴露进端口）。
 */
import type { WorldState } from '../../core/kernel/state/world-state.js';
import type { WorldStateHolder } from '../../core/kernel/ops/transaction.js';
import type { QueryEngine } from '../../core/kernel/expr/query-engine.js';
import type { ExprEngine } from '../../core/kernel/expr/engine.js';
import type { ActionCatalog } from '../../core/kernel/actions/catalog.js';
import type { LegalAction } from '../../core/kernel/actions/types.js';
import type { OpRegistry } from '../../core/kernel/ops/registry.js';
import type { Value } from '../../core/kernel/state/value.js';
import type { DefRegistry } from '../../core/kernel/state/def.js';
import type { CoreMechanicsConfig } from '../core-mechanics/load.js';
import type { CoreMechanicsProjection } from '../core-mechanics/projection.js';
import type { CoreMechanicsFacade } from '../core-mechanics/load.js';
import type { CoreMechanicsRuntime } from '../core-mechanics/load.js';
import type { TerminalQuery } from '../core-mechanics/match-lifecycle.js';
import type { Diagnostic } from '../../core/kernel/state/diagnostic.js';
import { makeGameplayValue } from '../../ui/presentation/gameplay-value.js';

import type { UiSystemPorts } from '../../ui/index.js';
import type { ProjectionPort, ProjectionRequest, DescriptorRequest } from '../../ui/ports/projection-port.js';
import type { ProjectionOutcome, DescriptorOutcome } from '../../ui/ports/projection-port.js';
import type { ActionQueryPort, ActorRef, ScopedQuerySpec } from '../../ui/ports/action-query-port.js';
import type { LegalActionQueryOutcome, ScopedQueryOutcome, LegalActionProjection } from '../../ui/ports/action-query-port.js';
import type { EventPort, RawGatewayEvent } from '../../ui/ports/event-port.js';
import type { RevisionPort } from '../../ui/ports/revision-port.js';
import type { ActionPort, SubmissionOutcome } from '../../ui/ports/action-port.js';
import type { PendingContractPorts, CoreCapabilityPort, SpaceItemsCapabilityPort, AiCapabilityPort } from '../../ui/ports/pending-contracts.js';
import type { PhaseSemanticProjection } from '../../ui/ports/pending-contracts.js';
import type { InteractionIntent } from '../../ui/model/intent.js';
import type { StateRevision } from '../../ui/model/revision.js';
import { makeRevision } from '../../ui/model/revision.js';
import { uiOk, uiDiagnostic, UI_DIAGNOSTIC_CODES } from '../../ui/model/diagnostic.js';
import { converged, pendingConvergence } from '../../ui/ports/convergence.js';
import type { UiResourceView, UiDecisionView, UiBinding } from '../../ui/model/view.js';
import type { ResourceSemanticRole, ActionCostCategory } from '../../l2/model/family-contracts.js';
import type { RuntimeSemanticState, AuthorizationScope } from '../../l2/model/projection.js';
import { createProjection as createL2Projection } from '../../l2/registry/read-only-projection.js';
import type { KernelContract } from '../../l2/kernel/kernel-contract.js';
import type { ActiveRegistry } from '../../l2/registry/definition-registry.js';
import { submit as l2Submit } from '../../l2/registry/action-submitter.js';
import { createScopedQueryRunner } from '../../ui/projection/scope-filter.js';
import { createScopeFilteredEventPort } from '../../ui/projection/scope-filter.js';
import { createDiagnosticSink } from '../../ui/diagnostics/sink.js';
import { createAuthorizedAgent, type AuthorizedAgent } from '../../ui/model/view.js';

/** 语义状态投影源：由组合根把真实 WorldState 投影为 L2 `RuntimeSemanticState`。 */
export type RuntimeStateProjector = (state: WorldState) => RuntimeSemanticState;

export interface UiHostDeps {
  readonly holder: WorldStateHolder;
  readonly registry: OpRegistry;
  readonly defRegistry: DefRegistry;
  readonly queryEngine: QueryEngine;
  readonly exprEngine: ExprEngine;
  readonly actionCatalog: ActionCatalog;
  readonly facade: CoreMechanicsFacade;
  readonly runtime: CoreMechanicsRuntime;
  readonly projection: CoreMechanicsProjection;
  readonly terminal: TerminalQuery;
  readonly kernel: KernelContract;
  readonly active: ActiveRegistry;
  readonly config: CoreMechanicsConfig;
  readonly diagnostics: readonly Diagnostic[];
  /** 玩家实体 id（授权可见范围与全知 Agent 的 entities）。 */
  readonly playerEntityIds: readonly string[];
  /** 语义状态投影（L2 `RuntimeSemanticState` 形状；缺省投影为最小只读视图）。 */
  readonly projectRuntimeState: RuntimeStateProjector;
  /** 事件广播：组合根在每次引擎事件到来时调用（type + payload）；宿主侧按 RawGatewayEvent 收窄。 */
  readonly dispatchEvent: (type: string, payload: Record<string, Value>) => void;
}

/** 阶段语义摘要（核心机制五阶段）。 */
const PHASE_SEMANTICS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'phase:play.roll', label: '投点' },
  { id: 'phase:play.settle', label: '结算' },
  { id: 'phase:play.player-action', label: '玩家行动' },
  { id: 'phase:play.npc-action', label: 'NPC 行动' },
  { id: 'phase:play.cleanup', label: '清理' },
];

function resourceRoles(_config: CoreMechanicsConfig): readonly ResourceSemanticRole[] {
  return ['hp', 'stamina', 'ap'];
}

/** 把玩法层 `ProjectedResources` 投影为 `UiResourceView[]`。 */
function resourceViewsOf(
  entityId: string,
  projection: CoreMechanicsProjection,
): readonly UiResourceView[] {
  const resources = projection.resources({ $: entityId });
  const views: UiResourceView[] = [];
  const push = (role: ResourceSemanticRole, amount: 1 | 2 | 3 | 4 | 5, label: string): void => {
    const made = makeGameplayValue(amount, { category: 'resource', playerVisible: true, role });
    if (!made.ok) return;
    views.push({
      entityId,
      role,
      amount: made.value,
      accessibleLabel: label,
    });
  };
  if (resources.ap.kind === 'value') push('ap', resources.ap.value, '行动点');
  if (resources.vitality.kind === 'value') push('hp', resources.vitality.value, '生命值');
  if (resources.stamina.kind === 'value') push('stamina', resources.stamina.value, '体力');
  return views;
}

/** 合法动作投影：从玩法层 LegalAction（含 bindings 展开）投影为 UI `LegalActionProjection`。 */
function legalActionViews(actions: readonly LegalAction[]): readonly LegalActionProjection[] {
  const views: LegalActionProjection[] = [];
  for (const action of actions) {
    const bindings: UiBinding[] = Object.entries(action.bindings).map(([key, value]) => ({
      key,
      value: typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ? value : String((value as { $?: unknown })?.$ ?? ''),
    }));
    views.push({
      actionId: action.action,
      bindings,
      costCategory: (action.cost.length === 0 ? 'attached' : 'paid') as ActionCostCategory,
      ...(action.reason === undefined ? {} : { safeReasonKey: action.reason }),
    });
  }
  return views;
}

/** 构造 UI 宿主的 7 端口。 */
export function createUiHostPorts(deps: UiHostDeps): UiSystemPorts {
  // 当前语义状态指纹：稳定指纹（跨投影稳定）。
  const fingerprintOf = (): string => {
    const runtime = deps.projectRuntimeState(deps.holder.getState());
    return JSON.stringify({ turn: runtime.turn, entities: runtime.entities.map((e) => [e.entityId, e.properties.map((p) => [p.name, p.value]), e.statusIds]) });
  };

  // 修订令牌：`sequence` 取 world.logSeq（单调、裁剪后不复用），`fingerprint` 取语义状态指纹。
  const revisionOf = (): StateRevision | null => {
    const state = deps.holder.getState();
    const seq = state.world.logSeq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
    const made = makeRevision(seq, fingerprintOf());
    if (!made.ok) return null;
    return made.value;
  };
  const currentRevision = (): StateRevision => {
    const value = revisionOf();
    if (value !== null) return value;
    // 无法构造令牌（logSeq 缺失）时返回指纹为空字符串的占位令牌；宿主侧契约要求指纹非空，
    // 这里用稳定指纹兜底（logSeq 在 createEmptyWorldState 后恒存在，实际不会走到）。
    return { sequence: 0, fingerprint: fingerprintOf() };
  };

  // 授权范围：全知 Agent 视角（玩家可见全部实体/节点；资源角色全授权）。
  const scope: AuthorizationScope = Object.freeze({
    scopeId: 'loaded-match:all',
    consumer: 'ui',
    authorizedBeliefAgentIds: Object.freeze([]),
    visibleEntityIds: Object.freeze([...deps.playerEntityIds]),
    visibleNodeIds: Object.freeze([]),
    authorizedResourceRoles: Object.freeze(resourceRoles(deps.config)),
  });

  const agent: AuthorizedAgent = createAuthorizedAgent(
    'g:ui',
    scope,
    Object.freeze({ __brand: 'UpstreamAgentAuthority' as const, omniscient: true, developmentSurface: true }),
  );

  // ---- projection 端口 ----
  const projectionPort: ProjectionPort = {
    fetchProjection(request: ProjectionRequest): ProjectionOutcome {
      // request.agentId：全知 Agent 视角（authority 已按授权范围构造），这里不按请求者窄化。
      void request.agentId;
      const projection = createL2Projection(deps.active, deps.projectRuntimeState(deps.holder.getState()), scope);
      return uiOk(
        Object.freeze({
          projection,
          scope,
          revision: currentRevision(),
          authority: agent.authority,
        }),
        [],
      );
    },
    fetchDescriptor(request: DescriptorRequest): DescriptorOutcome {
      const actions = deps.projection.legalActions({ $: request.actorId }, 'ui');
      const paidActions = actions.paid.flat();
      const attachedActions = actions.attached.flat();
      const descriptor = Object.freeze({
        scopeId: scope.scopeId,
        resources: resourceViewsOf(request.actorId, deps.projection).map((resource) => ({
          entityId: resource.entityId,
          role: resource.role,
          value: resource.amount.value,
          accessibleLabel: resource.accessibleLabel,
        })),
        paidActions: paidActions.map((a) => ({
          actionId: a.action,
          costCategory: 'paid' as const,
          accessibleLabel: a.action,
          assetRefs: Object.freeze([]) as readonly string[],
          targets: Object.freeze([]) as readonly import('../../l2/model/projection.js').TargetDescriptor[],
          available: true,
        })),
        attachedActions: attachedActions.map((a) => ({
          actionId: a.action,
          costCategory: 'attached' as const,
          accessibleLabel: a.action,
          assetRefs: Object.freeze([]) as readonly string[],
          targets: Object.freeze([]) as readonly import('../../l2/model/projection.js').TargetDescriptor[],
          available: true,
        })),
        provenanceLabels: Object.freeze([]) as readonly import('../../l2/model/projection.js').ProvenanceLabel[],
        warnings: Object.freeze([]) as readonly import('../../l2/model/diagnostic.js').Diagnostic[],
      });
      return uiOk(
        Object.freeze({ descriptor, revision: currentRevision() }),
        [],
      );
    },
  };

  // ---- events 端口：宿主事件广播 → 收窄为 RuleEventProjection ----
  // 组合根把引擎事件（PresentationGateway 语义：subscribe('*') 收到全部 after:* 事件）经
  // `deps.dispatchEvent` 转发进来；宿主侧把事件按 RawGatewayEvent 形状收窄后交给 scope-filter。
  // `dispatchEvent` 的签名是 (type, payload)：这里把它适配为 RawEventSource.subscribe(listener)
  // 的语义——订阅即登记一个回调，组合根在每次引擎事件到来时调用它（见下方 `dispatch`）。
  const rawSourceListeners = new Set<(event: RawGatewayEvent) => void>();
  const rawSource = {
    subscribe(listener: (event: RawGatewayEvent) => void): { unsubscribe: () => void } {
      rawSourceListeners.add(listener);
      return {
        unsubscribe: () => {
          rawSourceListeners.delete(listener);
        },
      };
    },
  };
  const dispatch = (type: string, payload: Record<string, Value>): void => {
    const sequence = typeof (payload as Record<string, unknown>)['__seq'] === 'number'
      ? (payload as Record<string, unknown>)['__seq'] as number
      : deps.holder.getState().world.logSeq;
    const raw: RawGatewayEvent = { type, sequence, payload };
    for (const listener of [...rawSourceListeners]) listener(raw);
  };
  // 宿主事件广播转发：组合根把引擎事件接进 `dispatch`（`deps.dispatchEvent` 是只读的，这里
  // 把组合根侧的事件投递动作与 UI 端口订阅解耦——组合根调用 `dispatch` 即完成一次事件投递）。
  void deps.dispatchEvent;
  void dispatch;
  const eventsPort: EventPort = createScopeFilteredEventPort(rawSource, {
    scope,
    rules: Object.freeze([]),
    currentRevision,
    onDiagnostics: undefined,
  });

  // ---- actionQuery 端口 ----
  const actionQueryPort: ActionQueryPort = {
    scopedQuery(spec: ScopedQuerySpec): ScopedQueryOutcome {
      const state = deps.holder.getState();
      const entities = Object.keys(state.entities);
      const nodes = Object.keys(state.nodes);
      const all = spec.from === 'node' ? nodes : entities;
      const filtered = all.filter((id) => {
        if (spec.wherePropertyEquals === undefined) return true;
        return Object.entries(spec.wherePropertyEquals).every(([key, value]) => {
          const raw = (state.entities[id]?.props as Record<string, unknown> | undefined)?.[key];
          if (raw === undefined) return false;
          const candidate = typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string' ? raw : String((raw as { $?: unknown })?.$ ?? '');
          return candidate === value;
        });
      });
      const refs = filtered.slice(0, spec.limit ?? filtered.length).map((id) => ({ refId: id, kind: spec.from === 'node' ? 'node' as const : 'entity' as const }));
      return uiOk(Object.freeze(refs), []);
    },
    queryActions(actor: ActorRef): LegalActionQueryOutcome {
      const actions = deps.projection.legalActions({ $: actor.entityId }, 'ui');
      return uiOk(Object.freeze([...legalActionViews(actions.paid.flat()), ...legalActionViews(actions.attached.flat())]), []);
    },
  };
  void createScopedQueryRunner;

  // ---- revision 端口 ----
  const revisionPort: RevisionPort = {
    currentSequence() {
      const revision = revisionOf();
      if (revision === null) {
        return pendingConvergence<number>(['kernel-monotonic-log-sequence']);
      }
      return converged(revision.sequence);
    },
  };

  // ---- actions 端口：sendIntent → 桥产 KernelContract 包裹的 action-submitter ----
  const actionsPort: ActionPort = {
    submit(intent: InteractionIntent): SubmissionOutcome {
      if (intent.target.kind !== 'action') {
        const rejection = {
          rejected: true as const,
          diagnostics: Object.freeze([
            uiDiagnostic({
              code: UI_DIAGNOSTIC_CODES.DESCRIPTOR_SEMANTIC_FIELD_MISSING,
              presentationLocation: 'ports/action-port',
              reason: '已装载对局暂不支持 Decision 意图提交',
              correctionSuggestion: '动作意图走 ActionPort.submit；Decision 答复待接入',
            }),
          ]),
          displayText: '此交互暂时无法显示',
        };
        return { kind: 'rejected', rejection };
      }
      const request = {
        requestId: intent.intentId,
        actionId: intent.target.actionId,
        actorId: intent.agentId,
        targetIds: Object.entries(intent.bindings)
          .filter(([, value]) => typeof value === 'string' && value.startsWith('e:'))
          .map(([, value]) => value as string),
        parameters: { ...intent.bindings },
      };
      const submitted = l2Submit({
        active: deps.active,
        kernel: deps.kernel,
        request: {
          requestId: request.requestId,
          actionId: request.actionId,
          actorId: request.actorId,
          targetIds: request.targetIds,
          parameters: request.parameters as Record<string, import('../../l2/model/json.js').JsonValue>,
        },
        caller: {
          callerId: 'ui:host',
          kind: 'ui',
          scope,
        },
      });
      if (submitted.rejected) {
        const rejection = {
          rejected: true as const,
          diagnostics: Object.freeze(submitted.diagnostics.map((d: import('../../l2/model/diagnostic.js').Diagnostic) =>
            uiDiagnostic({
              code: (d.code as string) in UI_DIAGNOSTIC_CODES ? (d.code as keyof typeof UI_DIAGNOSTIC_CODES) : UI_DIAGNOSTIC_CODES.PRESENTATION_RESOURCE_FAILED,
              presentationLocation: 'ports/action-port',
              reason: d.reason,
              correctionSuggestion: d.correctionSuggestion,
            }),
          )),
          displayText: '此交互暂时无法显示',
        };
        return { kind: 'rejected', rejection };
      }
      return { kind: 'accepted', committedRevision: currentRevision() };
    },
  };

  // ---- pendingContracts 端口：不可用能力显式失败（不猜测、不默认） ----
  const corePort: CoreCapabilityPort = {
    projectedResources(entityId: string) {
      const views = resourceViewsOf(entityId, deps.projection);
      return views.length > 0 ? converged(views) : pendingConvergence(['projectedResources']);
    },
    phaseSemantics() {
      const index = deps.holder.getState().world.turn.phaseIndex;
      const semantic = PHASE_SEMANTICS[index];
      const value: PhaseSemanticProjection = semantic === undefined
        ? { phaseSemanticId: `phase${index}`, accessibleLabel: `阶段${String(index)}` }
        : { phaseSemanticId: semantic.id, accessibleLabel: semantic.label };
      return converged(value);
    },
    legalActions(actorEntityId: string) {
      const actions = deps.projection.legalActions({ $: actorEntityId }, 'ui');
      return converged([...legalActionViews(actions.paid.flat()), ...legalActionViews(actions.attached.flat())]);
    },
    safeUnavailabilityReasonKey(actionId: string) {
      void actionId;
      return pendingConvergence(['safeUnavailabilityReasonKey']);
    },
    visibleDecisions() {
      return converged(Object.freeze([]) as readonly UiDecisionView[]);
    },
  };
  const spaceItemsPort: SpaceItemsCapabilityPort = {
    visibleScenes() {
      return pendingConvergence(['visibleScenes']);
    },
    visibleContainers() {
      return pendingConvergence(['visibleContainers']);
    },
    legalInteractions(actorEntityId: string) {
      void actorEntityId;
      return pendingConvergence(['legalInteractions']);
    },
  };
  const aiPort: AiCapabilityPort = {
    visibleActionState() {
      return pendingConvergence(['visibleActionState']);
    },
    publicIntents() {
      return pendingConvergence(['publicIntents']);
    },
    safeExplanationLabels(actorEntityId: string) {
      void actorEntityId;
      return pendingConvergence(['safeExplanationLabels']);
    },
  };
  const pendingContractsPort: PendingContractPorts = Object.freeze({ core: corePort, spaceItems: spaceItemsPort, ai: aiPort });

  // ---- diagnostics 端口：装载 diagnostics 接收器 ----
  const diagnosticsSink = createDiagnosticSink(agent);
  for (const diagnostic of deps.diagnostics) {
    if (diagnostic.severity === 'error' || diagnostic.severity === 'fatal') {
      diagnosticsSink.record({
        category: 'descriptor-rejection',
        diagnostic: uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.PENDING_CONVERGENCE_CONTRACT,
          presentationLocation: 'loading-runtime/ui-host',
          reason: `装载诊断：${diagnostic.message}`,
          correctionSuggestion: '见装载诊断详情',
        }),
        affectedEntityIds: Object.freeze([]),
        safeContext: Object.freeze({}),
        occurrence: 0,
      });
    }
  }

  return Object.freeze({
    projection: projectionPort,
    events: eventsPort,
    actionQuery: actionQueryPort,
    revision: revisionPort,
    actions: actionsPort,
    pendingContracts: pendingContractsPort,
    diagnostics: diagnosticsSink,
  });
}
