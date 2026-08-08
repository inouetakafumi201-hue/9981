/**
 * L2 Model: 深度不可变工具。
 *
 * 对应 Requirements 14.1、14.7–14.10 与 design.md `createProjection` 的 `deepImmutable`。
 *
 * 目标：投影、描述符与快照返回的对象在任意嵌套深度都不可写。
 * 实现使用 `Object.freeze` 递归 + `WeakSet` 防循环；对 `Map` / `Set` 额外替换其变更方法，
 * 因为 `Object.freeze` 不阻止 `Map.prototype.set`。
 */

import type { DeepReadonly } from './json.js';

const MUTATING_MAP_METHODS = ['set', 'delete', 'clear'] as const;
const MUTATING_SET_METHODS = ['add', 'delete', 'clear'] as const;

function blockMutation(target: object, methods: readonly string[], label: string): void {
  for (const method of methods) {
    Object.defineProperty(target, method, {
      value: () => {
        throw new TypeError(`不可变 ${label} 拒绝写入操作 ${method}()`);
      },
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
}

/**
 * 递归冻结任意值并返回深度只读视图。
 *
 * - 原始值原样返回。
 * - 数组、普通对象递归冻结。
 * - `Map` / `Set` 先冻结其元素，再屏蔽变更方法，最后冻结容器自身。
 * - 函数不被冻结内容，但也会被 freeze（防止属性挂载）；投影中本不应出现函数。
 * - 循环引用安全：已访问对象直接跳过。
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): DeepReadonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value as DeepReadonly<T>;
  }
  const asObject = value as unknown as object;
  if (seen.has(asObject)) {
    return value as DeepReadonly<T>;
  }
  seen.add(asObject);

  if (Array.isArray(value)) {
    for (const element of value) {
      deepFreeze(element, seen);
    }
    Object.freeze(value);
    return value as DeepReadonly<T>;
  }

  if (value instanceof Map) {
    for (const [key, element] of value.entries()) {
      deepFreeze(key, seen);
      deepFreeze(element, seen);
    }
    blockMutation(value, MUTATING_MAP_METHODS, 'Map');
    Object.freeze(value);
    return value as DeepReadonly<T>;
  }

  if (value instanceof Set) {
    for (const element of value.values()) {
      deepFreeze(element, seen);
    }
    blockMutation(value, MUTATING_SET_METHODS, 'Set');
    Object.freeze(value);
    return value as DeepReadonly<T>;
  }

  for (const key of Object.getOwnPropertyNames(asObject)) {
    const descriptor = Object.getOwnPropertyDescriptor(asObject, key);
    if (descriptor && 'value' in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  Object.freeze(value);
  return value as DeepReadonly<T>;
}

/**
 * 判断一个值是否已深度冻结。
 * 用于测试断言"投影不可写"，不作为运行时保护手段。
 */
export function isDeeplyFrozen(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return true;
  }
  const asObject = value as object;
  if (seen.has(asObject)) {
    return true;
  }
  seen.add(asObject);
  if (!Object.isFrozen(asObject)) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((element) => isDeeplyFrozen(element, seen));
  }
  if (value instanceof Map) {
    for (const [key, element] of value.entries()) {
      if (!isDeeplyFrozen(key, seen) || !isDeeplyFrozen(element, seen)) {
        return false;
      }
    }
    return true;
  }
  if (value instanceof Set) {
    for (const element of value.values()) {
      if (!isDeeplyFrozen(element, seen)) {
        return false;
      }
    }
    return true;
  }
  for (const key of Object.getOwnPropertyNames(asObject)) {
    const descriptor = Object.getOwnPropertyDescriptor(asObject, key);
    if (descriptor && 'value' in descriptor && !isDeeplyFrozen(descriptor.value, seen)) {
      return false;
    }
  }
  return true;
}

/** 冻结数组并返回只读数组。 */
export function frozenArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze(items.slice()) as readonly T[];
}

/** 由键值对构造冻结的只读 Map。 */
export function frozenMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const map = new Map<K, V>(entries.map(([key, value]) => [key, value] as [K, V]));
  blockMutation(map, MUTATING_MAP_METHODS, 'Map');
  return Object.freeze(map);
}

/** 由元素构造冻结的只读 Set。 */
export function frozenSet<T>(items: Iterable<T>): ReadonlySet<T> {
  const set = new Set<T>(items);
  blockMutation(set, MUTATING_SET_METHODS, 'Set');
  return Object.freeze(set);
}

/**
 * 结构化深拷贝（只处理纯数据：对象、数组、原始值）。
 * 用于把活动注册表复制为候选工作副本，确保候选变更不会原地修改活动对象。
 */
export function deepClonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((element) => deepClonePlain(element)) as unknown as T;
  }
  if (value instanceof Map) {
    return new Map(
      [...value.entries()].map(([key, element]) => [deepClonePlain(key), deepClonePlain(element)]),
    ) as unknown as T;
  }
  if (value instanceof Set) {
    return new Set([...value.values()].map((element) => deepClonePlain(element))) as unknown as T;
  }
  const output: Record<string, unknown> = {};
  for (const [key, element] of Object.entries(value as Record<string, unknown>)) {
    output[key] = deepClonePlain(element);
  }
  return output as unknown as T;
}
