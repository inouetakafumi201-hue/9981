/**
 * L1 State: Id / Ref 地址空间。
 * ID_PREFIXES 是唯一真相源（design.md 3.1节）：IdPrefix 类型与运行时前缀校验都从它派生。
 */

export const ID_PREFIXES = ['e', 'i', 'n', 'l', 'c', 's', 'a', 'g', 'd', 'w'] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

export type Id = string;

export type Ref = { readonly $: Id };

export const WORLD_REF: Ref = { $: 'w:0' };

export function idPrefixOf(id: Id): string {
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(0, idx);
}

export function isValidIdPrefix(id: Id): boolean {
  return (ID_PREFIXES as readonly string[]).includes(idPrefixOf(id));
}

export function isRef(v: unknown): v is Ref {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['$'] === 'string'
  );
}

export function makeRef(id: Id): Ref {
  return { $: id };
}

let counters: Partial<Record<IdPrefix, number>> = {};

/** 按前缀生成递增 Id，仅供内核内部各 Op 实现调用（不对外暴露为写入通道）。 */
export function nextId(prefix: IdPrefix): Id {
  const n = (counters[prefix] ?? 0) + 1;
  counters[prefix] = n;
  return `${prefix}:${n}`;
}

/** 仅供测试重置计数器，避免测试间 Id 分配互相干扰。 */
export function resetIdCounters(): void {
  counters = {};
}
