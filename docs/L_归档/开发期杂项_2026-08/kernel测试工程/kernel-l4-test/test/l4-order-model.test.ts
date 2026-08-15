/**
 * L4 影子模型测试：instead 竞争排序
 *
 * 为什么需要这个文件：
 * 原 l4-property.test.ts 的 HOOK-2 用 10 万次断言
 * `collectAndSortInstead(t)` 连续两次调用结果相同。该断言是空转的——
 * 同一份输入、无副作用的确定性比较器，两次调用必然相等，
 * 连"完全不排序、原样返回"的实现都能通过。
 * 且 fc.uuid() 让 defId / hookId 两级 tiebreak 一次都没执行。
 *
 * 本文件改为用独立实现的影子模型预测**具体顺序**，
 * 并用小 ID 池强制在全部 6 级 tiebreak 上产生并列。
 * 比对以**对象身份**为单位而非 id——id 允许重复，
 * 用 id 数组比对会让最后一级 order tiebreak 的翻转看起来"没变化"。
 */
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { HookPhase, HookSystem, createEntity } from '../src/index.js';
import type { HookDef, Item } from '../src/index.js';

const RUNS = Number(process.env.L4_RUNS ?? 100_000);

/** 小池子：故意让每一级 tiebreak 都撞上。 */
const IDS = ['a', 'b'];
/** 与 IDS 同池，使 defId 有机会等于 hookId，覆盖两级键的交叉情形。 */
const DEFS = ['a', 'b'];
const PRIORITIES = [-1, 0, 1];
const CONTAINER_ORDER = ['hand', 'backpack', 'belt'];
const EVENT = 'ev';
/** 用于考验 on 过滤：挂在此事件上的规则不应出现在 EVENT 的候选里 */
const OTHER_EVENT = 'other';

interface RuleSpec {
  id: string;
  /** undefined 用于考验"未指定 priority 即视为 0"的缺省契约 */
  priority: number | undefined;
  /** 非 EVENT 时该规则不应被收集 */
  on: string;
  /** 非 Instead 时该规则不应被 collectAndSortInstead 收集 */
  phase: HookPhase;
  /** false 时该规则应被跳过 */
  when: boolean;
}

interface ItemSpec {
  def: string;
  destroyed: boolean;
  rules: RuleSpec[];
}

interface Scenario {
  globals: RuleSpec[];
  /** 外层 = 容器（按 CONTAINER_ORDER 顺序），内层 = 该容器的物品 */
  containers: ItemSpec[][];
}

/** 构造规则的便捷函数：默认落在 EVENT / Instead / when=true。 */
function rule(id: string, priority: number | undefined, overrides: Partial<RuleSpec> = {}): RuleSpec {
  return { id, priority, on: EVENT, phase: HookPhase.Instead, when: true, ...overrides };
}

/** 构造物品的便捷函数。 */
function item(def: string, rules: RuleSpec[], destroyed = false): ItemSpec {
  return { def, destroyed, rules };
}

// ---------------------------------------------------------------------------
// 影子模型：与 src/hook-system.ts 零共享代码，按契约独立实现
// ---------------------------------------------------------------------------

interface ModelCandidate {
  /** 唯一身份标记，不参与任何排序键；用于在 id 相同时仍能区分个体 */
  tag: string;
  hookId: string;
  priority: number;
  containerIndex: number;
  slotIndex: number;
  defId: string;
  order: number;
}

/**
 * 独立实现 collectHooks(instead) + sortInsteadHooks。
 * 契约：
 *   过滤：on === 目标事件 && phase === 目标阶段 && when() 为真；
 *         destroyed 物品整体跳过。
 *   收集顺序：先全局 Hook（注册序），再按 containerOrder 逐容器、
 *             容器内按 slotIndex、物品内按 ruleIndex。
 *   全局 Hook 的 meta 为 containerIndex=0, slotIndex=0, defId=hook.id, order=注册序。
 *   物品 Hook 的 meta 为真实坐标, defId=item.def, order=ruleIndex。
 *   排序键：priority 降序 → containerIndex 升 → slotIndex 升 →
 *           defId 升 → hookId 升 → order 升；稳定排序。
 *   priority 未指定时视为 0。
 */
function modelSortedInstead(scenario: Scenario): string[] {
  const candidates: ModelCandidate[] = [];

  const collected = (spec: RuleSpec): boolean =>
    spec.on === EVENT && spec.phase === HookPhase.Instead && spec.when;

  scenario.globals.forEach((spec, registrationIndex) => {
    if (!collected(spec)) return;
    candidates.push({
      tag: `g${registrationIndex}`,
      hookId: spec.id,
      priority: spec.priority ?? 0,
      containerIndex: 0,
      slotIndex: 0,
      defId: spec.id,
      order: registrationIndex,
    });
  });

  scenario.containers.forEach((items, containerIndex) => {
    items.forEach((entry, slotIndex) => {
      if (entry.destroyed) return;
      entry.rules.forEach((spec, ruleIndex) => {
        if (!collected(spec)) return;
        candidates.push({
          tag: `c${containerIndex}s${slotIndex}r${ruleIndex}`,
          hookId: spec.id,
          priority: spec.priority ?? 0,
          containerIndex,
          slotIndex,
          defId: entry.def,
          order: ruleIndex,
        });
      });
    });
  });

  const keyed = candidates.map((candidate, collectIndex) => ({ candidate, collectIndex }));
  keyed.sort((left, right) => {
    const a = left.candidate;
    const b = right.candidate;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.containerIndex !== b.containerIndex) return a.containerIndex - b.containerIndex;
    if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
    if (a.defId !== b.defId) return a.defId < b.defId ? -1 : 1;
    if (a.hookId !== b.hookId) return a.hookId < b.hookId ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    // 全键并列：以收集顺序定序，等价于稳定排序
    return left.collectIndex - right.collectIndex;
  });

  return keyed.map((entry) => entry.candidate.tag);
}

// ---------------------------------------------------------------------------
// 场景 → 真实系统
// ---------------------------------------------------------------------------

interface Built {
  system: HookSystem;
  entity: ReturnType<typeof createEntity>;
  /** HookDef 对象 → 身份标记。id 可以重复，对象引用不会。 */
  tags: Map<HookDef, string>;
}

function buildSystem(scenario: Scenario): Built {
  const system = new HookSystem();
  const tags = new Map<HookDef, string>();

  scenario.globals.forEach((spec, registrationIndex) => {
    const hook: HookDef = {
      id: spec.id,
      on: spec.on,
      phase: spec.phase,
      // 显式保留 undefined，用于考验 `?? 0` 缺省契约
      priority: spec.priority,
      when: () => spec.when,
      effect: () => undefined,
    };
    tags.set(hook, `g${registrationIndex}`);
    system.registerHook(hook);
  });

  const entity = createEntity('e', CONTAINER_ORDER);
  scenario.containers.forEach((items, containerIndex) => {
    const container = entity.containers[CONTAINER_ORDER[containerIndex]];
    items.forEach((entry, slotIndex) => {
      const rules: HookDef[] = entry.rules.map((spec, ruleIndex) => {
        const hook: HookDef = {
          id: spec.id,
          on: spec.on,
          phase: spec.phase,
          priority: spec.priority,
          when: () => spec.when,
          effect: () => undefined,
        };
        tags.set(hook, `c${containerIndex}s${slotIndex}r${ruleIndex}`);
        return hook;
      });
      const built: Item = {
        id: `c${containerIndex}s${slotIndex}`,
        def: entry.def,
        destroyed: entry.destroyed,
        rules,
      };
      container.addItem(built);
    });
  });

  return { system, entity, tags };
}

/** 取真实系统的排序结果，映射为身份标记序列。 */
function actualTags(built: Built): string[] {
  return built.system
    .collectAndSortInstead(EVENT, { target: built.entity })
    .map((hook) => {
      const tag = built.tags.get(hook);
      assert.ok(tag !== undefined, '返回了未注册的 HookDef 对象');
      return tag;
    });
}

// ---------------------------------------------------------------------------
// 随机场景
// ---------------------------------------------------------------------------

const ruleArb: fc.Arbitrary<RuleSpec> = fc.record({
  id: fc.constantFrom(...IDS),
  // undefined 占一份权重：考验"未指定即 0"的缺省契约
  priority: fc.constantFrom<Array<number | undefined>>(...PRIORITIES, undefined),
  // 多数落在 EVENT 上，少量落在别的事件名以考验 on 过滤
  on: fc.constantFrom(EVENT, EVENT, EVENT, OTHER_EVENT),
  // 多数是 Instead，少量是别的阶段以考验 phase 过滤
  phase: fc.constantFrom<HookPhase>(
    HookPhase.Instead,
    HookPhase.Instead,
    HookPhase.Instead,
    HookPhase.Before,
    HookPhase.After,
  ),
  // 多数为 true，少量 false 以考验 when 过滤
  when: fc.constantFrom(true, true, true, false),
});

const itemArb: fc.Arbitrary<ItemSpec> = fc.record({
  def: fc.constantFrom(...DEFS),
  destroyed: fc.boolean(),
  rules: fc.array(ruleArb, { minLength: 0, maxLength: 3 }),
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  globals: fc.array(ruleArb, { minLength: 0, maxLength: 4 }),
  containers: fc.tuple(
    fc.array(itemArb, { minLength: 0, maxLength: 3 }),
    fc.array(itemArb, { minLength: 0, maxLength: 3 }),
    fc.array(itemArb, { minLength: 0, maxLength: 3 }),
  ),
});

describe('L4 影子模型：instead 竞争排序', () => {
  test(`排序结果与独立模型逐位一致（${RUNS.toLocaleString('en-US')}次）`, () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const built = buildSystem(scenario);
        const actual = actualTags(built);
        const expected = modelSortedInstead(scenario);
        assert.deepEqual(
          actual,
          expected,
          `顺序分歧\n场景=${JSON.stringify(scenario)}\n实际=${JSON.stringify(actual)}\n模型=${JSON.stringify(expected)}`,
        );
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  test('priority 非降序恒成立（20,000次）', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { system, entity } = buildSystem(scenario);
        const sorted = system.collectAndSortInstead(EVENT, { target: entity });
        for (let index = 1; index < sorted.length; index++) {
          const prev = sorted[index - 1].priority ?? 0;
          const curr = sorted[index].priority ?? 0;
          assert.ok(
            prev >= curr,
            `priority 非降序：位置 ${index - 1} 为 ${prev}，位置 ${index} 为 ${curr}`,
          );
        }
        return true;
      }),
      { numRuns: 20_000 },
    );
  });

  test('候选集合与模型一致：不多收也不漏收（20,000次）', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const built = buildSystem(scenario);
        const actual = actualTags(built).slice().sort();
        const expected = modelSortedInstead(scenario).slice().sort();
        assert.deepEqual(
          actual,
          expected,
          `候选集合分歧（多收或漏收）\n场景=${JSON.stringify(scenario)}\n实际=${JSON.stringify(actual)}\n模型=${JSON.stringify(expected)}`,
        );
        return true;
      }),
      { numRuns: 20_000 },
    );
  });

  test('三重过滤精确生效：on / phase / when 各自独立（20,000次）', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const built = buildSystem(scenario);
        const present = new Set(actualTags(built));

        const shouldAppear = (spec: RuleSpec): boolean =>
          spec.on === EVENT && spec.phase === HookPhase.Instead && spec.when;

        scenario.globals.forEach((spec, index) => {
          const tag = `g${index}`;
          assert.equal(
            present.has(tag),
            shouldAppear(spec),
            `全局规则 ${tag} 收集判定错误：on=${spec.on} phase=${spec.phase} when=${spec.when}`,
          );
        });

        scenario.containers.forEach((items, containerIndex) => {
          items.forEach((entry, slotIndex) => {
            entry.rules.forEach((spec, ruleIndex) => {
              const tag = `c${containerIndex}s${slotIndex}r${ruleIndex}`;
              assert.equal(
                present.has(tag),
                !entry.destroyed && shouldAppear(spec),
                `物品规则 ${tag} 收集判定错误：destroyed=${entry.destroyed} on=${spec.on} phase=${spec.phase} when=${spec.when}`,
              );
            });
          });
        });
        return true;
      }),
      { numRuns: 20_000 },
    );
  });

  test('排序不改变系统状态：不变量恒成立（20,000次）', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { system, entity } = buildSystem(scenario);
        const before = JSON.stringify(system.snapshot());
        system.collectAndSortInstead(EVENT, { target: entity });
        assert.deepEqual(system.checkInvariants(), [], '排序后出现不变量违规');
        assert.equal(JSON.stringify(system.snapshot()), before, '排序污染了系统状态');
        return true;
      }),
      { numRuns: 20_000 },
    );
  });
});

describe('L4 排序 tiebreak 逐级判定表', () => {
  const empty: ItemSpec[][] = [[], [], []];
  const at = (containerIndex: number, items: ItemSpec[]): ItemSpec[][] => {
    const containers: ItemSpec[][] = [[], [], []];
    containers[containerIndex] = items;
    return containers;
  };

  /** 同时断言真实顺序与模型顺序，避免只钉死其中一侧。 */
  function expectOrder(scenario: Scenario, expected: string[]): void {
    const built = buildSystem(scenario);
    const actual = actualTags(built);
    assert.deepEqual(actual, expected, `真实顺序不符：${JSON.stringify(actual)}`);
    assert.deepEqual(modelSortedInstead(scenario), expected, '模型顺序不符');
  }

  test('第1级 priority 降序压倒后续所有键', () => {
    // g0 的 hookId 更小（'a' < 'b'），但 priority 更低，必须排后
    expectOrder(
      { globals: [rule('a', -1), rule('b', 1)], containers: empty },
      ['g1', 'g0'],
    );
  });

  test('第1级 priority 缺省视为 0：介于 -1 与 1 之间', () => {
    // 只有把 undefined 归一化为 0，顺序才是 1 → undefined → -1
    expectOrder(
      { globals: [rule('a', -1), rule('a', undefined), rule('a', 1)], containers: empty },
      ['g2', 'g1', 'g0'],
    );
  });

  test('第1级 priority 缺省不等于 1：与显式 1 并列时由 order 决定', () => {
    // 若缺省被误当成 1，则 g0 与 g1 并列、顺序为 g0,g1；
    // 正确实现下 g1(priority=1) 必须压过 g0(缺省=0)。
    expectOrder(
      { globals: [rule('a', undefined), rule('a', 1)], containers: empty },
      ['g1', 'g0'],
    );
  });

  test('第2级 containerIndex 升序：hand 早于 belt', () => {
    const scenario: Scenario = {
      globals: [],
      containers: [
        [item('b', [rule('b', 0)])],
        [],
        [item('a', [rule('a', 0)])],
      ],
    };
    // belt 里的 defId/hookId 都更小，但 containerIndex 更大，必须排后
    expectOrder(scenario, ['c0s0r0', 'c2s0r0']);
  });

  test('第3级 slotIndex 升序：同容器内先入槽者优先', () => {
    expectOrder(
      {
        globals: [],
        containers: at(0, [item('b', [rule('b', 0)]), item('a', [rule('a', 0)])]),
      },
      ['c0s0r0', 'c0s1r0'],
    );
  });

  test('第4级 defId 升序：全局 Hook 与 hand 首槽物品在前三级并列时由 defId 分开', () => {
    // 全局 Hook 的 meta 是 (0,0)，与 hand 容器 slot 0 完全相同，
    // 这使 defId 与 hookId 可以彼此独立取值——唯一能纯粹考验第 4 级的构造。
    // 全局：defId='b'（等于其 id），hookId='b'
    // 物品：defId='a'，hookId='c'
    // 按 defId 升序 → 物品先（'a' < 'b'）
    // 若跳过 defId 直接比 hookId → 全局先（'b' < 'c'），顺序相反。
    expectOrder(
      {
        globals: [rule('b', 0)],
        containers: at(0, [item('a', [rule('c', 0)])]),
      },
      ['c0s0r0', 'g0'],
    );
  });

  test('第4级 defId 方向为升序而非降序', () => {
    // 全局：defId='a'，hookId='a'；物品：defId='b'，hookId='a'
    // 升序 → 全局先；降序 → 物品先
    expectOrder(
      {
        globals: [rule('a', 0)],
        containers: at(0, [item('b', [rule('a', 0)])]),
      },
      ['g0', 'c0s0r0'],
    );
  });

  test('第5级 hookId 升序：defId 相同时由 hookId 决定', () => {
    // 同一物品的两条规则：前四级全同，order 递增。
    // 令 hookId 与 order 方向相反，只有 hookId 生效才得到 r1 在前。
    expectOrder(
      {
        globals: [],
        containers: at(0, [item('a', [rule('b', 0), rule('a', 0)])]),
      },
      ['c0s0r1', 'c0s0r0'],
    );
  });

  test('第6级 order 升序：六键全并列时保持规则顺序', () => {
    // 同物品、同 id、同 priority：只有 order 能区分。
    // 用 tag 比对才能看出翻转——用 id 比对两种顺序都是 ['a','a']。
    expectOrder(
      {
        globals: [],
        containers: at(0, [item('a', [rule('a', 0), rule('a', 0)])]),
      },
      ['c0s0r0', 'c0s0r1'],
    );
  });

  test('第6级 order 对全局 Hook 生效：同 id 同 priority 时保持注册序', () => {
    expectOrder(
      { globals: [rule('a', 0), rule('a', 0), rule('a', 0)], containers: empty },
      ['g0', 'g1', 'g2'],
    );
  });

  test('第6级 order 用的是 ruleIndex 而非 slotIndex', () => {
    // 两个物品各两条规则，全部 id/def/priority 相同。
    // 正确实现：order=ruleIndex，(slot,rule) 顺序为 (0,0)(0,1)(1,0)(1,1)。
    // 若 order 误用 slotIndex，则 slot0 的两条 order 都是 0、
    // slot1 的两条都是 1，第 6 级失去区分力，退化为收集序——
    // 恰好仍是同一序列，故此用例配合下一个反向用例才有判别力。
    expectOrder(
      {
        globals: [],
        containers: at(0, [
          item('a', [rule('a', 0), rule('a', 0)]),
          item('a', [rule('a', 0), rule('a', 0)]),
        ]),
      },
      ['c0s0r0', 'c0s0r1', 'c0s1r0', 'c0s1r1'],
    );
  });

  test('order 误用 slotIndex 会被跨槽位并列暴露', () => {
    // 构造：hand 有两个物品，第二个物品的两条规则 id 更小。
    // 正确实现下，slotIndex（第 3 级）先于 hookId（第 5 级）判定，
    // 故 slot0 的两条无论 id 大小都排在前。
    expectOrder(
      {
        globals: [],
        containers: at(0, [
          item('a', [rule('b', 0), rule('b', 0)]),
          item('a', [rule('a', 0), rule('a', 0)]),
        ]),
      },
      ['c0s0r0', 'c0s0r1', 'c0s1r0', 'c0s1r1'],
    );
  });

  test('三重过滤：on / phase / when 任一不符即不收集', () => {
    const scenario: Scenario = {
      globals: [
        rule('a', 0, { on: OTHER_EVENT }),
        rule('a', 0, { phase: HookPhase.Before }),
        rule('a', 0, { when: false }),
        rule('a', 0),
      ],
      containers: at(0, [
        item('a', [
          rule('a', 0, { on: OTHER_EVENT }),
          rule('a', 0, { phase: HookPhase.After }),
          rule('a', 0, { when: false }),
          rule('a', 0),
        ]),
      ]),
    };
    // 只有各自的第 4 条应当出现；物品在 (0,0)、defId='a' 与全局 defId='a' 并列，
    // hookId 也相同，故由 order 决定：全局 order=3，物品 order=3 → 收集序（全局先）
    expectOrder(scenario, ['g3', 'c0s0r3']);
  });

  test('destroyed 物品的规则一条都不出现', () => {
    expectOrder(
      {
        globals: [],
        containers: at(0, [
          item('a', [rule('a', 0), rule('a', 0)], true),
          item('a', [rule('a', 0)]),
        ]),
      },
      ['c0s1r0'],
    );
  });

  test('第6级 order 不能退化为收集序：全局与物品的 order 可跨越收集序重排', () => {
    // 关键构造：全局 Hook 的 order 是"全局注册序"，物品 Hook 的 order 是"物品内 ruleIndex"，
    // 两者取自不同计数空间，因此可以冲突。
    //
    // 三个候选在前五级完全并列（priority=0、(0,0)、defId='a'、hookId='a'）：
    //   g0    order=0（第 1 个注册）
    //   g1    order=1（第 2 个注册）
    //   物品   order=0（该物品的第 1 条规则）
    // 收集序为 g0, g1, 物品。
    // 按 order 升序 + 稳定排序 → g0(0), 物品(0), g1(1)
    // 若把 order 兜底改为恒返回 0（放弃全序），结果退化为收集序 g0, g1, 物品。
    // 两者不同，故该用例能区分"真的比较 order"与"依赖稳定排序"。
    expectOrder(
      {
        globals: [rule('a', 0), rule('a', 0)],
        containers: at(0, [item('a', [rule('a', 0)])]),
      },
      ['g0', 'c0s0r0', 'g1'],
    );
  });

  test('物品 Hook 的 defId 取 item.def 而非 item.id', () => {
    // item.id 由 buildSystem 生成为 `c{container}s{slot}`，
    // 与 def 无关。令 def 的顺序与 id 的顺序相反即可区分。
    // hand slot0: def='b'，id='c0s0'；backpack slot0: def='a'，id='c1s0'
    // 但 containerIndex 优先于 defId，故需放在同一容器同一槽位——不可能。
    // 因此改用全局 Hook 与物品并列的构造：
    // 全局 defId='b'；物品 def='a'、item.id='c0s0'
    // 取 def → 'a' < 'b' → 物品先
    // 误取 item.id → 'b' < 'c0s0' → 全局先
    expectOrder(
      {
        globals: [rule('b', 0)],
        containers: at(0, [item('a', [rule('b', 0)])]),
      },
      ['c0s0r0', 'g0'],
    );
  });
});
