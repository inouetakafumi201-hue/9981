import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { linksTouching, connectedComponents, cascadeNodeDestroySet } from '../graph.js';
import { createNodeShape, createLinkShape } from '../types.js';
import type { Node, Link } from '../types.js';

describe('Node/Link 基本拓扑操作（需求7.1-7.6）', () => {
  it('linksTouching 找到全部以该节点为端点的 Link（需求7.5 级联销毁的输入）', () => {
    const links: Record<string, Link> = {
      'l:1': createLinkShape('l:1', 'n:1', 'n:2'),
      'l:2': createLinkShape('l:2', 'n:2', 'n:3'),
      'l:3': createLinkShape('l:3', 'n:4', 'n:5'),
    };
    expect(linksTouching(links, 'n:2').sort()).toEqual(['l:1', 'l:2']);
    expect(linksTouching(links, 'n:5')).toEqual(['l:3']);
    expect(linksTouching(links, 'n:99')).toEqual([]);
  });

  it('拓扑允许不连通分量（需求7.6）', () => {
    const nodes: Record<string, Node> = {
      'n:1': createNodeShape('n:1', 'd:x'),
      'n:2': createNodeShape('n:2', 'd:x'),
      'n:3': createNodeShape('n:3', 'd:x'),
      'n:4': createNodeShape('n:4', 'd:x'),
    };
    const links: Record<string, Link> = {
      'l:1': createLinkShape('l:1', 'n:1', 'n:2'),
    };
    const components = connectedComponents(nodes, links);
    expect(components.length).toBe(3); // {n:1,n:2}, {n:3}, {n:4}
  });

  it('cascadeNodeDestroySet 递归计算父子级联销毁集合（需求20.7）', () => {
    const nodes: Record<string, Node> = {
      'n:1': createNodeShape('n:1', 'd:x'),
      'n:2': createNodeShape('n:2', 'd:x', { parent: 'n:1' }),
      'n:3': createNodeShape('n:3', 'd:x', { parent: 'n:2' }),
      'n:4': createNodeShape('n:4', 'd:x'),
    };
    const result = cascadeNodeDestroySet(nodes, 'n:1');
    expect(result).toEqual(new Set(['n:1', 'n:2', 'n:3']));
  });

  it('Property: 对于任意森林结构，级联销毁集合恰好等于从根可达的全部子代', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 21 }), (parentSelectors) => {
        const nodes: Record<string, Node> = {};
        nodes['n:0'] = createNodeShape('n:0', 'd:x');
        for (let i = 1; i < parentSelectors.length; i++) {
          const parentIdx = parentSelectors[i]! % i;
          nodes[`n:${i}`] = createNodeShape(`n:${i}`, 'd:x', { parent: `n:${parentIdx}` });
        }
        const childrenOf = new Map<number, number[]>();
        for (let i = 1; i < parentSelectors.length; i++) {
          const parentIdx = parentSelectors[i]! % i;
          const list = childrenOf.get(parentIdx) ?? [];
          list.push(i);
          childrenOf.set(parentIdx, list);
        }
        const expected = new Set<string>();
        const queue = [0];
        while (queue.length > 0) {
          const cur = queue.shift() as number;
          expected.add(`n:${cur}`);
          for (const child of childrenOf.get(cur) ?? []) queue.push(child);
        }
        const result = cascadeNodeDestroySet(nodes, 'n:0');
        expect(result).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});
