import fc from 'fast-check';
import { RelationSystem, AttachmentDef } from '../src/relation';
import { describe, it, expect } from 'vitest';

describe('L8: Relation + Attachment', () => {

  // 属性测试1：任意操作后无悬空引用（10万次）
  it('INV-8/13: 任意操作后无悬空引用', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomL8Op(), { minLength: 1, maxLength: 40 }),
        (ops) => {
          const sys = new RelationSystem();
          setupInitial(sys);
          for (const op of ops) {
            try { execL8Op(sys, op); } catch {}
          }
          const v = sys.checkInvariants();
          if (v.length) console.error(v);
          return v.length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试2：Entity销毁后Relation对称删除（10万次）
  it('INV-8: entity销毁后其Relation全删，对端索引也清除', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 3, maxLength: 6 }),
        (relTypes) => {
          const sys = new RelationSystem();
          sys.createEntity('e1');
          sys.createEntity('e2');
          sys.createEntity('e3');

          const uniqueTypes = [...new Set(relTypes)].slice(0, 3);
          for (let i = 0; i < uniqueTypes.length; i++) {
            try {
              sys.relation_add(`r${i}`, uniqueTypes[i]!, 'e1', i % 2 === 0 ? 'e2' : 'e3');
            } catch {}
          }

          sys.destroyEntity('e1');

          // e2、e3的in/out索引应该清空
          const e2 = sys.get('entity', 'e2') as any;
          const e3 = sys.get('entity', 'e3') as any;
          const e2AllIn = [...(e2?.rel.in.values() ?? [])].flat();
          const e3AllIn = [...(e3?.rel.in.values() ?? [])].flat();
          const noOrphan = e2AllIn.length === 0 && e3AllIn.length === 0;

          return noOrphan && sys.checkInvariants().length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试3：Attachment的dep被销毁时级联删除（1万次）
  it('INV-13: dep销毁后Attachment级联删除', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const sys = new RelationSystem();
        sys.createEntity('target');
        sys.createEntity('grantor');
        sys.createEntity('dep1');
        sys.createEntity('dep2');

        sys.attachment_add({
          id: 'att1',
          type: 'aura',
          target: 'target',
          grantedBy: 'grantor',
          effects: [],
          deps: ['dep1', 'dep2']
        });

        // 销毁dep1
        sys.destroyEntity('dep1');

        // att1应该已被删除
        const attGone = !sys.get('attachment', 'att1');
        // target不再持有att1
        const targetClean = !(sys.get('entity', 'target') as any)?.attachments.has('att1');

        return attGone && targetClean && sys.checkInvariants().length === 0;
      }),
      { numRuns: 10000 }
    );
  });

  // 属性测试4：relation_del幂等（1万次）
  it('relation_del幂等', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const sys = new RelationSystem();
        sys.createEntity('e1');
        sys.createEntity('e2');
        sys.relation_add('r1', 'ally', 'e1', 'e2');
        sys.relation_del('r1');
        sys.relation_del('r1'); // 第二次不应抛异常
        return sys.checkInvariants().length === 0;
      }),
      { numRuns: 10000 }
    );
  });

  // 边界测试：自Relation（entity指向自身）
  it('自Relation: entity→entity', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    // Spec未明确是否允许，实现选择允许并验证不变量
    try {
      sys.relation_add('rSelf', 'self', 'e1', 'e1');
      expect(sys.checkInvariants()).toHaveLength(0);
    } catch (e: any) {
      expect(['E_REF_INVALID', 'E_RELATION_SELF_LOOP']).toContain(e.message);
    }
  });

  // 边界测试：同类型重复Relation
  it('同一对Entity可以有多个同类型Relation', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    sys.relation_add('r2', 'ally', 'e1', 'e2'); // 再加一条
    expect(sys.checkInvariants()).toHaveLength(0);
  });

  // 边界测试：grantedBy销毁时Attachment级联删除
  it('INV-13: grantedBy销毁后Attachment级联删除', () => {
    const sys = new RelationSystem();
    sys.createEntity('target');
    sys.createEntity('grantor');
    sys.attachment_add({ id: 'att1', type: 'aura', target: 'target', grantedBy: 'grantor', effects: [], deps: [] });

    sys.destroyEntity('grantor');
    expect(sys.get('attachment', 'att1')).toBeUndefined();
    expect(sys.checkInvariants()).toHaveLength(0);
  });

  // 边界测试：target销毁时Attachment级联删除
  it('INV-13: target销毁后Attachment级联删除', () => {
    const sys = new RelationSystem();
    sys.createEntity('target');
    sys.createEntity('grantor');
    sys.attachment_add({ id: 'att1', type: 'aura', target: 'target', grantedBy: 'grantor', effects: [], deps: [] });

    sys.destroyEntity('target');
    expect(sys.get('attachment', 'att1')).toBeUndefined();
    expect(sys.checkInvariants()).toHaveLength(0);
  });

  // 边界测试：重复id的relation_add不产生重复索引（脏索引回归测试）
  it('relation_add重复id不产生重复索引', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.createEntity('e3');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    // 用同一个id但不同端点重新add
    sys.relation_add('r1', 'ally', 'e1', 'e3');
    expect(sys.checkInvariants()).toHaveLength(0);
    const e2 = sys.get('entity', 'e2') as any;
    const e2In = [...(e2.rel.in.values() as any)].flat();
    expect(e2In).not.toContain('r1');
  });

  // 边界测试：重复id的attachment_add不产生脏引用
  it('attachment_add重复id不产生脏引用', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('t2');
    sys.createEntity('grantor');
    sys.attachment_add({ id: 'a1', type: 'aura', target: 't1', grantedBy: 'grantor', effects: [], deps: [] });
    sys.attachment_add({ id: 'a1', type: 'aura', target: 't2', grantedBy: 'grantor', effects: [], deps: [] });
    expect(sys.checkInvariants()).toHaveLength(0);
    const t1 = sys.get('entity', 't1') as any;
    expect(t1.attachments.has('a1')).toBe(false);
  });
});

// ---- 辅助 ----
type L8Op =
  | { type: 'create_entity'; id: string }
  | { type: 'destroy_entity'; idx: number }
  | { type: 'relation_add'; id: string; relType: string; fromIdx: number; toIdx: number }
  | { type: 'relation_del'; idx: number }
  | { type: 'attachment_add'; id: string; targetIdx: number; grantorIdx: number; depIdx: number }
  | { type: 'attachment_del'; idx: number };

const ENTITY_POOL = ['e0','e1','e2','e3','e4','e5','e6','e7'];
const REL_POOL    = ['r0','r1','r2','r3','r4','r5','r6','r7'];
const ATT_POOL    = ['a0','a1','a2','a3','a4'];

function genRandomL8Op() {
  return fc.oneof(
    fc.record({ type: fc.constant('create_entity' as const), id: fc.uuid() }),
    fc.record({ type: fc.constant('destroy_entity' as const), idx: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ type: fc.constant('relation_add' as const), id: fc.uuid(), relType: fc.constantFrom('ally','enemy','owns'), fromIdx: fc.integer({ min: 0, max: 7 }), toIdx: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ type: fc.constant('relation_del' as const), idx: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ type: fc.constant('attachment_add' as const), id: fc.uuid(), targetIdx: fc.integer({ min: 0, max: 7 }), grantorIdx: fc.integer({ min: 0, max: 7 }), depIdx: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ type: fc.constant('attachment_del' as const), idx: fc.integer({ min: 0, max: 4 }) })
  );
}

function setupInitial(sys: RelationSystem) {
  for (const id of ENTITY_POOL) {
    try { sys.createEntity(id); } catch {}
  }
}

function execL8Op(sys: RelationSystem, op: L8Op) {
  switch (op.type) {
    case 'create_entity': sys.createEntity(op.id); break;
    case 'destroy_entity': sys.destroyEntity(ENTITY_POOL[op.idx % ENTITY_POOL.length]!); break;
    case 'relation_add':
      sys.relation_add(op.id, op.relType, ENTITY_POOL[op.fromIdx % ENTITY_POOL.length]!, ENTITY_POOL[op.toIdx % ENTITY_POOL.length]!);
      break;
    case 'relation_del': sys.relation_del(REL_POOL[op.idx % REL_POOL.length]!); break;
    case 'attachment_add':
      sys.attachment_add({
        id: op.id, type: 'aura',
        target: ENTITY_POOL[op.targetIdx % ENTITY_POOL.length]!,
        grantedBy: ENTITY_POOL[op.grantorIdx % ENTITY_POOL.length]!,
        effects: [],
        deps: [ENTITY_POOL[op.depIdx % ENTITY_POOL.length]!]
      });
      break;
    case 'attachment_del': sys.attachment_del(ATT_POOL[op.idx % ATT_POOL.length]!); break;
  }
}
