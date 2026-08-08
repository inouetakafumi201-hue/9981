# L10层：Intent 意图系统 — 属性测试任务

> **文件性质：历史执行 Prompt（方案 C — 属性实测轴，即工程验收的权威层编号）。已执行完毕。**
> 交付物：`kernel-l10-test`（14 项命名测试 / 310,010 次检查，PASS；修复 3 处可绕过 INV-12 的缺陷）。
> 13 层总体结果与层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1 与 §3.2；
> 分发依据见 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md)。
> **注意**：各子项目内部使用的错误码（如 `E_INTENT_*`/`E_PHASE_*`）是测试工程本地命名，
> 不等于内核封闭注册表 `src/core/kernel/state/error-codes.ts` 的成员；两者对账属未执行的跨层门禁，
> 见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-03**。

## 任务目标

**用代码说话，不要推理。**

实现L10层Intent系统（提交→冻结→解算→void三态）+ 编写10万次属性测试 + 修复所有Bug + 提交报告。

---

## Step 1: 环境搭建

```bash
mkdir -p kernel-l10-test
cd kernel-l10-test
npm init -y
npm install fast-check typescript @types/node tsx vitest
npx tsc --init
```

---

## Step 2: 实现Intent系统

```typescript
// src/intent.ts

export type IntentStatus = 'pending' | 'resolved' | 'void' | 'cancelled';

export interface CostSpec {
  pool: string;   // 资源池名称，如 'ap', 'gold', 'hp'
  amount: number;
}

export interface IntentDef {
  id: string;
  actorId: string;
  actionType: string;
  cost: CostSpec[];
  require?: (world: IntentWorld) => boolean;  // 解算前的前置条件
  effect?: (world: IntentWorld) => void;
  priority?: number;
}

export interface Intent {
  id: string;
  actorId: string;
  actionType: string;
  cost: CostSpec[];
  status: IntentStatus;
  require?: (world: IntentWorld) => boolean;
  effect?: (world: IntentWorld) => void;
  priority: number;
  submittedAt: number;
}

export interface IntentWorld {
  actors: Map<string, Actor>;
}

export interface Actor {
  id: string;
  resources: Map<string, number>;         // 实际可用资源
  frozenResources: Map<string, number>;   // 冻结的资源
}

export class IntentSystem {
  private intents: Map<string, Intent> = new Map();
  private time: number = 0;

  submit(def: IntentDef, world: IntentWorld): Intent {
    const actor = world.actors.get(def.actorId);
    if (!actor) throw new Error('E_REF_INVALID');

    // 检查资源足够（可用 = resources - frozenResources）
    for (const cost of def.cost) {
      const available = this.getAvailable(actor, cost.pool);
      if (available < cost.amount) {
        throw new Error('E_COST_INSUFFICIENT');
      }
    }

    // 冻结资源（INV-12）
    for (const cost of def.cost) {
      const current = actor.frozenResources.get(cost.pool) ?? 0;
      actor.frozenResources.set(cost.pool, current + cost.amount);
    }

    const intent: Intent = {
      id: def.id,
      actorId: def.actorId,
      actionType: def.actionType,
      cost: def.cost,
      status: 'pending',
      require: def.require,
      effect: def.effect,
      priority: def.priority ?? 0,
      submittedAt: this.time
    };

    this.intents.set(def.id, intent);
    return intent;
  }

  resolve(intentId: string, world: IntentWorld): 'resolved' | 'void' {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('E_REF_INVALID');
    if (intent.status !== 'pending') throw new Error('E_INTENT_NOT_PENDING');

    const actor = world.actors.get(intent.actorId);
    if (!actor) {
      // actor已不存在 → void并退回
      this.voidIntent(intentId, world);
      return 'void';
    }

    // 检查require
    if (intent.require && !intent.require(world)) {
      this.voidIntent(intentId, world);
      return 'void';
    }

    // 结算资源：从冻结转为实际扣除
    for (const cost of intent.cost) {
      const frozen = actor.frozenResources.get(cost.pool) ?? 0;
      actor.frozenResources.set(cost.pool, frozen - cost.amount);
      const current = actor.resources.get(cost.pool) ?? 0;
      actor.resources.set(cost.pool, current - cost.amount);
    }

    // 执行effect
    if (intent.effect) {
      intent.effect(world);
    }

    intent.status = 'resolved';
    return 'resolved';
  }

  void(intentId: string, world: IntentWorld): void {
    this.voidIntent(intentId, world);
  }

  cancel(intentId: string, world: IntentWorld): void {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('E_REF_INVALID');
    if (intent.status !== 'pending') throw new Error('E_INTENT_NOT_PENDING');

    this.returnFrozen(intent, world);
    intent.status = 'cancelled';
  }

  private voidIntent(intentId: string, world: IntentWorld): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'pending') return;

    this.returnFrozen(intent, world);
    intent.status = 'void';
  }

  private returnFrozen(intent: Intent, world: IntentWorld): void {
    const actor = world.actors.get(intent.actorId);
    if (!actor) return; // actor已销毁，无处退回（可接受）

    for (const cost of intent.cost) {
      const frozen = actor.frozenResources.get(cost.pool) ?? 0;
      actor.frozenResources.set(cost.pool, Math.max(0, frozen - cost.amount));
    }
  }

  private getAvailable(actor: Actor, pool: string): number {
    const total = actor.resources.get(pool) ?? 0;
    const frozen = actor.frozenResources.get(pool) ?? 0;
    return total - frozen;
  }

  // — 不变量检查 —
  checkInvariants(world: IntentWorld): Violation[] {
    const violations: Violation[] = [];

    for (const actor of world.actors.values()) {
      // INV-12: frozen ≤ resources（资源不能冻结超出实际持有量）
      for (const [pool, frozen] of actor.frozenResources.entries()) {
        const total = actor.resources.get(pool) ?? 0;
        if (frozen > total) {
          violations.push({
            code: 'E_COST_OVER_FROZEN',
            detail: `actor=${actor.id} pool=${pool} frozen=${frozen} total=${total}`
          });
        }
        if (frozen < 0) {
          violations.push({
            code: 'E_COST_NEGATIVE_FROZEN',
            detail: `actor=${actor.id} pool=${pool} frozen=${frozen}`
          });
        }
      }

      // resources不能为负
      for (const [pool, amount] of actor.resources.entries()) {
        if (amount < 0) {
          violations.push({
            code: 'E_COST_NEGATIVE_RESOURCE',
            detail: `actor=${actor.id} pool=${pool} amount=${amount}`
          });
        }
      }
    }

    // pending的Intent必须对应存在的冻结资源
    for (const intent of this.intents.values()) {
      if (intent.status !== 'pending') continue;
      const actor = world.actors.get(intent.actorId);
      if (!actor) continue;

      for (const cost of intent.cost) {
        const frozen = actor.frozenResources.get(cost.pool) ?? 0;
        if (frozen < cost.amount) {
          violations.push({
            code: 'E_INTENT_FROZEN_MISMATCH',
            detail: `intent=${intent.id} pool=${cost.pool} needs=${cost.amount} frozen=${frozen}`
          });
        }
      }
    }

    return violations;
  }

  get(id: string) { return this.intents.get(id); }

  tick(delta: number) { this.time += delta; }
}

interface Violation { code: string; detail: string; }
```

---

## Step 3: 编写属性测试

```typescript
// test/l10-property.test.ts
import fc from 'fast-check';
import { IntentSystem, IntentWorld, Actor, IntentDef } from '../src/intent';
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

          // 资源应回到before
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
          let sumCost = 0;

          for (let i = 0; i < costs.length; i++) {
            const c = costs[i];
            try {
              sys.submit({ id: `i${i}`, actorId: 'actor1', actionType: 'action', cost: [{ pool: 'gold', amount: c }] }, world);
              sumCost += c;
            } catch {}
          }

          // 累积冻结不超过总资源
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
      require: () => false  // 永远失败
    }, world);

    const frozenAfterSubmit = actor.frozenResources.get('gold') ?? 0;
    expect(frozenAfterSubmit).toBe(30);

    sys.resolve('i1', world);

    expect(sys.get('i1')!.status).toBe('void');
    expect(actor.frozenResources.get('gold') ?? 0).toBe(0);
    expect(actor.resources.get('gold')).toBe(100); // 未扣除
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

    // cost=0是否允许？Spec若未定义，此处测试两种路径
    try {
      sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 0 }] }, world);
      sys.resolve('i1', world);
      expect(sys.checkInvariants(world)).toHaveLength(0);
    } catch (e: any) {
      // 若拒绝cost=0，也是合理行为，记录UNDEF
      console.warn('UNDEF: cost=0 behavior:', e.message);
    }
  });

  // 边界测试：actor销毁后pending Intent自动void
  it('actor销毁后resolve返回void', () => {
    const { sys, world } = makeSetup(100);

    sys.submit({ id: 'i1', actorId: 'actor1', actionType: 'a', cost: [{ pool: 'gold', amount: 10 }] }, world);

    // 销毁actor
    world.actors.delete('actor1');

    const outcome = sys.resolve('i1', world);
    expect(outcome).toBe('void');
    expect(sys.checkInvariants(world)).toHaveLength(0);
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
    fc.record({ type: fc.constant('submit' as const), id: fc.uuid(), cost: fc.integer({ min: 1, max: 30 }), require: fc.boolean() }),
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
```

---

## Step 4 & 5: 执行 + 报告

```bash
npx vitest run
```

报告格式同L3。**开始执行。用代码说话，不要推理。**
