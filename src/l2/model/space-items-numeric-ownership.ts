/**
 * 基类层 · 空间与物品领域：数值归属四分类、1–5 值域与内部度量标注。
 *
 * 对应要求 2.1–2.8 与 design.md「数值归属」「逐字段数值归属分类」。
 *
 * 本模块是**纯函数模块**：不 import `OpRegistry`、事务、`OpContext`，不持有任何世界状态。
 * 判定纪律：
 * - 分类缺失或冲突 → `classification-missing` / `conflicting-classification`。
 * - `Gameplay_Value` 且玩家可见 → 必须为 1–5 的有限整数，且不得出现在基类字段默认值上。
 * - `Gameplay_Value` 且非玩家可见 → 必须携带权威来源说明豁免依据，否则与
 *   「用 playerVisible:false 绕过 1–5」不可区分。
 * - `Internal_Metric` → 按自身 Schema 校验，不套用 1–5；缺显式标注的数值不得以"内部"为由豁免。
 */

import type { HumanReadableText } from './ids';
import { joinJsonPath } from './ids';
import type { OwningLayer, SourceRecord } from './source';
import type { DeclaredRange, ParameterField } from './schema';
import { NUMERIC_DECLARED_TYPES } from './schema';
import { GAMEPLAY_VALUE_RANGE } from './constitution';
import { compareStrings } from './ordering';
import { deepFreeze } from './immutable';

/** 数值归属四分类。与 `./schema.ts` 的 `ParameterClassification` 同取值。 */
export const NUMERIC_OWNERSHIPS = Object.freeze([
  'Gameplay_Value',
  'Structural_Bound',
  'Constitutional_Constant',
  'Internal_Metric',
] as const);

export type NumericOwnership = (typeof NUMERIC_OWNERSHIPS)[number];

export function isNumericOwnership(value: unknown): value is NumericOwnership {
  return typeof value === 'string' && (NUMERIC_OWNERSHIPS as readonly string[]).includes(value);
}

/** 一个数值字段的归属分类（要求 2.1）。 */
export interface NumericFieldClassification {
  readonly fieldPath: string;
  readonly ownership: NumericOwnership;
  readonly unit: string;
  readonly owningLayer: OwningLayer;
  readonly playerVisible: boolean;
  readonly declaredRange?: DeclaredRange;
  readonly authoritativeSources: readonly SourceRecord[];
  readonly structuralRationale?: HumanReadableText;
  /** `Internal_Metric` 必须携带显式度量标注。 */
  readonly internalMetric?: string;
}

/** 分类失败原因（映射到诊断条件标识）。 */
export const CLASSIFICATION_FAILURES = Object.freeze([
  'classification-missing',
  'conflicting-classification',
  'unlabeled-internal-metric',
  'gameplay-value-missing-visibility',
  'gameplay-value-missing-exemption-source',
  'structural-bound-missing-source',
  'structural-bound-missing-rationale',
  'constitutional-constant-missing-layer',
] as const);

export type ClassificationFailure = (typeof CLASSIFICATION_FAILURES)[number];

export interface ClassificationOutcome {
  readonly fieldPath: string;
  readonly classification?: NumericFieldClassification;
  readonly failures: readonly ClassificationFailure[];
}

/**
 * JSON/UGC 输入在完成 Schema 校验前可能缺少分类，或错误地提供多个分类。
 * 这里显式接收该运行时形状，避免通过 `as ParameterField` 掩盖冲突输入。
 */
export type NumericFieldCandidate = Omit<ParameterField, 'classification'> & {
  readonly classification?: unknown;
};

function resolveOwnership(value: unknown): {
  readonly ownership?: NumericOwnership;
  readonly failure?: 'classification-missing' | 'conflicting-classification';
} {
  if (Array.isArray(value)) {
    const valid = [...new Set(value.filter(isNumericOwnership))];
    if (valid.length > 1) {
      return { failure: 'conflicting-classification' };
    }
    if (valid.length === 1 && value.length === 1) {
      return { ownership: valid[0] };
    }
    return { failure: 'classification-missing' };
  }
  return isNumericOwnership(value)
    ? { ownership: value }
    : { failure: 'classification-missing' };
}

/**
 * 对单个数值参数字段做归属分类判定。非数值字段不进入本领域判定。
 */
export function classifyNumericField(
  field: NumericFieldCandidate,
  fieldPath: string,
): ClassificationOutcome {
  if (!NUMERIC_DECLARED_TYPES.has(field.dataType)) {
    return { fieldPath, failures: Object.freeze([]) };
  }

  const resolved = resolveOwnership(field.classification);
  if (resolved.ownership === undefined) {
    return {
      fieldPath,
      failures: Object.freeze([resolved.failure ?? 'classification-missing']),
    };
  }

  const ownership = resolved.ownership;
  const failures: ClassificationFailure[] = [];
  if (ownership === 'Gameplay_Value') {
    if (typeof field.playerVisible !== 'boolean') {
      failures.push('gameplay-value-missing-visibility');
    } else if (field.playerVisible === false && field.authoritativeSource === undefined) {
      failures.push('gameplay-value-missing-exemption-source');
    }
  }
  if (ownership === 'Structural_Bound') {
    if (field.authoritativeSource === undefined) {
      failures.push('structural-bound-missing-source');
    }
    if (field.structuralRationale === undefined || field.structuralRationale.trim().length === 0) {
      failures.push('structural-bound-missing-rationale');
    }
  }
  if (ownership === 'Constitutional_Constant') {
    if (field.authoritativeSource === undefined) {
      failures.push('structural-bound-missing-source');
    }
    if (field.owningLayer === undefined) {
      failures.push('constitutional-constant-missing-layer');
    }
  }
  if (ownership === 'Internal_Metric' && field.internalMetricSchema === undefined) {
    failures.push('unlabeled-internal-metric');
  }

  if (failures.length > 0) {
    return { fieldPath, failures: Object.freeze(failures.slice()) };
  }

  const classification = deepFreeze({
    fieldPath,
    ownership,
    unit: field.unit ?? 'dimensionless',
    owningLayer: field.owningLayer ?? (ownership === 'Gameplay_Value' ? '玩法层' : '基类层'),
    playerVisible: field.playerVisible ?? false,
    authoritativeSources:
      field.authoritativeSource === undefined ? [] : [field.authoritativeSource],
    ...(field.range === undefined ? {} : { declaredRange: field.range }),
    ...(field.structuralRationale === undefined
      ? {}
      : { structuralRationale: field.structuralRationale }),
    ...(field.internalMetricSchema === undefined
      ? {}
      : { internalMetric: field.internalMetricSchema.metric }),
  }) as NumericFieldClassification;
  return { fieldPath, classification, failures: Object.freeze([]) };
}

/** 玩家可见玩法数值的取值判定结果。 */
export interface GameplayValueVerdict {
  readonly acceptable: boolean;
  readonly reason?:
    | 'not-finite'
    | 'not-integer'
    | 'out-of-range'
    | 'not-gameplay-value'
    | 'missing-exemption-source';
  readonly allowedMin: number;
  readonly allowedMax: number;
}

/**
 * 判定一个取值对某分类是否合法（要求 2.3、2.5）。
 *
 * - 玩家可见 `Gameplay_Value`：必须是 1–5 的有限整数。
 * - 非玩家可见 `Gameplay_Value`：分类阶段已要求豁免来源，取值不再套用 1–5。
 * - `Internal_Metric`：按自身声明范围校验，不套用 1–5。
 * - `Structural_Bound` / `Constitutional_Constant`：由基类层与 L0 拥有，取值不套用 1–5。
 */
export function validateGameplayValue(
  classification: NumericFieldClassification,
  value: number,
): GameplayValueVerdict {
  const allowedMin = GAMEPLAY_VALUE_RANGE.min;
  const allowedMax = GAMEPLAY_VALUE_RANGE.max;
  if (classification.ownership !== 'Gameplay_Value') {
    return { acceptable: true, reason: 'not-gameplay-value', allowedMin, allowedMax };
  }
  if (!classification.playerVisible) {
    if (classification.authoritativeSources.length === 0) {
      return { acceptable: false, reason: 'missing-exemption-source', allowedMin, allowedMax };
    }
    return { acceptable: true, reason: 'not-gameplay-value', allowedMin, allowedMax };
  }
  if (!Number.isFinite(value)) {
    return { acceptable: false, reason: 'not-finite', allowedMin, allowedMax };
  }
  if (!Number.isInteger(value)) {
    return { acceptable: false, reason: 'not-integer', allowedMin, allowedMax };
  }
  if (value < allowedMin || value > allowedMax) {
    return { acceptable: false, reason: 'out-of-range', allowedMin, allowedMax };
  }
  return { acceptable: true, allowedMin, allowedMax };
}

/**
 * 内部度量必须携带显式标注与自有 Schema（要求 2.5）。
 * 缺标注的数值**不得**以「内部」为由豁免 1–5。
 */
export function validateInternalMetric(field: ParameterField): boolean {
  return field.classification === 'Internal_Metric' && field.internalMetricSchema !== undefined;
}

/**
 * 数值叶所处的结构区域。
 *
 * 区分区域是必要的：`ParameterField.range.min` 是**声明**（"这里允许 1–5"），
 * `ParameterField.defaultValue` 是**赋值**（"这里就是 3"）。两者都是数值叶，但前者合法、
 * 后者在基类层违规。若不区分，任何声明了值域的合法字段都会被误判为内嵌玩法数值。
 */
export const NUMERIC_LEAF_REGIONS = Object.freeze([
  'parameter-declaration',
  'parameter-default',
  'gameplay-value-assignment',
  'domain-contract',
  'composition-parameters',
  'other',
] as const);

export type NumericLeafRegion = (typeof NUMERIC_LEAF_REGIONS)[number];

/** 一个被发现的数值叶。 */
export interface NumericLeaf {
  readonly fieldPath: string;
  readonly value: number;
  readonly region: NumericLeafRegion;
  /** 叶所属的最近字段名，用于把叶关联回参数 Schema 的分类。 */
  readonly fieldName: string;
}

/** 遍历时跳过的键：来源、定位与纯表现信息不参与数值归属判定。 */
const SKIPPED_KEYS: ReadonlySet<string> = new Set([
  'sourceRecords',
  'sourceLocation',
  'authoritativeSource',
  'authoritativeSources',
  'presentation',
  'jsonPath',
]);

/** 参数 Schema 内属于"声明"而非"赋值"的键。 */
const DECLARATION_KEYS: ReadonlySet<string> = new Set([
  'range',
  'internalMetricSchema',
  'declaredRange',
]);

function regionOf(path: readonly string[], fallback: NumericLeafRegion): NumericLeafRegion {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const segment = path[index]!;
    if (DECLARATION_KEYS.has(segment)) {
      return 'parameter-declaration';
    }
    if (segment === 'defaultValue') {
      return 'parameter-default';
    }
    if (segment === 'gameplayValues') {
      return 'gameplay-value-assignment';
    }
    if (segment === 'domainContract') {
      return 'domain-contract';
    }
    if (segment === 'composition') {
      return 'composition-parameters';
    }
  }
  return fallback;
}

function nearestFieldName(path: readonly string[]): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const segment = path[index]!;
    if (!/^\d+$/u.test(segment)) {
      return segment;
    }
  }
  return '';
}

function walkNumericLeaves(
  value: unknown,
  path: readonly string[],
  basePath: string,
  seen: WeakSet<object>,
  out: NumericLeaf[],
): void {
  if (typeof value === 'number') {
    out.push({
      fieldPath: joinJsonPath(basePath, ...path),
      value,
      region: regionOf(path, 'other'),
      fieldName: nearestFieldName(path),
    });
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  const asObject = value as object;
  if (seen.has(asObject)) {
    return;
  }
  seen.add(asObject);
  if (Array.isArray(value)) {
    value.forEach((element, index) => {
      walkNumericLeaves(element, [...path, String(index)], basePath, seen, out);
    });
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>).sort(compareStrings)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    walkNumericLeaves((value as Record<string, unknown>)[key], [...path, key], basePath, seen, out);
  }
}

/**
 * 递归收集一个候选定义中的全部数值叶字段（要求 2.1、2.2、2.7）。
 *
 * 覆盖参数 Schema、组合组件参数与领域契约内嵌字段；跳过来源记录、定位与纯表现信息。
 * 返回结果按字段路径规范化排序，使诊断顺序不依赖对象键序。
 */
export function collectNumericFields(
  definition: Readonly<Record<string, unknown>>,
  basePath = '',
): readonly NumericLeaf[] {
  const out: NumericLeaf[] = [];
  const seen = new WeakSet<object>();
  for (const key of Object.keys(definition).sort(compareStrings)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    walkNumericLeaves(definition[key], [key], basePath, seen, out);
  }
  return Object.freeze(
    out.sort((left, right) => compareStrings(left.fieldPath, right.fieldPath)),
  );
}

/** 把参数 Schema 的字段按名称索引，供数值叶回查其归属分类。 */
export function indexFieldsByName(
  fields: readonly ParameterField[],
): ReadonlyMap<string, ParameterField> {
  const map = new Map<string, ParameterField>();
  const visit = (list: readonly ParameterField[]): void => {
    for (const field of list) {
      map.set(field.name, field);
      if (field.objectFields !== undefined) {
        visit(field.objectFields);
      }
    }
  };
  visit(fields);
  return map;
}
