import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  OpRegistry,
  World,
  checkAllInvariants,
  checkINV_1_ReferenceIntegrity,
  checkINV_2_SingleContainment,
  checkINV_3_SingleLocation,
  checkINV_4_LocationMutex,
  checkINV_5_NoContainmentCycle,
  checkINV_6_TopologyConsistency,
  checkINV_7_ParentChild,
  checkINV_8_RelationSymmetry,
  checkINV_9_ContainerBidirectional,
  checkINV_10_SlotIndexContinuity,
  checkINV_11_StackConservation,
  checkINV_12_CostConservation,
  checkINV_13_AttachmentConsistency,
  checkINV_14_StackBounded,
  checkINV_15_DecisionTermination,
  checkINV_16_NumericBounded,
  type OpName,
  type Result,
  type WorldSnapshot,
} from '../src/index.js';

const PROPERTY_RUNS = 100_000;

function createWorld(): World {
  const world = new World();
  world.registerDef({ id: 'coin', stackMax: 5 });
  world.registerDef({ id: 'gem', stackMax: 5 });
  return world;
}

function invokeCode(result: Result<unknown>): string | null {
  return result.ok ? null : result.code;
}

function stackCounts(world: World): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of world.items.values()) counts.set(item.def, (counts.get(item.def) ?? 0) + item.stack);
  return counts;
}

function snapshot(world: World): WorldSnapshot {
  return world.snapshot();
}

function assertProperty(name: string, property: fc.IProperty<unknown[]>, seed: number): void {
  const started = performance.now();
  fc.assert(property, { numRuns: PROPERTY_RUNS, seed, endOnFailure: true });
  const elapsed = Math.round(performance.now() - started);
  console.info(`[property] ${name}: ${PROPERTY_RUNS} runs, ${elapsed}ms`);
}

type StackCommand =
  | { kind: 'split'; source: number; amount: number; container: number }
  | { kind: 'merge'; source: number; target: number };

const stackCommandArb: fc.Arbitrary<StackCommand> = fc.oneof(
  fc.record({
    kind: fc.constant('split' as const),
    source: fc.nat(20),
    amount: fc.integer({ min: -1, max: 6 }),
    container: fc.nat(4),
  }),
  fc.record({
    kind: fc.constant('merge' as const),
    source: fc.nat(20),
    target: fc.nat(20),
  }),
);

type PlaceCommand =
  | { kind: 'node'; entity: number; target: number }
  | { kind: 'slot'; entity: number; target: number };

const placeCommandArb: fc.Arbitrary<PlaceCommand> = fc.oneof(
  fc.record({ kind: fc.constant('node' as const), entity: fc.nat(10), target: fc.nat(10) }),
  fc.record({ kind: fc.constant('slot' as const), entity: fc.nat(10), target: fc.nat(10) }),
);

type CostCommand =
  | { kind: 'freeze'; entity: number; resource: 'gold' | 'energy'; amount: number }
  | { kind: 'resolve'; entity: number }
  | { kind: 'void'; entity: number };

const costCommandArb: fc.Arbitrary<CostCommand> = fc.oneof(
  fc.record({
    kind: fc.constant('freeze' as const),
    entity: fc.nat(10),
    resource: fc.constantFrom('gold' as const, 'energy' as const),
    amount: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({ kind: fc.constant('resolve' as const), entity: fc.nat(10) }),
  fc.record({ kind: fc.constant('void' as const), entity: fc.nat(10) }),
);

describe('L3: Ops + Transaction 守恒性属性', () => {
  it('INV-11: 任意 split/merge Op 序列后堆叠守恒（100,000 runs）', () => {
    assertProperty(
      'INV-11 stack conservation',
      fc.property(fc.array(stackCommandArb, { minLength: 1, maxLength: 12 }), (commands) => {
        const world = createWorld();
        world.createItem('coin', 5);
        world.createItem('coin', 4);
        world.createItem('gem', 3);
        const containers = [world.createContainer(4), world.createContainer(4)];
        const baseline = snapshot(world);
        const beforeCounts = stackCounts(world);
        const transaction = new OpRegistry(world).begin();

        for (const command of commands) {
          const items = [...world.items.values()];
          if (items.length === 0) continue;
          if (command.kind === 'split') {
            const source = items[command.source % items.length]!;
            const target = containers[command.container % containers.length]!;
            transaction.invoke('stack.split', {
              sourceId: source.id,
              amount: command.amount,
              targetContainerId: target.id,
            });
          } else {
            const source = items[command.source % items.length]!;
            const target = items[command.target % items.length]!;
            transaction.invoke('stack.merge', { sourceId: source.id, targetId: target.id });
          }
        }

        const committed = transaction.commit();
        if (!committed.ok) return false;
        if (checkINV_11_StackConservation(world, { baseline }).length !== 0) return false;
        expect(stackCounts(world)).toEqual(beforeCounts);
        return true;
      }),
      0x11_51_11,
    );
  });

  it('INV-4: 任意 entity.place Op 序列后位置互斥（100,000 runs）', () => {
    assertProperty(
      'INV-4 location mutex',
      fc.property(fc.array(placeCommandArb, { minLength: 0, maxLength: 12 }), (commands) => {
        const world = createWorld();
        const entities = [world.createEntity('actor'), world.createEntity('actor'), world.createEntity('actor')];
        const nodes = [world.createNode(), world.createNode(), world.createNode()];
        const containers = [world.createContainer(3), world.createContainer(3)];
        const slots = containers.flatMap((container) => container.slots).filter((slot) => slot !== null);
        const transaction = new OpRegistry(world).begin();

        for (const command of commands) {
          const entity = entities[command.entity % entities.length]!;
          if (command.kind === 'node') {
            const node = nodes[command.target % nodes.length]!;
            transaction.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id });
          } else {
            const slot = slots[command.target % slots.length]!;
            transaction.invoke('entity.place', { entityId: entity.id, targetSlotId: slot.id });
          }
        }

        if (!transaction.commit().ok) return false;
        return checkAllInvariants(world).length === 0;
      }),
      0x04_10_04,
    );
  });

  it('INV-12: 任意 Cost Op 序列提交后无残留冻结资源（100,000 runs）', () => {
    assertProperty(
      'INV-12 cost conservation',
      fc.property(fc.array(costCommandArb, { minLength: 0, maxLength: 12 }), (commands) => {
        const world = createWorld();
        const entities = [
          world.createEntity('actor', { gold: 5, energy: 5 }),
          world.createEntity('actor', { gold: 5, energy: 5 }),
        ];
        const baseline = snapshot(world);
        const transaction = new OpRegistry(world).begin();

        for (const command of commands) {
          const entity = entities[command.entity % entities.length]!;
          if (command.kind === 'freeze') {
            transaction.invoke('cost.freeze', {
              entityId: entity.id,
              resources: { [command.resource]: command.amount },
            });
          } else if (command.kind === 'resolve') {
            transaction.invoke('cost.resolve', { entityId: entity.id });
          } else {
            transaction.invoke('cost.void', { entityId: entity.id });
          }
        }

        const committed = transaction.commit();
        if (!committed.ok) {
          if (committed.code !== 'E_COST_LEAK') return false;
          expect(snapshot(world)).toEqual(baseline);
          return true;
        }
        return checkINV_12_CostConservation(world).length === 0;
      }),
      0x12_50_12,
    );
  });
});

describe('stack Ops 边界', () => {
  it('stack.split amount=0 返回 E_OP_INVALID_AMOUNT', () => {
    const world = createWorld();
    const item = world.createItem('coin', 5);
    const container = world.createContainer();
    expect(invokeCode(new OpRegistry(world).invoke('stack.split', { sourceId: item.id, amount: 0, targetContainerId: container.id }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('stack.split amount<0 返回 E_OP_INVALID_AMOUNT', () => {
    const world = createWorld();
    const item = world.createItem('coin', 5);
    const container = world.createContainer();
    expect(invokeCode(new OpRegistry(world).invoke('stack.split', { sourceId: item.id, amount: -1, targetContainerId: container.id }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('stack.split 非整数 amount 返回 E_OP_INVALID_AMOUNT', () => {
    const world = createWorld();
    const item = world.createItem('coin', 5);
    const container = world.createContainer();
    expect(invokeCode(new OpRegistry(world).invoke('stack.split', { sourceId: item.id, amount: 1.5, targetContainerId: container.id }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('stack.split amount>stack 返回 E_OP_INVALID_AMOUNT', () => {
    const world = createWorld();
    const item = world.createItem('coin', 2);
    const container = world.createContainer();
    expect(invokeCode(new OpRegistry(world).invoke('stack.split', { sourceId: item.id, amount: 3, targetContainerId: container.id }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('stack.split amount=stack 时销毁来源且总量守恒', () => {
    const world = createWorld();
    const source = world.createItem('coin', 3);
    const container = world.createContainer();
    const result = new OpRegistry(world).invoke('stack.split', { sourceId: source.id, amount: 3, targetContainerId: container.id });
    expect(result.ok).toBe(true);
    expect(world.items.has(source.id)).toBe(false);
    expect(stackCounts(world).get('coin')).toBe(3);
  });

  it('stack.split 无槽位时不改变状态', () => {
    const world = createWorld();
    const source = world.createItem('coin', 3);
    const container = world.createContainer(0);
    const before = snapshot(world);
    const result = new OpRegistry(world).invoke('stack.split', { sourceId: source.id, amount: 1, targetContainerId: container.id });
    expect(invokeCode(result)).toBe('E_OP_NO_LEGAL_SLOT');
    expect(snapshot(world)).toEqual(before);
  });

  it('stack.split 来源不存在', () => {
    const world = createWorld();
    const container = world.createContainer();
    expect(invokeCode(new OpRegistry(world).invoke('stack.split', { sourceId: 'missing', amount: 1, targetContainerId: container.id }))).toBe('E_REF_MISSING');
  });

  it('stack.split 容器不存在', () => {
    const world = createWorld();
    const source = world.createItem('coin', 3);
    expect(invokeCode(new OpRegistry(world).invoke('stack.split', { sourceId: source.id, amount: 1, targetContainerId: 'missing' }))).toBe('E_REF_MISSING');
  });

  it('stack.merge Def 不匹配', () => {
    const world = createWorld();
    const a = world.createItem('coin', 1);
    const b = world.createItem('gem', 1);
    expect(invokeCode(new OpRegistry(world).invoke('stack.merge', { sourceId: a.id, targetId: b.id }))).toBe('E_OP_DEF_MISMATCH');
  });

  it('stack.merge 超过 stackMax', () => {
    const world = createWorld();
    const a = world.createItem('coin', 3);
    const b = world.createItem('coin', 3);
    expect(invokeCode(new OpRegistry(world).invoke('stack.merge', { sourceId: a.id, targetId: b.id }))).toBe('E_OP_STACK_OVERFLOW');
  });

  it('stack.merge 拒绝自身合并', () => {
    const world = createWorld();
    const item = world.createItem('coin', 2);
    expect(invokeCode(new OpRegistry(world).invoke('stack.merge', { sourceId: item.id, targetId: item.id }))).toBe('E_OP_INVALID_ARGS');
  });

  it('stack.merge 来源不存在', () => {
    const world = createWorld();
    const target = world.createItem('coin', 2);
    expect(invokeCode(new OpRegistry(world).invoke('stack.merge', { sourceId: 'missing', targetId: target.id }))).toBe('E_REF_MISSING');
  });

  it('stack.merge 成功销毁来源并增加目标', () => {
    const world = createWorld();
    const source = world.createItem('coin', 2);
    const target = world.createItem('coin', 3);
    expect(new OpRegistry(world).invoke('stack.merge', { sourceId: source.id, targetId: target.id }).ok).toBe(true);
    expect(world.items.has(source.id)).toBe(false);
    expect(world.items.get(target.id)?.stack).toBe(5);
  });

  it('stack.adjust 归零销毁', () => {
    const world = createWorld();
    const item = world.createItem('coin', 2);
    expect(new OpRegistry(world).invoke('stack.adjust', { itemId: item.id, delta: -2 }).ok).toBe(true);
    expect(world.items.has(item.id)).toBe(false);
  });

  it('stack.adjust 低于零销毁', () => {
    const world = createWorld();
    const item = world.createItem('coin', 2);
    expect(new OpRegistry(world).invoke('stack.adjust', { itemId: item.id, delta: -5 }).ok).toBe(true);
    expect(world.items.has(item.id)).toBe(false);
  });

  it('stack.adjust 超过 stackMax', () => {
    const world = createWorld();
    const item = world.createItem('coin', 4);
    expect(invokeCode(new OpRegistry(world).invoke('stack.adjust', { itemId: item.id, delta: 2 }))).toBe('E_OP_STACK_OVERFLOW');
  });

  it('stack.adjust 物品不存在', () => {
    const world = createWorld();
    expect(invokeCode(new OpRegistry(world).invoke('stack.adjust', { itemId: 'missing', delta: 1 }))).toBe('E_REF_MISSING');
  });

  it('stack.adjust 拒绝非整数 delta', () => {
    const world = createWorld();
    const item = world.createItem('coin', 2);
    expect(invokeCode(new OpRegistry(world).invoke('stack.adjust', { itemId: item.id, delta: 0.5 }))).toBe('E_OP_INVALID_AMOUNT');
  });
});

describe('entity.place 边界', () => {
  it('放置到 Node', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    expect(new OpRegistry(world).invoke('entity.place', { entityId: entity.id, targetNodeId: node.id }).ok).toBe(true);
    expect(entity.node).toBe(node.id);
    expect(node.entities.has(entity.id)).toBe(true);
  });

  it('放置到 Slot', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const slot = world.createContainer().slots[0]!;
    expect(new OpRegistry(world).invoke('entity.place', { entityId: entity.id, targetSlotId: slot.id }).ok).toBe(true);
    expect(entity.slot).toBe(slot.id);
    expect(slot.holds).toBe(entity);
  });

  it('Node 到 Slot 清除旧 Node', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    const slot = world.createContainer().slots[0]!;
    const registry = new OpRegistry(world);
    registry.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id });
    registry.invoke('entity.place', { entityId: entity.id, targetSlotId: slot.id });
    expect(entity.node).toBeUndefined();
    expect(node.entities.has(entity.id)).toBe(false);
  });

  it('Slot 到 Node 清除旧 Slot', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    const slot = world.createContainer().slots[0]!;
    const registry = new OpRegistry(world);
    registry.invoke('entity.place', { entityId: entity.id, targetSlotId: slot.id });
    registry.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id });
    expect(entity.slot).toBeUndefined();
    expect(slot.holds).toBeNull();
  });

  it('目标 Slot 已占用时保持原位置', () => {
    const world = createWorld();
    const a = world.createEntity('actor');
    const b = world.createEntity('actor');
    const node = world.createNode();
    const slot = world.createContainer().slots[0]!;
    const registry = new OpRegistry(world);
    registry.invoke('entity.place', { entityId: a.id, targetSlotId: slot.id });
    registry.invoke('entity.place', { entityId: b.id, targetNodeId: node.id });
    expect(invokeCode(registry.invoke('entity.place', { entityId: b.id, targetSlotId: slot.id }))).toBe('E_OP_SLOT_FULL');
    expect(b.node).toBe(node.id);
  });

  it('Slot accepts 拒绝不匹配 Def', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const slot = world.createContainer().slots[0]!;
    slot.accepts = new Set(['vehicle']);
    expect(invokeCode(new OpRegistry(world).invoke('entity.place', { entityId: entity.id, targetSlotId: slot.id }))).toBe('E_OP_SLOT_REJECT');
  });

  it('Entity 不存在', () => {
    const world = createWorld();
    const node = world.createNode();
    expect(invokeCode(new OpRegistry(world).invoke('entity.place', { entityId: 'missing', targetNodeId: node.id }))).toBe('E_REF_MISSING');
  });

  it('Node 不存在', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    expect(invokeCode(new OpRegistry(world).invoke('entity.place', { entityId: entity.id, targetNodeId: 'missing' }))).toBe('E_REF_MISSING');
  });

  it('Slot 不存在', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    expect(invokeCode(new OpRegistry(world).invoke('entity.place', { entityId: entity.id, targetSlotId: 'missing' }))).toBe('E_REF_MISSING');
  });
});

describe('Cost Ops 边界', () => {
  it('freeze 成功记录冻结资源', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    const tx = new OpRegistry(world).begin();
    expect(tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 2 } }).ok).toBe(true);
    expect(entity.frozenResources.get('gold')).toBe(2);
    tx.invoke('cost.void', { entityId: entity.id });
    expect(tx.commit().ok).toBe(true);
  });

  it('freeze 可累计且不超过可用量', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    const tx = new OpRegistry(world).begin();
    tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 2 } });
    expect(tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 3 } }).ok).toBe(true);
    expect(entity.frozenResources.get('gold')).toBe(5);
    tx.invoke('cost.void', { entityId: entity.id });
    tx.commit();
  });

  it('freeze 资源不足', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 1 });
    expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', { entityId: entity.id, resources: { gold: 2 } }))).toBe('E_COST_INSUFFICIENT');
  });

  it('freeze 拒绝 0', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', { entityId: entity.id, resources: { gold: 0 } }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('freeze 拒绝负数', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', { entityId: entity.id, resources: { gold: -1 } }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('freeze 拒绝 NaN', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', { entityId: entity.id, resources: { gold: Number.NaN } }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('resolve 扣除真实资源并清空冻结', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    const tx = new OpRegistry(world).begin();
    tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 2 } });
    expect(tx.invoke('cost.resolve', { entityId: entity.id }).ok).toBe(true);
    expect(entity.attr.gold).toBe(3);
    expect(entity.frozenResources.size).toBe(0);
    expect(tx.commit().ok).toBe(true);
  });

  it('void 不扣除真实资源并清空冻结', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    const tx = new OpRegistry(world).begin();
    tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 2 } });
    expect(tx.invoke('cost.void', { entityId: entity.id }).ok).toBe(true);
    expect(entity.attr.gold).toBe(5);
    expect(entity.frozenResources.size).toBe(0);
    expect(tx.commit().ok).toBe(true);
  });

  it('resolve Entity 不存在', () => {
    const world = createWorld();
    expect(invokeCode(new OpRegistry(world).invoke('cost.resolve', { entityId: 'missing' }))).toBe('E_REF_MISSING');
  });

  it('void Entity 不存在', () => {
    const world = createWorld();
    expect(invokeCode(new OpRegistry(world).invoke('cost.void', { entityId: 'missing' }))).toBe('E_REF_MISSING');
  });

  it('freeze Entity 不存在', () => {
    const world = createWorld();
    expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', { entityId: 'missing', resources: { gold: 1 } }))).toBe('E_REF_MISSING');
  });

  it('resolve 检测冻结后真实资源消失并回滚保存点', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    const tx = new OpRegistry(world).begin();
    tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 3 } });
    entity.attr.gold = 1;
    expect(invokeCode(tx.invoke('cost.resolve', { entityId: entity.id }))).toBe('E_COST_FROZEN_GONE');
    expect(world.entities.get(entity.id)?.frozenResources.get('gold')).toBe(3);
    tx.rollback();
  });
});

describe('Transaction 原子性', () => {
  it('外层提交检测 Cost 泄漏并回滚', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    const before = snapshot(world);
    const tx = new OpRegistry(world).begin();
    tx.invoke('cost.freeze', { entityId: entity.id, resources: { gold: 2 } });
    expect(invokeCode(tx.commit())).toBe('E_COST_LEAK');
    expect(snapshot(world)).toEqual(before);
  });

  it('成功提交持久化全部改动', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    const tx = new OpRegistry(world).begin();
    tx.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id });
    expect(tx.commit().ok).toBe(true);
    expect(world.entities.get(entity.id)?.node).toBe(node.id);
  });

  it('单个 Op 失败不撤销同事务内既有成功 Op', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    const tx = new OpRegistry(world).begin();
    expect(tx.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id }).ok).toBe(true);
    expect(tx.invoke('entity.place', { entityId: entity.id, targetNodeId: 'missing' }).ok).toBe(false);
    expect(tx.commit().ok).toBe(true);
    expect(world.entities.get(entity.id)?.node).toBe(node.id);
  });

  it('显式 rollback 撤销整批改动', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    const before = snapshot(world);
    const tx = new OpRegistry(world).begin();
    tx.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id });
    tx.rollback();
    expect(snapshot(world)).toEqual(before);
  });

  it('关闭后的事务拒绝再次 invoke', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    const tx = new OpRegistry(world).begin();
    expect(tx.commit().ok).toBe(true);
    expect(invokeCode(tx.invoke('entity.place', { entityId: entity.id, targetNodeId: node.id }))).toBe('E_TX_CLOSED');
  });
});

describe('16 条不变量检查器', () => {
  it('INV-1 引用完整性', () => {
    const world = createWorld();
    world.createEntity('actor').node = 'missing';
    expect(checkINV_1_ReferenceIntegrity(world)[0]?.code).toBe('E_INV_DANGLING');
  });

  it('INV-2 单一容纳', () => {
    const world = createWorld();
    const item = world.createItem('coin', 1);
    const a = world.createContainer().slots[0]!;
    const b = world.createContainer().slots[0]!;
    a.holds = item;
    b.holds = item;
    expect(checkINV_2_SingleContainment(world)[0]?.code).toBe('E_INV_SINGLE_CONTAINMENT');
  });

  it('INV-3 单一位置双向一致', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const node = world.createNode();
    node.entities.add(entity.id);
    expect(checkINV_3_SingleLocation(world)[0]?.code).toBe('E_INV_SINGLE_LOCATION');
  });

  it('INV-4 位置互斥', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    entity.node = 'node';
    entity.slot = 'slot';
    expect(checkINV_4_LocationMutex(world)[0]?.code).toBe('E_INV_LOCATION_EXCLUSIVE');
  });

  it('INV-5 无环容纳', () => {
    const world = createWorld();
    const entity = world.createEntity('actor');
    const container = world.createContainer({ owner: entity.id, name: 'self', slots: 1 });
    container.slots[0]!.holds = entity;
    expect(checkINV_5_NoContainmentCycle(world)[0]?.code).toBe('E_INV_CONTAINMENT_CYCLE');
  });

  it('INV-6 拓扑一致', () => {
    const world = createWorld();
    const a = world.createNode();
    const b = world.createNode();
    world.createLink(a.id, b.id);
    world.nodes.delete(b.id);
    expect(checkINV_6_TopologyConsistency(world)[0]?.code).toBe('E_INV_TOPOLOGY_CONSISTENCY');
  });

  it('INV-7 父子一致', () => {
    const world = createWorld();
    world.createNode('missing');
    expect(checkINV_7_ParentChild(world)[0]?.code).toBe('E_INV_PARENT_CHILD');
  });

  it('INV-8 关系对称', () => {
    const world = createWorld();
    const a = world.createEntity('actor');
    const b = world.createEntity('actor');
    a.relations.set('knows', { out: new Set([b.id]), in: new Set() });
    expect(checkINV_8_RelationSymmetry(world)[0]?.code).toBe('E_INV_RELATION_SYMMETRY');
  });

  it('INV-9 容器双向一致', () => {
    const world = createWorld();
    const owner = world.createEntity('actor');
    const container = world.createContainer({ owner: owner.id, name: 'bag' });
    owner.containers.delete('bag');
    expect(checkINV_9_ContainerBidirectional(world)[0]?.code).toBe('E_INV_CONTAINER_BIDIRECTIONAL');
    expect(container.owner).toBe(owner.id);
  });

  it('INV-10 槽位索引连续', () => {
    const world = createWorld();
    const container = world.createContainer({ insert: 'shift', slots: 2 });
    container.slots[0] = null;
    expect(checkINV_10_SlotIndexContinuity(world)[0]?.code).toBe('E_INV_SLOT_INDEX_CONTINUITY');
  });

  it('INV-11 堆叠守恒', () => {
    const world = createWorld();
    const item = world.createItem('coin', 2);
    const baseline = snapshot(world);
    item.stack = 3;
    expect(checkINV_11_StackConservation(world, { baseline })[0]?.code).toBe('E_INV_STACK_LEAK');
  });

  it('INV-12 代价守恒', () => {
    const world = createWorld();
    world.createEntity('actor', { gold: 5 }).frozenResources.set('gold', 1);
    expect(checkINV_12_CostConservation(world)[0]?.code).toBe('E_COST_LEAK');
  });

  it('INV-13 附属一致', () => {
    const world = createWorld();
    world.attachments.set('attachment-1', { id: 'attachment-1', target: 'missing' });
    expect(checkINV_13_AttachmentConsistency(world)[0]?.code).toBe('E_INV_ATTACHMENT_CONSISTENCY');
  });

  it('INV-14 堆叠有界', () => {
    const world = createWorld();
    world.createItem('coin', 0);
    expect(checkINV_14_StackBounded(world)[0]?.code).toBe('E_INV_STACK_BOUNDED');
  });

  it('INV-15 决策有终', () => {
    const world = createWorld();
    world.decisions.set('decision-1', { id: 'decision-1', status: 'open', deadline: 100 });
    expect(checkINV_15_DecisionTermination(world, { now: 101 })[0]?.code).toBe('E_INV_DECISION_TERMINATION');
  });

  it('INV-16 数值有界', () => {
    const world = createWorld();
    world.createEntity('actor', { gold: Number.NaN });
    expect(checkINV_16_NumericBounded(world)[0]?.code).toBe('E_INV_NAN_OR_INFINITY');
  });
});

describe('补充数值边界矩阵（23 cases）', () => {
  it.each([
    [1, 0, 1], [1, 1, 2], [2, -1, 1], [2, 2, 4], [3, -2, 1],
    [3, 2, 5], [4, -3, 1], [4, 1, 5], [5, -4, 1], [5, 0, 5],
  ])('stack.adjust initial=%i delta=%i -> %i', (initial, delta, expected) => {
    const world = createWorld();
    const item = world.createItem('coin', initial);
    expect(new OpRegistry(world).invoke('stack.adjust', { itemId: item.id, delta }).ok).toBe(true);
    expect(world.items.get(item.id)?.stack).toBe(expected);
  });

  it.each([[1, 2], [1, 3], [2, 3], [3, 4], [4, 5]])(
    'cost.freeze available=%i request=%i -> insufficient',
    (available, request) => {
      const world = createWorld();
      const entity = world.createEntity('actor', { gold: available });
      expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', { entityId: entity.id, resources: { gold: request } }))).toBe('E_COST_INSUFFICIENT');
    },
  );

  it.each([[2, 1], [3, 1], [3, 2], [4, 1], [5, 5]])(
    'stack.split initial=%i amount=%i conserves total',
    (initial, amount) => {
      const world = createWorld();
      const item = world.createItem('coin', initial);
      const container = world.createContainer();
      expect(new OpRegistry(world).invoke('stack.split', { sourceId: item.id, amount, targetContainerId: container.id }).ok).toBe(true);
      expect(stackCounts(world).get('coin')).toBe(initial);
    },
  );

  it.each([[1, 1], [1, 2], [2, 3]])('stack.merge %i + %i succeeds', (sourceStack, targetStack) => {
    const world = createWorld();
    const source = world.createItem('coin', sourceStack);
    const target = world.createItem('coin', targetStack);
    expect(new OpRegistry(world).invoke('stack.merge', { sourceId: source.id, targetId: target.id }).ok).toBe(true);
    expect(world.items.get(target.id)?.stack).toBe(sourceStack + targetStack);
  });
});


describe('规范数值与拓扑边界', () => {
  it('ItemDef.stackMax 超过 5 时拒绝注册', () => {
    const world = new World();
    expect(() => world.registerDef({ id: 'invalid', stackMax: 6 })).toThrow(/\[1, 5\]/);
  });

  it('cost.freeze 单次数值超过 5 时拒绝', () => {
    const world = createWorld();
    const entity = world.createEntity('actor', { gold: 5 });
    expect(invokeCode(new OpRegistry(world).invoke('cost.freeze', {
      entityId: entity.id,
      resources: { gold: 6 },
    }))).toBe('E_OP_INVALID_AMOUNT');
  });

  it('INV-6 检测节点连接数超过 5', () => {
    const world = createWorld();
    const center = world.createNode();
    for (let index = 0; index < 6; index++) {
      const neighbor = world.createNode();
      world.createLink(center.id, neighbor.id);
    }
    expect(checkINV_6_TopologyConsistency(world).some((entry) => entry.detail.includes('exceeds 5'))).toBe(true);
  });
});
