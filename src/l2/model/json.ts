/**
 * L2 Model: 声明式 JSON 值模型与深度不可变类型工具。
 *
 * 对应 Requirements 11（Declarative_JSON）与 14（只读投影）。
 * `JsonValue` 只覆盖纯数据：对象、数组、字符串、有限数字、布尔与 null。
 * 不存在函数、正则、Date、undefined 或任何可执行构造 —— 这由 `codec/json-codec.ts` 强制。
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export interface JsonArray extends ReadonlyArray<JsonValue> {}

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** 深度只读类型：把嵌套对象/数组全部收敛为 readonly。 */
export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends (infer E)[]
    ? ReadonlyArray<DeepReadonly<E>>
    : T extends ReadonlyArray<infer E>
      ? ReadonlyArray<DeepReadonly<E>>
      : T extends ReadonlyMap<infer K, infer V>
        ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends ReadonlySet<infer E>
          ? ReadonlySet<DeepReadonly<E>>
          : T extends (...args: never[]) => unknown
            ? never
            : { readonly [K in keyof T]: DeepReadonly<T[K]> };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value);
}

export function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * 判断任意值是否为合法 `JsonValue`（拒绝 NaN、Infinity、undefined、函数、Symbol、
 * 循环引用与非纯对象原型）。
 */
export function isJsonValue(value: unknown, seen: ReadonlySet<object> = new Set()): value is JsonValue {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(value);
  if (Array.isArray(value)) {
    return value.every((element) => isJsonValue(element, nextSeen));
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).every(([, element]) =>
    isJsonValue(element, nextSeen),
  );
}
