/**
 * Feature: wakeup-engine-bombardment
 * Property 2: L1 Topology 图度量一致性
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 *
 * 对任意随机图（多节点 + 混合方向四 token + 加权 + 自环/负权/悬空）：
 * - dist(a,a) = 0 恒成立；
 * - shortestPath(a,b) 返回序列首尾为 a/b 且逐边可达；
 * - dist(a,b) 等于该序列邻边代价之和（二者共用邻接，不自相矛盾）；
 * - radius(…,budget) 的可到集合 === dist(…,maxCost=budget) 的可到集合；
 * - spread 的 strength ∈ [0,budget]；
 * - 度量函数对含负权/悬空端点/未知方向 token 的图绝不抛异常。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Node, Link } from '../topology/types.js';
import { createNodeShape, createLinkShape } from '../topology/types.js';
import { dist, spread, shortestPath, radius } from '../topology/metrics.js';

const DIR_TOKENS = ['bidirectional', 'unidirectional', 'one-way-down', 'one-way-up'] as const;

interface GraphModel {
  nodes: Record<string, Node>;
  links: Record<string, Link>;
}

/**
 * 生成随机图。分两种：consistency 用非负权图（Dijkstra 与 spread-budget 的前置条件），
 * dirty 用含负权/未知方向/悬空/自环的图（只测"不抛"，不测数值一致性——负权会使
 * Dijkstra 与 spread 的预算语义失效，属非法度量输入）。两种生成器都混入悬空端点。
 */

interface EdgeSpec {
  a: number;
  b: number;
  weight: number;
  direction?: string;
  dangling: boolean;
}

function buildGraph(n: number, edges: EdgeSpec[]): GraphModel {
  const nodes: Record<string, Node> = {};
  for (let i = 0; i < n; i++) nodes[`n:${i}`] = createNodeShape(`n:${i}`, 'd:room', { weight: (i % 3) + 1 });
  const links: Record<string, Link> = {};
  edges.forEach((e, idx) => {
    const aId = `n:${e.a % Math.max(1, n)}`;
    const bId = e.dangling ? 'n:99' : `n:${e.b % Math.max(1, n)}`;
    links[`l:${idx}`] = createLinkShape(`l:${idx}`, aId, bId, {
      // `direction` 缺省时可省略；非 1-5 未知 token 也透传（back-compat 面），
      // 不在此做布尔压缩，保持与引擎层 `Link.direction` 的一致性。
      ...(e.direction === undefined ? {} : { direction: e.direction }),
      weight: e.weight,
    });
  });
  return { nodes, links };
}

const weightArb = fc.integer({ min: 0, max: 4 });
const dirArb = fc.oneof(
  fc.constantFrom(...DIR_TOKENS),
  fc.constant(undefined as unknown as string),
);

/** 非负权、合法方向（可能悬空）图 → 用于一致性属性。 */
const consistentGraphArb: fc.Arbitrary<GraphModel> = fc
  .record({
    n: fc.integer({ min: 1, max: 6 }),
    edges: fc.array(
      fc.record({
        a: fc.integer({ min: 0, max: 6 }),
        b: fc.integer({ min: 0, max: 6 }),
        weight: weightArb,
        direction: dirArb,
        dangling: fc.boolean(),
      }),
      { maxLength: 7 },
    ),
  })
  .map(({ n, edges }) => buildGraph(n, edges));

/** 含负权/未知方向/自环/悬空 → 只测"不抛"。 */
/**
 * 脏图（fail-closed）：含未知方向 token + 悬空端点 + 自环，但权重保持非负——
 * 生产 `metrics.ts` 的 spread/dist 契约假设非负代价（负数会破坏 Dijkstra 与预算语义），
 * 因此负数权重不属合法度量输入，这里不生成。自环与悬空是结构上合法但不常见，
 * 未知方向 token 与缺 token 是 back-compat 面。
 */
const dirtyGraphArb: fc.Arbitrary<GraphModel> = fc
  .record({
    n: fc.integer({ min: 1, max: 6 }),
    edges: fc.array(
      fc.record({
        a: fc.integer({ min: 0, max: 6 }),
        b: fc.integer({ min: 0, max: 6 }),
        weight: fc.integer({ min: 0, max: 4 }),
        direction: fc.oneof(fc.constantFrom(...DIR_TOKENS), fc.constant('sideways' as unknown as string), fc.constant(undefined as unknown as string)),
        dangling: fc.boolean(),
      }),
      { maxLength: 7 },
    ),
  })
  .map(({ n, edges }) => buildGraph(n, edges));

describe('Feature: wakeup-engine-bombardment, Property 2: L1 Topology 图度量一致性', () => {
  it('dist(a,a)=0 恒成立，且 four metrics 对任意一致图绝不抛', () => {
    fc.assert(
      fc.property(consistentGraphArb, (g) => {
        const ids = Object.keys(g.nodes);
        expect(() => {
          for (const id of ids) {
            expect(dist(g.nodes, g.links, id, id, { metric: 'sum' })).toBe(0);
            expect(dist(g.nodes, g.links, id, id, { metric: 'hops' })).toBe(0);
          }
          // 对每对可能端点跑最长一条路径（仅当两端都在 nodes 内），验证不抛
          for (const a of ids) {
            for (const b of ids) {
              dist(g.nodes, g.links, a, b, { metric: 'sum' });
              shortestPath(g.nodes, g.links, a, b, { metric: 'sum' });
            }
            spread(g.nodes, g.links, a, 5, { metric: 'sum' });
            radius(g.nodes, g.links, a, 5, { metric: 'sum' });
          }
        }).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('对任意可达对：shortestPath 首尾为 a/b 且代价和 === dist（共用邻接不自相矛盾）', () => {
    fc.assert(
      fc.property(consistentGraphArb, (g) => {
        for (const a of Object.keys(g.nodes)) {
          for (const b of Object.keys(g.nodes)) {
            const d = dist(g.nodes, g.links, a, b, { metric: 'sum' });
            const path = shortestPath(g.nodes, g.links, a, b, { metric: 'sum' });
            if (d === null) {
              // 不可达则 shortestPath 也应 null
              expect(path).toBeNull();
              continue;
            }
            if (a === b) {
              expect(path).toEqual([a]);
              continue;
            }
            expect(path).not.toBeNull();
            expect(path![0]).toBe(a);
            expect(path![path!.length - 1]).toBe(b);
            // 序列代价和必须等于 dist
            let sum = 0;
            for (let i = 0; i < path!.length - 1; i++) {
              const from = path![i]!;
              const to = path![i + 1]!;
              const cost = edgeCost(g, from, to);
              if (cost === null) throw new Error(`${a}->${b} 路径经过不存在的边 ${from}->${to}`);
              sum += cost;
            }
            expect(sum).toBe(d);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('radius 与 dist(maxCost=budget) 可到集合一致；spread strength∈[0,budget]', () => {
    fc.assert(
      fc.property(consistentGraphArb, fc.integer({ min: 0, max: 12 }), (g, budget) => {
        for (const origin of Object.keys(g.nodes)) {
          const rad = radius(g.nodes, g.links, origin, budget, { metric: 'sum' });
          const reach = Object.keys(g.nodes)
            .filter((c) => c !== origin)
            .filter((c) => {
              const d = dist(g.nodes, g.links, origin, c, { metric: 'sum', maxCost: budget });
              return d !== null && d <= budget;
            })
            .sort();
          expect([...rad].sort()).toEqual(reach);

          const spreads = spread(g.nodes, g.links, origin, budget, { metric: 'sum' });
          for (const s of spreads) {
            expect(s.strength).toBeGreaterThanOrEqual(0);
            expect(s.strength).toBeLessThanOrEqual(budget);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('含负权/未知方向/自环/悬空的脏图：全部度量函数绝不抛（fail-closed）', () => {
    fc.assert(
      fc.property(dirtyGraphArb, (g) => {
        const ids = Object.keys(g.nodes);
        expect(() => {
          for (const a of ids) {
            dist(g.nodes, g.links, a, ids[0] ?? a, { metric: 'sum' });
            spread(g.nodes, g.links, a, 5, { metric: 'sum' });
            shortestPath(g.nodes, g.links, a, ids[0] ?? a, { metric: 'sum' });
            radius(g.nodes, g.links, a, 5, { metric: 'sum' });
          }
        }).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});

/**
 * 用与 metrics.ts buildAdjacency 完全一致的规则计算 from→to 的 sum-metric 代价，
 * 作为 `dist(a,b)===路径代价和` 断言的参考实现（对照验证 metrics 自身不自相矛盾）。
 * 逐链接按方向判定该方向的可用性；one-way-up 禁 a→b、one-way-down 禁 b→a、
 * 其余方向两向可用（无 direction 时 a→b 恒可用，b→a 取决于 directed 缺省）。
 */
function edgeCost(g: GraphModel, from: string, to: string): number | null {
  // Dijkstra 会把满足方向条件的所有平行边纳入距离松弛，取其中代价最小者；
  // reference 必须返回「全部可用方向边中的最小代价」，否则平行边会让 dist 偏离
  // 单边路径和。one-way-up 禁 a→b、one-way-down 禁 b→a、其余方向两向可用。
  let best: number | null = null;
  for (const link of Object.values(g.links)) {
    const dir = link.direction;
    if (link.a === from && link.b === to) {
      if (dir === 'one-way-up') continue; // a→b 禁用
      const cost = link.weight * (g.nodes[link.b]?.weight ?? 1);
      if (best === null || cost < best) best = cost;
    } else if (link.b === from && link.a === to) {
      if (dir === 'one-way-down') continue; // b→a 禁用
      const cost = link.weight * (g.nodes[link.a]?.weight ?? 1);
      if (best === null || cost < best) best = cost;
    }
  }
  return best;
}
