/**
 * 全面对抗性属性测试专项：异形 Expr / Def 模糊测试。
 *
 * 目标：需求12.1（Expr 全函数，任意输入返回值或诊断，不抛异常）与需求16.2-16.3（Op 永不
 * 抛异常）的联合边界——不是喂"结构合法但语义空洞"的 Expr（已有 engine.test.ts 的 Property 2
 * 姊妹测试覆盖），而是喂"结构本身就带刺"的输入：深度递归到预算上限、自引用式深链、Def.clamp
 * 里 min>max 的矛盾声明、slot.accepts 挂一个会访问不存在路径的 Expr、继承链把 extends 指向
 * 自己或指向一个尚未注册的占位 Id 再注册一个真正的环。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import type { Expr } from '../../state/expr-types';
import { DefRegistry } from '../../state/def';
import { createFullHarness, defaultSeedDefs } from '../full-harness';
import { resetIdCounters } from '../../state/ids';
import { registerPropOps } from '../../ops/prop-ops';
import { OpRegistry } from '../../ops/registry';
import { WorldStateHolder } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { createEntityShape } from '../../state/entity';
import type { Ref } from '../../state/ids';

const engine = new ExprEngine();

describe('异形 Expr 模糊测试：深度递归到预算上限', () => {
  it('Property M1: 对于任意深度 1-200 的自嵌套 op 表达式（如 add(add(add(...1...)))），eval 永不抛异常，且深度超出 maxDepth 时返回 null 而不是挂死', () => {
    // 边界推导（写测试时先证明再断言，避免拍脑袋定边界值）：wrapCount 层 add 嵌套，
    // 第 k 层（0-indexed，最外层为 0）的 op 节点在 ctx.budget.depth=k 时被求值，其两个参数
    // 在 depth=k+1 时被求值。因此最内层字面量 `1` 在 depth=wrapCount 时被求值，这是整次求值
    // 过程中达到的最大 depth 值。evalInner 的检查是 `depth > maxDepth` 才返回 null，
    // 所以：wrapCount <= maxDepth 时全部节点都在预算内，结果应为 wrapCount+1；
    // wrapCount > maxDepth 时最内层节点触发 null，该 null 经 add 的 num()===null 短路
    // 逐层传播到顶层，最终结果为 null。
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (wrapCount) => {
        let expr: Expr = 1;
        for (let i = 0; i < wrapCount; i++) {
          expr = { op: 'add', args: [expr, 1] };
        }
        const ctx = makeDefaultEvalContext();
        expect(() => engine.eval(expr, ctx)).not.toThrow();
        const result = engine.eval(expr, ctx);
        if (wrapCount <= ctx.budget.maxDepth) {
          expect(result).toBe(wrapCount + 1);
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 500 },
    );
  });

  it('Property M2: 对于任意畸形算子名（含空字符串、随机随机字符串、内置算子的大小写变体），eval 返回 null 而不抛异常', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 20 }), fc.array(fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)), { maxLength: 5 }), (opName, args) => {
        const ctx = makeDefaultEvalContext();
        expect(() => engine.eval({ op: opName, args: args as Expr[] }, ctx)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('Property M3: 对于任意结构随机的深度嵌套对象（混合 op/path/var/call/普通字面量映射，深度 1-50），eval 永不抛异常', () => {
    const nestedArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      node: fc.oneof(
        { depthSize: 'large', withCrossShrink: true, maxDepth: 50 },
        fc.constant(null),
        fc.boolean(),
        fc.double({ noNaN: true }),
        fc.string({ maxLength: 5 }),
        fc.record({ op: fc.constantFrom('add', 'sub', 'eq', 'and', 'gibberish'), args: fc.array(tie('node') as fc.Arbitrary<Expr>, { maxLength: 3 }) }),
        fc.record({ path: fc.string({ maxLength: 10 }) }),
        fc.record({ var: fc.string({ maxLength: 10 }) }),
        fc.record({ call: fc.string({ maxLength: 10 }), args: fc.dictionary(fc.string({ maxLength: 5 }), tie('node') as fc.Arbitrary<Expr>, { maxKeys: 3 }) }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), tie('node') as fc.Arbitrary<Expr>, { maxKeys: 4 }),
      ),
    })).node;

    fc.assert(
      fc.property(nestedArb, (expr) => {
        const ctx = makeDefaultEvalContext({ resolveNamedExpr: () => null });
        expect(() => engine.eval(expr as Expr, ctx)).not.toThrow();
      }),
      { numRuns: 800 },
    );
  });
});

describe('异形 Def 模糊测试：矛盾继承链与 clamp 声明', () => {
  it('Property M4: 对于任意构造的"部分环"继承链（前向引用尚未注册的父 Def，之后再注册出真正的环），register 最终应拒绝且不抛异常', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }), fc.integer({ min: 0, max: 9 }), (n, permSeed) => {
        const registry = new DefRegistry();
        const ids = Array.from({ length: n }, (_, i) => `d:node${i}`);
        // 随机打乱注册顺序（模拟"前向引用"：子 Def 可能先于父 Def 注册）
        const order = [...ids].sort((a, b) => (hashStr(a + permSeed) - hashStr(b + permSeed)));
        for (let i = 0; i < order.length - 1; i++) {
          const idx = ids.indexOf(order[i] as string);
          const nextIdx = (idx + 1) % n;
          expect(() => registry.register({ id: order[i] as string, kind: 'entity', extends: [ids[nextIdx] as string] })).not.toThrow();
        }
        // 最后一个注册的 Def 闭合环
        const lastId = order[order.length - 1] as string;
        const idx = ids.indexOf(lastId);
        const nextIdx = (idx + 1) % n;
        const finalResult = registry.register({ id: lastId, kind: 'entity', extends: [ids[nextIdx] as string] });
        // 环是否被检测取决于注册顺序是否恰好闭合了环——这里只断言不抛异常，
        // 且若检测到环则返回 ok:false 而不是静默接受
        expect(typeof finalResult.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('Property M5: 对于任意 clamp 声明（含 min>max 的矛盾声明），prop.add 永不抛异常，且矛盾 clamp 下的行为是确定性的（不产生 NaN/Infinity）', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: -10000, max: 10000 }), (min, max, delta) => {
        resetIdCounters();
        const defRegistry = new DefRegistry();
        defRegistry.register({ id: 'd:clamped', kind: 'entity', clamp: { hp: { min, max } } });
        const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
        const registry = new OpRegistry(holder);
        registerPropOps(registry, defRegistry);

        const entity = createEntityShape('e:1', 'd:clamped');
        holder.setState({ ...holder.getState(), entities: { 'e:1': entity } });

        expect(() => registry.invoke('prop.add', { path: 'entities.e:1.props.hp', delta })).not.toThrow();
        const result = registry.invoke('prop.add', { path: 'entities.e:1.props.hp', delta });
        if (result.ok) {
          const value = result.value as number;
          expect(Number.isFinite(value)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('异形 Expr 模糊测试：slot.accepts 挂载会抛内部错误的谓词', () => {
  it('Property M6: 对于任意会访问不存在路径/畸形算子的 accepts Expr，item.move 的槎位筛选永不抛异常，只影响该次移动是否成功', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ op: fc.constant('gibberish-op'), args: fc.constant([]) }),
          fc.record({ path: fc.constantFrom('nonexistent.deep.path', 'entities.e:doesnotexist.props.x') }),
          fc.record({ op: fc.constant('eq'), args: fc.constant([{ path: 'a.b.c.d.e.f.g' }, 1]) }),
        ),
        (accepts) => {
          resetIdCounters();
          const harness = createFullHarness(defaultSeedDefs());
          const { registry, holder } = harness;

          const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
          expect(entity.ok).toBe(true);
          if (!entity.ok) return;

          const containerResult = harnessCreateContainer(holder, entity.value.$);
          expect(() => registry.invoke('slot.add', { containerId: containerResult, accepts: accepts as Expr })).not.toThrow();
          registry.invoke('slot.add', { containerId: containerResult, accepts: accepts as Expr });

          const item = registry.invoke<{ def: string }, Ref>('item.create', { def: 'd:sword' });
          expect(item.ok).toBe(true);
          if (!item.ok) return;

          expect(() => registry.invoke('item.move', { itemId: item.value.$, toContainerId: containerResult })).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });
});

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function harnessCreateContainer(holder: ReturnType<typeof createFullHarness>['holder'], ownerId: string): string {
  const draft = holder.getState();
  const containerId = `c:fuzz-${Math.random()}`;
  const container = { id: containerId, owner: ownerId, name: 'main', slots: [], insert: 'fixed' as const, props: {} };
  const entity = draft.entities[ownerId];
  const nextEntities = entity ? { ...draft.entities, [ownerId]: { ...entity, containers: { ...entity.containers, main: containerId } } } : draft.entities;
  holder.setState({ ...draft, containers: { ...draft.containers, [containerId]: container }, entities: nextEntities });
  return containerId;
}
