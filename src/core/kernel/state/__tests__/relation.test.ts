import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RelationIndex } from '../relation.js';
import type { Ref } from '../ids.js';

function ref(id: string): Ref {
  return { $: id };
}

describe('RelationIndex: 对称性与级联清理（需求6.1-6.7）', () => {
  it('_add 后 relOut/relIn 互为镜像', () => {
    const idx = new RelationIndex();
    idx._add(ref('e:1'), ref('e:2'), 'knows');
    expect(idx.relOut(ref('e:1'), 'knows')).toEqual([ref('e:2')]);
    expect(idx.relIn(ref('e:2'), 'knows')).toEqual([ref('e:1')]);
  });

  it('支持同一对 (from,to) 存在多个不同 kind 的 Relation（需求6.2）', () => {
    const idx = new RelationIndex();
    idx._add(ref('e:1'), ref('e:2'), 'knows');
    idx._add(ref('e:1'), ref('e:2'), 'owns');
    expect(idx.relOut(ref('e:1'), 'knows')).toEqual([ref('e:2')]);
    expect(idx.relOut(ref('e:1'), 'owns')).toEqual([ref('e:2')]);
  });

  it('支持同一 from 对多个不同 to 建立同一 kind 的 Relation（需求6.3）', () => {
    const idx = new RelationIndex();
    idx._add(ref('e:1'), ref('e:2'), 'knows');
    idx._add(ref('e:1'), ref('e:3'), 'knows');
    expect(idx.relOut(ref('e:1'), 'knows')).toEqual([ref('e:2'), ref('e:3')]);
  });

  it('_removeAllInvolving 移除全部以该 Ref 为端点的 Relation（需求6.6）', () => {
    const idx = new RelationIndex();
    idx._add(ref('e:1'), ref('e:2'), 'knows');
    idx._add(ref('e:3'), ref('e:1'), 'owns');
    idx._removeAllInvolving(ref('e:1'));
    expect(idx.relOut(ref('e:1'), 'knows')).toEqual([]);
    expect(idx.relIn(ref('e:2'), 'knows')).toEqual([]);
    expect(idx.relOut(ref('e:3'), 'owns')).toEqual([]);
    expect(idx.relIn(ref('e:1'), 'owns')).toEqual([]);
  });

  it('Property: 对于任意 _add(a,b,k)，relOut(a,k) 应包含 b 且 relIn(b,k) 应包含 a；销毁 a 后以 a 为端点的关系应消失（需求6.6, 20.8）', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            from: fc.integer({ min: 0, max: 5 }),
            to: fc.integer({ min: 0, max: 5 }),
            kind: fc.constantFrom('knows', 'owns', 'allies'),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.integer({ min: 0, max: 5 }),
        (edges, destroyTarget) => {
          const idx = new RelationIndex();
          for (const e of edges) {
            idx._add(ref(`e:${e.from}`), ref(`e:${e.to}`), e.kind);
          }
          for (const e of edges) {
            expect(idx.relOut(ref(`e:${e.from}`), e.kind)).toContainEqual(ref(`e:${e.to}`));
            expect(idx.relIn(ref(`e:${e.to}`), e.kind)).toContainEqual(ref(`e:${e.from}`));
          }
          const target = ref(`e:${destroyTarget}`);
          idx._removeAllInvolving(target);
          for (const kind of ['knows', 'owns', 'allies']) {
            expect(idx.relOut(target, kind)).toEqual([]);
            expect(idx.relIn(target, kind)).toEqual([]);
            for (let other = 0; other <= 5; other++) {
              expect(idx.relOut(ref(`e:${other}`), kind)).not.toContainEqual(target);
              expect(idx.relIn(ref(`e:${other}`), kind)).not.toContainEqual(target);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
