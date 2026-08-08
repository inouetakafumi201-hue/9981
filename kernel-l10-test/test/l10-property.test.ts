import fc from 'fast-check';
import { IntentSystem, IntentWorld, Actor } from '../src/intent';
import { describe, it, expect } from 'vitest';

describe('L10: Intent意图系统', () => {

  // 属性测试1：任意操作后INV-12 Cost守恒（10万次）
  it('INV-12: 任意submit/resolve/void/cancel后Cost守恒', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomIntentOp(), { minLength: 1, maxLength: 30 }),
        (ops) => {
          const { sys, world } = makeSetup();

          for (const op of ops) {
            try { execIntentOp(sys, world, op); } catch {}
          }

          const v = sys.checkInvariants(world);
          if (v.length) console.error(v);
          return v.length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试2：submit→void后资源全额退回（10万次）
  it('INV-12: void后冻结资源全额退回', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 51, max: 200 }),
        (cost, totalGold) => {
          const { sys, world } = makeSetup(totalGold);
          const actor = world.actors.get('actor1')!;

          const before = actor.resources.get('gold')!;

          try {
            sys.submit({
              id: 'i1', actorId: 'actor1', actionType: 'attack',
              cost: [{ pool: 'gold', amount: cost }]
            }, world);
          } catch { return true; }

          sys.void('i1', world);

          const after = actor.resources.get('gold')!;
          const frozen = actor.frozenResources.get('gold') ?? 0;

          return after === before && frozen === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试3：submit→resolve后资源正确扣除（10万次）
  it('资源在resolve时正确扣除', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 51, max: 200 }),
        (cost, totalGold) => {
          const { sys, world } = makeSetup(totalGold);
          const actor = world.actors.get('actor1')!;
          const before = actor.resources.get('gold')!;

          try {
            sys.submit({
              id: 'i1', actorId: 'actor1', actionType: 'attack',
              cost: [{ pool: 'gold', amount: cost }]
            }, world);
          } catch { return true; }

          sys.resolve('i1', world);

          const after = actor.resources.get('gold')!;
          const frozen = actor.frozenResources.get('gold') ?? 0;

          return after === before - cost && frozen === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试4：多个Intent累积冻结不超过总量（1万次）
  it('多个pending Intent的冻结总量不超过可用资源', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 100 }),
        (costs, totalGold) => {
          const { sys, world } = makeSetup(totalGold);

          for (let i = 0; i < costs.length; i++) {
            const c = costs[i];
            try {
              sys.submit({ id: `i${i}`, actorId: 'actor1', actionType: 'action', cost: [{ pool: 'gold', amount: c }] }, world);
            } catch { /* insufficient, skip */ }
          }

          const actor = world.actors.get('actor1')!;
          const frozen = actor.frozenResources.get('gold') ?? 0;
          return frozen <= totalGold;
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 边界测试：资源不足时submit被拒绝
  it('E_COST_INSUFFICIENT: 资源不足时submit失败', () => {
    const { sys, world } = makeSetup(10);

    expect(() => sys.submit({
      id: 'i1', actorId: 'actor1', actionType: 'attack',
      cost: [{ pool: 'gold', amount: 20 }]
    }, world)).toThrow('E_COST_INSUFFICIENT');

    const v = sys.checkInvariants(world);
    expect(v).toHaveLength(0);
  });

  // 边界测试：require失败时void并退回
  it('require失败时Intent变为void，资源退回', () => {
    const { sys, world } = makeSetup(100);
    const actor = world.actors.get('actor1')!;

    sys.submit({
      id: 'i1', actorId: 'actor1', actionType: 'attack',
      cost: [{ pool: 'gold', amount: 30 }],
      require: () => false
    }, world);

    const frozenAfterSubmit = actor.frozenResources.get('gold') ?? 0;
    expect(frozenAfterSubmit).toBe(30);

    sys.resolve('i1', world);

    expect(sys.get('i1')!.status).toBe('void');
    expect(actor.frozenResources.get('gold') ?? 0).toBe(0);
    expect(actor.resources.get('gold')).toBe(100);
  });

  // 边界测试：非pending状态不能再resolve
  it('E_INTENT_NOT_PENDING: 已resolved的Intent不能再resolve', () => {
    const { sys, world } = makeSetup(100);

    sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 1 }] }, world);
    sys.resolve('i1', world);

    expect(() => sys.resolve('i1', world)).toThrow('E_INTENT_NOT_PENDING');
  });

  // 边界测试：cost=0的Intent
  it('cost=[{amount:0}]的Intent正常submit和resolve', () => {
    const { sys, world } = makeSetup(100);

    sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 0 }] }, world);
    sys.resolve('i1', world);
    expect(sys.checkInvariants(world)).toHaveLength(0);
  });

  // 边界测试：actor销毁后pending Intent自动void
  it('actor销毁后resolve返回void', () => {
    const { sys, world } = makeSetup(100);

    sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 10 }] }, world);

    world.actors.delete('actor1');

    const outcome = sys.resolve('i1', world);
    expect(outcome).toBe('void');
    expect(sys.checkInvariants(world)).toHaveLength(0);
  });

  // Bug回归1：同一Intent内对同一pool重复计cost不会造成冻结超额
  it('Bug回归: 单Intent内重复pool的cost合并计算，不产生冻结超额', () => {
    const { sys, world } = makeSetup(50);
    const actor = world.actors.get('actor1')!;

    // 两条cost都指向gold，合计40 <= 50，应能submit成功
    sys.submit({
      id: 'i1', actorId: 'actor1', actionType: 'a',
      cost: [{ pool: 'gold', amount: 25 }, { pool: 'gold', amount: 15 }]
    }, world);

    expect(actor.frozenResources.get('gold')).toBe(40);
    expect(sys.checkInvariants(world)).toHaveLength(0);

    sys.resolve('i1', world);
    expect(actor.resources.get('gold')).toBe(10);
    expect(actor.frozenResources.get('gold')).toBe(0);
  });

  // Bug回归2：重复id提交被拒绝，不允许静默覆盖导致冻结资源泄漏
  it('Bug回归: 重复id的submit被拒绝(E_INTENT_DUP_ID)', () => {
    const { sys, world } = makeSetup(100);

    sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 10 }] }, world);

    expect(() => sys.submit({
      id: 'i1', actorId: 'actor1', actionType: 'b', cost: [{ pool: 'gold', amount: 5 }]
    }, world)).toThrow('E_INTENT_DUP_ID');

    expect(sys.checkInvariants(world)).toHaveLength(0);
  });

  // Bug回归3：负数cost被拒绝，防止通过负cost凭空产生资源
  it('Bug回归: 负数cost被拒绝(E_COST_NEGATIVE)', () => {
    const { sys, world } = makeSetup(100);

    expect(() => sys.submit({
      id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: -10 }]
    }, world)).toThrow('E_COST_NEGATIVE');
  });

  // 边界测试：void一个不存在的Intent应报错，而非静默忽略
  it('E_REF_INVALID: void不存在的Intent抛出异常', () => {
    const { sys, world } = makeSetup(100);
    expect(() => sys.void('nonexistent', world)).toThrow('E_REF_INVALID');
  });

  // 边界测试：cancel已resolved的Intent应被拒绝
  it('E_INTENT_NOT_PENDING: 已resolved的Intent不能被cancel', () => {
    const { sys, world } = makeSetup(100);
    sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 1 }] }, world);
    sys.resolve('i1', world);
    expect(() => sys.cancel('i1', world)).toThrow('E_INTENT_NOT_PENDING');
  });
});

// ---- 辅助 ----
type IntentOp =
  | { type: 'submit'; id: string; cost: number; require: boolean }
  | { type: 'resolve'; idx: number }
  | { type: 'void'; idx: number }
  | { type: 'cancel'; idx: number };

const INTENT_POOL = ['i0','i1','i2','i3','i4','i5','i6','i7','i8','i9'];

function genRandomIntentOp() {
  return fc.oneof(
    fc.record({ type: fc.constant('submit' as const), id: fc.constantFrom(...INTENT_POOL), cost: fc.integer({ min: 1, max: 30 }), require: fc.boolean() }),
    fc.record({ type: fc.constant('resolve' as const), idx: fc.integer({ min: 0, max: 9 }) }),
    fc.record({ type: fc.constant('void' as const), idx: fc.integer({ min: 0, max: 9 }) }),
    fc.record({ type: fc.constant('cancel' as const), idx: fc.integer({ min: 0, max: 9 }) })
  );
}

function makeSetup(gold = 200) {
  const sys = new IntentSystem();
  const actor: Actor = {
    id: 'actor1',
    resources: new Map([['gold', gold], ['ap', 5]]),
    frozenResources: new Map()
  };
  const world: IntentWorld = { actors: new Map([['actor1', actor]]) };
  return { sys, world };
}

function execIntentOp(sys: IntentSystem, world: IntentWorld, op: IntentOp) {
  switch (op.type) {
    case 'submit':
      sys.submit({
        id: op.id, actorId: 'actor1', actionType: 'action',
        cost: [{ pool: 'gold', amount: op.cost }],
        require: op.require ? undefined : () => false
      }, world);
      break;
    case 'resolve': sys.resolve(INTENT_POOL[op.idx % INTENT_POOL.length], world); break;
    case 'void':    sys.void(INTENT_POOL[op.idx % INTENT_POOL.length], world); break;
    case 'cancel':  sys.cancel(INTENT_POOL[op.idx % INTENT_POOL.length], world); break;
  }
}
