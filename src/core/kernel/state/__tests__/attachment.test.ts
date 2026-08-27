import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cascadeRemovalSet, type Attachment } from '../attachment';

function att(id: string, grantedBy?: string): Attachment {
  return { id, def: 'd:x', target: { $: 'e:1' }, props: {}, stack: 1, grantedBy };
}

describe('Attachment 级联移除（需求2.7, 30.7）', () => {
  it('单层：根 + 一个子代', () => {
    const all = [att('a:1'), att('a:2', 'a:1')];
    const result = cascadeRemovalSet(all, 'a:1');
    expect(result).toEqual(new Set(['a:1', 'a:2']));
  });

  it('多层：根 + 子 + 孙', () => {
    const all = [att('a:1'), att('a:2', 'a:1'), att('a:3', 'a:2'), att('a:4')];
    const result = cascadeRemovalSet(all, 'a:1');
    expect(result).toEqual(new Set(['a:1', 'a:2', 'a:3']));
    expect(result.has('a:4')).toBe(false);
  });

  it('Property: 对于任意 grantedBy 森林，级联移除集合恰好等于从根可达的全部节点', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 1, maxLength: 16 }),
        (parentSelectors) => {
          // 构造一棵森林：节点 i 的 parent 是 parentSelectors[i] % i（保证无环，i=0 无父）
          const all: Attachment[] = parentSelectors.map((sel, i) => {
            if (i === 0) return att('a:0');
            const parentIdx = sel % i;
            return att(`a:${i}`, `a:${parentIdx}`);
          });
          // 计算期望：从 a:0 BFS 可达的全部节点
          const childrenOf = new Map<number, number[]>();
          for (let i = 1; i < all.length; i++) {
            const parentIdx = parentSelectors[i]! % i;
            const list = childrenOf.get(parentIdx) ?? [];
            list.push(i);
            childrenOf.set(parentIdx, list);
          }
          const expected = new Set<string>();
          const queue = [0];
          while (queue.length > 0) {
            const cur = queue.shift() as number;
            expected.add(`a:${cur}`);
            for (const child of childrenOf.get(cur) ?? []) queue.push(child);
          }
          const result = cascadeRemovalSet(all, 'a:0');
          expect(result).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
