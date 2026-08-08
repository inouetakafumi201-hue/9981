/**
 * L1 Topology: 度量、扩散（design.md 3.2节 / 需求11.1-11.7）。
 * dist：加权最短路（Dijkstra，支持 via/maxCost）。spread：预算受限扩散（有序数组，非 Map）。
 */
import type { Id } from '../state/ids.js';
import type { Node, Link } from './types.js';

export interface DistOpts {
  via?: (link: Link) => boolean;
  maxCost?: number;
  metric?: 'sum' | 'hops';
}

interface AdjEdge {
  to: Id;
  cost: number;
  link: Link;
}

function buildAdjacency(nodes: Record<Id, Node>, links: Record<Id, Link>, metric: 'sum' | 'hops'): Map<Id, AdjEdge[]> {
  const adjacency = new Map<Id, AdjEdge[]>();
  for (const id of Object.keys(nodes)) adjacency.set(id, []);
  for (const link of Object.values(links)) {
    const nodeWeightB = nodes[link.b]?.weight ?? 1;
    const nodeWeightA = nodes[link.a]?.weight ?? 1;
    const costAtoB = metric === 'hops' ? 1 : link.weight * nodeWeightB;
    const costBtoA = metric === 'hops' ? 1 : link.weight * nodeWeightA;
    adjacency.get(link.a)?.push({ to: link.b, cost: costAtoB, link });
    if (!link.directed) {
      adjacency.get(link.b)?.push({ to: link.a, cost: costBtoA, link });
    }
  }
  return adjacency;
}

/** 加权最短路：不连通时返回 null（需求11.2）。 */
export function dist(nodes: Record<Id, Node>, links: Record<Id, Link>, a: Id, b: Id, opts?: DistOpts): number | null {
  if (!(a in nodes) || !(b in nodes)) return null;
  if (a === b) return 0;
  const metric = opts?.metric ?? 'sum';
  const adjacency = buildAdjacency(nodes, links, metric);
  const distances = new Map<Id, number>();
  distances.set(a, 0);
  const visited = new Set<Id>();
  // 简单 Dijkstra（无优先队列，规模面向内核测试场景，足够）
  for (;;) {
    let current: Id | null = null;
    let currentDist = Infinity;
    for (const [id, d] of distances.entries()) {
      if (!visited.has(id) && d < currentDist) {
        current = id;
        currentDist = d;
      }
    }
    if (current === null) break;
    if (current === b) return currentDist;
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (opts?.via && !opts.via(edge.link)) continue;
      const newDist = currentDist + edge.cost;
      if (opts?.maxCost !== undefined && newDist > opts.maxCost) continue;
      const existing = distances.get(edge.to);
      if (existing === undefined || newDist < existing) {
        distances.set(edge.to, newDist);
      }
    }
  }
  return distances.has(b) ? (distances.get(b) as number) : null;
}

export interface SpreadOpts {
  decay?: (cost: number) => number;
  via?: (link: Link) => boolean;
  metric?: 'sum' | 'hops';
}

export interface SpreadResult {
  node: Id;
  strength: number;
  from: Id;
}

/** 预算受限扩散：从起点做加权 BFS，返回按强度降序、NodeId 升序排列的有序数组（需求11.5-11.7）。 */
export function spread(
  nodes: Record<Id, Node>,
  links: Record<Id, Link>,
  origin: Id,
  budget: number,
  opts?: SpreadOpts,
): SpreadResult[] {
  if (!(origin in nodes)) return [];
  const metric = opts?.metric ?? 'sum';
  const adjacency = buildAdjacency(nodes, links, metric);
  const defaultDecay = (cost: number): number => cost;
  const decay = opts?.decay ?? defaultDecay;

  // strength[nodeId] = 剩余强度；from[nodeId] = 上游来源
  const bestStrength = new Map<Id, number>();
  const bestFrom = new Map<Id, Id>();
  bestStrength.set(origin, budget);

  // 松弛式 BFS/Dijkstra-like：以"强度越大越先扩展"为优先级
  const frontier: Id[] = [origin];
  const visited = new Set<Id>();
  while (frontier.length > 0) {
    // 取当前 frontier 中剩余强度最大的节点
    let bestIdx = 0;
    for (let i = 1; i < frontier.length; i++) {
      const si = bestStrength.get(frontier[i] as Id) ?? -Infinity;
      const sb = bestStrength.get(frontier[bestIdx] as Id) ?? -Infinity;
      if (si > sb) bestIdx = i;
    }
    const current = frontier.splice(bestIdx, 1)[0] as Id;
    if (visited.has(current)) continue;
    visited.add(current);
    const currentStrength = bestStrength.get(current) ?? 0;
    for (const edge of adjacency.get(current) ?? []) {
      if (opts?.via && !opts.via(edge.link)) continue;
      const remaining = currentStrength - decay(edge.cost);
      if (remaining <= 0) continue;
      const existing = bestStrength.get(edge.to);
      if (existing === undefined || remaining > existing) {
        bestStrength.set(edge.to, remaining);
        bestFrom.set(edge.to, current);
        if (!visited.has(edge.to)) frontier.push(edge.to);
      }
    }
  }

  const results: SpreadResult[] = [];
  for (const [nodeId, strength] of bestStrength.entries()) {
    if (nodeId === origin) continue;
    results.push({ node: nodeId, strength, from: bestFrom.get(nodeId) as Id });
  }
  results.sort((x, y) => (y.strength !== x.strength ? y.strength - x.strength : x.node.localeCompare(y.node)));
  return results;
}

/**
 * 加权最短路的节点序列（`path` 算子的底座 / 需求11.1-11.4 的姊妹能力）。
 *
 * `dist` 只返回代价，但"沿路施加效果""逐段判定阻挡"这类玩法需要真正的节点序列。两者共用同一套
 * 邻接构建与松弛逻辑，因此这里复用 buildAdjacency 而不是另写一份图遍历——否则 `dist` 与 `path`
 * 可能在 via/maxCost/metric 的边界处给出互相矛盾的答案（例如 dist 说可达而 path 返回 null）。
 *
 * 返回值含起点与终点；起点等于终点时返回单元素数组；不连通（或被 via/maxCost 切断）时返回 null。
 */
export function shortestPath(
  nodes: Record<Id, Node>,
  links: Record<Id, Link>,
  a: Id,
  b: Id,
  opts?: DistOpts,
): Id[] | null {
  if (!(a in nodes) || !(b in nodes)) return null;
  if (a === b) return [a];
  const metric = opts?.metric ?? 'sum';
  const adjacency = buildAdjacency(nodes, links, metric);
  const distances = new Map<Id, number>([[a, 0]]);
  const previous = new Map<Id, Id>();
  const visited = new Set<Id>();

  for (;;) {
    let current: Id | null = null;
    let currentDist = Infinity;
    // 与 dist 保持同一条选点规则：距离相同时取 NodeId 字典序较小者，保证 path 结果确定性
    // （需求11.6 的有序性要求在 path 上的对应物；否则同代价多路径会给出运行间不稳定的序列）。
    for (const [id, d] of distances.entries()) {
      if (visited.has(id)) continue;
      if (d < currentDist || (d === currentDist && current !== null && id.localeCompare(current) < 0)) {
        current = id;
        currentDist = d;
      }
    }
    if (current === null) break;
    if (current === b) break;
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (opts?.via && !opts.via(edge.link)) continue;
      const newDist = currentDist + edge.cost;
      if (opts?.maxCost !== undefined && newDist > opts.maxCost) continue;
      const existing = distances.get(edge.to);
      if (existing === undefined || newDist < existing) {
        distances.set(edge.to, newDist);
        previous.set(edge.to, current);
      }
    }
  }

  if (!distances.has(b)) return null;
  const sequence: Id[] = [b];
  let cursor: Id = b;
  while (cursor !== a) {
    const parent = previous.get(cursor);
    if (parent === undefined) return null;
    sequence.push(parent);
    cursor = parent;
  }
  return sequence.reverse();
}

/**
 * 预算内可达的节点集合（`radius` 算子的底座）。
 *
 * 与 `spread` 的区别是语义而非实现细节：`spread` 回答"强度按边代价衰减后每个节点还剩多少"，
 * `radius` 回答"哪些节点在代价预算内可达"。后者不带强度概念，因此按 NodeId 升序返回，
 * 不按强度排序——把两者合成一个算子会迫使调用方在"要强度"和"要集合"之间做无意义的转换。
 * 不含起点自身，与 spread 的约定一致。
 */
export function radius(
  nodes: Record<Id, Node>,
  links: Record<Id, Link>,
  origin: Id,
  budget: number,
  opts?: DistOpts,
): Id[] {
  if (!(origin in nodes) || !Number.isFinite(budget) || budget < 0) return [];
  const reached: Id[] = [];
  for (const candidate of Object.keys(nodes)) {
    if (candidate === origin) continue;
    const cost = dist(nodes, links, origin, candidate, { ...opts, maxCost: budget });
    if (cost !== null && cost <= budget) reached.push(candidate);
  }
  return reached.sort((left, right) => left.localeCompare(right));
}
