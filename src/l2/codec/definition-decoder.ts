/**
 * L2 Codec: 候选定义与定义包解码。
 *
 * 对应 Requirements 3、4、11、12 与 model/definition.ts。
 * 把声明式 JSON 对象解码为强类型 `CandidateDefinition` / `DefinitionPackage`，
 * 语义缺失/损坏报错，可选字段缺失静默跳过，表现字段损坏降级为 Warning。
 */

import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids';
import type { JsonValue } from '../model/json';
import { isJsonValue } from '../model/json';
import { isL1DefKind, type L1DefKind, L1_EXCLUSIVE_MECHANISMS, type L1ExclusiveMechanism } from '../model/def-kind';
import {
  EMPTY_TYPE_IDENTITY,
  FIELD_MERGE_STRATEGIES,
  type CompositionComponent,
  type DefinitionReference,
  type FieldMergeRule,
  type TypeIdentity,
} from '../model/reference';
import type {
  BaseDefinition,
  CandidateDefinition,
  ChildLifecycleOperation,
  DefinitionPackage,
  GameplaySpecificRule,
  OverrideIntent,
  PackageDependency,
  PresentationMetadata,
  RemovalIntent,
  SemanticFamilyReference,
} from '../model/definition';
import {
  CHILD_LIFECYCLE_OPERATIONS,
  GAMEPLAY_SPECIFIC_RULE_KINDS,
} from '../model/definition';
import type { GameplayValueAssignment } from '../model/schema';
import type { DecodeContext } from './decode';
import {
  createDecodeContext,
  optionalArray,
  optionalObject,
  optionalString,
  pushPresentationFallback,
  requireArray,
  requireBoolean,
  requireEnum,
  requireObject,
  requireString,
} from './decode';
import { decodeParameterSchema, decodeTypedReference, decodeTypedReferenceArray } from './schema-decoder';
import { decodeFamilyContract } from './family-decoder';
import type { JsonNode } from './json-scanner';
import type { SourceLocation, SourceRecord } from '../model/source';
import {
  OWNING_LAYERS,
  SOURCE_CLASSIFICATION_KINDS,
  SOURCE_PRECEDENCE_ORDER,
} from '../model/source';

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

function decodeTypeIdentity(ctx: DecodeContext, value: unknown, path: string): TypeIdentity {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return EMPTY_TYPE_IDENTITY;
  }
  return {
    requiredCapabilities: stringArray(ctx, object['requiredCapabilities'], joinJsonPath(path, 'requiredCapabilities')),
    legalRelationships: stringArray(ctx, object['legalRelationships'], joinJsonPath(path, 'legalRelationships')),
    invariants: stringArray(ctx, object['invariants'], joinJsonPath(path, 'invariants')),
    substitutionCompatibility: stringArray(ctx, object['substitutionCompatibility'], joinJsonPath(path, 'substitutionCompatibility')),
  };
}

function decodeExtends(ctx: DecodeContext, value: unknown, path: string): readonly DefinitionReference[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: DefinitionReference[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const refId = requireString(ctx, object['refId'], joinJsonPath(ip, 'refId'));
    if (refId !== undefined) {
      out.push({ refId, jsonPath: ip });
    }
  });
  return out;
}

function decodeComposition(ctx: DecodeContext, value: unknown, path: string): readonly CompositionComponent[] {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out: CompositionComponent[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const componentId = requireString(ctx, object['componentId'], joinJsonPath(ip, 'componentId'));
    const role = requireString(ctx, object['role'], joinJsonPath(ip, 'role'));
    const optional = requireBoolean(ctx, object['optional'], joinJsonPath(ip, 'optional'));
    const typeDefining = requireBoolean(ctx, object['typeDefining'], joinJsonPath(ip, 'typeDefining'));
    if (componentId === undefined || role === undefined || optional === undefined || typeDefining === undefined) {
      return;
    }
    const target =
      object['target'] === undefined
        ? undefined
        : decodeTypedReference(ctx, object['target'], joinJsonPath(ip, 'target'), role);
    const parameters =
      object['parameters'] === undefined
        ? undefined
        : decodeParameterSchema(ctx, object['parameters'], joinJsonPath(ip, 'parameters'));
    const reason = optionalString(ctx, object['reason'], joinJsonPath(ip, 'reason'));
    out.push({
      componentId,
      role,
      optional,
      typeDefining,
      dependsOn: stringArray(ctx, object['dependsOn'], joinJsonPath(ip, 'dependsOn')),
      ...(target === undefined ? {} : { target }),
      ...(parameters === undefined ? {} : { parameters }),
      ...(reason === undefined ? {} : { reason }),
    });
  });
  return out;
}

function decodeMergeRules(ctx: DecodeContext, value: unknown, path: string): readonly FieldMergeRule[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: FieldMergeRule[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const field = requireString(ctx, object['field'], joinJsonPath(ip, 'field'));
    const strategy = requireEnum(ctx, object['strategy'], joinJsonPath(ip, 'strategy'), FIELD_MERGE_STRATEGIES);
    const reason = requireString(ctx, object['reason'], joinJsonPath(ip, 'reason'));
    if (field === undefined || strategy === undefined || reason === undefined) {
      return;
    }
    out.push({
      field,
      strategy,
      reason,
      precedence: stringArray(ctx, object['precedence'], joinJsonPath(ip, 'precedence')),
    });
  });
  return out;
}

function decodeSemanticFamilyReference(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): SemanticFamilyReference | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const familyId = requireString(ctx, object['familyId'], joinJsonPath(path, 'familyId'));
  if (familyId === undefined) {
    return undefined;
  }
  const registration =
    object['registration'] === undefined
      ? undefined
      : decodeFamilyRegistration(ctx, object['registration'], joinJsonPath(path, 'registration'));
  return {
    familyId,
    ...(registration === undefined ? {} : { registration }),
  };
}

function decodeFamilyRegistration(ctx: DecodeContext, value: unknown, path: string) {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const familyId = requireString(ctx, object['familyId'], joinJsonPath(path, 'familyId'));
  const classificationReason = requireString(ctx, object['classificationReason'], joinJsonPath(path, 'classificationReason'));
  const eligibilityObject = requireObject(ctx, object['eligibility'], joinJsonPath(path, 'eligibility'));
  if (familyId === undefined || classificationReason === undefined || eligibilityObject === undefined) {
    return undefined;
  }
  const ep = joinJsonPath(path, 'eligibility');
  const conceptId = requireString(ctx, eligibilityObject['conceptId'], joinJsonPath(ep, 'conceptId'));
  const enumerable = requireBoolean(ctx, eligibilityObject['enumerable'], joinJsonPath(ep, 'enumerable'));
  const composable = requireBoolean(ctx, eligibilityObject['composable'], joinJsonPath(ep, 'composable'));
  const gameplayIndependent = requireBoolean(ctx, eligibilityObject['gameplayIndependent'], joinJsonPath(ep, 'gameplayIndependent'));
  const enumerationRationale = requireString(ctx, eligibilityObject['enumerationRationale'], joinJsonPath(ep, 'enumerationRationale'));
  const compositionRationale = requireString(ctx, eligibilityObject['compositionRationale'], joinJsonPath(ep, 'compositionRationale'));
  const independenceRationale = requireString(ctx, eligibilityObject['independenceRationale'], joinJsonPath(ep, 'independenceRationale'));
  if (
    conceptId === undefined ||
    enumerable === undefined ||
    composable === undefined ||
    gameplayIndependent === undefined ||
    enumerationRationale === undefined ||
    compositionRationale === undefined ||
    independenceRationale === undefined
  ) {
    return undefined;
  }
  const sources = decodeSourceRecordArray(ctx, eligibilityObject['sources'], joinJsonPath(ep, 'sources'));
  return {
    familyId,
    classificationReason,
    eligibility: {
      conceptId,
      enumerable,
      composable,
      gameplayIndependent,
      enumerationRationale,
      compositionRationale,
      independenceRationale,
      sources,
    },
    sourceRecords: decodeSourceRecordArray(ctx, object['sourceRecords'], joinJsonPath(path, 'sourceRecords')),
  };
}

export function decodeSourceRecord(ctx: DecodeContext, value: unknown, path: string): SourceRecord | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const sourceFile = requireString(ctx, object['sourceFile'], joinJsonPath(path, 'sourceFile'));
  const precedence = requireEnum(ctx, object['precedence'], joinJsonPath(path, 'precedence'), SOURCE_PRECEDENCE_ORDER);
  const classification = requireEnum(ctx, object['classification'], joinJsonPath(path, 'classification'), SOURCE_CLASSIFICATION_KINDS);
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
  return {
    sourceFile,
    sourceLocation: { sourceFile, section },
    precedence,
    classification,
    owningLayer,
    statementFingerprint,
    ...(decisionId === undefined ? {} : { decisionId }),
  };
}

function decodeSourceRecordArray(ctx: DecodeContext, value: unknown, path: string): readonly SourceRecord[] {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out: SourceRecord[] = [];
  array.forEach((element, index) => {
    const record = decodeSourceRecord(ctx, element, joinJsonPath(path, index));
    if (record !== undefined) {
      out.push(record);
    }
  });
  return out;
}

/** 表现元数据：字段损坏只降级为 Warning，不阻止装载（Requirements 11.11、14.9）。 */
function decodePresentation(ctx: DecodeContext, value: unknown, path: string): PresentationMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    pushPresentationFallback(ctx, path, '表现元数据不是对象，已忽略并使用默认展示。');
    return undefined;
  }
  const object = value as Record<string, unknown>;
  const readText = (key: string): string | undefined => {
    const raw = object[key];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== 'string') {
      pushPresentationFallback(ctx, joinJsonPath(path, key), `表现字段 ${key} 类型不符，已回退为缺省。`);
      return undefined;
    }
    return raw;
  };
  const displayName = readText('displayName');
  const iconRef = readText('iconRef');
  const accessibleLabel = readText('accessibleLabel');
  const animationRef = readText('animationRef');
  const description = readText('description');
  let assetRefs: readonly string[] | undefined;
  if (object['assetRefs'] !== undefined) {
    if (Array.isArray(object['assetRefs'])) {
      assetRefs = (object['assetRefs'] as unknown[]).filter((element): element is string => typeof element === 'string');
    } else {
      pushPresentationFallback(ctx, joinJsonPath(path, 'assetRefs'), '表现字段 assetRefs 不是数组，已回退为空。');
    }
  }
  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(iconRef === undefined ? {} : { iconRef }),
    ...(accessibleLabel === undefined ? {} : { accessibleLabel }),
    ...(animationRef === undefined ? {} : { animationRef }),
    ...(description === undefined ? {} : { description }),
    ...(assetRefs === undefined ? {} : { assetRefs }),
  };
}

function decodeGameplayValues(ctx: DecodeContext, value: unknown, path: string): readonly GameplayValueAssignment[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: GameplayValueAssignment[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const field = requireString(ctx, object['field'], joinJsonPath(ip, 'field'));
    const playerVisible = requireBoolean(ctx, object['playerVisible'], joinJsonPath(ip, 'playerVisible'));
    const owningProfile = requireString(ctx, object['owningProfile'], joinJsonPath(ip, 'owningProfile'));
    if (field === undefined || playerVisible === undefined || owningProfile === undefined) {
      return;
    }
    const rawValue = object['value'];
    const gameplayValue: JsonValue = rawValue !== undefined && isJsonValue(rawValue) ? (rawValue as JsonValue) : null;
    out.push({ field, value: gameplayValue, playerVisible, owningProfile });
  });
  return out;
}

function decodeGameplayRules(ctx: DecodeContext, value: unknown, path: string): readonly GameplaySpecificRule[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: GameplaySpecificRule[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const kind = requireEnum(ctx, object['kind'], joinJsonPath(ip, 'kind'), GAMEPLAY_SPECIFIC_RULE_KINDS);
    const detail = requireString(ctx, object['detail'], joinJsonPath(ip, 'detail'));
    if (kind === undefined || detail === undefined) {
      return;
    }
    const jsonPath = optionalString(ctx, object['jsonPath'], joinJsonPath(ip, 'jsonPath'));
    out.push({ kind, detail, ...(jsonPath === undefined ? {} : { jsonPath }) });
  });
  return out;
}

function decodeDeclaredMechanisms(ctx: DecodeContext, value: unknown, path: string): readonly L1ExclusiveMechanism[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: L1ExclusiveMechanism[] = [];
  array.forEach((element, index) => {
    const item = requireEnum(ctx, element, joinJsonPath(path, index), L1_EXCLUSIVE_MECHANISMS);
    if (item !== undefined) {
      out.push(item);
    }
  });
  return out;
}

/** 解码一个候选定义。`baseLocation` 提供来源文件基线。 */
export function decodeDefinition(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): CandidateDefinition | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }

  const id = requireString(ctx, object['id'], joinJsonPath(path, 'id'));
  // 在解码后续字段前把 definitionId 挂到上下文，使字段级诊断能定位到定义。
  const previousDefinitionId = ctx.definitionId;
  if (id !== undefined) {
    ctx.definitionId = id;
  }

  const defKindRaw = requireString(ctx, object['defKind'], joinJsonPath(path, 'defKind'));
  const abstract = requireBoolean(ctx, object['abstract'], joinJsonPath(path, 'abstract'));
  const semanticFamily = decodeSemanticFamilyReference(ctx, object['semanticFamily'], joinJsonPath(path, 'semanticFamily'));

  let defKind: L1DefKind | undefined;
  if (defKindRaw !== undefined) {
    if (isL1DefKind(defKindRaw)) {
      defKind = defKindRaw;
    } else {
      // Def kind 越界属于语义损坏；由验证器 4.2 报 DEF_INVALID_DEF_KIND，这里保留原值供其定位。
      defKind = undefined;
    }
  }

  if (id === undefined || defKindRaw === undefined || abstract === undefined || semanticFamily === undefined) {
    ctx.definitionId = previousDefinitionId;
    return undefined;
  }

  const location: SourceLocation = { ...ctx.baseLocation };
  const familyContract = decodeFamilyContract(ctx, object['familyContract'], joinJsonPath(path, 'familyContract'));
  const extendsRefs = decodeExtends(ctx, object['extends'], joinJsonPath(path, 'extends'));
  const mergeRules = decodeMergeRules(ctx, object['mergeRules'], joinJsonPath(path, 'mergeRules'));
  const presentation = decodePresentation(ctx, object['presentation'], joinJsonPath(path, 'presentation'));
  const gameplayValues = decodeGameplayValues(ctx, object['gameplayValues'], joinJsonPath(path, 'gameplayValues'));
  const gameplaySpecificRules = decodeGameplayRules(ctx, object['gameplaySpecificRules'], joinJsonPath(path, 'gameplaySpecificRules'));
  const declaredL1Mechanisms = decodeDeclaredMechanisms(ctx, object['declaredL1Mechanisms'], joinJsonPath(path, 'declaredL1Mechanisms'));
  const otherRefs = decodeTypedReferenceArray(ctx, object['otherRefs'], joinJsonPath(path, 'otherRefs'), 'base');

  const definition: BaseDefinition = {
    id,
    // defKind 越界时用原值占位，交给验证器诊断（类型断言仅此一处，理由如上）。
    defKind: (defKind ?? (defKindRaw as L1DefKind)),
    abstract,
    semanticFamily,
    typeIdentity: decodeTypeIdentity(ctx, object['typeIdentity'], joinJsonPath(path, 'typeIdentity')),
    composition: decodeComposition(ctx, object['composition'], joinJsonPath(path, 'composition')),
    parameterSchema: decodeParameterSchema(ctx, object['parameterSchema'], joinJsonPath(path, 'parameterSchema')),
    tags: stringArray(ctx, object['tags'], joinJsonPath(path, 'tags')),
    actionRefs: decodeTypedReferenceArray(ctx, object['actionRefs'], joinJsonPath(path, 'actionRefs'), 'action'),
    ruleRefs: decodeTypedReferenceArray(ctx, object['ruleRefs'], joinJsonPath(path, 'ruleRefs'), 'rule'),
    sourceRecords: decodeSourceRecordArray(ctx, object['sourceRecords'], joinJsonPath(path, 'sourceRecords')),
    otherRefs,
    sourceLocation: location,
    jsonPath: path,
    ...(extendsRefs === undefined ? {} : { extends: extendsRefs }),
    ...(familyContract === undefined ? {} : { familyContract }),
    ...(mergeRules === undefined ? {} : { mergeRules }),
    ...(presentation === undefined ? {} : { presentation }),
    ...(gameplayValues === undefined ? {} : { gameplayValues }),
    ...(gameplaySpecificRules === undefined ? {} : { gameplaySpecificRules }),
    ...(declaredL1Mechanisms === undefined ? {} : { declaredL1Mechanisms }),
  };

  ctx.definitionId = previousDefinitionId;
  return definition;
}

function decodeDependencies(ctx: DecodeContext, value: unknown, path: string): readonly PackageDependency[] {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const out: PackageDependency[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const packageId = requireString(ctx, object['packageId'], joinJsonPath(ip, 'packageId'));
    if (packageId === undefined) {
      return;
    }
    const versionConstraint = optionalString(ctx, object['versionConstraint'], joinJsonPath(ip, 'versionConstraint'));
    out.push({ packageId, ...(versionConstraint === undefined ? {} : { versionConstraint }) });
  });
  return out;
}

function decodeOverrideIntents(ctx: DecodeContext, value: unknown, path: string): readonly OverrideIntent[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: OverrideIntent[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const targetId = requireString(ctx, object['targetId'], joinJsonPath(ip, 'targetId'));
    const reason = requireString(ctx, object['reason'], joinJsonPath(ip, 'reason'));
    if (targetId === undefined || reason === undefined) {
      return;
    }
    out.push({ targetId, reason });
  });
  return out;
}

function decodeChildLifecycleOperation(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): ChildLifecycleOperation | undefined {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const kind = requireEnum(ctx, object['kind'], joinJsonPath(path, 'kind'), CHILD_LIFECYCLE_OPERATIONS);
  if (kind === undefined) {
    return undefined;
  }
  const newParentId = optionalString(ctx, object['newParentId'], joinJsonPath(path, 'newParentId'));
  return { kind, ...(newParentId === undefined ? {} : { newParentId }) };
}

function decodeRemovals(ctx: DecodeContext, value: unknown, path: string): readonly RemovalIntent[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = requireArray(ctx, value, path);
  if (array === undefined) {
    return undefined;
  }
  const out: RemovalIntent[] = [];
  array.forEach((element, index) => {
    const ip = joinJsonPath(path, index);
    const object = requireObject(ctx, element, ip);
    if (object === undefined) {
      return;
    }
    const targetId = requireString(ctx, object['targetId'], joinJsonPath(ip, 'targetId'));
    const reason = requireString(ctx, object['reason'], joinJsonPath(ip, 'reason'));
    if (targetId === undefined || reason === undefined) {
      return;
    }
    const childLifecycleOperation = decodeChildLifecycleOperation(ctx, object['childLifecycleOperation'], joinJsonPath(ip, 'childLifecycleOperation'));
    out.push({
      targetId,
      reason,
      ...(childLifecycleOperation === undefined ? {} : { childLifecycleOperation }),
    });
  });
  return out;
}

/**
 * 解码定义包。
 * `schemaVersion` 缺失由调用方（json-codec）在解析阶段已校验；此处仍容错读取。
 */
export function decodePackage(
  ctx: DecodeContext,
  root: JsonNode,
  object: Record<string, unknown>,
): DefinitionPackage | undefined {
  const packageId = requireString(ctx, object['packageId'], joinJsonPath(ROOT_JSON_PATH, 'packageId'));
  const schemaVersion = requireString(ctx, object['schemaVersion'], joinJsonPath(ROOT_JSON_PATH, 'schemaVersion'));
  if (packageId === undefined || schemaVersion === undefined) {
    return undefined;
  }
  ctx.definitionId = undefined;

  const definitionsRaw = requireArray(ctx, object['definitions'], joinJsonPath(ROOT_JSON_PATH, 'definitions'));
  const definitions: CandidateDefinition[] = [];
  if (definitionsRaw !== undefined) {
    definitionsRaw.forEach((element, index) => {
      const definition = decodeDefinition(ctx, element, joinJsonPath(joinJsonPath(ROOT_JSON_PATH, 'definitions'), index));
      if (definition !== undefined) {
        definitions.push(definition);
      }
    });
  }

  const overrideIntent = decodeOverrideIntents(ctx, object['overrideIntent'], joinJsonPath(ROOT_JSON_PATH, 'overrideIntent'));
  const removals = decodeRemovals(ctx, object['removals'], joinJsonPath(ROOT_JSON_PATH, 'removals'));

  return {
    packageId,
    schemaVersion,
    dependencies: decodeDependencies(ctx, object['dependencies'], joinJsonPath(ROOT_JSON_PATH, 'dependencies')),
    sourceRecords: decodeSourceRecordArray(ctx, object['sourceRecords'], joinJsonPath(ROOT_JSON_PATH, 'sourceRecords')),
    definitions,
    ...(overrideIntent === undefined ? {} : { overrideIntent }),
    ...(removals === undefined ? {} : { removals }),
  };
}

export { createDecodeContext };
