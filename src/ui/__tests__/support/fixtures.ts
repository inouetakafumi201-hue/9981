/**
 * 测试夹具：深冻结的上游投影、描述符、授权范围与视图基底。
 *
 * 夹具刻意**自己做深冻结**，而不是依赖被测代码去冻结：`projection-cache.ts` 的边界断言
 * 要求上游交付深冻结结构，如果夹具交出可变结构，那条断言就永远只在失败路径被测到。
 */

import { makeRevision, type StateRevision } from '../../model/revision.js';
import { makeInternalMetric } from '../../presentation/gameplay-value.js';
import type { PresentationProfile } from '../../model/profile.js';
import {
  entityViewToken,
  type ActionCostCategory,
  type AuthorizationScope,
  type InteractionIntent,
  type PresentationDescriptor,
  type ReadOnlySemanticProjection,
  type UiActionView,
  type UiEntityView,
  type UpstreamAgentAuthority,
} from '../../model/view.js';
import type { ProjectedViewBase } from '../../projection/reconcile.js';

/** 递归冻结。夹具专用，产品代码不做就地冻结。 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

export function revision(sequence: number, fingerprint: string): StateRevision {
  const made = makeRevision(sequence, fingerprint);
  if (!made.ok) throw new Error('fixture revision must be constructible');
  return made.value;
}

export function authority(
  omniscient = false,
  developmentSurface = false,
): UpstreamAgentAuthority {
  return Object.freeze({
    __brand: 'UpstreamAgentAuthority' as const,
    omniscient,
    developmentSurface,
  });
}

export interface ScopeOptions {
  readonly scopeId?: string;
  readonly agentId?: string;
  readonly visibleEntityIds?: readonly string[];
  readonly visibleNodeIds?: readonly string[];
  readonly authorizedBeliefAgentIds?: readonly string[];
}

export function scope(options: ScopeOptions = {}): AuthorizationScope {
  return deepFreeze({
    scopeId: options.scopeId ?? 'scope.a',
    consumer: 'ui' as const,
    agentId: options.agentId ?? 'agent.a',
    authorizedBeliefAgentIds: [...(options.authorizedBeliefAgentIds ?? [options.agentId ?? 'agent.a'])],
    visibleEntityIds: [...(options.visibleEntityIds ?? ['e1', 'e2'])],
    visibleNodeIds: [...(options.visibleNodeIds ?? ['n1'])],
    authorizedResourceRoles: ['hp', 'stamina', 'ap'] as const,
  }) as AuthorizationScope;
}

export interface ProjectionOptions {
  readonly scopeId?: string;
  readonly turn?: number;
  readonly fingerprint?: string;
  readonly entityIds?: readonly string[];
}

export function projection(options: ProjectionOptions = {}): ReadOnlySemanticProjection {
  return deepFreeze({
    scopeId: options.scopeId ?? 'scope.a',
    consumer: 'ui' as const,
    turn: options.turn ?? 1,
    definitions: [],
    entities: (options.entityIds ?? ['e1', 'e2']).map((entityId) => ({
      entityId,
      properties: [],
      statusIds: [],
      locationNodeId: 'n1',
    })),
    beliefSlices: [],
    visibility: [],
    semanticStateFingerprint: options.fingerprint ?? 'fp-1',
  }) as ReadOnlySemanticProjection;
}

export function descriptor(scopeId = 'scope.a'): PresentationDescriptor {
  return deepFreeze({
    scopeId,
    resources: [],
    paidActions: [],
    attachedActions: [],
    provenanceLabels: [],
    warnings: [],
  }) as PresentationDescriptor;
}

export interface ActionOptions {
  readonly actionId?: string;
  readonly costCategory?: ActionCostCategory;
  readonly interactionIntent?: InteractionIntent;
  readonly available?: boolean;
  readonly accessibleLabel?: string;
  readonly bindings?: readonly { readonly key: string; readonly value: string }[];
}

export function actionView(options: ActionOptions = {}): UiActionView {
  return deepFreeze({
    actionId: options.actionId ?? 'act.move',
    costCategory: options.costCategory ?? ('paid' as const),
    ...(options.interactionIntent === undefined
      ? { interactionIntent: 'traversal' as const }
      : { interactionIntent: options.interactionIntent }),
    available: options.available ?? true,
    accessibleLabel: options.accessibleLabel ?? '移动',
    assetRefs: [],
    bindings: [...(options.bindings ?? [{ key: 'to', value: 'n1' }])],
    targets: [],
  }) as UiActionView;
}

export function entityView(entityId: string, remembered = false): UiEntityView {
  return deepFreeze({
    entityId,
    viewToken: entityViewToken(entityId),
    locationNodeId: 'n1',
    statusIds: [],
    resources: [],
    salientStates: [],
    remembered,
  }) as UiEntityView;
}

export interface BaseOptions {
  readonly revision?: StateRevision;
  readonly agentId?: string;
  readonly scopeId?: string;
  readonly turn?: number;
  readonly entityIds?: readonly string[];
  readonly rememberedEntityIds?: readonly string[];
  readonly actions?: readonly UiActionView[];
}

export function viewBase(options: BaseOptions = {}): ProjectedViewBase {
  return Object.freeze({
    revision: options.revision ?? revision(1, 'fp-1'),
    agentId: options.agentId ?? 'agent.a',
    scopeId: options.scopeId ?? 'scope.a',
    turn: makeInternalMetric(options.turn ?? 1, 'turn-index'),
    entities: Object.freeze((options.entityIds ?? ['e1', 'e2']).map((id) => entityView(id))),
    rememberedEntities: Object.freeze(
      (options.rememberedEntityIds ?? []).map((id) => entityView(id, true)),
    ),
    actions: Object.freeze([...(options.actions ?? [actionView()])]),
    decisions: Object.freeze([]),
    turnOrder: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}

/**
 * 测试用 Presentation_Profile。
 *
 * 结构与 `profile/wakeup-default.profile.json` 一致，但**不是**它的副本：属性测试需要
 * 能改布局、改资源、改动效时长而不牵动默认交付件（Requirement 16.12 的换 profile 重跑）。
 */
export function profileFixture(overrides: Partial<PresentationProfile> = {}): PresentationProfile {
  return Object.freeze({
    version: '1.1.0',
    visualDirection: Object.freeze({
      interactionComponents: 'pixel-art',
      mapBackground: 'sketch',
      compositing: 'separated-foreground-background',
      authoritativeSource: 'D-024' as const,
    }),
    ceremonialActionSemantics: Object.freeze([
      Object.freeze({ actionSemanticId: 'vault-window', authoritativeSource: 'D-026' as const }),
      Object.freeze({ actionSemanticId: 'jump-window', authoritativeSource: 'D-026' as const }),
      Object.freeze({ actionSemanticId: 'lay-to-rest', authoritativeSource: 'D-026' as const }),
      Object.freeze({ actionSemanticId: 'parry-trigger', authoritativeSource: 'D-032' as const }),
    ]),
    salienceTiers: Object.freeze([
      Object.freeze({
        stateSemanticId: 'weakness',
        tier: 'public-persistent' as const,
        renderer: 'above-head-icon',
        authoritativeSource: 'D-031' as const,
      }),
      Object.freeze({
        stateSemanticId: 'aiming',
        tier: 'public-on-inspect' as const,
        renderer: 'red-dotted-aim-line',
        authoritativeSource: 'D-033' as const,
      }),
      Object.freeze({
        stateSemanticId: 'parry-ready',
        tier: 'hidden' as const,
        renderer: null,
        authoritativeSource: 'D-032' as const,
      }),
    ]),
    turnOrderBar: Object.freeze({
      edge: 'left' as const,
      persistent: true,
      entryFields: Object.freeze(['portrait', 'name', 'health', 'stamina']),
      spentEntryTreatment: 'desaturate',
      rollAnimationAnchor: 'beside-entry',
      authoritativeSource: 'D-035, D-036',
    }),
    endTurnCountdown: Object.freeze({
      seconds: makeInternalMetric(3, 's'),
      cancellable: true,
      authoritativeSource: 'D-042' as const,
    }),
    safeFieldWhitelist: Object.freeze([]),
    safeUnavailabilityReasons: Object.freeze({}),
    eventBufferTimeout: makeInternalMetric(2_000, 'ms'),
    ...overrides,
  }) as PresentationProfile;
}
