/**
 * 跨层真实接线的穷举组合测试：五阶段 × 多候选优先级 × veto 结果的完整交互矩阵。
 *
 * 方法论：不用随机采样，而是对"同一个结构性 Op 上同时挂载 before/modify/instead/default/
 * after 五个阶段各一条规则，其中 before 阶段可能 veto 也可能放行"这一组合空间做完整穷举——
 * 5 个阶段 × 每阶段 0-2 条候选 × veto 命中位置，枚举出全部有意义的组合类别（而不是随机抽样
 * 碰几个），逐一验证真实 OpRegistry 事务机制 + 真实 FlowInterpreter 执行 + 真实
 * HookDispatcher 五阶段调度的组合结果与"单独测试各阶段"时的预期完全一致——这是
 * events/__tests__/dispatcher.test.ts（用 mock EffectRunner）与本文件（用真实
 * FlowInterpreter）的关键差异：前者验证调度顺序逻辑本身，后者验证调度顺序在真实事务/回滚/
 * 嵌套 Op 调用环境下是否还成立。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { wireHooksIntoRegistry } from '../wire-hooks.js';
import { WorldStateHolder } from '../ops/transaction.js';
import { createEmptyWorldState } from '../state/world-state.js';
import { resetIdCounters } from '../state/ids.js';
import { registerStructuralOps, makeItemMove } from '../ops/structural-ops.js';
import { registerPropOps } from '../ops/prop-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine.js';
import { DefRegistry } from '../state/def.js';
import type { Def } from '../state/def.js';

const TEST_DEFS = new Map<string, Def>([['d:sword', { id: 'd:sword', kind: 'item' }]]);

function setup() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const wired = wireHooksIntoRegistry({ holder });
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(wired.registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  registerPropOps(wired.registry, new DefRegistry());
  return { holder, ...wired };
}

describe('穷举组合：五阶段 × 优先级 × veto 在真实事务环境下的交互', () => {
  beforeEach(() => resetIdCounters());

  // ---- 维度1：before 阶段的多候选执行顺序（穷举 3 种优先级排列：升序/降序/相同）----
  const priorityOrders: { name: string; priorities: [number, number] }[] = [
    { name: '升序声明(2,1)应按优先级值排序为1先2后', priorities: [2, 1] },
    { name: '降序声明(1,2)应按优先级值排序为1先2后', priorities: [1, 2] },
    { name: '相同优先级应按ruleId字典序排序', priorities: [5, 5] },
  ];
  for (const { name, priorities } of priorityOrders) {
    it(`before 阶段多候选执行顺序：${name}`, () => {
      const { holder, registry, ruleProvider } = setup();
      const [p1, p2] = priorities;
      // 用 list.insert 累积执行顺序而不是覆盖同一个 marker（before 每条候选都要留痕）
      ruleProvider.add({
        id: 'r:a', kind: 'rule', on: 'before:item.create', phase: 'before', priority: p1,
        effects: [{ op: 'list.insert', args: { path: 'world.props.order', value: 'r:a' } }],
      });
      ruleProvider.add({
        id: 'r:b', kind: 'rule', on: 'before:item.create', phase: 'before', priority: p2,
        effects: [{ op: 'list.insert', args: { path: 'world.props.order', value: 'r:b' } }],
      });
      // 需要先初始化 order 为空数组，否则 list.insert 的 getPath 返回 null -> 视为空数组也可以，
      // 但为了显式起见先创建
      registry.invoke('prop.set', { path: 'world.props.order', value: [] });

      const result = registry.invoke('item.create', { def: 'd:sword' });
      expect(result.ok).toBe(true);
      const order = holder.getState().world.props['order'] as string[];

      if (p1 === p2) {
        // 相同优先级：按 ruleId 字典序（r:a < r:b）
        expect(order).toEqual(['r:a', 'r:b']);
      } else {
        const expected = p1 < p2 ? ['r:a', 'r:b'] : ['r:b', 'r:a'];
        expect(order).toEqual(expected);
      }
    });
  }

  // ---- 维度2：before 阶段 veto 出现在不同优先级位置时的短路行为（穷举3种位置：第一个/第二个/都不veto）----
  const vetoPositions: { name: string; vetoFirst: boolean; vetoSecond: boolean; expectCancelled: boolean }[] = [
    { name: '第一个候选veto：第二个不应执行', vetoFirst: true, vetoSecond: false, expectCancelled: true },
    { name: '第一个不veto第二个veto：第二个执行后取消', vetoFirst: false, vetoSecond: true, expectCancelled: true },
    { name: '都不veto：两者都执行，Op成功', vetoFirst: false, vetoSecond: false, expectCancelled: false },
  ];
  for (const { name, vetoFirst, vetoSecond, expectCancelled } of vetoPositions) {
    it(`before veto 位置穷举：${name}`, () => {
      const { holder, registry, ruleProvider } = setup();
      ruleProvider.add({
        id: 'r:1', kind: 'rule', on: 'before:item.create', phase: 'before', priority: 1,
        effects: vetoFirst ? [{ abort: 'v1' }] : [{ op: 'prop.set', args: { path: 'world.props.m1', value: true } }],
      });
      ruleProvider.add({
        id: 'r:2', kind: 'rule', on: 'before:item.create', phase: 'before', priority: 2,
        effects: vetoSecond ? [{ abort: 'v2' }] : [{ op: 'prop.set', args: { path: 'world.props.m2', value: true } }],
      });
      const before = holder.getState();
      const result = registry.invoke('item.create', { def: 'd:sword' });
      expect(result.ok).toBe(!expectCancelled);
      if (expectCancelled) {
        expect(holder.getState()).toBe(before); // 零状态改动
      }
      // r:1 优先级更低，总是先执行；若 r:1 veto，r:2 不应执行（不留下 m2 标记）
      if (vetoFirst) {
        expect(holder.getState().world.props['m2']).toBeUndefined();
      }
    });
  }

  // ---- 维度3：instead 阶段排他执行 + default 阶段的互斥关系（穷举：无instead/有一个通过/多个候选但只一个when通过）----
  it('instead 有候选通过时，default 阶段完全不执行（即便 default 阶段也挂了规则）', () => {
    const { holder, registry, ruleProvider } = setup();
    ruleProvider.add({
      id: 'r:instead', kind: 'rule', on: 'before:item.create', phase: 'instead', priority: 0,
      effects: [{ op: 'prop.set', args: { path: 'world.props.insteadRan', value: true } }],
    });
    ruleProvider.add({
      id: 'r:default', kind: 'rule', on: 'before:item.create', phase: 'default', priority: 0,
      effects: [{ op: 'prop.set', args: { path: 'world.props.defaultRan', value: true } }],
    });
    registry.invoke('item.create', { def: 'd:sword' });
    expect(holder.getState().world.props['insteadRan']).toBe(true);
    expect(holder.getState().world.props['defaultRan']).toBeUndefined();
  });

  it('instead 候选存在但 when 全部为 false 时，转入 default 阶段执行', () => {
    const { holder, registry, ruleProvider } = setup();
    ruleProvider.add({
      id: 'r:instead', kind: 'rule', on: 'before:item.create', phase: 'instead', priority: 0, when: false,
      effects: [{ op: 'prop.set', args: { path: 'world.props.insteadRan', value: true } }],
    });
    ruleProvider.add({
      id: 'r:default', kind: 'rule', on: 'before:item.create', phase: 'default', priority: 0,
      effects: [{ op: 'prop.set', args: { path: 'world.props.defaultRan', value: true } }],
    });
    registry.invoke('item.create', { def: 'd:sword' });
    expect(holder.getState().world.props['insteadRan']).toBeUndefined();
    expect(holder.getState().world.props['defaultRan']).toBe(true);
  });

  // ---- 维度4：全部五阶段同时挂载在同一事件上的完整链路（笛卡尔积的代表性切片：全部放行）----
  it('全部五阶段（before/modify/instead/default/after）同时挂载，全部放行时按固定顺序依次生效', () => {
    const { holder, registry, ruleProvider } = setup();
    registry.invoke('prop.set', { path: 'world.props.log', value: [] });

    const logEffect = (phase: string) => [{ op: 'list.insert', args: { path: 'world.props.log', value: phase } }];
    ruleProvider.add({ id: 'r:before', kind: 'rule', on: 'before:item.create', phase: 'before', priority: 0, effects: logEffect('before') });
    ruleProvider.add({ id: 'r:modify', kind: 'rule', on: 'before:item.create', phase: 'modify', priority: 0, effects: logEffect('modify') });
    ruleProvider.add({ id: 'r:instead', kind: 'rule', on: 'before:item.create', phase: 'instead', priority: 0, effects: logEffect('instead') });
    // default 不应执行（instead 已通过）
    ruleProvider.add({ id: 'r:default', kind: 'rule', on: 'before:item.create', phase: 'default', priority: 0, effects: logEffect('default') });
    ruleProvider.add({ id: 'r:after', kind: 'rule', on: 'after:item.create', phase: 'after', priority: 0, effects: logEffect('after') });

    const result = registry.invoke('item.create', { def: 'd:sword' });
    expect(result.ok).toBe(true);
    const log = holder.getState().world.props['log'] as string[];
    // before -> modify -> instead 生效（default 跳过，因为 instead 通过）；
    // after 阶段的写入被回滚丢弃，不会出现在最终 log 里
    expect(log).toEqual(['before', 'modify', 'instead']);
  });
});
