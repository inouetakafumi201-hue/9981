/**
 * L2 Codec: 语义族契约解码。
 *
 * 把候选定义的 `familyContract` 从声明式 JSON 解码为 model/family-contracts.ts 的强类型契约。
 * 每个 contractKind 一个解码函数；未知 kind 报语义损坏，不猜测。
 *
 * 违规检测面字段（`concrete*` / `named*` / `embedded*` / `owner*` 等）会被原样解码，
 * 以便验证器发现越层声明；解码本身不拒绝它们。
 */

import { joinJsonPath } from '../model/ids.js';
import type { JsonValue } from '../model/json.js';
import { isJsonValue } from '../model/json.js';
import {
  ACTION_COST_CATEGORIES,
  ATTACHMENT_CLEANUP_BEHAVIORS,
  ATTACHMENT_STACK_BEHAVIORS,
  AI_POLICY_CATEGORIES,
  CONSUMABLE_USE_LOCATIONS,
  CONSUMPTION_BEHAVIORS,
  CRITERION_COMPARISONS,
  GATEWAY_KINDS,
  INTERACTION_INTENTS,
  ITEM_KINDS,
  MICRO_SCENE_LIFECYCLE_DETERMINANTS,
  MOVEMENT_TRAVERSALS,
  SCENE_SCALES,
  SKILL_ACTIVATIONS,
  STATUS_DURATION_MODES,
  STATUS_STACK_MODES,
  TARGET_KINDS,
  TRANSITION_DIRECTIONALITIES,
  WEAPON_CLASSES,
  type FamilyContract,
} from '../model/family-contracts.js';
import type { DecodeContext } from './decode.js';
import {
  optionalArray,
  optionalBoolean,
  optionalFiniteNumber,
  optionalObject,
  optionalString,
  requireBoolean,
  requireEnum,
  requireObject,
  requireString,
} from './decode.js';
import { decodeParameterSchema, decodeTypedReference, decodeTypedReferenceArray } from './schema-decoder.js';
import type { TypedReference } from '../model/reference.js';
import type { SourceRecord } from '../model/source.js';
import {
  OWNING_LAYERS,
  SOURCE_CLASSIFICATION_KINDS,
  SOURCE_PRECEDENCE_ORDER,
} from '../model/source.js';

/** 逐元素解码引用数组，跳过报错元素（诊断已记录）。 */
function refArray(ctx: DecodeContext, value: unknown, path: string, role: string): readonly TypedReference[] {
  return decodeTypedReferenceArray(ctx, value, path, role);
}

function stringArray(ctx: DecodeContext, value: unknown, path: string): readonly string[] {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out: string[] = [];
  array.forEach((element, index) => {
    const item = requireString(ctx, element, joinJsonPath(path, index));
    if (item !== undefined) {
      out.push(item);
    }
  });
  return out;
}

function preserveObject(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined || !isJsonValue(value) || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, JsonValue>>;
}

/** 解码内嵌于契约中的 Source_Record（例如结构边界的权威来源）。 */
function decodeSourceRecord(ctx: DecodeContext, value: unknown, path: string): SourceRecord | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const sourceFile = requireString(ctx, object['sourceFile'], joinJsonPath(path, 'sourceFile'));
  const precedence = requireEnum(ctx, object['precedence'], joinJsonPath(path, 'precedence'), SOURCE_PRECEDENCE_ORDER);
  const classification = requireEnum(
    ctx,
    object['classification'],
    joinJsonPath(path, 'classification'),
    SOURCE_CLASSIFICATION_KINDS,
  );
  const owningLayer = requireEnum(ctx, object['owningLayer'], joinJsonPath(path, 'owningLayer'), OWNING_LAYERS);
  const statementFingerprint = requireString(ctx, object['statementFingerprint'], joinJsonPath(path, 'statementFingerprint'));
  const locationObject = requireObject(ctx, object['sourceLocation'], joinJsonPath(path, 'sourceLocation'));
  if (
    sourceFile === undefined ||
    precedence === undefined ||
    classification === undefined ||
    owningLayer === undefined ||
    statementFingerprint === undefined ||
    locationObject === undefined
  ) {
    return undefined;
  }
  const section = requireString(ctx, locationObject['section'], joinJsonPath(joinJsonPath(path, 'sourceLocation'), 'section'));
  if (section === undefined) {
    return undefined;
  }
  const decisionId = optionalString(ctx, object['decisionId'], joinJsonPath(path, 'decisionId'));
  const line = optionalFiniteNumber(ctx, locationObject['line'], joinJsonPath(joinJsonPath(path, 'sourceLocation'), 'line'));
  const column = optionalFiniteNumber(ctx, locationObject['column'], joinJsonPath(joinJsonPath(path, 'sourceLocation'), 'column'));
  return {
    sourceFile,
    sourceLocation: {
      sourceFile,
      section,
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    },
    precedence,
    classification,
    owningLayer,
    statementFingerprint,
    ...(decisionId === undefined ? {} : { decisionId }),
  };
}

function decodeActionContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const costCategory = requireEnum(ctx, o['costCategory'], joinJsonPath(p, 'costCategory'), ACTION_COST_CATEGORIES);
  const apCost = optionalFiniteNumber(ctx, o['apCost'], joinJsonPath(p, 'apCost'));
  const completionState = requireString(ctx, o['completionState'], joinJsonPath(p, 'completionState'));
  const availableAsDecisionBranch = requireBoolean(
    ctx,
    o['availableAsDecisionBranch'],
    joinJsonPath(p, 'availableAsDecisionBranch'),
  );
  const requiresHookIntegration = requireBoolean(
    ctx,
    o['requiresHookIntegration'],
    joinJsonPath(p, 'requiresHookIntegration'),
  );
  if (
    costCategory === undefined ||
    apCost === undefined ||
    completionState === undefined ||
    availableAsDecisionBranch === undefined ||
    requiresHookIntegration === undefined
  ) {
    return undefined;
  }

  const actorRequirements = decodeActorRequirements(ctx, o['actorRequirements'], joinJsonPath(p, 'actorRequirements'));
  const targetRequirements = decodeTargetRequirements(ctx, o['targetRequirements'], joinJsonPath(p, 'targetRequirements'));
  const hostActionRef =
    o['hostActionRef'] === undefined
      ? undefined
      : decodeTypedReference(ctx, o['hostActionRef'], joinJsonPath(p, 'hostActionRef'), 'action');
  const sequence = decodeActionSequence(ctx, o['sequence'], joinJsonPath(p, 'sequence'));
  const opMapping = decodeOpMapping(ctx, o['opMapping'], joinJsonPath(p, 'opMapping'));
  const interactionIntent = o['interactionIntent'] === undefined ? undefined : requireEnum(ctx, o['interactionIntent'], joinJsonPath(p, 'interactionIntent'), INTERACTION_INTENTS);
  // 2026-08-08 权威变更：attackShape 解码已删除，见 model/family-contracts.ts 顶部权威变更说明。
  const posture = optionalString(ctx, o['posture'], joinJsonPath(p, 'posture'));
  const accessibleLabel = optionalString(ctx, o['accessibleLabel'], joinJsonPath(p, 'accessibleLabel'));

  return {
    contractKind: 'action',
    costCategory,
    apCost,
    actorRequirements,
    targetRequirements,
    effectRefs: refArray(ctx, o['effectRefs'], joinJsonPath(p, 'effectRefs'), 'effect'),
    interruptionConditionRefs: refArray(ctx, o['interruptionConditionRefs'], joinJsonPath(p, 'interruptionConditionRefs'), 'expr'),
    completionState,
    availableAsDecisionBranch,
    requiresHookIntegration,
    ...(hostActionRef === undefined ? {} : { hostActionRef }),
    ...(sequence === undefined ? {} : { sequence }),
    ...(opMapping === undefined ? {} : { opMapping }),
    ...(interactionIntent === undefined ? {} : { interactionIntent }),
    ...(posture === undefined ? {} : { posture }),
    ...(accessibleLabel === undefined ? {} : { accessibleLabel }),
  };
}

function decodeActorRequirements(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const itemPath = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], itemPath);
    if (object === undefined) {
      continue;
    }
    const requirementId = requireString(ctx, object['requirementId'], joinJsonPath(itemPath, 'requirementId'));
    const capability = requireString(ctx, object['capability'], joinJsonPath(itemPath, 'capability'));
    if (requirementId === undefined || capability === undefined) {
      continue;
    }
    const conditionExprRef =
      object['conditionExprRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['conditionExprRef'], joinJsonPath(itemPath, 'conditionExprRef'), 'expr');
    out.push({
      requirementId,
      capability,
      ...(conditionExprRef === undefined ? {} : { conditionExprRef }),
    });
  }
  return out;
}

function decodeTargetRequirements(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const itemPath = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], itemPath);
    if (object === undefined) {
      continue;
    }
    const requirementId = requireString(ctx, object['requirementId'], joinJsonPath(itemPath, 'requirementId'));
    const targetKind = requireEnum(ctx, object['targetKind'], joinJsonPath(itemPath, 'targetKind'), TARGET_KINDS);
    if (requirementId === undefined || targetKind === undefined) {
      continue;
    }
    const expectedFamily = optionalString(ctx, object['expectedFamily'], joinJsonPath(itemPath, 'expectedFamily'));
    const maxTargetsField = optionalString(ctx, object['maxTargetsField'], joinJsonPath(itemPath, 'maxTargetsField'));
    const interactionIntent =
      object['interactionIntent'] === undefined
        ? undefined
        : requireEnum(ctx, object['interactionIntent'], joinJsonPath(itemPath, 'interactionIntent'), INTERACTION_INTENTS);
    const conditionExprRef =
      object['conditionExprRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['conditionExprRef'], joinJsonPath(itemPath, 'conditionExprRef'), 'expr');
    out.push({
      requirementId,
      targetKind,
      ...(expectedFamily === undefined ? {} : { expectedFamily }),
      ...(maxTargetsField === undefined ? {} : { maxTargetsField }),
      ...(interactionIntent === undefined ? {} : { interactionIntent }),
      ...(conditionExprRef === undefined ? {} : { conditionExprRef }),
    });
  }
  return out;
}

function decodeActionSequence(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const itemPath = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], itemPath);
    if (object === undefined) {
      continue;
    }
    const stepId = requireString(ctx, object['stepId'], joinJsonPath(itemPath, 'stepId'));
    const actionRef = decodeTypedReference(ctx, object['actionRef'], joinJsonPath(itemPath, 'actionRef'), 'action');
    if (stepId === undefined || actionRef === undefined) {
      continue;
    }
    const intermediateStatusRef =
      object['intermediateStatusRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['intermediateStatusRef'], joinJsonPath(itemPath, 'intermediateStatusRef'), 'status');
    out.push({
      stepId,
      actionRef,
      ...(intermediateStatusRef === undefined ? {} : { intermediateStatusRef }),
    });
  }
  return out;
}

function decodeOpMapping(ctx: DecodeContext, value: unknown, path: string) {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const opId = requireString(ctx, object['opId'], joinJsonPath(path, 'opId'));
  if (opId === undefined) {
    return undefined;
  }
  const mappingArray = optionalArray(ctx, object['argumentMapping'], joinJsonPath(path, 'argumentMapping')) ?? [];
  const argumentMapping = [];
  for (let index = 0; index < mappingArray.length; index += 1) {
    const itemPath = joinJsonPath(joinJsonPath(path, 'argumentMapping'), index);
    const entry = requireObject(ctx, mappingArray[index], itemPath);
    if (entry === undefined) {
      continue;
    }
    const opArgument = requireString(ctx, entry['opArgument'], joinJsonPath(itemPath, 'opArgument'));
    const source = requireEnum(ctx, entry['source'], joinJsonPath(itemPath, 'source'), ['actor', 'target', 'parameter', 'constant'] as const);
    if (opArgument === undefined || source === undefined) {
      continue;
    }
    const parameterName = optionalString(ctx, entry['parameterName'], joinJsonPath(itemPath, 'parameterName'));
    const constant = entry['constant'] !== undefined && isJsonValue(entry['constant']) ? (entry['constant'] as JsonValue) : undefined;
    argumentMapping.push({
      opArgument,
      source,
      ...(parameterName === undefined ? {} : { parameterName }),
      ...(constant === undefined ? {} : { constant }),
    });
  }
  return { opId, argumentMapping };
}

function decodeGatewayContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const gatewayKind = requireEnum(ctx, o['gatewayKind'], joinJsonPath(p, 'gatewayKind'), GATEWAY_KINDS);
  if (gatewayKind === undefined) {
    return undefined;
  }
  const concreteThreshold = optionalFiniteNumber(ctx, o['concreteThreshold'], joinJsonPath(p, 'concreteThreshold'));
  const namedGameplayEntity = optionalString(ctx, o['namedGameplayEntity'], joinJsonPath(p, 'namedGameplayEntity'));

  let resourceConversion;
  if (o['resourceConversion'] !== undefined) {
    const rc = requireObject(ctx, o['resourceConversion'], joinJsonPath(p, 'resourceConversion'));
    if (rc !== undefined) {
      const deterministicSuccess = requireBoolean(ctx, rc['deterministicSuccess'], joinJsonPath(joinJsonPath(p, 'resourceConversion'), 'deterministicSuccess'));
      resourceConversion = {
        inputResourceRefs: refArray(ctx, rc['inputResourceRefs'], joinJsonPath(joinJsonPath(p, 'resourceConversion'), 'inputResourceRefs'), 'item'),
        outputEffectRefs: refArray(ctx, rc['outputEffectRefs'], joinJsonPath(joinJsonPath(p, 'resourceConversion'), 'outputEffectRefs'), 'effect'),
        deterministicSuccess: deterministicSuccess ?? false,
      };
    }
  }

  let check;
  if (o['check'] !== undefined) {
    const c = requireObject(ctx, o['check'], joinJsonPath(p, 'check'));
    if (c !== undefined) {
      const cp = joinJsonPath(p, 'check');
      const primitiveRef = decodeTypedReference(ctx, c['primitiveRef'], joinJsonPath(cp, 'primitiveRef'), 'expr');
      const criterion = decodeCriterion(ctx, c['criterion'], joinJsonPath(cp, 'criterion'));
      if (primitiveRef !== undefined && criterion !== undefined) {
        check = {
          primitiveRef,
          criterion,
          successEffectRefs: refArray(ctx, c['successEffectRefs'], joinJsonPath(cp, 'successEffectRefs'), 'effect'),
          failureEffectRefs: refArray(ctx, c['failureEffectRefs'], joinJsonPath(cp, 'failureEffectRefs'), 'effect'),
        };
      }
    }
  }

  let condition;
  if (o['condition'] !== undefined) {
    const c = requireObject(ctx, o['condition'], joinJsonPath(p, 'condition'));
    if (c !== undefined) {
      const cp = joinJsonPath(p, 'condition');
      const conditionExprRef = decodeTypedReference(ctx, c['conditionExprRef'], joinJsonPath(cp, 'conditionExprRef'), 'expr');
      if (conditionExprRef !== undefined) {
        condition = {
          conditionExprRef,
          successEffectRefs: refArray(ctx, c['successEffectRefs'], joinJsonPath(cp, 'successEffectRefs'), 'effect'),
          failureEffectRefs: refArray(ctx, c['failureEffectRefs'], joinJsonPath(cp, 'failureEffectRefs'), 'effect'),
        };
      }
    }
  }

  return {
    contractKind: 'gateway',
    gatewayKind,
    ...(resourceConversion === undefined ? {} : { resourceConversion }),
    ...(check === undefined ? {} : { check }),
    ...(condition === undefined ? {} : { condition }),
    ...(namedGameplayEntity === undefined ? {} : { namedGameplayEntity }),
    ...(concreteThreshold === undefined ? {} : { concreteThreshold }),
  };
}

function decodeCriterion(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const comparison = requireEnum(ctx, object['comparison'], joinJsonPath(path, 'comparison'), CRITERION_COMPARISONS);
  const thresholdField = requireString(ctx, object['thresholdField'], joinJsonPath(path, 'thresholdField'));
  if (comparison === undefined || thresholdField === undefined) {
    return undefined;
  }
  return { comparison, thresholdField };
}

function decodeNaturalSceneContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const scale = requireEnum(ctx, o['scale'], joinJsonPath(p, 'scale'), SCENE_SCALES);
  if (scale === undefined) {
    return undefined;
  }
  const connectionBound = decodeStructuralBound(ctx, o['connectionBound'], joinJsonPath(p, 'connectionBound'));
  const sharedMicroSceneCapabilityRef =
    o['sharedMicroSceneCapabilityRef'] === undefined
      ? undefined
      : decodeTypedReference(ctx, o['sharedMicroSceneCapabilityRef'], joinJsonPath(p, 'sharedMicroSceneCapabilityRef'), 'node');
  const concreteMapNodeIds = o['concreteMapNodeIds'] === undefined ? undefined : stringArray(ctx, o['concreteMapNodeIds'], joinJsonPath(p, 'concreteMapNodeIds'));
  return {
    contractKind: 'natural-scene',
    scale,
    personalVacantGroundMicroSceneRefs: refArray(ctx, o['personalVacantGroundMicroSceneRefs'], joinJsonPath(p, 'personalVacantGroundMicroSceneRefs'), 'node'),
    ...(connectionBound === undefined ? {} : { connectionBound }),
    ...(sharedMicroSceneCapabilityRef === undefined ? {} : { sharedMicroSceneCapabilityRef }),
    ...(concreteMapNodeIds === undefined ? {} : { concreteMapNodeIds }),
  };
}

function decodeStructuralBound(ctx: DecodeContext, value: unknown, path: string) {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const boundValue = optionalFiniteNumber(ctx, object['value'], joinJsonPath(path, 'value'));
  const structuralRationale = optionalString(ctx, object['structuralRationale'], joinJsonPath(path, 'structuralRationale'));
  const source =
    object['authoritativeSource'] === undefined
      ? undefined
      : decodeSourceRecord(ctx, object['authoritativeSource'], joinJsonPath(path, 'authoritativeSource'));
  if (boundValue === undefined || structuralRationale === undefined || source === undefined) {
    // 字段不完整：返回 undefined，由 spatial 验证器报告"结构边界缺少来源/理由"。
    return undefined;
  }
  return { value: boundValue, structuralRationale, authoritativeSource: source };
}

function decodeMicroSceneContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const parent = decodeTypedReference(ctx, o['parent'], joinJsonPath(p, 'parent'), 'node');
  const occupancyContractRef = decodeTypedReference(ctx, o['occupancyContractRef'], joinJsonPath(p, 'occupancyContractRef'), 'rule');
  const creatorObject = requireObject(ctx, o['creator'], joinJsonPath(p, 'creator'));
  if (parent === undefined || occupancyContractRef === undefined || creatorObject === undefined) {
    return undefined;
  }
  const creatorEntityRef = requireString(ctx, creatorObject['creatorEntityRef'], joinJsonPath(joinJsonPath(p, 'creator'), 'creatorEntityRef'));
  const immutable = requireBoolean(ctx, creatorObject['immutable'], joinJsonPath(joinJsonPath(p, 'creator'), 'immutable'));
  if (creatorEntityRef === undefined || immutable === undefined) {
    return undefined;
  }
  const lifecycleDeterminants = decodeLifecycleDeterminants(ctx, o['lifecycleDeterminants'], joinJsonPath(p, 'lifecycleDeterminants'));
  const ownerField = optionalString(ctx, o['ownerField'], joinJsonPath(p, 'ownerField'));
  return {
    contractKind: 'micro-scene',
    parent,
    creator: { creatorEntityRef, immutable },
    occupancyContractRef,
    lifecycleDeterminants,
    ...(ownerField === undefined ? {} : { ownerField }),
  };
}

function decodeLifecycleDeterminants(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): readonly (typeof MICRO_SCENE_LIFECYCLE_DETERMINANTS)[number][] {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out: (typeof MICRO_SCENE_LIFECYCLE_DETERMINANTS)[number][] = [];
  for (let index = 0; index < array.length; index += 1) {
    const determinant = requireEnum(ctx, array[index], joinJsonPath(path, index), MICRO_SCENE_LIFECYCLE_DETERMINANTS);
    if (determinant !== undefined) {
      out.push(determinant);
    }
  }
  return out;
}

function decodeTransitionContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const directionality = requireEnum(ctx, o['directionality'], joinJsonPath(p, 'directionality'), TRANSITION_DIRECTIONALITIES);
  if (directionality === undefined) {
    return undefined;
  }
  return {
    contractKind: 'transition',
    directionality,
    endpoints: refArray(ctx, o['endpoints'], joinJsonPath(p, 'endpoints'), 'node'),
    traversalConditionRefs: refArray(ctx, o['traversalConditionRefs'], joinJsonPath(p, 'traversalConditionRefs'), 'expr'),
    blockingCapabilityRefs: refArray(ctx, o['blockingCapabilityRefs'], joinJsonPath(p, 'blockingCapabilityRefs'), 'rule'),
  };
}

function decodeItemContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const itemKind = requireEnum(ctx, o['itemKind'], joinJsonPath(p, 'itemKind'), ITEM_KINDS);
  const containerObject = requireObject(ctx, o['containerEligibility'], joinJsonPath(p, 'containerEligibility'));
  if (itemKind === undefined || containerObject === undefined) {
    return undefined;
  }
  const cp = joinJsonPath(p, 'containerEligibility');
  const storable = requireBoolean(ctx, containerObject['storable'], joinJsonPath(cp, 'storable'));
  if (storable === undefined) {
    return undefined;
  }
  const volumeField = optionalString(ctx, containerObject['volumeField'], joinJsonPath(cp, 'volumeField'));
  const containerEligibility = {
    storable,
    requiredContainerCapabilityRefs: refArray(ctx, containerObject['requiredContainerCapabilityRefs'], joinJsonPath(cp, 'requiredContainerCapabilityRefs'), 'container'),
    ...(volumeField === undefined ? {} : { volumeField }),
  };

  const armor = o['armor'] === undefined ? undefined : decodeArmorProfile(ctx, o['armor'], joinJsonPath(p, 'armor'));
  const consumable = o['consumable'] === undefined ? undefined : decodeConsumableProfile(ctx, o['consumable'], joinJsonPath(p, 'consumable'));
  const heavyTagAggregation = o['heavyTagAggregation'] === undefined ? undefined : decodeHeavyTag(ctx, o['heavyTagAggregation'], joinJsonPath(p, 'heavyTagAggregation'));
  const deathContainerCapability = o['deathContainerCapability'] === undefined ? undefined : decodeDeathContainer(ctx, o['deathContainerCapability'], joinJsonPath(p, 'deathContainerCapability'));

  return {
    contractKind: 'item',
    itemKind,
    containerEligibility,
    slotRequirements: decodeSlotRequirements(ctx, o['slotRequirements'], joinJsonPath(p, 'slotRequirements')),
    equipRequirements: decodeEquipRequirements(ctx, o['equipRequirements'], joinJsonPath(p, 'equipRequirements')),
    grantedActionRefs: refArray(ctx, o['grantedActionRefs'], joinJsonPath(p, 'grantedActionRefs'), 'action'),
    attachmentPoints: decodeAttachmentPoints(ctx, o['attachmentPoints'], joinJsonPath(p, 'attachmentPoints')),
    ...(armor === undefined ? {} : { armor }),
    ...(consumable === undefined ? {} : { consumable }),
    ...(heavyTagAggregation === undefined ? {} : { heavyTagAggregation }),
    ...(deathContainerCapability === undefined ? {} : { deathContainerCapability }),
  };
}

function decodeSlotRequirements(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const slotId = requireString(ctx, object['slotId'], joinJsonPath(ip, 'slotId'));
    const slotRef = decodeTypedReference(ctx, object['slotRef'], joinJsonPath(ip, 'slotRef'), 'slot');
    const exclusive = requireBoolean(ctx, object['exclusive'], joinJsonPath(ip, 'exclusive'));
    if (slotId === undefined || slotRef === undefined || exclusive === undefined) {
      continue;
    }
    out.push({ slotId, slotRef, exclusive });
  }
  return out;
}

function decodeEquipRequirements(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const requirementId = requireString(ctx, object['requirementId'], joinJsonPath(ip, 'requirementId'));
    const capability = requireString(ctx, object['capability'], joinJsonPath(ip, 'capability'));
    if (requirementId === undefined || capability === undefined) {
      continue;
    }
    const conditionExprRef =
      object['conditionExprRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['conditionExprRef'], joinJsonPath(ip, 'conditionExprRef'), 'expr');
    out.push({ requirementId, capability, ...(conditionExprRef === undefined ? {} : { conditionExprRef }) });
  }
  return out;
}

function decodeAttachmentPoints(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const pointId = requireString(ctx, object['pointId'], joinJsonPath(ip, 'pointId'));
    const acceptedFamily = requireString(ctx, object['acceptedFamily'], joinJsonPath(ip, 'acceptedFamily'));
    if (pointId === undefined || acceptedFamily === undefined) {
      continue;
    }
    const acceptedRef =
      object['acceptedRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['acceptedRef'], joinJsonPath(ip, 'acceptedRef'), 'attachment');
    out.push({ pointId, acceptedFamily, ...(acceptedRef === undefined ? {} : { acceptedRef }) });
  }
  return out;
}

function decodeArmorProfile(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const concreteInstanceRef = optionalString(ctx, object['concreteInstanceRef'], joinJsonPath(path, 'concreteInstanceRef'));
  return {
    mitigationRuleRefs: refArray(ctx, object['mitigationRuleRefs'], joinJsonPath(path, 'mitigationRuleRefs'), 'rule'),
    breakConditionRefs: refArray(ctx, object['breakConditionRefs'], joinJsonPath(path, 'breakConditionRefs'), 'expr'),
    equipmentSlotRequirements: decodeSlotRequirements(ctx, object['equipmentSlotRequirements'], joinJsonPath(path, 'equipmentSlotRequirements')),
    ...(concreteInstanceRef === undefined ? {} : { concreteInstanceRef }),
  };
}

function decodeConsumableProfile(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const useLocation = requireEnum(ctx, object['useLocation'], joinJsonPath(path, 'useLocation'), CONSUMABLE_USE_LOCATIONS);
  const consumptionBehavior = requireEnum(ctx, object['consumptionBehavior'], joinJsonPath(path, 'consumptionBehavior'), CONSUMPTION_BEHAVIORS);
  if (useLocation === undefined || consumptionBehavior === undefined) {
    return undefined;
  }
  const chargesField = optionalString(ctx, object['chargesField'], joinJsonPath(path, 'chargesField'));
  return {
    useLocation,
    consumptionBehavior,
    effectRefs: refArray(ctx, object['effectRefs'], joinJsonPath(path, 'effectRefs'), 'effect'),
    ...(chargesField === undefined ? {} : { chargesField }),
  };
}

function decodeHeavyTag(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const aggregation = requireString(ctx, object['aggregation'], joinJsonPath(path, 'aggregation'));
  const tag = requireString(ctx, object['tag'], joinJsonPath(path, 'tag'));
  const queryRef = decodeTypedReference(ctx, object['queryRef'], joinJsonPath(path, 'queryRef'), 'expr');
  const relationRef = decodeTypedReference(ctx, object['relationRef'], joinJsonPath(path, 'relationRef'), 'rule');
  if (aggregation === undefined || tag === undefined || queryRef === undefined || relationRef === undefined) {
    return undefined;
  }
  return { aggregation: aggregation as 'l1-query-relation', queryRef, relationRef, tag };
}

function decodeDeathContainer(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const containerRef = decodeTypedReference(ctx, object['containerRef'], joinJsonPath(path, 'containerRef'), 'container');
  const depositDisabled = requireBoolean(ctx, object['depositDisabled'], joinJsonPath(path, 'depositDisabled'));
  const contentSource = requireString(ctx, object['contentSource'], joinJsonPath(path, 'contentSource'));
  if (containerRef === undefined || depositDisabled === undefined || contentSource === undefined) {
    return undefined;
  }
  return { containerRef, depositDisabled, contentSource };
}

function decodeWeaponContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const weaponClass = requireEnum(ctx, o['weaponClass'], joinJsonPath(p, 'weaponClass'), WEAPON_CLASSES);
  if (weaponClass === undefined) {
    return undefined;
  }
  const attackSpectrumTier = optionalString(ctx, o['attackSpectrumTier'], joinJsonPath(p, 'attackSpectrumTier'));
  const specialTierMechanism = preserveObject(o['specialTierMechanism']);
  const concreteDamageValue = optionalFiniteNumber(ctx, o['concreteDamageValue'], joinJsonPath(p, 'concreteDamageValue'));
  const gameplayProfileCoupling = optionalString(ctx, o['gameplayProfileCoupling'], joinJsonPath(p, 'gameplayProfileCoupling'));
  return {
    contractKind: 'weapon',
    weaponClass,
    ...(attackSpectrumTier === undefined ? {} : { attackSpectrumTier }),
    ...(specialTierMechanism === undefined ? {} : { specialTierMechanism }),
    ...(concreteDamageValue === undefined ? {} : { concreteDamageValue }),
    ...(gameplayProfileCoupling === undefined ? {} : { gameplayProfileCoupling }),
  };
}

function decodeVehicleContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const entityBacked = requireBoolean(ctx, o['entityBacked'], joinJsonPath(p, 'entityBacked'));
  if (entityBacked === undefined) {
    return undefined;
  }
  const lockCapabilityRef = o['lockCapabilityRef'] === undefined ? undefined : decodeTypedReference(ctx, o['lockCapabilityRef'], joinJsonPath(p, 'lockCapabilityRef'), 'rule');
  const movementCapabilityRef = o['movementCapabilityRef'] === undefined ? undefined : decodeTypedReference(ctx, o['movementCapabilityRef'], joinJsonPath(p, 'movementCapabilityRef'), 'movement');
  const collisionCapabilityRef = o['collisionCapabilityRef'] === undefined ? undefined : decodeTypedReference(ctx, o['collisionCapabilityRef'], joinJsonPath(p, 'collisionCapabilityRef'), 'rule');
  const d030PolicyRef = o['d030PolicyRef'] === undefined ? undefined : decodeTypedReference(ctx, o['d030PolicyRef'], joinJsonPath(p, 'd030PolicyRef'), 'policy');
  const adjacencyInteractionComponentId = optionalString(ctx, o['adjacencyInteractionComponentId'], joinJsonPath(p, 'adjacencyInteractionComponentId'));
  const doorTargetInteractionComponentId = optionalString(ctx, o['doorTargetInteractionComponentId'], joinJsonPath(p, 'doorTargetInteractionComponentId'));
  const interiorMicroSceneBoundary = preserveObject(o['interiorMicroSceneBoundary']);
  const destructionDisposition = decodeDestruction(ctx, o['destructionDisposition'], joinJsonPath(p, 'destructionDisposition'));
  return {
    contractKind: 'vehicle',
    entityBacked,
    seatRoles: decodeSeatRoles(ctx, o['seatRoles'], joinJsonPath(p, 'seatRoles')),
    cargoContainers: decodeCargoContainers(ctx, o['cargoContainers'], joinJsonPath(p, 'cargoContainers')),
    doors: decodeDoors(ctx, o['doors'], joinJsonPath(p, 'doors')),
    ...(lockCapabilityRef === undefined ? {} : { lockCapabilityRef }),
    ...(movementCapabilityRef === undefined ? {} : { movementCapabilityRef }),
    ...(collisionCapabilityRef === undefined ? {} : { collisionCapabilityRef }),
    ...(destructionDisposition === undefined ? {} : { destructionDisposition }),
    ...(adjacencyInteractionComponentId === undefined ? {} : { adjacencyInteractionComponentId }),
    ...(doorTargetInteractionComponentId === undefined ? {} : { doorTargetInteractionComponentId }),
    ...(d030PolicyRef === undefined ? {} : { d030PolicyRef }),
    ...(interiorMicroSceneBoundary === undefined ? {} : { interiorMicroSceneBoundary }),
  };
}

function decodeSeatRoles(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const seatRole = requireString(ctx, object['seatRole'], joinJsonPath(ip, 'seatRole'));
    if (seatRole === undefined) {
      continue;
    }
    const capacityField = optionalString(ctx, object['capacityField'], joinJsonPath(ip, 'capacityField'));
    out.push({
      seatRole,
      occupantRequirementRefs: refArray(ctx, object['occupantRequirementRefs'], joinJsonPath(ip, 'occupantRequirementRefs'), 'expr'),
      ...(capacityField === undefined ? {} : { capacityField }),
    });
  }
  return out;
}

function decodeCargoContainers(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const containerId = requireString(ctx, object['containerId'], joinJsonPath(ip, 'containerId'));
    const containerRef = decodeTypedReference(ctx, object['containerRef'], joinJsonPath(ip, 'containerRef'), 'container');
    if (containerId === undefined || containerRef === undefined) {
      continue;
    }
    out.push({ containerId, containerRef });
  }
  return out;
}

function decodeDoors(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const doorId = requireString(ctx, object['doorId'], joinJsonPath(ip, 'doorId'));
    if (doorId === undefined) {
      continue;
    }
    const lockCapabilityRef =
      object['lockCapabilityRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['lockCapabilityRef'], joinJsonPath(ip, 'lockCapabilityRef'), 'rule');
    out.push({
      doorId,
      adjacentSeatRoles: stringArray(ctx, object['adjacentSeatRoles'], joinJsonPath(ip, 'adjacentSeatRoles')),
      ...(lockCapabilityRef === undefined ? {} : { lockCapabilityRef }),
    });
  }
  return out;
}

function decodeDestruction(ctx: DecodeContext, value: unknown, path: string) {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const occupantDispositionRef = decodeTypedReference(ctx, object['occupantDispositionRef'], joinJsonPath(path, 'occupantDispositionRef'), 'rule');
  const cargoDispositionRef = decodeTypedReference(ctx, object['cargoDispositionRef'], joinJsonPath(path, 'cargoDispositionRef'), 'rule');
  if (occupantDispositionRef === undefined || cargoDispositionRef === undefined) {
    return undefined;
  }
  return { occupantDispositionRef, cargoDispositionRef };
}

function decodeDamageContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const damageCategory = requireString(ctx, o['damageCategory'], joinJsonPath(p, 'damageCategory'));
  if (damageCategory === undefined) {
    return undefined;
  }
  const amount = optionalFiniteNumber(ctx, o['amount'], joinJsonPath(p, 'amount'));
  return {
    contractKind: 'damage',
    damageCategory,
    sourceRequirements: decodeActorRequirements(ctx, o['sourceRequirements'], joinJsonPath(p, 'sourceRequirements')),
    targetRequirements: decodeTargetRequirements(ctx, o['targetRequirements'], joinJsonPath(p, 'targetRequirements')),
    settlementPipelineRefs: refArray(ctx, o['settlementPipelineRefs'], joinJsonPath(p, 'settlementPipelineRefs'), 'rule'),
    ...(amount === undefined ? {} : { amount }),
  };
}

function decodeStatusContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const durationMode = requireEnum(ctx, o['durationMode'], joinJsonPath(p, 'durationMode'), STATUS_DURATION_MODES);
  const stackMode = requireEnum(ctx, o['stackMode'], joinJsonPath(p, 'stackMode'), STATUS_STACK_MODES);
  if (durationMode === undefined || stackMode === undefined) {
    return undefined;
  }
  const representsL1RuntimeTransition = optionalBoolean(ctx, o['representsL1RuntimeTransition'], joinJsonPath(p, 'representsL1RuntimeTransition'));
  const reusableGameplaySemantics = optionalBoolean(ctx, o['reusableGameplaySemantics'], joinJsonPath(p, 'reusableGameplaySemantics'));
  const differsOnlyByNameOrValue = optionalBoolean(ctx, o['differsOnlyByNameOrValue'], joinJsonPath(p, 'differsOnlyByNameOrValue'));
  return {
    contractKind: 'status',
    durationMode,
    stackMode,
    triggerRefs: refArray(ctx, o['triggerRefs'], joinJsonPath(p, 'triggerRefs'), 'expr'),
    interruptionRefs: refArray(ctx, o['interruptionRefs'], joinJsonPath(p, 'interruptionRefs'), 'expr'),
    effectRefs: refArray(ctx, o['effectRefs'], joinJsonPath(p, 'effectRefs'), 'effect'),
    interactions: decodeStatusInteractions(ctx, o['interactions'], joinJsonPath(p, 'interactions')),
    ...(representsL1RuntimeTransition === undefined ? {} : { representsL1RuntimeTransition }),
    ...(reusableGameplaySemantics === undefined ? {} : { reusableGameplaySemantics }),
    ...(differsOnlyByNameOrValue === undefined ? {} : { differsOnlyByNameOrValue }),
  };
}

function decodeStatusInteractions(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const interactionId = requireString(ctx, object['interactionId'], joinJsonPath(ip, 'interactionId'));
    const counterpartRef = decodeTypedReference(ctx, object['counterpartRef'], joinJsonPath(ip, 'counterpartRef'), 'status');
    if (interactionId === undefined || counterpartRef === undefined) {
      continue;
    }
    const interactionRuleRef =
      object['interactionRuleRef'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['interactionRuleRef'], joinJsonPath(ip, 'interactionRuleRef'), 'rule');
    out.push({ interactionId, counterpartRef, ...(interactionRuleRef === undefined ? {} : { interactionRuleRef }) });
  }
  return out;
}

function decodeSkillContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const activation = requireEnum(ctx, o['activation'], joinJsonPath(p, 'activation'), SKILL_ACTIVATIONS);
  if (activation === undefined) {
    return undefined;
  }
  const differsOnlyByNameOrValue = optionalBoolean(ctx, o['differsOnlyByNameOrValue'], joinJsonPath(p, 'differsOnlyByNameOrValue'));
  return {
    contractKind: 'skill',
    activation,
    costFields: stringArray(ctx, o['costFields'], joinJsonPath(p, 'costFields')),
    cooldownFields: stringArray(ctx, o['cooldownFields'], joinJsonPath(p, 'cooldownFields')),
    triggerConditionRefs: refArray(ctx, o['triggerConditionRefs'], joinJsonPath(p, 'triggerConditionRefs'), 'expr'),
    effectRefs: refArray(ctx, o['effectRefs'], joinJsonPath(p, 'effectRefs'), 'effect'),
    ...(differsOnlyByNameOrValue === undefined ? {} : { differsOnlyByNameOrValue }),
  };
}

function decodeMovementContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const traversal = requireEnum(ctx, o['traversal'], joinJsonPath(p, 'traversal'), MOVEMENT_TRAVERSALS);
  if (traversal === undefined) {
    return undefined;
  }
  const costField = optionalString(ctx, o['costField'], joinJsonPath(p, 'costField'));
  const speedField = optionalString(ctx, o['speedField'], joinJsonPath(p, 'speedField'));
  const rangeField = optionalString(ctx, o['rangeField'], joinJsonPath(p, 'rangeField'));
  const terrainModifierField = optionalString(ctx, o['terrainModifierField'], joinJsonPath(p, 'terrainModifierField'));
  return {
    contractKind: 'movement',
    traversal,
    collisionEffectRefs: refArray(ctx, o['collisionEffectRefs'], joinJsonPath(p, 'collisionEffectRefs'), 'effect'),
    ...(costField === undefined ? {} : { costField }),
    ...(speedField === undefined ? {} : { speedField }),
    ...(rangeField === undefined ? {} : { rangeField }),
    ...(terrainModifierField === undefined ? {} : { terrainModifierField }),
  };
}

function decodeAttachmentContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const durationMode = requireEnum(ctx, o['durationMode'], joinJsonPath(p, 'durationMode'), STATUS_DURATION_MODES);
  const stackBehavior = requireEnum(ctx, o['stackBehavior'], joinJsonPath(p, 'stackBehavior'), ATTACHMENT_STACK_BEHAVIORS);
  const cleanupBehavior = requireEnum(ctx, o['cleanupBehavior'], joinJsonPath(p, 'cleanupBehavior'), ATTACHMENT_CLEANUP_BEHAVIORS);
  const hostType = decodeExpectedRef(ctx, o['hostType'], joinJsonPath(p, 'hostType'));
  const sourceType = decodeExpectedRef(ctx, o['sourceType'], joinJsonPath(p, 'sourceType'));
  if (
    durationMode === undefined ||
    stackBehavior === undefined ||
    cleanupBehavior === undefined ||
    hostType === undefined ||
    sourceType === undefined
  ) {
    return undefined;
  }
  return {
    contractKind: 'attachment',
    hostType,
    sourceType,
    durationMode,
    stackBehavior,
    cleanupBehavior,
    grantedRuleRefs: refArray(ctx, o['grantedRuleRefs'], joinJsonPath(p, 'grantedRuleRefs'), 'rule'),
  };
}

function decodeExpectedRef(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const allowAbstract = requireBoolean(ctx, object['allowAbstract'], joinJsonPath(path, 'allowAbstract'));
  if (allowAbstract === undefined) {
    return undefined;
  }
  const defKind = optionalString(ctx, object['defKind'], joinJsonPath(path, 'defKind'));
  const semanticFamily = optionalString(ctx, object['semanticFamily'], joinJsonPath(path, 'semanticFamily'));
  return {
    allowAbstract,
    ...(defKind === undefined ? {} : { defKind: defKind as never }),
    ...(semanticFamily === undefined ? {} : { semanticFamily }),
  };
}

function decodeAiBehaviorContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const policyCategory = requireEnum(ctx, o['policyCategory'], joinJsonPath(p, 'policyCategory'), AI_POLICY_CATEGORIES);
  const fallbackStateRef = decodeTypedReference(ctx, o['fallbackStateRef'], joinJsonPath(p, 'fallbackStateRef'), 'rule');
  const neutralFallbackEvaluation = optionalFiniteNumber(ctx, o['neutralFallbackEvaluation'], joinJsonPath(p, 'neutralFallbackEvaluation'));
  if (policyCategory === undefined || fallbackStateRef === undefined || neutralFallbackEvaluation === undefined) {
    return undefined;
  }
  const embeddedGameplayDetails = o['embeddedGameplayDetails'] === undefined ? undefined : stringArray(ctx, o['embeddedGameplayDetails'], joinJsonPath(p, 'embeddedGameplayDetails'));
  const redefinedL1Interfaces = o['redefinedL1Interfaces'] === undefined ? undefined : stringArray(ctx, o['redefinedL1Interfaces'], joinJsonPath(p, 'redefinedL1Interfaces'));
  return {
    contractKind: 'ai-behavior',
    policyCategory,
    states: decodeAiStates(ctx, o['states'], joinJsonPath(p, 'states')),
    transitions: decodeAiTransitions(ctx, o['transitions'], joinJsonPath(p, 'transitions')),
    perceptionParameterSchema: decodeParameterSchema(ctx, o['perceptionParameterSchema'], joinJsonPath(p, 'perceptionParameterSchema')),
    fallbackStateRef,
    requiredActionTags: stringArray(ctx, o['requiredActionTags'], joinJsonPath(p, 'requiredActionTags')),
    requiredActionRefs: refArray(ctx, o['requiredActionRefs'], joinJsonPath(p, 'requiredActionRefs'), 'action'),
    neutralFallbackEvaluation,
    ...(embeddedGameplayDetails === undefined ? {} : { embeddedGameplayDetails }),
    ...(redefinedL1Interfaces === undefined ? {} : { redefinedL1Interfaces }),
  };
}

function decodeAiStates(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const stateName = requireString(ctx, object['stateName'], joinJsonPath(ip, 'stateName'));
    if (stateName === undefined) {
      continue;
    }
    out.push({
      stateName,
      goalRefs: refArray(ctx, object['goalRefs'], joinJsonPath(ip, 'goalRefs'), 'expr'),
      intentRefs: refArray(ctx, object['intentRefs'], joinJsonPath(ip, 'intentRefs'), 'action'),
    });
  }
  return out;
}

function decodeAiTransitions(ctx: DecodeContext, value: unknown, path: string) {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out = [];
  for (let index = 0; index < array.length; index += 1) {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, array[index], ip);
    if (object === undefined) {
      continue;
    }
    const transitionId = requireString(ctx, object['transitionId'], joinJsonPath(ip, 'transitionId'));
    const fromState = requireString(ctx, object['fromState'], joinJsonPath(ip, 'fromState'));
    const toState = requireString(ctx, object['toState'], joinJsonPath(ip, 'toState'));
    const conditionExprRef = decodeTypedReference(ctx, object['conditionExprRef'], joinJsonPath(ip, 'conditionExprRef'), 'expr');
    if (transitionId === undefined || fromState === undefined || toState === undefined || conditionExprRef === undefined) {
      continue;
    }
    out.push({ transitionId, fromState, toState, conditionExprRef });
  }
  return out;
}

function decodeGenericContract(ctx: DecodeContext, o: Record<string, unknown>, p: string): FamilyContract | undefined {
  const familyId = requireString(ctx, o['familyId'], joinJsonPath(p, 'familyId'));
  if (familyId === undefined) {
    return undefined;
  }
  return {
    contractKind: 'generic',
    familyId,
    declaredContractFields: stringArray(ctx, o['declaredContractFields'], joinJsonPath(p, 'declaredContractFields')),
  };
}

const CONTRACT_KINDS = [
  'action',
  'gateway',
  'natural-scene',
  'micro-scene',
  'transition',
  'item',
  'weapon',
  'vehicle',
  'damage',
  'status',
  'skill',
  'movement',
  'attachment',
  'ai-behavior',
  'generic',
] as const;

/**
 * 解码 `familyContract`。缺省返回 undefined（合法：并非所有定义都带专用契约）；
 * 存在但 `contractKind` 未知或字段损坏时报错并返回 undefined。
 */
export function decodeFamilyContract(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): FamilyContract | undefined {
  if (value === undefined) {
    return undefined;
  }
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const contractKind = requireEnum(ctx, object['contractKind'], joinJsonPath(path, 'contractKind'), CONTRACT_KINDS);
  if (contractKind === undefined) {
    return undefined;
  }
  switch (contractKind) {
    case 'action':
      return decodeActionContract(ctx, object, path);
    case 'gateway':
      return decodeGatewayContract(ctx, object, path);
    case 'natural-scene':
      return decodeNaturalSceneContract(ctx, object, path);
    case 'micro-scene':
      return decodeMicroSceneContract(ctx, object, path);
    case 'transition':
      return decodeTransitionContract(ctx, object, path);
    case 'item':
      return decodeItemContract(ctx, object, path);
    case 'weapon':
      return decodeWeaponContract(ctx, object, path);
    case 'vehicle':
      return decodeVehicleContract(ctx, object, path);
    case 'damage':
      return decodeDamageContract(ctx, object, path);
    case 'status':
      return decodeStatusContract(ctx, object, path);
    case 'skill':
      return decodeSkillContract(ctx, object, path);
    case 'movement':
      return decodeMovementContract(ctx, object, path);
    case 'attachment':
      return decodeAttachmentContract(ctx, object, path);
    case 'ai-behavior':
      return decodeAiBehaviorContract(ctx, object, path);
    case 'generic':
      return decodeGenericContract(ctx, object, path);
    default: {
      const exhaustive: never = contractKind;
      return exhaustive;
    }
  }
}
