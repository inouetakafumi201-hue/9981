/**
 * MapData → PrefabDef 编译。
 *
 * 这是整条地图管线的终点，也是它值得被这样搭的理由：`PrefabDef` 与 `prefab.spawn` 是**引擎层
 * 已经存在并已被测试覆盖**的东西（`kernel/topology/prefab.ts`，需求8.1-8.7）。地图载入因此
 * 不需要任何新的 Op，也不需要引擎层做任何改动——编译产物落在一条已验证的路径上。
 *
 * 编译是纯函数、无 IO、可确定性重放：同一份 MapData 永远编出字节相同的 PrefabDef。这让
 * "地图能不能载入"变成一个可以在 CI 里对全部地图批量断言的问题。
 *
 * 几何在这一步被**丢弃**：PrefabDef 里没有坐标、没有曲线、没有楼层。这正是"删掉几何，一局
 * 游戏照样跑"这条判据的可执行形式——编译产物就是删掉几何之后的那份数据。渲染层单独读
 * MapData 取几何，两条路互不依赖。
 */
import type { PrefabDef } from '../../core/kernel/topology/prefab';
import type { Expr } from '../../core/kernel/state/expr-types';
import type { MapDataDocument, MapEdge, MapPlacement, CanonicalMapNode, Directionality } from './types';
import { normalizeMapDocument } from './types';
import { validateMapStructure } from './validate';
import type { MapDiagnostic } from './validate';

/** 编译结果。失败时只带诊断，不带半成品产物。 */
export type CompileResult =
  | { readonly ok: true; readonly prefab: PrefabDef; readonly warnings: readonly MapDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly MapDiagnostic[] };

/**
 * PrefabDef 内部用 key 而非 Id 标识节点，`buildKeyToIdMap` 在 spawn 时才分配真实 Id。
 * 地图节点 id 直接充当 key：它们在一张地图内已被校验为唯一，正好满足 key 的要求。
 *
 */
function nodeSpecOf(node: CanonicalMapNode): { key: string; def: string; props?: Record<string, Expr> } {
  const props: Record<string, Expr> = { scale: node.scale };
  if (node.name !== undefined) props['name'] = node.name;
  return { key: node.id, def: node.def, props };
}

/**
 * 单向连接按 `[起点, 终点]` 排列（`transition.class.scene_link` 的 endpoints 约定）。
 * 双向连接的 a/b 顺序无语义，保持创作者画的顺序，使编译可确定性重放。
 *
 * L-07 去布尔压缩：`directionality` 完整 token 经 `direction` 字段传入 PrefabDef.links[]，
 * 不再压成布尔 `directed`。`directed` 字段保留为兼容旧 spawn 的 fallback。
 */
function linkSpecOf(edge: MapEdge): { a: string; b: string; def: string; directed?: boolean; direction?: Directionality } {
  return {
    a: edge.a,
    b: edge.b,
    def: edge.def,
    directed: edge.directionality !== 'bidirectional',
    direction: edge.directionality,
  };
}

/**
 * 放置编译为 `PrefabDef.entities`：`at` 指向宿主节点 key，`overrides` 是字面量。
 *
 * 这里刻意不生成 `weight`。曾经的注释说它"由 spawn 时的 link.create 消费"——那是错的：
 * `prefab.spawn` 调 `createLinkShape(id, a, b, { def, directed })`，没有 weight 通道，
 * `PrefabDef.links[]` 本身也没有这个字段。所以 MapEdge 已经不带 weight 了，通行代价属于
 * 门户类型（见 types.ts 的 MapEdge 注释与 L2/03 门户系统一节）。
 */
function entitySpecOf(placement: MapPlacement): {
  at: string;
  def: string;
  overrides?: Record<string, Expr>;
} {
  const overrides: Record<string, Expr> = {};
  for (const [key, value] of Object.entries(placement.overrides ?? {})) {
    overrides[key] = value as Expr;
  }
  if (placement.temporaryFree === true) overrides['temporaryFree'] = true;
  return Object.keys(overrides).length > 0
    ? { at: placement.at, def: placement.def, overrides }
    : { at: placement.at, def: placement.def };
}

/**
 * 编译一张地图。
 *
 * 先跑结构校验：有 error 就不产出 PrefabDef。让一张已知非法的地图编译出"看起来能用"的产物
 * 是最坏的失败形态——它会把问题推迟到运行期，届时诊断信息已经离创作者的编辑动作很远了。
 * warning 不阻止编译，随成功结果一起返回，由调用方决定是否展示。
 *
 * 跨目录引用校验（`validateMapAgainstClasses`）不在这里调用：它需要加载基类层目录，而编译
 * 必须保持无 IO 才能在属性测试里被高频调用。调用方负责在发布前另外跑那一层。
 */
export function compileMap(map: MapDataDocument, prefabId?: string): CompileResult {
  const canonical = map.schemaVersion === '3.0' ? map : normalizeMapDocument(map);
  const findings = validateMapStructure(canonical);
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) return { ok: false, diagnostics: findings };

  const prefab: PrefabDef = {
    id: prefabId ?? `d:map/${map.id}`,
    kind: 'prefab',
    nodes: canonical.nodes.map(nodeSpecOf),
    links: canonical.edges.map(linkSpecOf),
    entities: canonical.placements.map(entitySpecOf),
  };

  return {
    ok: true,
    prefab,
    warnings: findings.filter((finding) => finding.severity === 'warning'),
  };
}

/**
 * 把编译产物还原成拓扑邻接表，供 `dist`/`shortestPath` 之类的度量在没有完整 WorldState 时
 * 做离线推演——例如编辑器的"试玩"要回答"从出生点能不能走到目标"，不必起一局真游戏。
 */
export function adjacencyOf(map: MapDataDocument): ReadonlyMap<string, readonly string[]> {
  const canonical = map.schemaVersion === '3.0' ? map : normalizeMapDocument(map);
  const adjacency = new Map<string, string[]>();
  for (const node of canonical.nodes) adjacency.set(node.id, []);
  for (const edge of canonical.edges) {
    adjacency.get(edge.a)?.push(edge.b);
    if (edge.directionality === 'bidirectional') adjacency.get(edge.b)?.push(edge.a);
  }
  for (const neighbours of adjacency.values()) {
    neighbours.sort((left, right) => left.localeCompare(right, 'en'));
  }
  return adjacency;
}

/**
 * 连通分量。编辑器用它回答"这张图有没有玩家永远到不了的孤岛"。
 *
 * 拓扑允许不连通（引擎层需求7.6），所以这**不是** error——一张地图可能故意有需要载具才能到的
 * 区域。但它值得提示，因为绝大多数不连通是画漏了一条边。方向性在这里被忽略：判定的是
 * "有没有一片区域和主体完全没有连线"，而不是"能不能单向抵达"。
 */
export function connectedGroups(map: MapDataDocument): readonly (readonly string[])[] {
  const canonical = map.schemaVersion === '3.0' ? map : normalizeMapDocument(map);
  const undirected = new Map<string, string[]>();
  for (const node of canonical.nodes) undirected.set(node.id, []);
  for (const edge of canonical.edges) {
    undirected.get(edge.a)?.push(edge.b);
    undirected.get(edge.b)?.push(edge.a);
  }

  const visited = new Set<string>();
  const groups: string[][] = [];
  for (const node of canonical.nodes) {
    if (visited.has(node.id)) continue;
    const group: string[] = [];
    const stack = [node.id];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      group.push(current);
      for (const next of undirected.get(current) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
    }
    groups.push(group.sort((left, right) => left.localeCompare(right, 'en')));
  }
  return groups.sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? '', 'en'));
}
