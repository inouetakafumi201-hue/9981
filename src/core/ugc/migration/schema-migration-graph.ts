/**
 * Schema 版本判定与唯一迁移路径解析（design.md「Schema migration」/ 需求 12.1-12.5、12.12-12.13）。
 *
 * 只有在存在**恰好一条**完整、无环迁移链时才允许继续。这里刻意不做"选一条最短路径"之类的启发式：
 * 一旦有两条路径，两条都可能产生不同的规范化结果，"同一输入 + 同一注册表 → 同一输出"（需求 12.13）
 * 就不再成立。因此分支歧义是错误，不是可以自动消解的情况。
 */
import type { TrustedSchemaMigration } from '../ports/schema-ports';
import type { SchemaMigrationGateway, SchemaVersionCatalog } from '../ports/schema-ports';
import type { QuotaBudget, QuotaViolation } from '../model/quota-types';
import { isPortUnavailable } from '../ports/availability';

/** 候选声明版本相对当前 Schema 目录的处境。 */
export type VersionStanding =
  | { readonly kind: 'malformed' }
  | { readonly kind: 'supported' }
  | { readonly kind: 'older'; readonly target: string }
  | { readonly kind: 'newer'; readonly supported: readonly string[] };

/**
 * 判定版本处境。
 *
 * 顺序重要：先判格式合法性，再判是否直接支持，最后才与支持范围比较新旧。把"格式非法"与"版本过旧"
 * 混为一谈会让创作者收到错误的修复建议（需求 12.1 要求版本必须符合登记的格式契约）。
 */
export function classifyVersion(catalog: SchemaVersionCatalog, declared: string): VersionStanding {
  if (!catalog.isWellFormed(declared)) return { kind: 'malformed' };
  if (catalog.supports(declared)) return { kind: 'supported' };

  const supported = catalog.supportedVersions();
  if (supported.length === 0) return { kind: 'newer', supported };

  // 与全部受支持版本比较：只有比**每一个**受支持版本都新，才算"未来版本"。
  const isNewerThanAll = supported.every((version) => catalog.compare(declared, version) > 0);
  if (isNewerThanAll) return { kind: 'newer', supported };

  // 迁移目标取受支持版本中的最大者，保证升级到当前最新受支持形状。
  let target = supported[0] ?? declared;
  for (const version of supported) {
    if (catalog.compare(version, target) > 0) target = version;
  }
  return { kind: 'older', target };
}

export type MigrationGraphProblem =
  | { readonly kind: 'gateway-unavailable' }
  | { readonly kind: 'duplicate-edge'; readonly from: string; readonly to: string; readonly edgeIds: readonly string[] }
  | { readonly kind: 'self-edge'; readonly edgeId: string; readonly version: string }
  | { readonly kind: 'cycle'; readonly path: readonly string[] };

export interface MigrationGraph {
  /** from 版本 → 出边（按 to 版本稳定排序）。 */
  readonly outgoing: ReadonlyMap<string, readonly TrustedSchemaMigration[]>;
  readonly edgeCount: number;
}

/**
 * 构建并校验迁移图。
 *
 * 三类结构问题在**搜索路径之前**就拒绝（需求 12.5 "在改变候选之前拒绝迁移"）：
 * 重复边（同一 from→to 有多条边，无法确定用哪条）、自环边、以及图中存在环。
 */
export function buildMigrationGraph(
  gateway: SchemaMigrationGateway,
): { readonly ok: true; readonly graph: MigrationGraph } | { readonly ok: false; readonly problem: MigrationGraphProblem } {
  if (isPortUnavailable(gateway)) {
    return { ok: false, problem: { kind: 'gateway-unavailable' } };
  }

  const edges = gateway.edges();
  const byPair = new Map<string, string[]>();
  const outgoing = new Map<string, TrustedSchemaMigration[]>();

  for (const edge of edges) {
    if (edge.from === edge.to) {
      return { ok: false, problem: { kind: 'self-edge', edgeId: edge.id, version: edge.from } };
    }
    const pairKey = `${edge.from}\u0000${edge.to}`;
    const existing = byPair.get(pairKey);
    if (existing !== undefined) {
      existing.push(edge.id);
      return {
        ok: false,
        problem: { kind: 'duplicate-edge', from: edge.from, to: edge.to, edgeIds: Object.freeze([...existing]) },
      };
    }
    byPair.set(pairKey, [edge.id]);

    const bucket = outgoing.get(edge.from);
    if (bucket === undefined) outgoing.set(edge.from, [edge]);
    else bucket.push(edge);
  }

  for (const bucket of outgoing.values()) {
    bucket.sort((left, right) => (left.to === right.to ? 0 : left.to < right.to ? -1 : 1));
  }

  const cycle = findCycle(outgoing);
  if (cycle !== null) {
    return { ok: false, problem: { kind: 'cycle', path: cycle } };
  }

  return {
    ok: true,
    graph: { outgoing, edgeCount: edges.length },
  };
}

/** 迭代式三色 DFS 环检测。返回一条确定性的环路径，或 `null`。 */
function findCycle(outgoing: ReadonlyMap<string, readonly TrustedSchemaMigration[]>): readonly string[] | null {
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const starts = [...outgoing.keys()].sort();

  for (const start of starts) {
    if (visited.has(start)) continue;
    const stack: { readonly version: string; index: number }[] = [{ version: start, index: 0 }];
    const path: string[] = [start];
    onPath.add(start);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const nextEdges = outgoing.get(frame.version) ?? [];
      if (frame.index >= nextEdges.length) {
        onPath.delete(frame.version);
        visited.add(frame.version);
        stack.pop();
        path.pop();
        continue;
      }
      const edge = nextEdges[frame.index];
      frame.index += 1;
      if (edge === undefined) continue;
      if (onPath.has(edge.to)) {
        const cycleStart = path.indexOf(edge.to);
        return Object.freeze([...path.slice(cycleStart >= 0 ? cycleStart : 0), edge.to]);
      }
      if (visited.has(edge.to)) continue;
      onPath.add(edge.to);
      path.push(edge.to);
      stack.push({ version: edge.to, index: 0 });
    }
  }
  return null;
}

export type PathResolution =
  | { readonly kind: 'resolved'; readonly path: readonly TrustedSchemaMigration[] }
  | { readonly kind: 'no-path' }
  | { readonly kind: 'ambiguous'; readonly first: readonly string[]; readonly second: readonly string[] }
  | { readonly kind: 'step-limit'; readonly maxSteps: number }
  | { readonly kind: 'quota'; readonly violation: QuotaViolation };

/**
 * 在无环图中枚举 from→to 的**全部**简单路径，但一发现第二条就停止。
 *
 * 为什么必须枚举到第二条而不是"找到一条就返回"：需求 12.3 要求路径**唯一**。只找一条无法区分
 * "唯一路径"与"多条路径中恰好先找到的一条"，后者会让同一候选在注册表顺序变化时得到不同结果。
 *
 * 步数与遍历量都受可信配额约束；`migrationSteps` 对应任务 1.3 已登记的 `E_QUOTA_MIGRATION_STEPS`。
 */
export function resolveUniquePath(
  graph: MigrationGraph,
  from: string,
  to: string,
  maxSteps: number,
  budget: QuotaBudget,
): PathResolution {
  if (from === to) return { kind: 'resolved', path: Object.freeze([]) };

  const found: TrustedSchemaMigration[][] = [];
  const current: TrustedSchemaMigration[] = [];
  const onPath = new Set<string>([from]);

  const stack: { readonly version: string; index: number }[] = [{ version: from, index: 0 }];

  while (stack.length > 0) {
    const work = budget.consume('traversalWork', 1);
    if (work !== null) return { kind: 'quota', violation: work };

    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const edges = graph.outgoing.get(frame.version) ?? [];

    if (frame.index >= edges.length) {
      onPath.delete(frame.version);
      stack.pop();
      current.pop();
      continue;
    }

    const edge = edges[frame.index];
    frame.index += 1;
    if (edge === undefined) continue;
    if (onPath.has(edge.to)) continue;

    if (current.length + 1 > maxSteps) {
      return { kind: 'step-limit', maxSteps };
    }
    const stepViolation = budget.consume('migrationSteps', 1);
    if (stepViolation !== null) return { kind: 'quota', violation: stepViolation };

    current.push(edge);

    if (edge.to === to) {
      found.push([...current]);
      if (found.length >= 2) {
        const first = found[0]?.map((entry) => entry.id) ?? [];
        const second = found[1]?.map((entry) => entry.id) ?? [];
        return { kind: 'ambiguous', first: Object.freeze(first), second: Object.freeze(second) };
      }
      current.pop();
      continue;
    }

    onPath.add(edge.to);
    stack.push({ version: edge.to, index: 0 });
  }

  const only = found[0];
  if (only === undefined) return { kind: 'no-path' };
  return { kind: 'resolved', path: Object.freeze(only) };
}
