/**
 * L-05 地图唯一装载锚点（design.md §6 地图锚点组件 / 需求 7.1-7.5）。
 *
 * 语义对齐 UGC §7.6：地图是「玩法包」的装载锚点，按 ID（命名 + 随机符号尾数）占据一个 map 位。
 * **只在同 key 撞位时不可替换**（换图须先卸载旧位或改用不同 ID）；不同 key 各自独立装载、
 * 互不排。剔除走 no-reload 跳过（不报错）。
 *
 * 与既有 `PlaypackLoader` 的单调重定义不同：玩法包同 key 覆盖先装（D-073 后装覆盖先装），
 * 但地图锚点位**绝不**后装覆盖先装——同一 map 位塞进另一张地图是"换地图"，必须显式拒绝而非
 * 静默换图，否则已在地图上的占位者会悬空。这是地图锚点位的机械纪律：同 key 位不可替换，
 * 不是可被后装抹掉的重定义 key（异 key 位彼此独立、不受此约束）。
 *
 * `MapAnchorRegistry` 是一个独立的只读状态表（`occupiedSlots: Map<key, mapId>`），挂在
 * 玩法包装载流程之外、供地图位判定使用。它不是第七个顶层集合，不进入 WorldState 计数。
 */
import type { Result } from '../../core/kernel/ops/result';
import { ok, err } from '../../core/kernel/ops/result';

/** 地图装载位状态。按 ID 区分，异 key 互不排。 */
export type MapAnchorResult =
  | { readonly status: 'accepted'; readonly mapId: string }
  | { readonly status: 'rejected'; readonly reason: 'non-replaceable'; readonly mapId: string; readonly existing: string }
  | { readonly status: 'skipped'; readonly reason: 'no-reload'; readonly mapId: string };

export interface MapAnchorRegistry {
  /** key → 已装载 map ID（命名 + 随机符号尾数）。 */
  readonly occupiedSlots: ReadonlyMap<string, string>;
}

export function createEmptyMapAnchorRegistry(): MapAnchorRegistry {
  return { occupiedSlots: new Map() };
}

/** 地图位 key：用 map 的 ID（含命名与随机尾数）自身作 key，天然区分异 key。 */
function slotKeyFor(mapId: string): string {
  return mapId;
}

/**
 * 尝试把一张地图装入其锚点位。
 * - 该 map 位为空 → accepted（占用该位）。
 * - 该 map 位已被同 key 占据 → non-replaceable 拒绝（要求 7.1/7.3）。地图不参与单调重定义
 *   覆盖，换图必须先释放旧图位。
 * - 传入 `skipOnReload=true`（剔除/无重载场景）且位被占据 → no-reload 跳过，不报错（要求 7.1）。
 *
 * `registry` 与返回的新表都是不可变快照，读写分离，便于快照/回放一致性。
 */
export function registerMapAnchor(
  registry: MapAnchorRegistry,
  mapId: string,
  opts: { skipOnReload?: boolean } = {},
): { readonly result: MapAnchorResult; readonly next: MapAnchorRegistry } {
  const key = slotKeyFor(mapId);
  const existing = registry.occupiedSlots.get(key);

  if (existing !== undefined) {
    if (opts.skipOnReload) {
      return { result: { status: 'skipped', reason: 'no-reload', mapId }, next: registry };
    }
    return { result: { status: 'rejected', reason: 'non-replaceable', mapId, existing }, next: registry };
  }

  const next = new Map(registry.occupiedSlots);
  next.set(key, mapId);
  return { result: { status: 'accepted', mapId }, next: { occupiedSlots: next } };
}

/** 释放一个 map 位。位不存在时返回原表（剔除 no-reload 语义，不报错）。 */
export function releaseMapAnchor(registry: MapAnchorRegistry, mapId: string): MapAnchorRegistry {
  const next = new Map(registry.occupiedSlots);
  next.delete(slotKeyFor(mapId));
  return { occupiedSlots: next };
}

/**
 * 以 OpIdResult 形态返回装载接受/拒绝，供玩法包装载流程消费。
 * 拒绝时携带 `E_LOAD_MAP_ANCHOR_NON_REPLACEABLE`，与诊断码注册表一致。
 */
export function registerMapAnchorAsResult(
  registry: MapAnchorRegistry,
  mapId: string,
  opts: { skipOnReload?: boolean } = {},
): { readonly result: Result<null>; readonly next: MapAnchorRegistry } {
  const { result, next } = registerMapAnchor(registry, mapId, opts);
  if (result.status === 'accepted') {
    return { result: ok(null), next };
  }
  if (result.status === 'skipped') {
    return { result: ok(null), next };
  }
  return { result: err('E_LOAD_MAP_ANCHOR_NON_REPLACEABLE', `同一地图位 ${mapId} 已被地图 ${result.existing} 占据。地图锚点在同 key 撞位时不可替换（换图须先卸载旧图位或换用不同 ID），不同 key 各自独立装载、不互排。`), next };
}
