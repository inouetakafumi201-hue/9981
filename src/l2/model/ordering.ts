/**
 * L2 Model: 规范化排序与稳定指纹。
 *
 * 对应 Requirements 1.12、13.2、13.8、15.7 与 design.md
 * 「所有集合的外部可观察顺序使用规范化排序，排序键来自语义标识、路径和来源定位，
 * 而非宿主语言的散列表迭代顺序」。
 *
 * 诊断排序（design.md Error Handling）：
 * 受影响定义标识 → JSON 路径 → 稳定代码 → 来源定位。
 * 该顺序是可观察结果的一部分，不得更改。
 */

import type { Diagnostic } from './diagnostic.js';
import type { JsonValue } from './json.js';
import type { SourceLocation, SourceRecord, SourceStatement } from './source.js';
import { precedenceRank } from './source.js';

/**
 * 确定性字符串比较：按 UTF-16 码元序，不使用 `localeCompare`
 * （locale 依赖会让排序结果随运行环境变化）。
 */
export function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** 缺省值排在有值之前，保证"字段缺席"也是确定位置。 */
export function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return compareStrings(left, right);
}

export function compareNumbers(left: number, right: number): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return compareNumbers(left, right);
}

/** 组合多个比较器，返回首个非零结果。 */
export function chainComparators<T>(
  ...comparators: readonly ((left: T, right: T) => number)[]
): (left: T, right: T) => number {
  return (left, right) => {
    for (const comparator of comparators) {
      const outcome = comparator(left, right);
      if (outcome !== 0) {
        return outcome;
      }
    }
    return 0;
  };
}

/** 来源定位比较：文件 → 段落 → 行 → 列。 */
export function compareSourceLocations(
  left: SourceLocation | undefined,
  right: SourceLocation | undefined,
): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return chainComparators<SourceLocation>(
    (a, b) => compareStrings(a.sourceFile, b.sourceFile),
    (a, b) => compareStrings(a.section, b.section),
    (a, b) => compareOptionalNumbers(a.line, b.line),
    (a, b) => compareOptionalNumbers(a.column, b.column),
  )(left, right);
}

/** 来源记录比较：优先级 → 文件 → 定位 → 决策编号 → 指纹。 */
export const compareSourceRecords = chainComparators<SourceRecord>(
  (a, b) => compareNumbers(precedenceRank(a.precedence), precedenceRank(b.precedence)),
  (a, b) => compareStrings(a.sourceFile, b.sourceFile),
  (a, b) => compareSourceLocations(a.sourceLocation, b.sourceLocation),
  (a, b) => compareOptionalStrings(a.decisionId, b.decisionId),
  (a, b) => compareStrings(a.statementFingerprint, b.statementFingerprint),
);

/** 来源陈述比较：主张键 → 来源记录。 */
export const compareSourceStatements = chainComparators<SourceStatement>(
  (a, b) => compareStrings(a.claimKey, b.claimKey),
  (a, b) => compareSourceRecords(a.record, b.record),
);

/**
 * 诊断比较：受影响定义标识 → JSON 路径 → 稳定代码 → 来源定位 → 来源包 → 原因文本。
 * 末位的 `reason` 比较保证"完全同类但不同实例"的诊断也有确定顺序。
 */
export const compareDiagnostics = chainComparators<Diagnostic>(
  (a, b) => compareOptionalStrings(a.definitionId, b.definitionId),
  (a, b) => compareOptionalStrings(a.jsonPath, b.jsonPath),
  (a, b) => compareStrings(a.code, b.code),
  (a, b) => compareSourceLocations(a.sourceLocation, b.sourceLocation),
  (a, b) => compareOptionalStrings(a.sourcePackage, b.sourcePackage),
  (a, b) => compareStrings(a.severity, b.severity),
  (a, b) => compareStrings(a.reason, b.reason),
);

/** 返回按比较器排序的新数组；不修改输入（输入可能是冻结的只读数组）。 */
export function canonicalSort<T>(items: readonly T[], comparator: (left: T, right: T) => number): readonly T[] {
  return [...items].sort(comparator);
}

/** 按字符串键排序。 */
export function sortByKey<T>(items: readonly T[], keyOf: (item: T) => string): readonly T[] {
  return canonicalSort(items, (left, right) => compareStrings(keyOf(left), keyOf(right)));
}

/** 去重（保持排序后的第一个出现）。 */
export function dedupeStrings(items: readonly string[]): readonly string[] {
  return [...new Set(items)].sort(compareStrings);
}

/**
 * 稳定序列化：递归按键名排序输出紧凑 JSON。
 *
 * 这是 L2 内所有"规范化表示"的唯一真相源：
 * - `codec/json-canonicalizer.ts` 的 pretty 输出复用同一键序；
 * - 指纹与快照等价比较复用同一字节串。
 *
 * `undefined` 属性被省略（与 `JSON.stringify` 一致）；非有限数字被拒绝，
 * 因为它们不是合法 `JsonValue`。
 */
export function stableStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const kind = typeof value;
  if (kind === 'string') {
    return JSON.stringify(value);
  }
  if (kind === 'number') {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) {
      throw new TypeError(`stableStringify 拒绝非有限数字：${String(numeric)}`);
    }
    // 归一化 -0 为 0，避免同一语义值出现两种字节表示。
    return JSON.stringify(numeric === 0 ? 0 : numeric);
  }
  if (kind === 'boolean') {
    return JSON.stringify(value);
  }
  if (kind === 'undefined' || kind === 'function' || kind === 'symbol') {
    throw new TypeError(`stableStringify 拒绝不可序列化的值类型：${kind}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((element) => serialize(element)).join(',')}]`;
  }
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([key, element]) => [String(key), element] as const)
      .sort((left, right) => compareStrings(left[0], right[0]));
    return `{${entries.map(([key, element]) => `${JSON.stringify(key)}:${serialize(element)}`).join(',')}}`;
  }
  if (value instanceof Set) {
    const elements = [...value.values()].map((element) => serialize(element)).sort(compareStrings);
    return `[${elements.join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(',')}}`;
}

/**
 * 稳定指纹：对 `stableStringify` 结果做 FNV-1a（64 位，双 32 位累加器实现）。
 *
 * 用途仅限于等价比较与回归对比，不用于安全场景；因此选择无依赖、确定性、
 * 跨平台字节一致的实现，而不是引入加密散列库。
 */
export function fingerprint(value: unknown): string {
  return fingerprintOfString(stableStringify(value));
}

export function fingerprintOfString(input: string): string {
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    high ^= code & 0xff;
    high = Math.imul(high, 0x01000193) >>> 0;
    low ^= (code >>> 8) & 0xff;
    low = Math.imul(low, 0x01000193) >>> 0;
  }
  const lengthTag = (input.length >>> 0).toString(16).padStart(8, '0');
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}${lengthTag}`;
}

/** 规范化 JSON 值的键序（返回新的纯数据结构，供 canonicalizer 复用）。 */
export function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((element) => canonicalizeJsonValue(element));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, JsonValue>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort(compareStrings)) {
      const element = record[key];
      if (element !== undefined) {
        output[key] = canonicalizeJsonValue(element);
      }
    }
    return output;
  }
  if (typeof value === 'number' && value === 0) {
    return 0;
  }
  return value;
}
