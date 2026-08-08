# L8层：Relation + Attachment — 属性测试任务

> **文件性质：历史执行 Prompt（方案 C — 属性实测轴，即工程验收的权威层编号）。已执行完毕。**
> 交付物：`kernel-l8-test`（10 项命名测试 / 220,006 次检查，PASS；修复 1 处缺陷：`destroyEntity()` 遗漏 `cascadeOnDepDestroy` 致 INV-13 失效）。
> 13 层总体结果与层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1 与 §3.2；
> 分发依据见 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md)。
> **注意**：各子项目内部使用的错误码（如 `E_INTENT_*`/`E_PHASE_*`）是测试工程本地命名，
> 不等于内核封闭注册表 `src/core/kernel/state/error-codes.ts` 的成员；两者对账属未执行的跨层门禁，
> 见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-03**。

## 任务目标

**用代码说话，不要推理。**

实现L8层关系系统（Relation）与附属系统（Attachment）+ 编写10万次属性测试 + 修复所有Bug + 提交报告。

---

## Step 1: 环境搭建

```bash
mkdir -p kernel-l8-test
cd kernel-l8-test
npm init -y
npm install fast-check typescript @types/node tsx vitest
npx tsc --init
```

---

## Step 2: 实现关系与附属系统

```typescript
// src/relation.ts

export interface RelationDef {
  id: string;
  type: string;
  from: string;   // entity ID
  to: string;     // entity ID
  attrs: Record<string, any>;
}

export interface AttachmentDef {
  id: string;
  type: string;
  target: string;         // entity ID
  grantedBy: string;      // item/entity ID that created this attachment
  effects: EffectDef[];
  deps: string[];         // dependency entity IDs — if any dep is destroyed, attachment removed
}

export interface EffectDef {
  op: string;
  args: Record<string, any>;
}

export class RelationSystem {
  private entities: Map<string, EntityStub> = new Map();
  private relations: Map<string, RelationDef> = new Map();
  private attachments: Map<string, AttachmentDef> = new Map();

  // — Entity stubs —
  createEntity(id: string): EntityStub {
    const e: EntityStub = { id, rel: { out: new Map(), in: new Map() }, attachments: new Set() };
    this.entities.set(id, e);
    return e;
  }

  destroyEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) throw new Error('E_REF_INVALID');

    // INV-6: 删除所有以该Entity为端点的Relation
    const relIds = [
      ...Array.from(entity.rel.out.values()).flat(),
      ...Array.from(entity.rel.in.values()).flat()
    ];
    for (const relId of relIds) {
      this.relation_del(relId);
    }

    // INV-13: 删除target为该Entity的Attachment
    for (const attId of [...entity.attachments]) {
      this.attachment_del(attId);
    }

    // INV-13: 若作为grantedBy，也需要级联删除
    for (const att of [...this.attachments.values()]) {
      if (att.grantedBy === id) {
        this.attachment_del(att.id);
      }
    }

    this.entities.delete(id);
  }

  // — Relation —
  relation_add(id: string, type: string, from: string, to: string, attrs: Record<string, any> = {}): RelationDef {
    if (!this.entities.has(from)) throw new Error('E_REF_INVALID');
    if (!this.entities.has(to)) throw new Error('E_REF_INVALID');

    const rel: RelationDef = { id, type, from, to, attrs };
    this.relations.set(id, rel);

    // INV-8: 双向索引
    const fromEnt = this.entities.get(from)!;
    const toEnt = this.entities.get(to)!;

    const outList = fromEnt.rel.out.get(type) ?? [];
    outList.push(id);
    fromEnt.rel.out.set(type, outList);

    const inList = toEnt.rel.in.get(type) ?? [];
    inList.push(id);
    toEnt.rel.in.set(type, inList);

    return rel;
  }

  relation_del(id: string): void {
    const rel = this.relations.get(id);
    if (!rel) return; // 幂等

    // 从双向索引中移除
    const fromEnt = this.entities.get(rel.from);
    const toEnt = this.entities.get(rel.to);

    if (fromEnt) {
      const outList = fromEnt.rel.out.get(rel.type) ?? [];
      fromEnt.rel.out.set(rel.type, outList.filter(x => x !== id));
    }
    if (toEnt) {
      const inList = toEnt.rel.in.get(rel.type) ?? [];
      toEnt.rel.in.set(rel.type, inList.filter(x => x !== id));
    }

    this.relations.delete(id);
  }

  // — Attachment —
  attachment_add(def: AttachmentDef): AttachmentDef {
    if (!this.entities.has(def.target)) throw new Error('E_REF_INVALID');
    if (!this.entities.has(def.grantedBy)) throw new Error('E_REF_INVALID');
    for (const dep of def.deps) {
      if (!this.entities.has(dep)) throw new Error('E_REF_INVALID');
    }

    this.attachments.set(def.id, def);
    this.entities.get(def.target)!.attachments.add(def.id);
    return def;
  }

  attachment_del(id: string): void {
    const att = this.attachments.get(id);
    if (!att) return;

    this.entities.get(att.target)?.attachments.delete(id);
    this.attachments.delete(id);
  }

  // INV-13: dep被销毁时级联删除Attachment
  private cascadeOnDepDestroy(depId: string): void {
    for (const att of [...this.attachments.values()]) {
      if (att.deps.includes(depId)) {
        this.attachment_del(att.id);
      }
    }
  }

  // — 不变量检查 —
  checkInvariants(): Violation[] {
    const violations: Violation[] = [];

    // INV-8: Relation双向索引对称
    for (const rel of this.relations.values()) {
      const fromEnt = this.entities.get(rel.from);
      const toEnt = this.entities.get(rel.to);

      if (!fromEnt) {
        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} from=${rel.from} missing` });
        continue;
      }
      if (!toEnt) {
        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} to=${rel.to} missing` });
        continue;
      }

      const hasOut = (fromEnt.rel.out.get(rel.type) ?? []).includes(rel.id);
      const hasIn = (toEnt.rel.in.get(rel.type) ?? []).includes(rel.id);

      if (!hasOut) violations.push({ code: 'E_INV_ASYMMETRIC', detail: `rel ${rel.id} missing in out-index` });
      if (!hasIn)  violations.push({ code: 'E_INV_ASYMMETRIC', detail: `rel ${rel.id} missing in in-index` });
    }

    // INV-13: Attachment的target和grantedBy必须存在
    for (const att of this.attachments.values()) {
      if (!this.entities.has(att.target)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} target=${att.target} missing` });
      }
      if (!this.entities.has(att.grantedBy)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} grantedBy=${att.grantedBy} missing` });
      }
      for (const dep of att.deps) {
        if (!this.entities.has(dep)) {
          violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} dep=${dep} missing` });
        }
      }
    }

    // Entity的attachments集合与attachments Map一致
    for (const ent of this.entities.values()) {
      for (const attId of ent.attachments) {
        if (!this.attachments.has(attId)) {
          violations.push({ code: 'E_INV_INCONSISTENT', detail: `entity ${ent.id} refs att ${attId} not in map` });
        }
      }
    }

    return violations;
  }

  get(type: 'entity' | 'relation' | 'attachment', id: string) {
    if (type === 'entity') return this.entities.get(id);
    if (type === 'relation') return this.relations.get(id);
    if (type === 'attachment') return this.attachments.get(id);
  }
}

interface EntityStub {
  id: string;
  rel: { out: Map<string, string[]>; in: Map<string, string[]> };
  attachments: Set<string>;
}

interface Violation { code: string; detail: string; }
```

---

## Step 3: 编写属性测试

```typescript
// test/l8-property.test.ts
import fc from 'fast-check';
import { RelationSystem } from '../src/relation';
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
              sys.relation_add(`r${i}`, uniqueTypes[i], 'e1', i % 2 === 0 ? 'e2' : 'e3');
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
    case 'destroy_entity': sys.destroyEntity(ENTITY_POOL[op.idx % ENTITY_POOL.length]); break;
    case 'relation_add':
      sys.relation_add(op.id, op.relType, ENTITY_POOL[op.fromIdx % ENTITY_POOL.length], ENTITY_POOL[op.toIdx % ENTITY_POOL.length]);
      break;
    case 'relation_del': sys.relation_del(REL_POOL[op.idx % REL_POOL.length]); break;
    case 'attachment_add':
      sys.attachment_add({
        id: op.id, type: 'aura',
        target: ENTITY_POOL[op.targetIdx % ENTITY_POOL.length],
        grantedBy: ENTITY_POOL[op.grantorIdx % ENTITY_POOL.length],
        effects: [],
        deps: [ENTITY_POOL[op.depIdx % ENTITY_POOL.length]]
      });
      break;
    case 'attachment_del': sys.attachment_del(ATT_POOL[op.idx % ATT_POOL.length]); break;
  }
}
```

---

## Step 4 & 5: 执行 + 报告

```bash
npx vitest run
```

报告格式同L3。**开始执行。用代码说话，不要推理。**
