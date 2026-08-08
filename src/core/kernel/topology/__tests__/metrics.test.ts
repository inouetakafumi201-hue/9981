import { describe, it, expect } from 'vitest';
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
});
