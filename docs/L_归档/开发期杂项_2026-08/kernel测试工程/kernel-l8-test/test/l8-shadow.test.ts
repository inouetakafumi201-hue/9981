/**
 * L8 影子模型对照套件。
 *
 * 原套件的空转成因（已由 probe 实测确认，不是推断）：
 * `relation_add` 的 id 取 `fc.uuid()`，而 `relation_del` 的 id 取自固定池
 * `REL_POOL = ['r0'..'r7']`——**两个池不相交**。于是 2000 次随机序列里
 * `relation_del` 真正删到东西的次数是 **0/2000**，`attachment_del` 同为 0/2000，
 * `create_entity` 造出的 uuid 实体也没有任何后续操作能引用到。
 * 六种 op 里有三种是整段 100,000 次运行中的死代码。
 *
 * 本套件的 id 一律取自**小且共用**的池：add 与 del 抽同一个池，
 * 删除、覆盖、级联才成为可达事件。
 */
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { RelationSystem } from '../src/relation';
import { RelationModel, show } from './model/relation-model';

const RUNS = Number(process.env.L8_RUNS ?? 20_000);
const SMALL = Math.max(200, Math.floor(RUNS / 4));

/** 全部池刻意极小，且 del 与 add 共用，保证删除/覆盖/级联可达。 */
const ENTS = ['e0', 'e1', 'e2', 'e3'];
const RELS = ['r0', 'r1', 'r2'];
const ATTS = ['a0', 'a1'];
const TYPES = ['ally', 'enemy'];

type Op =
  | { k: 'ce'; id: string }
  | { k: 'de'; id: string }
  | { k: 'ra'; id: string; type: string; from: string; to: string; attr: number }
  | { k: 'rd'; id: string }
  | { k: 'aa'; id: string; type: string; target: string; grantor: string; deps: string[]; effects: number }
  | { k: 'ad'; id: string };

const genOp = (): fc.Arbitrary<Op> =>
  fc.oneof(
    fc.record({ k: fc.constant('ce' as const), id: fc.constantFrom(...ENTS) }),
    fc.record({ k: fc.constant('de' as const), id: fc.constantFrom(...ENTS) }),
    fc.record({
      k: fc.constant('ra' as const),
      id: fc.constantFrom(...RELS),
      type: fc.constantFrom(...TYPES),
      from: fc.constantFrom(...ENTS),
      to: fc.constantFrom(...ENTS),
      attr: fc.integer({ min: 0, max: 3 }),
    }),
    fc.record({ k: fc.constant('rd' as const), id: fc.constantFrom(...RELS) }),
    fc.record({
      k: fc.constant('aa' as const),
      id: fc.constantFrom(...ATTS),
      type: fc.constantFrom('aura', 'curse'),
      target: fc.constantFrom(...ENTS),
      grantor: fc.constantFrom(...ENTS),
      deps: fc.uniqueArray(fc.constantFrom(...ENTS), { minLength: 0, maxLength: 2 }),
      effects: fc.integer({ min: 0, max: 2 }),
    }),
    fc.record({ k: fc.constant('ad' as const), id: fc.constantFrom(...ATTS) }),
  );

/** 在产品与模型上执行同一 op，返回错误码（或 null）。 */
function applyBoth(sys: RelationSystem, mod: RelationModel, op: Op): { p: string | null; m: string | null } {
  const run = (f: () => void): string | null => {
    try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  switch (op.k) {
    case 'ce':
      return { p: run(() => sys.createEntity(op.id)), m: run(() => mod.createEntity(op.id)) };
    case 'de':
      return { p: run(() => sys.destroyEntity(op.id)), m: run(() => mod.destroyEntity(op.id)) };
    case 'ra':
      return {
        p: run(() => sys.relation_add(op.id, op.type, op.from, op.to, { w: op.attr })),
        m: run(() => mod.relationAdd(op.id, op.type, op.from, op.to, { w: op.attr })),
      };
    case 'rd':
      return { p: run(() => sys.relation_del(op.id)), m: run(() => mod.relationDel(op.id)) };
    case 'aa': {
      const effects = Array.from({ length: op.effects }, (_, i) => ({ op: `o${i}`, args: {} }));
      return {
        p: run(() => sys.attachment_add({
          id: op.id, type: op.type, target: op.target, grantedBy: op.grantor,
          effects, deps: [...op.deps],
        })),
        m: run(() => mod.attachmentAdd({
          id: op.id, type: op.type, target: op.target, grantedBy: op.grantor,
          deps: [...op.deps], effectCount: op.effects,
        })),
      };
    }
    case 'ad':
      return { p: run(() => sys.attachment_del(op.id)), m: run(() => mod.attachmentDel(op.id)) };
  }
}

function seed(sys: RelationSystem, mod: RelationModel): void {
  for (const e of ENTS) {
    sys.createEntity(e);
    mod.createEntity(e);
  }
}

describe('L8 影子模型：全量状态逐字段对照', () => {
  it('任意 op 序列后，主表与双向索引与独立推导的模型完全一致', () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 30 }), (ops) => {
        const sys = new RelationSystem();
        const mod = new RelationModel();
        seed(sys, mod);
        for (const op of ops) applyBoth(sys, mod, op);
        expect(show(sys.dump())).toBe(show(mod.dump()));
      }),
      { numRuns: RUNS },
    );
  });

  it('每一步的错误码都与模型一致（不是只比末态）', () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 30 }), (ops) => {
        const sys = new RelationSystem();
        const mod = new RelationModel();
        seed(sys, mod);
        for (const op of ops) {
          const { p, m } = applyBoth(sys, mod, op);
          // 只比末态时，"该抛却没抛"会被后续操作掩盖
          expect(p).toBe(m);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('逐步对照：每一步之后立刻比全量状态', () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 12 }), (ops) => {
        const sys = new RelationSystem();
        const mod = new RelationModel();
        seed(sys, mod);
        ops.forEach((op, i) => {
          applyBoth(sys, mod, op);
          // 末态相同不代表每步相同：两个相反的错误可以互相抵消
          expect(show(sys.dump()), `第 ${i} 步 op=${op.k} 后分歧`).toBe(show(mod.dump()));
        });
      }),
      { numRuns: SMALL },
    );
  });

  it('任意 op 序列后 checkInvariants 必为空（此处是必要条件，不是判据）', () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 30 }), (ops) => {
        const sys = new RelationSystem();
        const mod = new RelationModel();
        seed(sys, mod);
        for (const op of ops) applyBoth(sys, mod, op);
        expect(sys.checkInvariants()).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('L8 影子模型：删除与覆盖确实可达（防止再次空转）', () => {
  it('随机序列里 relation_del 与 attachment_del 有实际生效的样本', () => {
    let relHits = 0;
    let attHits = 0;
    let overwrite = 0;
    let dupEntity = 0;
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 5, maxLength: 30 }), (ops) => {
        const sys = new RelationSystem();
        const mod = new RelationModel();
        seed(sys, mod);
        for (const op of ops) {
          if (op.k === 'rd' && sys.get('relation', op.id) !== undefined) relHits++;
          if (op.k === 'ad' && sys.get('attachment', op.id) !== undefined) attHits++;
          if (op.k === 'ra' && sys.get('relation', op.id) !== undefined) overwrite++;
          if (op.k === 'ce' && sys.get('entity', op.id) !== undefined) dupEntity++;
          applyBoth(sys, mod, op);
        }
        return true;
      }),
      { numRuns: SMALL },
    );
    // 原套件这四个计数全为 0——池不相交，删除分支是死代码
    expect(relHits).toBeGreaterThan(0);
    expect(attHits).toBeGreaterThan(0);
    expect(overwrite).toBeGreaterThan(0);
    expect(dupEntity).toBeGreaterThan(0);
  });
});
