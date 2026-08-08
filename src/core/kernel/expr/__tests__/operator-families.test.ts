/**
 * L2 Expr：拓扑/状态/关系/认知/表 五类内置算子的行为锁定（design.md 3.3节算子表 / 需求12.7、30.8）。
 *
 * 为什么单独立一个文件：既有 engine.test.ts 只覆盖算术/比较/逻辑/空值这几类"不需要 WorldState"
 * 的算子。拓扑与状态类算子必须先有一个真实的 WorldState 才能求值，它们此前完全没有测试——
 * 事实上 dist/spread/path/radius/hasAttachment/attachCount/propOf/defOf/relOut/relIn/hasRel/knows
 * 这一整批算子在本次修补前根本没有实现，算子表里只有一个把 tags 从内联对象上读出来的 hasTag。
 * 需求12.7 明确要求的 isA 也只是 ExprEngine 的一个实例方法，没进算子表，`{op:'isA'}` 恒为 null。
 */
import { describe, expect, it } from 'vitest';
import { ExprEngine, makeDefaultEvalContext } from '../engine.js';
import type { EvalContext } from '../engine.js';
import { makeExprStateAccess } from '../state-access.js';
import { DefRegistry } from '../../state/def.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import type { WorldState } from '../../state/world-state.js';
import { createEntityShape, createItemShape } from '../../state/entity.js';
import { createLinkShape, createNodeShape } from '../../topology/types.js';
import type { Expr } from '../../state/expr-types.js';
import type { Value } from '../../state/value.js';

/**
 * 一条三节点直链 n:a -(w=1)- n:b -(w=2)- n:c，外加一个孤立节点 n:island。
 * e:hero 站在 n:a，e:foe 站在 n:c；i:sword 在 e:hero 的 bag 容器里。
 */
function buildWorld(): { state: WorldState; defRegistry: DefRegistry } {
  const defRegistry = new DefRegistry();
  defRegistry.register({ id: 'd:creature', kind: 'entity', abstract: true });
  defRegistry.register({ id: 'd:human', kind: 'entity', extends: ['d:creature'] });
  defRegistry.register({ id: 'd:blade', kind: 'item' });
  defRegistry.register({ id: 'd:room', kind: 'node' });
  defRegistry.register({ id: 'd:door', kind: 'link' });
  defRegistry.register({ id: 'd:poison', kind: 'attachment', stackStrategy: 'count' } as never);

  const base = createEmptyWorldState('sched:test');
  const state: WorldState = {
    ...base,
    world: {
      ...base.world,
      turn: { scheduleId: 'sched:test', phaseIndex: 0, phaseEnteredAt: 10 },
      knowledge: { 'ag:1': { facts: { sawHero: true, count: 3 }, seen: {} } },
      attachments: {
        'a:1': { id: 'a:1', def: 'd:poison', target: { $: 'e:hero' }, props: { potency: 2 }, stack: 3 },
        // activeAt=99 > 当前相位 10：整条 Attachment 视为未生效（需求30.8）
        'a:2': { id: 'a:2', def: 'd:poison', target: { $: 'e:foe' }, props: {}, stack: 1, activeAt: 99 },
      },
    },
    nodes: {
      'n:a': { ...createNodeShape('n:a', 'd:room'), tags: ['lit'] },
      'n:b': { ...createNodeShape('n:b', 'd:room'), parent: 'n:a' },
      'n:c': createNodeShape('n:c', 'd:room'),
      'n:island': createNodeShape('n:island', 'd:room'),
    },
    links: {
      'l:ab': { ...createLinkShape('l:ab', 'n:a', 'n:b', { def: 'd:door', weight: 1 }), tags: ['walk'] },
      'l:bc': { ...createLinkShape('l:bc', 'n:b', 'n:c', { def: 'd:door', weight: 2 }), tags: ['sight'] },
    },
    entities: {
      'e:hero': {
        ...createEntityShape('e:hero', 'd:human'),
        tags: ['living', 'player'],
        props: { hp: 4, nested: { deep: 5 } },
        node: 'n:a',
        containers: { bag: 'c:bag' },
        relations: { allyOf: { out: [{ $: 'e:foe' }], in: [] } },
      },
      'e:foe': {
        ...createEntityShape('e:foe', 'd:human'),
        tags: ['living'],
        node: 'n:c',
        relations: { allyOf: { out: [], in: [{ $: 'e:hero' }] } },
      },
    },
    items: { 'i:sword': { ...createItemShape('i:sword', 'd:blade'), tags: ['weapon'], slot: 's:bag0' } },
    containers: {
      'c:bag': {
        id: 'c:bag', owner: 'e:hero', name: 'bag', insert: 'shift', props: {},
        slots: [{ id: 's:bag0', tags: [], props: {}, holds: { $: 'i:sword' } }],
      },
    },
  };
  return { state, defRegistry };
}

function makeCtx(): EvalContext {
  const { state, defRegistry } = buildWorld();
  return makeDefaultEvalContext({
    defRegistry,
    stateAccess: makeExprStateAccess(() => state, defRegistry),
    resolvePath: () => null,
  });
}

const engine = new ExprEngine();
const evaluate = (expr: Expr, ctx: EvalContext = makeCtx()): Value | null => engine.eval(expr, ctx);
const op = (name: string, ...args: Expr[]): Expr => ({ op: name, args });
const ref = (id: string): Expr => ({ $: id });

describe('拓扑类算子', () => {
  it('dist 返回加权最短路代价，不连通返回 null', () => {
    expect(evaluate(op('dist', ref('n:a'), ref('n:c')))).toBe(3);
    expect(evaluate(op('dist', ref('n:a'), ref('n:a')))).toBe(0);
    expect(evaluate(op('dist', ref('n:a'), ref('n:island')))).toBeNull();
  });

  it('dist 接受裸 NodeId 字符串，与 Ref 形态等价', () => {
    expect(evaluate(op('dist', 'n:a', 'n:c'))).toBe(3);
  });

  it('dist 的 metric:hops 只数跳数，忽略边权', () => {
    expect(evaluate(op('dist', 'n:a', 'n:c', { metric: 'hops' }))).toBe(2);
  });

  it('dist 的 viaTag 只允许走带该 tag 的边', () => {
    // n:a->n:b 是 walk，n:b->n:c 是 sight：只允许 walk 时 n:c 不可达
    expect(evaluate(op('dist', 'n:a', 'n:b', { viaTag: 'walk' }))).toBe(1);
    expect(evaluate(op('dist', 'n:a', 'n:c', { viaTag: 'walk' }))).toBeNull();
  });

  it('dist 的 maxCost 切断超预算路径', () => {
    expect(evaluate(op('dist', 'n:a', 'n:c', { maxCost: 2 }))).toBeNull();
    expect(evaluate(op('dist', 'n:a', 'n:c', { maxCost: 3 }))).toBe(3);
  });

  it('path 返回含起终点的节点序列，不连通返回 null', () => {
    expect(evaluate(op('path', 'n:a', 'n:c'))).toEqual(['n:a', 'n:b', 'n:c']);
    expect(evaluate(op('path', 'n:a', 'n:a'))).toEqual(['n:a']);
    expect(evaluate(op('path', 'n:a', 'n:island'))).toBeNull();
  });

  it('radius 返回预算内可达节点，按 NodeId 升序且不含起点', () => {
    expect(evaluate(op('radius', 'n:a', 1))).toEqual(['n:b']);
    expect(evaluate(op('radius', 'n:a', 3))).toEqual(['n:b', 'n:c']);
    expect(evaluate(op('radius', 'n:a', 0))).toEqual([]);
  });

  it('spread 按强度降序返回，起点不在结果里', () => {
    const result = evaluate(op('spread', 'n:a', 5)) as unknown as { node: string; strength: number }[];
    expect(result.map((entry) => entry.node)).toEqual(['n:b', 'n:c']);
    expect(result[0]?.strength).toBe(4);
    expect(result[1]?.strength).toBe(2);
  });

  it('nodeOf 解析 Entity 所在节点，并沿容器链回溯 Item 所在节点', () => {
    expect(evaluate(op('nodeOf', ref('e:hero')))).toBe('n:a');
    expect(evaluate(op('nodeOf', ref('i:sword')))).toBe('n:a');
  });

  it('parentOf / containerOf / slotOf / occupantsOf 各自解析所属关系', () => {
    expect(evaluate(op('parentOf', 'n:b'))).toBe('n:a');
    expect(evaluate(op('parentOf', 'n:a'))).toBeNull();
    expect(evaluate(op('containerOf', ref('i:sword')))).toBe('c:bag');
    expect(evaluate(op('slotOf', ref('i:sword')))).toBe('s:bag0');
    expect(evaluate(op('occupantsOf', 'n:a'))).toEqual([{ $: 'e:hero' }]);
    expect(evaluate(op('occupantsOf', 'n:island'))).toEqual([]);
  });
});

describe('状态类算子', () => {
  it('hasTag 支持 Ref 形态（从 WorldState 解析 tags）', () => {
    expect(evaluate(op('hasTag', ref('e:hero'), 'player'))).toBe(true);
    expect(evaluate(op('hasTag', ref('e:hero'), 'ghost'))).toBe(false);
    expect(evaluate(op('hasTag', ref('i:sword'), 'weapon'))).toBe(true);
    expect(evaluate(op('hasTag', ref('n:a'), 'lit'))).toBe(true);
  });

  it('hasTag 仍支持内联对象形态（slots[].accepts 谓词求值时没有可寻址 Ref）', () => {
    expect(evaluate(op('hasTag', { tags: ['currency'] } as unknown as Expr, 'currency'))).toBe(true);
    expect(evaluate(op('hasTag', { tags: ['currency'] } as unknown as Expr, 'weapon'))).toBe(false);
  });

  it('propOf 读属性并支持点号深路径', () => {
    expect(evaluate(op('propOf', ref('e:hero'), 'hp'))).toBe(4);
    expect(evaluate(op('propOf', ref('e:hero'), 'nested.deep'))).toBe(5);
    expect(evaluate(op('propOf', ref('e:hero'), 'absent'))).toBeNull();
  });

  it('defOf 返回 defId', () => {
    expect(evaluate(op('defOf', ref('e:hero')))).toBe('d:human');
    expect(evaluate(op('defOf', ref('i:sword')))).toBe('d:blade');
  });

  it('isA 作为算子可用并沿继承链判定（需求12.7）', () => {
    // 本次修补前这一条恒为 null：isA 只是 ExprEngine 的实例方法，从未进入算子表。
    expect(evaluate(op('isA', ref('e:hero'), 'd:human'))).toBe(true);
    expect(evaluate(op('isA', ref('e:hero'), 'd:creature'))).toBe(true);
    expect(evaluate(op('isA', ref('e:hero'), 'd:blade'))).toBe(false);
  });

  it('hasAttachment / attachCount 只统计已生效的 Attachment（需求30.8）', () => {
    expect(evaluate(op('hasAttachment', ref('e:hero'), 'd:poison'))).toBe(true);
    // e:foe 的 a:2 声明了 activeAt=99，当前相位为 10：视为不存在
    expect(evaluate(op('hasAttachment', ref('e:foe'), 'd:poison'))).toBe(false);
    // stack:'count' 下 attachCount 累加层数而非条数
    expect(evaluate(op('attachCount', ref('e:hero'), 'd:poison'))).toBe(3);
    expect(evaluate(op('attachCount', ref('e:foe'), 'd:poison'))).toBe(0);
    // 不传 defId 时统计已生效条数
    expect(evaluate(op('attachCount', ref('e:hero')))).toBe(1);
    expect(evaluate(op('attachCount', ref('e:foe')))).toBe(0);
  });
});

describe('关系类算子', () => {
  it('relOut / relIn 对称地读出关系两端', () => {
    expect(evaluate(op('relOut', ref('e:hero'), 'allyOf'))).toEqual([{ $: 'e:foe' }]);
    expect(evaluate(op('relIn', ref('e:foe'), 'allyOf'))).toEqual([{ $: 'e:hero' }]);
    expect(evaluate(op('relOut', ref('e:foe'), 'allyOf'))).toEqual([]);
    expect(evaluate(op('relOut', ref('e:hero'), 'absentKind'))).toEqual([]);
  });

  it('hasRel 判定有向存在性', () => {
    expect(evaluate(op('hasRel', ref('e:hero'), ref('e:foe'), 'allyOf'))).toBe(true);
    expect(evaluate(op('hasRel', ref('e:foe'), ref('e:hero'), 'allyOf'))).toBe(false);
  });
});

describe('认知类算子', () => {
  it('knows 读认知域事实，未知返回 null', () => {
    expect(evaluate(op('knows', 'ag:1', 'sawHero'))).toBe(true);
    expect(evaluate(op('knows', 'ag:1', 'count'))).toBe(3);
    expect(evaluate(op('knows', 'ag:1', 'nope'))).toBeNull();
    expect(evaluate(op('knows', 'ag:absent', 'sawHero'))).toBeNull();
  });

  it('visibleTo 刻意不是算子：可见性只在 QueryEngine 的 visibleTo 参数上实现', () => {
    expect(evaluate(op('visibleTo', ref('e:hero'), 'ag:1'))).toBeNull();
  });
});

describe('表类算子', () => {
  it('slice / contains / sort / reverse / sum 按表语义工作', () => {
    expect(evaluate(op('slice', [1, 2, 3, 4] as unknown as Expr, 1, 3))).toEqual([2, 3]);
    expect(evaluate(op('slice', [1, 2, 3, 4] as unknown as Expr, 2))).toEqual([3, 4]);
    expect(evaluate(op('contains', [1, 2, 3] as unknown as Expr, 2))).toBe(true);
    expect(evaluate(op('contains', [1, 2, 3] as unknown as Expr, 9))).toBe(false);
    expect(evaluate(op('sort', [3, 1, 2] as unknown as Expr))).toEqual([1, 2, 3]);
    expect(evaluate(op('sort', ['c', 'a', 'b'] as unknown as Expr))).toEqual(['a', 'b', 'c']);
    expect(evaluate(op('reverse', [1, 2, 3] as unknown as Expr))).toEqual([3, 2, 1]);
    expect(evaluate(op('sum', [1, 2, 3] as unknown as Expr))).toBe(6);
  });

  it('sum 遇到非数元素返回 null，而不是静默跳过', () => {
    expect(evaluate(op('sum', [1, 'x', 3] as unknown as Expr))).toBeNull();
  });

  it('any / all 是真值归约，不接受谓词（Expr 无闭包）', () => {
    expect(evaluate(op('any', [false, true] as unknown as Expr))).toBe(true);
    expect(evaluate(op('any', [false, false] as unknown as Expr))).toBe(false);
    expect(evaluate(op('all', [true, true] as unknown as Expr))).toBe(true);
    expect(evaluate(op('all', [true, false] as unknown as Expr))).toBe(false);
  });

  it('map / filter 刻意不提供：需要按谓词筛选时用 Query 的 where', () => {
    expect(evaluate(op('map', [1, 2] as unknown as Expr, true))).toBeNull();
    expect(evaluate(op('filter', [1, 2] as unknown as Expr, true))).toBeNull();
  });

  it('表算子对非表入参一律返回 null，不抛异常', () => {
    for (const name of ['slice', 'contains', 'sort', 'reverse', 'sum', 'any', 'all']) {
      expect(evaluate(op(name, 'not-a-list', 1))).toBeNull();
    }
  });
});

describe('全函数性：缺少 stateAccess 时不抛异常', () => {
  it('所有需要状态的算子在 accessor 缺失时返回 null 或 false，绝不抛出', () => {
    const bare = makeDefaultEvalContext({ resolvePath: () => null });
    const nullary = ['dist', 'path', 'radius', 'spread', 'nodeOf', 'parentOf', 'containerOf',
      'slotOf', 'occupantsOf', 'propOf', 'defOf', 'relOut', 'relIn', 'knows'];
    for (const name of nullary) {
      expect(() => evaluate(op(name, ref('e:hero'), ref('e:foe')), bare)).not.toThrow();
      expect(evaluate(op(name, ref('e:hero'), ref('e:foe')), bare)).toBeNull();
    }
    // 布尔类算子失败关闭为 false，而不是 null：它们出现在 require/when 的谓词位置，
    // null 与 false 在那里都表示"不通过"，但显式 false 让语义更明确。
    for (const name of ['hasTag', 'hasAttachment', 'hasRel', 'isA']) {
      expect(evaluate(op(name, ref('e:hero'), 'x'), bare)).toBe(false);
    }
  });
});

describe('随机算子仍不属于 Expr（需求12.8 / Property 30）', () => {
  it('roll/pick/shuffle/weightedPick 在算子表里不存在且求值恒为 null', () => {
    for (const name of ['roll', 'pick', 'shuffle', 'weightedPick']) {
      expect(evaluate(op(name, 6))).toBeNull();
    }
    expect(() => ExprEngine.assertNoRandomOps()).not.toThrow();
  });
});
