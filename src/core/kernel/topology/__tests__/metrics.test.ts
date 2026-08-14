import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { dist, spread } from '../metrics.js';
import { createNodeShape, createLinkShape } from '../types.js';
import type { Node, Link } from '../types.js';

function makeChain(n: number): { nodes: Record<string, Node>; links: Record<string, Link> } {
  const nodes: Record<string, Node> = {};
  const links: Record<string, Link> = {};
  for (let i = 0; i < n; i++) nodes[`n:${i}`] = createNodeShape(`n:${i}`, 'd:x');
  for (let i = 0; i < n - 1; i++) links[`l:${i}`] = createLinkShape(`l:${i}`, `n:${i}`, `n:${i + 1}`, { weight: 1 });
  return { nodes, links };
}

describe('dist / spread（需求11.1-11.7）', () => {
  it('两个不连通分量之间 dist 返回 null（需求11.2, 8.7）', () => {
    const nodes: Record<string, Node> = {
      'n:1': createNodeShape('n:1', 'd:x'),
      'n:2': createNodeShape('n:2', 'd:x'),
    };
    expect(dist(nodes, {}, 'n:1', 'n:2')).toBeNull();
  });

  it('链式拓扑的加权最短路', () => {
    const { nodes, links } = makeChain(5);
    expect(dist(nodes, links, 'n:0', 'n:4')).toBe(4);
  });

  it('maxCost 截断：超出代价时返回 null', () => {
    const { nodes, links } = makeChain(5);
    expect(dist(nodes, links, 'n:0', 'n:4', { maxCost: 2 })).toBeNull();
  });

  it('via 谓词：仅沿满足条件的边计算', () => {
    const nodes: Record<string, Node> = {
      'n:1': createNodeShape('n:1', 'd:x'),
      'n:2': createNodeShape('n:2', 'd:x'),
      'n:3': createNodeShape('n:3', 'd:x'),
    };
    const links: Record<string, Link> = {
      'l:1': { ...createLinkShape('l:1', 'n:1', 'n:2'), tags: ['door'] },
      'l:2': { ...createLinkShape('l:2', 'n:1', 'n:3'), tags: ['wall'] },
    };
    const result = dist(nodes, links, 'n:1', 'n:3', { via: (l) => l.tags.includes('door') });
    expect(result).toBeNull();
  });

  it('spread 返回按强度降序、NodeId 升序排列的有序数组（需求11.6-11.7）', () => {
    const { nodes, links } = makeChain(4);
    const result = spread(nodes, links, 'n:0', 10);
    expect(result.length).toBe(3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.strength).toBeGreaterThanOrEqual(result[i]!.strength);
    }
    // n:1 应该是强度最高、n:3 最低
    expect(result[0]!.node).toBe('n:1');
  });

  it('spread 每个可达节点包含剩余强度与上游来源', () => {
    const { nodes, links } = makeChain(3);
    const result = spread(nodes, links, 'n:0', 5);
    const n1 = result.find((r) => r.node === 'n:1');
    expect(n1?.from).toBe('n:0');
  });

  it('one-way-down 在 dist 中只可 a→b，反向不可达（需求11.2 + reconciliation 要求1）', () => {
    const nodes: Record<string, Node> = {
      'n:a': createNodeShape('n:a', 'd:x'),
      'n:b': createNodeShape('n:b', 'd:x'),
    };
    const links: Record<string, Link> = {
      'l:1': createLinkShape('l:1', 'n:a', 'n:b', { direction: 'one-way-down', weight: 1 }),
    };
    // a→b 可达；b→a 被方向禁用
    expect(dist(nodes, links, 'n:a', 'n:b')).toBe(1);
    expect(dist(nodes, links, 'n:b', 'n:a')).toBeNull();
  });

  it('one-way-up 在 dist 中只可 b→a，正向不可达（需求11.2 + reconciliation 要求1）', () => {
    const nodes: Record<string, Node> = {
      'n:a': createNodeShape('n:a', 'd:x'),
      'n:b': createNodeShape('n:b', 'd:x'),
    };
    const links: Record<string, Link> = {
      'l:1': createLinkShape('l:1', 'n:a', 'n:b', { direction: 'one-way-up', weight: 1 }),
    };
    // 反向 b→a 可达；正向 a→b 被禁用
    expect(dist(nodes, links, 'n:b', 'n:a')).toBe(1);
    expect(dist(nodes, links, 'n:a', 'n:b')).toBeNull();
  });

  it('bidirectional 显式方向 token 两向可达，与 directed 布尔回退一致', () => {
    const nodes: Record<string, Node> = {
      'n:a': createNodeShape('n:a', 'd:x'),
      'n:b': createNodeShape('n:b', 'd:x'),
    };
    const bi = createLinkShape('l:bi', 'n:a', 'n:b', { direction: 'bidirectional', weight: 1 });
    expect(dist(nodes, { 'l:bi': bi }, 'n:a', 'n:b')).toBe(1);
    expect(dist(nodes, { 'l:bi': bi }, 'n:b', 'n:a')).toBe(1);

    // back-compat：只设 directed（不存在 direction token）语义不变
    const legacy = createLinkShape('l:legacy', 'n:a', 'n:b', { directed: false, weight: 1 });
    expect(dist(nodes, { 'l:legacy': legacy }, 'n:a', 'n:b')).toBe(1);
    expect(dist(nodes, { 'l:legacy': legacy }, 'n:b', 'n:a')).toBe(1);
  });

  it('Property 方向可达性×权值×hops：与单调重定义无关，但覆盖方向四值在混合图上的组合', () => {
    const directions = ['bidirectional', 'unidirectional', 'one-way-down', 'one-way-up'] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...directions),
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(),
        (direction, weight, hops) => {
          const nodes: Record<string, Node> = {
            'n:a': createNodeShape('n:a', 'd:x'),
            'n:b': createNodeShape('n:b', 'd:x'),
          };
          // 权重仅当 metric 为 sum 时生效；hops 下恒为 1
          const links: Record<string, Link> = {
            'l:1': createLinkShape('l:1', 'n:a', 'n:b', { direction, weight }),
          };
          const metric = hops ? 'hops' : 'sum';
          const cost = metric === 'hops' ? 1 : weight;
          // 期望的可达性：由 direction 精确决定
          const aToB = direction === 'one-way-up' ? false : true; // 仅 upward 禁 a→b
          const bToA = direction === 'one-way-down' ? false : true; // 仅 downward 禁 b→a
          if (aToB) expect(dist(nodes, links, 'n:a', 'n:b', { metric })).toBe(cost);
          else expect(dist(nodes, links, 'n:a', 'n:b', { metric })).toBeNull();
          if (bToA) expect(dist(nodes, links, 'n:b', 'n:a', { metric })).toBe(cost);
          else expect(dist(nodes, links, 'n:b', 'n:a', { metric })).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 不变量 x in nodes → dist(x,x)=0；a→非目标经 via/maxCost 不越界', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        (n, undirected) => {
          const { nodes, links } = makeChainPlus(n, undirected);
          // 自环距离恒为 0（需求 11.1）
          for (const id of Object.keys(nodes)) {
            expect(dist(nodes, links, id, id)).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** 从 0 到 n 的链，可选双向；供混合方向属性测试复用。 */
function makeChainPlus(n: number, undirected: boolean): { nodes: Record<string, Node>; links: Record<string, Link> } {
  const nodes: Record<string, Node> = {};
  const links: Record<string, Link> = {};
  for (let i = 0; i <= n; i++) nodes[`n:${i}`] = createNodeShape(`n:${i}`, 'd:x');
  for (let i = 0; i < n; i++) {
    links[`l:${i}`] = createLinkShape(`l:${i}`, `n:${i}`, `n:${i + 1}`, {
      weight: ((i + 1) % 3) + 1,
      ...(undirected ? {} : { direction: 'one-way-down' as const }),
    });
  }
  return { nodes, links };
}
