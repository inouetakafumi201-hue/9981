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
            for (const i of seq) w.comp_add(ids[i]!, 'health', {});
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
  const pick = (i: number) => ids[i % ids.length]!;
  switch (op.type) {
    case 'create':   ids.push(w.entity_create()); break;
    case 'destroy':  w.entity_destroy(pick(op.idx)); break;
    case 'comp_add': w.comp_add(pick(op.idx), op.ct, { v: op.v }); break;
    case 'comp_del': w.comp_del(pick(op.idx), op.ct); break;
    case 'comp_set': w.comp_set(pick(op.idx), op.ct, op.key, op.v); break;
  }
}
