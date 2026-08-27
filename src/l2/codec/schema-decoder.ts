/**
 * L2 Codec: 参数 Schema 与类型化引用的解码。
 *
 * 对应 Requirements 5.1、12.1–12.2 与 model/schema.ts、model/reference.ts。
 */

import { joinJsonPath } from '../model/ids';
import {
  DECLARED_TYPES,
  PARAMETER_CLASSIFICATIONS,
  GAMEPLAY_VALUE_KINDS,
  type ConstraintReference,
  type DeclaredRange,
  type DeclaredType,
  type ExpectedReferenceType,
  type InternalMetricSchema,
  type ParameterField,
  type ParameterSchema,
} from '../model/schema';
import { isL1DefKind, type L1DefKind } from '../model/def-kind';
import type { JsonValue } from '../model/json';
import { isJsonValue } from '../model/json';
import { REFERENCE_ROLES, type ReferenceRole, type TypedReference } from '../model/reference';
import type { DecodeContext } from './decode';
import {
  optionalArray,
  optionalBoolean,
  optionalFiniteNumber,
  optionalObject,
  optionalString,
  requireArray,
  requireBoolean,
  requireEnum,
  requireObject,
  requireString,
} from './decode';

function decodeRange(ctx: DecodeContext, value: unknown, path: string): DeclaredRange | undefined {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const min = optionalFiniteNumber(ctx, object['min'], joinJsonPath(path, 'min'));
  const max = optionalFiniteNumber(ctx, object['max'], joinJsonPath(path, 'max'));
  const step = optionalFiniteNumber(ctx, object['step'], joinJsonPath(path, 'step'));
  const exclusiveMin = optionalBoolean(ctx, object['exclusiveMin'], joinJsonPath(path, 'exclusiveMin'));
  const exclusiveMax = optionalBoolean(ctx, object['exclusiveMax'], joinJsonPath(path, 'exclusiveMax'));
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(step === undefined ? {} : { step }),
    ...(exclusiveMin === undefined ? {} : { exclusiveMin }),
    ...(exclusiveMax === undefined ? {} : { exclusiveMax }),
  } satisfies DeclaredRange;
}

function decodeExpectedReference(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): ExpectedReferenceType | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const allowAbstract = requireBoolean(ctx, object['allowAbstract'], joinJsonPath(path, 'allowAbstract'));
  if (allowAbstract === undefined) {
    return undefined;
  }
  const defKindRaw = optionalString(ctx, object['defKind'], joinJsonPath(path, 'defKind'));
  const semanticFamily = optionalString(ctx, object['semanticFamily'], joinJsonPath(path, 'semanticFamily'));
  const defKind: L1DefKind | undefined = defKindRaw !== undefined && isL1DefKind(defKindRaw) ? defKindRaw : undefined;
  return {
    allowAbstract,
    ...(defKind === undefined ? {} : { defKind }),
    ...(semanticFamily === undefined ? {} : { semanticFamily }),
  } satisfies ExpectedReferenceType;
}

export function decodeTypedReference(
  ctx: DecodeContext,
  value: unknown,
  path: string,
  defaultRole?: ReferenceRole,
): TypedReference | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const refId = requireString(ctx, object['refId'], joinJsonPath(path, 'refId'));
  const roleRaw = optionalString(ctx, object['role'], joinJsonPath(path, 'role'));
  const role: ReferenceRole | undefined = roleRaw ?? defaultRole;
  const expected = decodeExpectedReference(ctx, object['expected'], joinJsonPath(path, 'expected'));
  const required = requireBoolean(ctx, object['required'], joinJsonPath(path, 'required'));
  if (refId === undefined || role === undefined || expected === undefined || required === undefined) {
    return undefined;
  }
  return {
    refId,
    role,
    expected,
    required,
    jsonPath: path,
  } satisfies TypedReference;
}

/** 允许角色缺省地解码引用数组（用于 actionRefs/ruleRefs 等已知角色列表）。 */
export function decodeTypedReferenceArray(
  ctx: DecodeContext,
  value: unknown,
  path: string,
  defaultRole: ReferenceRole,
): readonly TypedReference[] {
  const array = optionalArray(ctx, value, path);
  if (array === undefined) {
    return [];
  }
  const result: TypedReference[] = [];
  array.forEach((element, index) => {
    const reference = decodeTypedReference(ctx, element, joinJsonPath(path, index), defaultRole);
    if (reference !== undefined) {
      result.push(reference);
    }
  });
  return result;
}

export const KNOWN_REFERENCE_ROLES: ReadonlySet<string> = new Set(REFERENCE_ROLES);
export const KNOWN_DECLARED_TYPES: ReadonlySet<string> = new Set(DECLARED_TYPES);

function decodeInternalMetricSchema(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): InternalMetricSchema | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const metric = requireString(ctx, object['metric'], joinJsonPath(path, 'metric'));
  const integral = requireBoolean(ctx, object['integral'], joinJsonPath(path, 'integral'));
  if (metric === undefined || integral === undefined) {
    return undefined;
  }
  const range = decodeRange(ctx, object['range'], joinJsonPath(path, 'range'));
  return {
    metric,
    integral,
    ...(range === undefined ? {} : { range }),
  } satisfies InternalMetricSchema;
}

export function decodeParameterField(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): ParameterField | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const name = requireString(ctx, object['name'], joinJsonPath(path, 'name'));
  const dataType = requireEnum<DeclaredType>(ctx, object['dataType'], joinJsonPath(path, 'dataType'), DECLARED_TYPES);
  const required = requireBoolean(ctx, object['required'], joinJsonPath(path, 'required'));
  const classification = requireEnum(
    ctx,
    object['classification'],
    joinJsonPath(path, 'classification'),
    PARAMETER_CLASSIFICATIONS,
  );
  if (name === undefined || dataType === undefined || required === undefined || classification === undefined) {
    return undefined;
  }

  const unit = optionalString(ctx, object['unit'], joinJsonPath(path, 'unit'));
  const structuralRationale = optionalString(ctx, object['structuralRationale'], joinJsonPath(path, 'structuralRationale'));
  const owningLayer = optionalString(ctx, object['owningLayer'], joinJsonPath(path, 'owningLayer'));
  const gameplayValueKind = requireEnumOptional(ctx, object['gameplayValueKind'], joinJsonPath(path, 'gameplayValueKind'), GAMEPLAY_VALUE_KINDS);
  const playerVisible = optionalBoolean(ctx, object['playerVisible'], joinJsonPath(path, 'playerVisible'));
  const description = optionalString(ctx, object['description'], joinJsonPath(path, 'description'));
  const range = decodeRange(ctx, object['range'], joinJsonPath(path, 'range'));
  const referenceTarget =
    object['referenceTarget'] === undefined
      ? undefined
      : decodeExpectedReference(ctx, object['referenceTarget'], joinJsonPath(path, 'referenceTarget'));
  const internalMetricSchema =
    object['internalMetricSchema'] === undefined
      ? undefined
      : decodeInternalMetricSchema(ctx, object['internalMetricSchema'], joinJsonPath(path, 'internalMetricSchema'));

  let enumValues: readonly string[] | undefined;
  if (object['enumValues'] !== undefined) {
    const raw = requireArray(ctx, object['enumValues'], joinJsonPath(path, 'enumValues'));
    if (raw !== undefined) {
      const values: string[] = [];
      raw.forEach((element, index) => {
        const item = requireString(ctx, element, joinJsonPath(joinJsonPath(path, 'enumValues'), index));
        if (item !== undefined) {
          values.push(item);
        }
      });
      enumValues = values;
    }
  }

  let itemType: DeclaredType | undefined;
  if (object['itemType'] !== undefined) {
    itemType = requireEnum<DeclaredType>(ctx, object['itemType'], joinJsonPath(path, 'itemType'), DECLARED_TYPES);
  }

  let objectFields: readonly ParameterField[] | undefined;
  if (object['objectFields'] !== undefined) {
    const raw = requireArray(ctx, object['objectFields'], joinJsonPath(path, 'objectFields'));
    if (raw !== undefined) {
      const fields: ParameterField[] = [];
      raw.forEach((element, index) => {
        const field = decodeParameterField(ctx, element, joinJsonPath(joinJsonPath(path, 'objectFields'), index));
        if (field !== undefined) {
          fields.push(field);
        }
      });
      objectFields = fields;
    }
  }

  let defaultValue: JsonValue | undefined;
  if (object['defaultValue'] !== undefined) {
    if (isJsonValue(object['defaultValue'])) {
      defaultValue = object['defaultValue'] as JsonValue;
    }
  }

  return {
    name,
    dataType,
    required,
    classification,
    ...(unit === undefined ? {} : { unit }),
    ...(range === undefined ? {} : { range }),
    ...(referenceTarget === undefined ? {} : { referenceTarget }),
    ...(structuralRationale === undefined ? {} : { structuralRationale }),
    ...(owningLayer === undefined ? {} : { owningLayer: owningLayer as ParameterField['owningLayer'] }),
    ...(gameplayValueKind === undefined ? {} : { gameplayValueKind }),
    ...(playerVisible === undefined ? {} : { playerVisible }),
    ...(description === undefined ? {} : { description }),
    ...(enumValues === undefined ? {} : { enumValues }),
    ...(itemType === undefined ? {} : { itemType }),
    ...(objectFields === undefined ? {} : { objectFields }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(internalMetricSchema === undefined ? {} : { internalMetricSchema }),
  } satisfies ParameterField;
}

function requireEnumOptional<T extends string>(
  ctx: DecodeContext,
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireEnum(ctx, value, path, allowed);
}

function decodeConstraint(ctx: DecodeContext, value: unknown, path: string): ConstraintReference | undefined {
  const object = requireObject(ctx, value, path);
  if (object === undefined) {
    return undefined;
  }
  const constraintId = requireString(ctx, object['constraintId'], joinJsonPath(path, 'constraintId'));
  const reason = requireString(ctx, object['reason'], joinJsonPath(path, 'reason'));
  const fieldsRaw = requireArray(ctx, object['fields'], joinJsonPath(path, 'fields'));
  if (constraintId === undefined || reason === undefined || fieldsRaw === undefined) {
    return undefined;
  }
  const fields: string[] = [];
  fieldsRaw.forEach((element, index) => {
    const field = requireString(ctx, element, joinJsonPath(joinJsonPath(path, 'fields'), index));
    if (field !== undefined) {
      fields.push(field);
    }
  });
  const exprRef = optionalString(ctx, object['exprRef'], joinJsonPath(path, 'exprRef'));
  return {
    constraintId,
    reason,
    fields,
    ...(exprRef === undefined ? {} : { exprRef }),
  } satisfies ConstraintReference;
}

export function decodeParameterSchema(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): ParameterSchema {
  const object = optionalObject(ctx, value, path);
  if (object === undefined) {
    return { fields: [], crossFieldConstraints: [] };
  }
  const fields: ParameterField[] = [];
  const rawFields = optionalArray(ctx, object['fields'], joinJsonPath(path, 'fields'));
  if (rawFields !== undefined) {
    rawFields.forEach((element, index) => {
      const field = decodeParameterField(ctx, element, joinJsonPath(joinJsonPath(path, 'fields'), index));
      if (field !== undefined) {
        fields.push(field);
      }
    });
  }
  const constraints: ConstraintReference[] = [];
  const rawConstraints = optionalArray(ctx, object['crossFieldConstraints'], joinJsonPath(path, 'crossFieldConstraints'));
  if (rawConstraints !== undefined) {
    rawConstraints.forEach((element, index) => {
      const constraint = decodeConstraint(
        ctx,
        element,
        joinJsonPath(joinJsonPath(path, 'crossFieldConstraints'), index),
      );
      if (constraint !== undefined) {
        constraints.push(constraint);
      }
    });
  }
  return { fields, crossFieldConstraints: constraints };
}
