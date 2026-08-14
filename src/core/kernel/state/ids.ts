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
let pending: Partial<Record<IdPrefix, number>> = {};
let pendingDepth = 0;

/**
 * 开启一次「Id 事务」：整段嵌套事务里通过 nextId 推进的所有计数器先累积到 pending，
 * 不会立即写进 counters。commitIdCounters() 时一次性把累积值并入 counters；rollbackIdCounters()
 * 则全部丢弃。
 *
 * 这从根本上消解了「一次失败但回滚的 Op 会永久吞掉一个编号」的问题（bombardment-l12 属性 8
 * 实测暴露的栈/结构/附着/随机各处的幂等重放分歧）：无需在每个 Op 调用点手工 rollbackNextIdCounter，
 * 计数器推进天然与事务提交一致。ID 计数器是非持久化的引擎内部记账（不在快照/重放契约内），
 * 因此「成功 Op 序列 → 幂等快照重放」要求的是：同一意图序列里成功 Op 得到的 Id 序列完全一致，
 * 失败 Op 不产生任何残留计数。嵌套事务最深那层（OpRegistry.invoke 的顶层事务）负责 commit。
 */
export function beginIdCounterScope(): void {
  pendingDepth++;
}

/** 把当前事务层累积的计数器推进一次性并入全局 counters。 */
export function commitIdCounters(): void {
  if (pendingDepth <= 0) return;
  pendingDepth--;
  if (pendingDepth > 0) return; // 仍是嵌套层，保留累积，外层统一并入
  if (pendingDepth === 0) {
    for (const prefix of Object.keys(pending) as IdPrefix[]) {
      counters[prefix] = (counters[prefix] ?? 0) + (pending[prefix] ?? 0);
    }
    pending = {};
  }
}

/** 丢弃当前事务层累积的计数器推进（失败回滚路径）。 */
export function rollbackIdCounters(): void {
  if (pendingDepth <= 0) return;
  pendingDepth--;
  if (pendingDepth > 0) return; // 仍是嵌套层，保留 pending 由最外层统一决定
  pending = {};
}

/** 按前缀生成递增 Id，仅供内核内部各 Op 实现调用（不对外暴露为写入通道）。 */
export function nextId(prefix: IdPrefix): Id {
  // 事务推进统一走 pending；顶层 invoke 会 beginIdCounterScope/commitIdCounters 对齐。
  // 但存在不经任一层 invoke 的直接分配（如测试里的 materializeDefContainers、transform-ops 的
  // 内部 node 分配——它们在 harness 组装阶段而非 Op 事务内调用）。此时 pendingDepth 为 0，
  // 直接把推进写进 counters，保持旧行为。
  if (pendingDepth <= 0) {
    const n = (counters[prefix] ?? 0) + 1;
    counters[prefix] = n;
    return `${prefix}:${n}`;
  }
  const base = counters[prefix] ?? 0;
  const prev = pending[prefix] ?? 0;
  pending[prefix] = prev + 1;
  return `${prefix}:${base + prev + 1}`;
}

/**
 * 撤销上次 nextId 对该前缀的递增（回退 1，不会回退到负）。
 *
 * 用途：某 Op 在事务中途分配了 Id、随后因后续步骤失败整体回滚（tx.rollback），但那次
 * 分配已经把计数器抬高了。不回退会让一次"失败但回滚"的 Op 永久吞掉一个编号，破坏
 * 「成功 Op 序列 → 幂等快照重放」的持久化定见（bombardment-l12 属性 8 实测暴露：
 * 一次失败的 stack.split 在 h1 里烧掉了 i:2，重放 journal 却从 i:1 分歧）。
 *
 * 注意：只允许在「刚拿到的 Id 已被丢弃、不会重新使用」的回滚路径上调用；若该 Id 仍被
 * 引用或已对外返回，禁止回退（会制造重复 Id）。
 */
export function rollbackNextIdCounter(prefix: IdPrefix): void {
  const n = counters[prefix] ?? 0;
  if (n > 0) counters[prefix] = n - 1;
}

/** 仅供测试重置计数器，避免测试间 Id 分配互相干扰。 */
export function resetIdCounters(): void {
  counters = {};
  pending = {};
  pendingDepth = 0;
}
