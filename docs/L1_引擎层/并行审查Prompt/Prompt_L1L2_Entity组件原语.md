# L1/L2层：Entity + Component 原语 — 属性测试任务

> **文件性质：历史执行 Prompt（方案 C — 属性实测轴，即工程验收的权威层编号）。已执行完毕。**
> 交付物：`kernel-l1l2-test`（15 项命名测试 / 610,008 次检查，PASS；报告 `L1L2_TEST_REPORT.md`）。
> 13 层总体结果与层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1 与 §3.2；
> 分发依据见 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md)。
> **注意**：各子项目内部使用的错误码（如 `E_INTENT_*`/`E_PHASE_*`）是测试工程本地命名，
> 不等于内核封闭注册表 `src/core/kernel/state/error-codes.ts` 的成员；两者对账属未执行的跨层门禁，
> 见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-03**。

## 任务目标

**用代码说话，不要推理。**

实现L1/L2层Entity/Component原语 + 编写10万次属性测试 + 修复所有Bug + 提交报告。

**核心命题**：Entity是纯ID，Component是纯数据。任何`comp_add/comp_del/comp_set/entity_create/entity_destroy`序列后，都不能出现：孤儿Component、重复Component、ID复用冲突、销毁后残留。

---

## Step 1: 环境搭建

```bash
mkdir -p kernel-l1l2-test
cd kernel-l1l2-test
npm init -y
npm install fast-check typescript @types/node tsx vitest
npx tsc --init
```

---

## Step 2: 实现Entity/Component系统

```typescript
// src/ecs.ts

export type EntityId = string;
export type CompType = string;

export interface Component {
  type: CompType;
  data: Record<string, number | string | boolean | null>;
}

export class EcsWorld {
  private entities: Set<EntityId> = new Set();
  private destroyed: Set<EntityId> = new Set();       // 已销毁ID墓碑，防止复用
  private comps: Map<EntityId, Map<CompType, Component>> = new Map();
  private byType: Map<CompType, Set<EntityId>> = new Map();  // 反向索引
  private nextId = 0;

  // —— Entity 原语 ——
  entity_create(explicitId?: EntityId): EntityId {
    const id = explicitId ?? `e${this.nextId++}`;
    if (this.entities.has(id)) throw new Error('E_ENT_DUPLICATE_ID');
    if (this.destroyed.has(id)) throw new Error('E_ENT_ID_REUSE');
    this.entities.add(id);
    this.comps.set(id, new Map());
    return id;
  }

  entity_destroy(id: EntityId): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');

    // 清理所有Component + 反向索引（不能有孤儿）
    const bag = this.comps.get(id);
    if (bag) {
      for (const type of [...bag.keys()]) {
        this.byType.get(type)?.delete(id);
        if (this.byType.get(type)?.size === 0) this.byType.delete(type);
      }
    }
    this.comps.delete(id);
    this.entities.delete(id);
    this.destroyed.add(id);
  }

  entity_exists(id: EntityId): boolean { return this.entities.has(id); }

  // —— Component 原语 ——
  comp_add(id: EntityId, type: CompType, data: Component['data'] = {}): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    if (!type || type.length === 0) throw new Error('E_COMP_INVALID_TYPE');

    const bag = this.comps.get(id)!;
    if (bag.has(type)) throw new Error('E_COMP_DUPLICATE');

    // 深拷贝：Component是纯数据，外部引用不得影响世界状态
    bag.set(type, { type, data: { ...data } });

    let set = this.byType.get(type);
    if (!set) { set = new Set(); this.byType.set(type, set); }
    set.add(id);
  }

  comp_del(id: EntityId, type: CompType): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    const bag = this.comps.get(id)!;
    if (!bag.has(type)) return;  // 幂等：删不存在的Component不报错

    bag.delete(type);
    const set = this.byType.get(type);
    set?.delete(id);
    if (set && set.size === 0) this.byType.delete(type);
  }

  comp_get(id: EntityId, type: CompType): Component | undefined {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    const c = this.comps.get(id)!.get(type);
    if (!c) return undefined;
    return { type: c.type, data: { ...c.data } };  // 返回拷贝，防止外部改写
  }

  comp_set(id: EntityId, type: CompType, key: string, value: number | string | boolean | null): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    const c = this.comps.get(id)!.get(type);
    if (!c) throw new Error('E_COMP_NOT_FOUND');
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('E_COMP_NON_FINITE');   // INV-16
    }
    c.data[key] = value;
  }

  comp_has(id: EntityId, type: CompType): boolean {
    if (!this.entities.has(id)) return false;
    return this.comps.get(id)!.has(type);
  }

  query_byType(type: CompType): EntityId[] {
    return [...(this.byType.get(type) ?? [])].sort();  // 确定性顺序
  }

  // —— 不变量检查 ——
  checkInvariants(): string[] {
    const v: string[] = [];

    // ECS-1: comps的每个key都必须是存活Entity
    for (const id of this.comps.keys()) {
      if (!this.entities.has(id)) v.push(`ORPHAN_COMP_BAG:${id}`);
    }

    // ECS-2: 每个存活Entity都必须有一个comp bag（哪怕是空的）
    for (const id of this.entities) {
      if (!this.comps.has(id)) v.push(`MISSING_COMP_BAG:${id}`);
    }

    // ECS-3: 反向索引与正向存储双向一致
    for (const [type, ids] of this.byType) {
      if (ids.size === 0) v.push(`EMPTY_TYPE_INDEX:${type}`);
      for (const id of ids) {
        if (!this.entities.has(id)) { v.push(`INDEX_DANGLING:${type}->${id}`); continue; }
        if (!this.comps.get(id)!.has(type)) v.push(`INDEX_ORPHAN:${type}->${id}`);
      }
    }
    for (const [id, bag] of this.comps) {
      for (const type of bag.keys()) {
        if (!this.byType.get(type)?.has(id)) v.push(`MISSING_INDEX:${id}->${type}`);
      }
    }

    // ECS-4: Component的type字段与其存储key一致
    for (const [id, bag] of this.comps) {
      for (const [key, comp] of bag) {
        if (comp.type !== key) v.push(`TYPE_MISMATCH:${id} key=${key} type=${comp.type}`);
      }
    }

    // ECS-5: 存活Entity与墓碑不相交
    for (const id of this.entities) {
      if (this.destroyed.has(id)) v.push(`ALIVE_AND_DESTROYED:${id}`);
    }

    // ECS-6 (INV-16): 所有数值必须有限
    for (const [id, bag] of this.comps) {
      for (const comp of bag.values()) {
        for (const [k, val] of Object.entries(comp.data)) {
          if (typeof val === 'number' && !Number.isFinite(val)) {
            v.push(`NON_FINITE:${id}.${comp.type}.${k}=${val}`);
          }
        }
      }
    }

    return v;
  }

  get entityCount() { return this.entities.size; }
}
```

---

## Step 3: 编写属性测试

```typescript
// test/l1l2-property.test.ts
import fc from 'fast-check';
import { EcsWorld } from '../src/ecs';
import { describe, it, expect } from 'vitest';

const TYPES = ['health', 'position', 'inventory', 'ai', 'tag'];

describe('L1/L2: Entity + Component 原语', () => {

  // 属性测试1：任意操作序列后所有不变量成立（10万次）
  it('ECS-1..6: 任意操作序列后不变量成立', () => {
    fc.assert(
      fc.property(
        fc.array(genEcsOp(), { minLength: 1, maxLength: 50 }),
        (ops) => {
          const w = new EcsWorld();
          const ids: string[] = [];
          for (let i = 0; i < 8; i++) ids.push(w.entity_create());

          for (const op of ops) {
            try { execEcsOp(w, ids, op); } catch {}
          }

          const v = w.checkInvariants();
          if (v.length) console.error(v);
          return v.length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试2：entity_destroy后无残留（10万次）
  it('entity_destroy后该Entity的所有Component和索引均被清理', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...TYPES), { minLength: 0, maxLength: 5 }),
        (types) => {
          const w = new EcsWorld();
          const a = w.entity_create();
          const b = w.entity_create();

          const added = new Set<string>();
          for (const t of types) {
            try { w.comp_add(a, t, { x: 1 }); added.add(t); } catch {}
            try { w.comp_add(b, t, { x: 2 }); } catch {}
          }

          w.entity_destroy(a);

          // a不存在
          if (w.entity_exists(a)) return false;
          // 反向索引里不应再有a
          for (const t of added) {
            if (w.query_byType(t).includes(a)) return false;
            // b的组件不应被误删
            if (!w.comp_has(b, t)) return false;
          }
          return w.checkInvariants().length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试3：comp_add/comp_del往返幂等（10万次）
  it('comp_add→comp_del→comp_add 状态可复现', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TYPES),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 5 }),
        (type, val, repeat) => {
          const w = new EcsWorld();
          const e = w.entity_create();

          for (let i = 0; i < repeat; i++) {
            w.comp_add(e, type, { v: val });
            if (w.comp_get(e, type)!.data.v !== val) return false;
            w.comp_del(e, type);
            if (w.comp_has(e, type)) return false;
          }

          return w.checkInvariants().length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试4：comp_get返回拷贝，外部改写不影响世界（10万次）
  it('comp_get返回值被外部改写不影响世界状态', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (orig, tampered) => {
          fc.pre(orig !== tampered);
          const w = new EcsWorld();
          const e = w.entity_create();
          w.comp_add(e, 'health', { hp: orig });

          const c = w.comp_get(e, 'health')!;
          c.data.hp = tampered;   // 外部篡改

          return w.comp_get(e, 'health')!.data.hp === orig;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试5：comp_add传入的data被深拷贝（10万次）
  it('comp_add的入参对象后续改写不影响世界状态', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (orig, tampered) => {
          fc.pre(orig !== tampered);
          const w = new EcsWorld();
          const e = w.entity_create();

          const payload = { hp: orig };
          w.comp_add(e, 'health', payload);
          payload.hp = tampered;   // 调用方改写入参

          return w.comp_get(e, 'health')!.data.hp === orig;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试6：query_byType结果确定性（1万次）
  it('query_byType结果与插入顺序无关（确定性排序）', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 8 }),
        (order) => {
          const build = (seq: number[]) => {
            const w = new EcsWorld();
            const ids: string[] = [];
            for (let i = 0; i < 8; i++) ids.push(w.entity_create(`e${i}`));
            for (const i of seq) w.comp_add(ids[i], 'health', {});
            return w.query_byType('health');
          };

          const a = build(order);
          const b = build([...order].reverse());
          return JSON.stringify(a) === JSON.stringify(b);
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 属性测试7：非有限数值被拒绝（10万次）
  it('INV-16: comp_set拒绝NaN/Infinity', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(NaN, Infinity, -Infinity),
        (bad) => {
          const w = new EcsWorld();
          const e = w.entity_create();
          w.comp_add(e, 'health', { hp: 10 });

          try {
            w.comp_set(e, 'health', 'hp', bad);
            return false;
          } catch (e2: any) {
            return e2.message === 'E_COMP_NON_FINITE';
          }
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 边界测试：重复comp_add被拒绝
  it('E_COMP_DUPLICATE: 同type重复add被拒绝', () => {
    const w = new EcsWorld();
    const e = w.entity_create();
    w.comp_add(e, 'health', {});
    expect(() => w.comp_add(e, 'health', {})).toThrow('E_COMP_DUPLICATE');
    expect(w.checkInvariants()).toHaveLength(0);
  });

  // 边界测试：ID复用被拒绝
  it('E_ENT_ID_REUSE: 销毁后的ID不能复用', () => {
    const w = new EcsWorld();
    const e = w.entity_create('hero');
    w.entity_destroy(e);
    expect(() => w.entity_create('hero')).toThrow('E_ENT_ID_REUSE');
  });

  // 边界测试：重复ID被拒绝
  it('E_ENT_DUPLICATE_ID: 同ID重复create被拒绝', () => {
    const w = new EcsWorld();
    w.entity_create('hero');
    expect(() => w.entity_create('hero')).toThrow('E_ENT_DUPLICATE_ID');
  });

  // 边界测试：对不存在Entity操作
  it('E_REF_INVALID: 对已销毁Entity的所有操作均报错', () => {
    const w = new EcsWorld();
    const e = w.entity_create();
    w.entity_destroy(e);

    expect(() => w.comp_add(e, 'health', {})).toThrow('E_REF_INVALID');
    expect(() => w.comp_del(e, 'health')).toThrow('E_REF_INVALID');
    expect(() => w.comp_get(e, 'health')).toThrow('E_REF_INVALID');
    expect(() => w.entity_destroy(e)).toThrow('E_REF_INVALID');
    expect(w.comp_has(e, 'health')).toBe(false);
  });

  // 边界测试：comp_del幂等
  it('comp_del对不存在的Component是幂等的', () => {
    const w = new EcsWorld();
    const e = w.entity_create();
    expect(() => w.comp_del(e, 'health')).not.toThrow();
    expect(() => w.comp_del(e, 'health')).not.toThrow();
    expect(w.checkInvariants()).toHaveLength(0);
  });

  // 边界测试：空type被拒绝
  it('E_COMP_INVALID_TYPE: 空字符串type被拒绝', () => {
    const w = new EcsWorld();
    const e = w.entity_create();
    expect(() => w.comp_add(e, '', {})).toThrow('E_COMP_INVALID_TYPE');
  });

  // 边界测试：comp_set对不存在Component
  it('E_COMP_NOT_FOUND: comp_set对未add的Component报错', () => {
    const w = new EcsWorld();
    const e = w.entity_create();
    expect(() => w.comp_set(e, 'health', 'hp', 1)).toThrow('E_COMP_NOT_FOUND');
  });

  // 边界测试：空世界
  it('空世界不变量成立', () => {
    expect(new EcsWorld().checkInvariants()).toHaveLength(0);
  });
});

// ---- 辅助 ----
type EcsOp =
  | { type: 'create' }
  | { type: 'destroy'; idx: number }
  | { type: 'comp_add'; idx: number; ct: string; v: number }
  | { type: 'comp_del'; idx: number; ct: string }
  | { type: 'comp_set'; idx: number; ct: string; key: string; v: number };

function genEcsOp() {
  return fc.oneof(
    fc.record({ type: fc.constant('create' as const) }),
    fc.record({ type: fc.constant('destroy' as const), idx: fc.integer({ min: 0, max: 20 }) }),
    fc.record({ type: fc.constant('comp_add' as const), idx: fc.integer({ min: 0, max: 20 }), ct: fc.constantFrom(...TYPES), v: fc.integer({ min: -1000, max: 1000 }) }),
    fc.record({ type: fc.constant('comp_del' as const), idx: fc.integer({ min: 0, max: 20 }), ct: fc.constantFrom(...TYPES) }),
    fc.record({ type: fc.constant('comp_set' as const), idx: fc.integer({ min: 0, max: 20 }), ct: fc.constantFrom(...TYPES), key: fc.constantFrom('hp', 'x', 'y', 'flag'), v: fc.integer({ min: -1000, max: 1000 }) })
  );
}

function execEcsOp(w: EcsWorld, ids: string[], op: EcsOp) {
  const pick = (i: number) => ids[i % ids.length];
  switch (op.type) {
    case 'create':   ids.push(w.entity_create()); break;
    case 'destroy':  w.entity_destroy(pick(op.idx)); break;
    case 'comp_add': w.comp_add(pick(op.idx), op.ct, { v: op.v }); break;
    case 'comp_del': w.comp_del(pick(op.idx), op.ct); break;
    case 'comp_set': w.comp_set(pick(op.idx), op.ct, op.key, op.v); break;
  }
}
```

---

## Step 4: 执行

```bash
npx vitest run
```

## Step 5: 修复Bug

失败时记录最小复现序列，修复实现，重跑，直到100%通过。

## Step 6: 报告

写入 `L1L2_TEST_REPORT.md`：

```markdown
# L1/L2 Entity+Component原语 属性测试报告

## 测试规模
| 测试项 | 次数 | 结果 |
|--------|------|------|
| 任意操作序列不变量 | 100,000 | |
| destroy无残留 | 100,000 | |
| add/del往返 | 100,000 | |
| comp_get返回拷贝 | 100,000 | |
| comp_add深拷贝入参 | 100,000 | |
| query确定性 | 10,000 | |
| INV-16非有限数值 | 100,000 | |
| 边界用例 | 8 | |
| **合计** | **610,008** | |

## 发现的Bug
| # | 最小复现序列 | 期望 | 实际 | 修复 |
|---|-------------|------|------|------|

## Spec缺口（UNDEF）
| 场景 | 缺什么 | 建议 |
|------|--------|------|

## 结论
PASS / FAIL
```

**开始执行。用代码说话，不要推理。**
