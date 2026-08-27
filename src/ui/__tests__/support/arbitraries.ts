import fc from 'fast-check';

import { deepFreeze, actionView, authority, scope } from './fixtures';
import { INPUT_SOURCES, stableHash, type InputSource } from '../../model/intent';
import { compareRevision, type RevisionComparison, type StateRevision } from '../../model/revision';
import {
  createAuthorizedAgent,
  type AuthorizedAgent,
  type PresentationDescriptor,
  type ReadOnlySemanticProjection,
  type UiActionView,
} from '../../model/view';

/** 所有跨 Agent、跨窗口与隐藏变体生成器共享的固定小标识池。 */
export const ENTITY_ID_POOL = Object.freeze([
  'entity:0',
  'entity:1',
  'entity:2',
  'entity:3',
  'entity:4',
  'entity:5',
  'entity:6',
  'entity:7',
] as const);

const NODE_ID_POOL = Object.freeze(['node:0', 'node:1', 'node:2'] as const);
const AGENT_ID_POOL = Object.freeze(['agent:0', 'agent:1', 'agent:2'] as const);

export function arbAgent(): fc.Arbitrary<AuthorizedAgent> {
  return fc
    .record({
      agentId: fc.constantFrom(...AGENT_ID_POOL),
      visibleEntityIds: fc.uniqueArray(fc.constantFrom(...ENTITY_ID_POOL), {
        minLength: 0,
        maxLength: ENTITY_ID_POOL.length,
      }),
      visibleNodeIds: fc.uniqueArray(fc.constantFrom(...NODE_ID_POOL), {
        minLength: 0,
        maxLength: NODE_ID_POOL.length,
      }),
      omniscient: fc.boolean(),
      developmentSurface: fc.boolean(),
      localDebugEnabled: fc.boolean(),
    })
    .map((value) =>
      createAuthorizedAgent(
        value.agentId,
        scope({
          agentId: value.agentId,
          scopeId: `scope:${value.agentId}`,
          visibleEntityIds: value.visibleEntityIds,
          visibleNodeIds: value.visibleNodeIds,
          authorizedBeliefAgentIds: [value.agentId],
        }),
        authority(value.omniscient, value.developmentSurface),
        {
          showInternalMetrics: value.localDebugEnabled,
          verbosePresentationLog: value.localDebugEnabled,
          overlayGrid: value.localDebugEnabled,
        },
      ),
    );
}

export type ReachableProjectionAction =
  | { readonly kind: 'advance-turn' }
  | {
      readonly kind: 'move-visible-entity';
      readonly entityId: (typeof ENTITY_ID_POOL)[number];
      readonly nodeId: (typeof NODE_ID_POOL)[number];
    };

export interface ReachableProjectionCase {
  readonly initial: ReadOnlySemanticProjection;
  readonly actions: readonly ReachableProjectionAction[];
  readonly projection: ReadOnlySemanticProjection;
}

function projectionFingerprint(
  turn: number,
  locations: readonly (readonly [string, string])[],
): string {
  return `reachable:${stableHash(`${String(turn)}|${locations.map(([id, node]) => `${id}@${node}`).join('|')}`)}`;
}

function initialReachableProjection(
  turn: number,
  locations: readonly (typeof NODE_ID_POOL)[number][],
): ReadOnlySemanticProjection {
  const locationPairs = ENTITY_ID_POOL.map(
    (entityId, index) => [entityId, locations[index] ?? NODE_ID_POOL[0]] as const,
  );
  return deepFreeze({
    scopeId: 'scope:reachable',
    consumer: 'ui' as const,
    turn,
    definitions: [],
    entities: locationPairs.map(([entityId, locationNodeId]) => ({
      entityId,
      properties: [],
      statusIds: [],
      locationNodeId,
    })),
    beliefSlices: [],
    visibility: [
      {
        agentId: 'agent:0',
        visibleEntityIds: [...ENTITY_ID_POOL],
        visibleNodeIds: [...NODE_ID_POOL],
      },
    ],
    semanticStateFingerprint: projectionFingerprint(turn, locationPairs),
  }) as ReadOnlySemanticProjection;
}

/** 独立重放器：每一步只接受生成器可产生的合法动作。 */
export function replayReachableProjection(
  initial: ReadOnlySemanticProjection,
  actions: readonly ReachableProjectionAction[],
): ReadOnlySemanticProjection {
  let turn = initial.turn;
  const locations = new Map(
    initial.entities.map((entity) => [entity.entityId, entity.locationNodeId ?? NODE_ID_POOL[0]]),
  );
  for (const action of actions) {
    if (action.kind === 'advance-turn') {
      turn += 1;
      continue;
    }
    if (!locations.has(action.entityId)) {
      throw new Error(`unreachable generated action for ${action.entityId}`);
    }
    locations.set(action.entityId, action.nodeId);
  }
  const locationPairs = initial.entities.map(
    (entity) => [entity.entityId, locations.get(entity.entityId) ?? NODE_ID_POOL[0]] as const,
  );
  return deepFreeze({
    ...initial,
    turn,
    entities: initial.entities.map((entity) => ({
      ...entity,
      locationNodeId: locations.get(entity.entityId) ?? NODE_ID_POOL[0],
      properties: [...entity.properties],
      statusIds: [...entity.statusIds],
    })),
    semanticStateFingerprint: projectionFingerprint(turn, locationPairs),
  }) as ReadOnlySemanticProjection;
}

export function arbReachableProjection(): fc.Arbitrary<ReachableProjectionCase> {
  const advanceAction: fc.Arbitrary<ReachableProjectionAction> = fc.constant({
    kind: 'advance-turn' as const,
  });
  const moveAction: fc.Arbitrary<ReachableProjectionAction> = fc.record({
    kind: fc.constant('move-visible-entity' as const),
    entityId: fc.constantFrom(...ENTITY_ID_POOL),
    nodeId: fc.constantFrom(...NODE_ID_POOL),
  });
  const action = fc.oneof(advanceAction, moveAction);
  return fc
    .record({
      turn: fc.nat({ max: 100 }),
      locations: fc.array(fc.constantFrom(...NODE_ID_POOL), {
        minLength: ENTITY_ID_POOL.length,
        maxLength: ENTITY_ID_POOL.length,
      }),
      actions: fc.array(action, { minLength: 0, maxLength: 30 }),
    })
    .map(({ turn, locations, actions }) => {
      const initial = initialReachableProjection(turn, locations);
      return Object.freeze({
        initial,
        actions: Object.freeze(actions.map((item) => Object.freeze(item))),
        projection: replayReachableProjection(initial, actions),
      });
    });
}

export interface HiddenEntityState {
  readonly entityId: (typeof ENTITY_ID_POOL)[number];
  readonly secretVariant: string;
}

export interface HiddenVariantWorld {
  readonly visibleProjection: ReadOnlySemanticProjection;
  readonly hidden: readonly HiddenEntityState[];
}

export type HiddenVariantPair = readonly [HiddenVariantWorld, HiddenVariantWorld];

export function arbHiddenVariantPair(): fc.Arbitrary<HiddenVariantPair> {
  return fc
    .tuple(
      arbReachableProjection(),
      fc.constantFrom(...ENTITY_ID_POOL),
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.string({ minLength: 1, maxLength: 24 }),
    )
    .map(([reachable, entityId, leftSecret, rightSeed]) => {
      const rightSecret = rightSeed === leftSecret ? `${rightSeed}:different` : rightSeed;
      const left: HiddenVariantWorld = Object.freeze({
        visibleProjection: reachable.projection,
        hidden: Object.freeze([Object.freeze({ entityId, secretVariant: leftSecret })]),
      });
      const right: HiddenVariantWorld = Object.freeze({
        visibleProjection: reachable.projection,
        hidden: Object.freeze([Object.freeze({ entityId, secretVariant: rightSecret })]),
      });
      return Object.freeze([left, right]) as HiddenVariantPair;
    });
}

const arbCostCategory = fc.constantFrom('paid' as const, 'attached' as const);
const arbInteractionIntent = fc.constantFrom(
  'traversal' as const,
  'precise-interaction' as const,
  'hostile-interaction' as const,
  'executable-target' as const,
);

function actionDescriptor(index: number, seed: {
  readonly costCategory: 'paid' | 'attached';
  readonly interactionIntent: 'traversal' | 'precise-interaction' | 'hostile-interaction' | 'executable-target';
  readonly available: boolean;
}) {
  return {
    actionId: `action:${String(index)}`,
    costCategory: seed.costCategory,
    interactionIntent: seed.interactionIntent,
    available: seed.available,
    accessibleLabel: `action ${String(index)}`,
    assetRefs: [`asset:${String(index)}`],
    targets: [],
  };
}

const arbActionDescriptorSeed = fc.record({
  costCategory: arbCostCategory,
  interactionIntent: arbInteractionIntent,
  available: fc.boolean(),
});

function descriptorFromSeeds(
  seeds: readonly {
    readonly costCategory: 'paid' | 'attached';
    readonly interactionIntent: 'traversal' | 'precise-interaction' | 'hostile-interaction' | 'executable-target';
    readonly available: boolean;
  }[],
): PresentationDescriptor {
  const actions = seeds.map((seed, index) => actionDescriptor(index, seed));
  return deepFreeze({
    scopeId: 'scope:descriptor',
    resources: [],
    paidActions: actions.filter((action) => action.costCategory === 'paid'),
    attachedActions: actions.filter((action) => action.costCategory === 'attached'),
    provenanceLabels: [],
    warnings: [],
  }) as unknown as PresentationDescriptor;
}

export function arbDescriptor(): fc.Arbitrary<PresentationDescriptor> {
  return fc
    .array(arbActionDescriptorSeed, { minLength: 0, maxLength: 20 })
    .map(descriptorFromSeeds);
}

export const DAMAGED_DESCRIPTOR_FIELDS = [
  'scopeId',
  'resources',
  'paidActions',
  'attachedActions',
  'actionId',
  'costCategory',
  'available',
  'assetRefs',
  'targets',
  'accessibleLabel',
] as const;
export type DamagedDescriptorField = (typeof DAMAGED_DESCRIPTOR_FIELDS)[number];

export interface DamagedDescriptorCase {
  readonly field: DamagedDescriptorField;
  readonly descriptor: unknown;
}

export function arbDamagedDescriptor(
  field: DamagedDescriptorField,
): fc.Arbitrary<DamagedDescriptorCase> {
  return arbActionDescriptorSeed.map((seed) => {
    const action: Record<string, unknown> = { ...actionDescriptor(0, seed) };
    const descriptor: Record<string, unknown> = {
      scopeId: 'scope:damaged',
      resources: [],
      paidActions: [action],
      attachedActions: [],
      provenanceLabels: [],
      warnings: [],
    };
    if (field === 'scopeId') descriptor[field] = '';
    else if (field === 'resources' || field === 'paidActions' || field === 'attachedActions') {
      descriptor[field] = null;
    } else {
      const invalidValues: Readonly<Record<string, unknown>> = {
        actionId: '',
        costCategory: 'unknown-cost',
        available: 'yes',
        assetRefs: [42],
        targets: null,
        accessibleLabel: '',
      };
      action[field] = invalidValues[field];
    }
    return Object.freeze({ field, descriptor: deepFreeze(descriptor) });
  });
}

export function arbLegalActionSet(size: number): fc.Arbitrary<readonly UiActionView[]> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('legal action set size must be a non-negative safe integer');
  return fc
    .array(
      fc.record({
        costCategory: arbCostCategory,
        interactionIntent: arbInteractionIntent,
        available: fc.boolean(),
        targetEntityId: fc.constantFrom(...ENTITY_ID_POOL),
      }),
      { minLength: size, maxLength: size },
    )
    .map((seeds) =>
      Object.freeze(
        seeds.map((seed, index) =>
          actionView({
            actionId: `legal:${String(index)}`,
            costCategory: seed.costCategory,
            interactionIntent: seed.interactionIntent,
            available: seed.available,
            accessibleLabel: `legal action ${String(index)}`,
            bindings: [{ key: 'target', value: seed.targetEntityId }],
          }),
        ),
      ),
    );
}

export function arbInputSource(): fc.Arbitrary<InputSource> {
  return fc.constantFrom(...INPUT_SOURCES);
}

export interface RevisionPair {
  readonly left: StateRevision;
  readonly right: StateRevision;
  readonly expected: RevisionComparison;
}

function frozenRevision(sequence: number, fingerprint: string): StateRevision {
  return Object.freeze({ sequence, fingerprint });
}

export function arbRevisionPair(): fc.Arbitrary<RevisionPair> {
  const sequence = fc.nat({ max: 1_000 });
  const fingerprint = fc.string({ minLength: 1, maxLength: 20 }).map((value) => `fp:${value}`);
  return fc.oneof(
    fc.tuple(sequence, fingerprint).map(([value, fp]) =>
      Object.freeze({
        left: frozenRevision(value, fp),
        right: frozenRevision(value, fp),
        expected: 'same' as const,
      }),
    ),
    fc.tuple(sequence, fingerprint).map(([value, fp]) =>
      Object.freeze({
        left: frozenRevision(value + 1, fp),
        right: frozenRevision(value, fp),
        expected: 'newer' as const,
      }),
    ),
    fc.tuple(sequence, fingerprint).map(([value, fp]) =>
      Object.freeze({
        left: frozenRevision(value, fp),
        right: frozenRevision(value + 1, fp),
        expected: 'older' as const,
      }),
    ),
    fc.tuple(sequence, fingerprint, fingerprint).map(([value, leftFp, rightSeed]) => {
      const rightFp = rightSeed === leftFp ? `${rightSeed}:different` : rightSeed;
      return Object.freeze({
        left: frozenRevision(value, leftFp),
        right: frozenRevision(value, rightFp),
        expected: 'uncomparable' as const,
      });
    }),
  ).filter((pair) => compareRevision(pair.left, pair.right) === pair.expected);
}
