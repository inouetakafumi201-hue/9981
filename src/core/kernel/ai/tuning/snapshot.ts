/**
 * StateSnapshot：世界状态的可序列化快照 + 稳定哈希（Task 5）。
 *
 * 给决策重放提供抗漂移的还原基准：schema 稳定序序列化 → hashWorldState 产生不随
 * 键序漂移的 `stateHash`；restoreFromSnapshot 从快照还原结构等价状态。property
 * 保证：restore(snapshot(s)) 结构等于 s，再次 snapshot 得相同 hash。
 */
import { createEmptyWorldState } from '../../state/world-state.js';
import type { WorldState } from '../../state/world-state.js';

/** 世界状态快照：序列化 + 稳定哈希。 */
export interface WorldStateSnapshot {
  readonly stateHash: string;
  readonly serialized: string;
}

/** 顶层六个集合键的稳定顺序，避免对象键遍历序不一致导致 hash/空比较漂移。 */
const TOP_KEYS = ['world', 'defs', 'nodes', 'links', 'entities', 'items', 'containers'] as const;

/** 递归稳定序列化：对象键排序，数组保序，值规范化。 */
export function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return String(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`).join(',')}}`;
  }
  return 'null';
}

/** cyrb53 字符串哈希 → 稳定 64 位十六进制 stateHash。 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const h1Hex = (h1 >>> 0).toString(16).padStart(8, '0');
  const h2Hex = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${h1Hex}${h2Hex}`;
}

/** 对 WorldState 做稳定哈希（同一状态任意键序 → 相同 hash）。 */
export function hashWorldState(state: WorldState): string {
  const parts = TOP_KEYS.map((key) => `${key}:${stableSerialize((state as unknown as Record<string, unknown>)[key])}`);
  return cyrb53(parts.join('|'));
}

/** 生成世界快照。 */
export function snapshotWorldState(state: WorldState): WorldStateSnapshot {
  const serialized = JSON.stringify(state);
  return { stateHash: hashWorldState(state), serialized };
}

/** 从快照还原结构等价状态；若快照序列化损坏则抛带上下文错误。 */
export function restoreFromSnapshot(snapshot: WorldStateSnapshot): WorldState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.serialized);
  } catch (error) {
    throw new Error(`WorldState snapshot serialized data is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WorldState snapshot must deserialize to an object.');
  }
  // 结构收拢：合并到空世界，缺字段以空兜底，确保 round-trip 结构一致。
  const merged = createEmptyWorldState('sched:restored');
  const source = parsed as Partial<Record<string, unknown>>;
  const next = { ...merged } as Record<string, unknown>;
  for (const key of TOP_KEYS) {
    if (source[key] !== undefined) next[key] = source[key];
  }
  return next as unknown as WorldState;
}
