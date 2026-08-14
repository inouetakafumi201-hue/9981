/**
 * 基类层 JSON 契约基础设施。
 *
 * 这里只放"读取正式数据时的形状断言"与 JSON 遍历原语，供
 * `catalog-loader.ts`（目录装载）与 `class-contract.ts`（语义契约校验）共用，
 * 避免两者互相 import 形成环。
 *
 * 断言全部抛出 `ClassCatalogContractError`：契约破坏是错误而不是警告，
 * 也不允许静默降级或猜测缺失语义。
 */

import type { JsonValue } from '../core/kernel/spec-compiler/types.js';

export class ClassCatalogContractError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path || '/'}: ${message}`);
    this.name = 'ClassCatalogContractError';
  }
}

export type JsonObject = Readonly<Record<string, JsonValue>>;

export function expectObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    throw new ClassCatalogContractError(path, 'must be an object');
  }
  return value as JsonObject;
}

export function expectArray(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new ClassCatalogContractError(path, 'must be an array');
  return value;
}

export function expectNonEmptyArray(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  const entries = expectArray(value, path);
  if (entries.length === 0) throw new ClassCatalogContractError(path, 'must not be empty');
  return entries;
}

export function expectString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ClassCatalogContractError(path, 'must be a non-empty string');
  }
  return value;
}

export function expectBoolean(value: JsonValue | undefined, path: string): boolean {
  if (typeof value !== 'boolean') throw new ClassCatalogContractError(path, 'must be a boolean');
  return value;
}

export function expectNumber(value: JsonValue | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ClassCatalogContractError(path, 'must be a finite number');
  }
  return value;
}

export function expectEnum<T extends string>(
  value: JsonValue | undefined,
  path: string,
  allowed: readonly T[],
): T {
  const text = expectString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new ClassCatalogContractError(path, `must be one of ${allowed.join(', ')}`);
  }
  return text as T;
}

export function expectUniqueStringArray(value: JsonValue | undefined, path: string): readonly string[] {
  const strings = expectArray(value, path).map((entry, index) => expectString(entry, `${path}/${index}`));
  if (new Set(strings).size !== strings.length) {
    throw new ClassCatalogContractError(path, 'must not contain duplicate values');
  }
  return Object.freeze(strings);
}

export function assertAllowedKeys(
  object: JsonObject,
  path: string,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(object).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) {
    throw new ClassCatalogContractError(`${path}/${unknown}`, 'is not part of the catalog contract');
  }
}

export function assertRequiredKeys(
  object: JsonObject,
  path: string,
  required: readonly string[],
): void {
  const missing = required.find((key) => object[key] === undefined);
  if (missing !== undefined) {
    throw new ClassCatalogContractError(`${path}/${missing}`, 'is required by the catalog contract');
  }
}

export function assertUniqueIds(values: readonly { readonly id: string }[], path: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      throw new ClassCatalogContractError(`${path}/${index}/id`, `duplicate id ${value.id}`);
    }
    seen.add(value.id);
  });
}

/** 深冻结解析结果：装载后的目录是不可写投影，不是可写别名。 */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value) as T;
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  return value;
}

/** 一次 JSON 访问：`pointer` 是 RFC 6901 形式的定位，便于诊断直接指向出错位置。 */
export interface JsonVisit {
  readonly key: string;
  readonly value: JsonValue;
  readonly pointer: string;
  readonly parent: JsonObject | undefined;
}

/** 按确定性顺序遍历 JSON 的每个成员（数组按下标，对象按声明顺序）。 */
export function visitJson(
  value: JsonValue,
  visitor: (visit: JsonVisit) => void,
  pointer = '',
  key = '',
  parent: JsonObject | undefined = undefined,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const childPointer = `${pointer}/${index}`;
      visitor({ key, value: entry, pointer: childPointer, parent });
      visitJson(entry, visitor, childPointer, key, parent);
    });
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value as JsonObject)) {
    const childPointer = `${pointer}/${childKey}`;
    visitor({ key: childKey, value: child, pointer: childPointer, parent: value as JsonObject });
    visitJson(child, visitor, childPointer, childKey, value as JsonObject);
  }
}

/** 遍历每个叶值（字符串、数字、布尔、null）。 */
export function visitJsonLeaves(
  value: JsonValue,
  visitor: (visit: JsonVisit) => void,
): void {
  visitJson(value, (visit) => {
    if (visit.value === null || typeof visit.value !== 'object') visitor(visit);
  });
}
