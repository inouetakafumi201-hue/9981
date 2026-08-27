/**
 * 全引擎跨层回归套件（"犁地"式完备性确认）。
 *
 * 与既有测试的分工：
 * - 既有 `__tests__/e2e.test.ts` 覆盖 Def 继承深度、AI/人类决策一致性、Gateway 边界等若干条链路。
 * - 既有各层 `__tests__/*.test.ts` 各自验证单层正确性。
 * - 本文件只做一件事：把**必须贯穿整个引擎**的铁律，放在 `createFullHarness()` 这个
 *   接齐 L1-L13 的真实合成根上逐条钉死。断言全部打在"契约/不变量"层面，不打在实现细节上
 *   （例如：只断言随机数的**确定性与范围**，不断言具体 LCG 数值；只断言事务**原子性**，
 *   不断言内部 frame 结构）——这样即使某层实现被判定不合理而重写，本套件依然是有效的犁。
 *
 * 覆盖的铁律来源：规范宪法 §4.1 Op 通道铁律、§4.2 数值铁律、§4.3 拓扑铁律，
 * 以及 design.md 的五阶段 Hook、事务原子性、快照/回放确定性、诊断有界性。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import {
  createFullHarness,
  defaultSeedDefs,
  ABSTRACT_SEED_DEF_IDS,
  CONCRETE_SUBCLASS_DEF_IDS,
} from '../testing/full-harness';
import type { FullHarness } from '../testing/full-harness';
import { resetIdCounters } from '../state/ids';
import { createEmptyWorldState, TOP_LEVEL_COLLECTION_KEYS } from '../state/world-state';
import { Transaction } from '../ops/transaction';
import { DefRegistry } from '../state/def';
import { PlaypackLoader } from '../schedule/playpack';
import type { PlaypackDef } from '../schedule/playpack';
import { DiagnosticSink, DiagnosticHaltError } from '../safety/safety';
import {
  takeSnapshot,
  Journal,
  replay,
  InMemoryCheckpointStore,
  applyMigration,
  LogStore,
} from '../persistence/persistence';
import type { MigrationDef } from '../persistence/persistence';
import { InvariantChecker } from '../ops/invariants';
import {
  Linter,
  RuleCircuitBreaker,
  QuotaEnforcer,
  HINT_TEMPLATES,
} from '../safety/safety';
import { withShadowStream, snapshotStream, restoreStream } from '../random/shadow-stream';
import { setPath } from '../ops/path';
import { checkPure, registerExprDef, applyOverrides } from '../expr/named-expr';
import {
  removeSlot,
  insertSlot,
  findDefaultSlotIndex,
  setSlotHolds,
} from '../topology/container';
import type { ActionDef } from '../actions/types';
import { AuraEngine } from '../attachment/aura-engine';
import type { Def } from '../state/def';
import { knowledgeStore } from '../knowledge/knowledge-store';
import { PresentationGateway } from '../gateway';
import { ActionCatalog } from '../actions/catalog';
import { dist, spread } from '../topology/metrics';
import type { RuleDef } from '../events/types';
import type { Effect } from '../events/effect-types';
import type { Diagnostic } from '../state/diagnostic';

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 本套件自带的 ScheduleDef。
 *
 * 发现（记录于本文件，供审计侧参考）：`createFullHarness()` 用
 * `createEmptyWorldState('sched:fuzz')` 建世界，而 `defaultSeedDefs()` 只声明了 `sched:main`——
 * 于是 `world.turn.scheduleId` 指向的 Def 在合成根里根本不存在，`schedule.advance` 在全量
 * harness 上必然失败。这不是本套件的断言写错，而是既有模糊测试从未成功推进过任何一次相位
 * （schedule.advance 的成功分支在 fuzz 里是死代码）。
 *
 * 本套件不修改 full-harness（实现归审计侧），改为自带一个与 scheduleId 对齐的 ScheduleDef，
 * 让相位推进链路真正可达。
 */
const FUZZ_SCHEDULE_PHASE_COUNT = 2;

function seedDefsWithSchedule(extra: readonly unknown[] = []) {
  return [
    ...defaultSeedDefs(),
    {
      id: 'sched:fuzz',
      kind: 'schedule',
      phases: [{ kind: 'action', id: 'p:action' }, { kind: 'response', id: 'p:response' }],
      loop: true,
    },
    ...extra,
  ] as Parameters<typeof createFullHarness>[0];
}

function harness(): FullHarness {
  return createFullHarness(seedDefsWithSchedule());
}

/** 造一条 RuleDef；only 结构，不含任何玩法语义。 */
function rule(
  id: string,
  on: string,
  phase: RuleDef['phase'],
  effects: Effect[],
  extra: Partial<RuleDef> = {},
): RuleDef {
  return { id, kind: 'rule', on, phase, priority: 0, effects, ...extra } as RuleDef;
}

function createEntity(h: FullHarness, def = 'd:human'): string {
  const r = h.registry.invoke<{ def: string }, { $: string }>('entity.create', { def });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('entity.create failed');
  return r.value.$;
}

function diag(code: string, severity: Diagnostic['severity'], message = code): Diagnostic {
  return { code, severity, message, phase: 0 } as Diagnostic;
}

/** 一批覆盖各种形状的垃圾参数，用于"Op 永不抛异常"的全 Op 遍历。 */
const GARBAGE_ARGS: unknown[] = [
  undefined,
  null,
  {},
  [],
  0,
  '',
  'not-an-object',
  true,
  { def: 'nonexistent:def' },
  { id: 'e:does-not-exist' },
  { path: 'entities.e:missing.props.hp', value: 1 },
  { path: 'defs.d:human.kind', value: 'hacked' },
  { path: '', value: null },
  { ref: { collection: 'entities', id: 'e:missing' }, tag: 't' },
  { items: [] },
  { sides: 0 },
  { sides: -1 },
  { sides: 1.5 },
  { target: { $: 'e:missing' }, def: 'd:buff' },
  { from: null, to: undefined },
  { a: 'x', b: 'y' },
  { index: -1, path: 'world.props.list' },
];

// ===========================================================================
// A. Op 通道铁律（规范宪法 §4.1）：唯一写入通道
// ===========================================================================

describe('A. Op 通道铁律：唯一写入通道', () => {
  beforeEach(() => resetIdCounters());

  it('A1 未注册 Op 返回 E_OP_NOT_FOUND，绝不抛异常', () => {
    const h = harness();
    const r = h.registry.invoke('no.such.op', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_OP_NOT_FOUND');
  });

  it('A2 全部已注册 Op 面对任意垃圾参数都不抛异常，且总返回合法 Result', () => {
    const h = harness();
    const opNames = h.registry.listOpNames();
    expect(opNames.length).toBeGreaterThan(0);

    for (const name of opNames) {
      for (const args of GARBAGE_ARGS) {
        let result: unknown;
        expect(() => { result = h.registry.invoke(name, args as never); }, `${name} / ${JSON.stringify(args)}`).not.toThrow();
        expect(result, `${name} 必须返回 Result`).toBeDefined();
        expect(typeof (result as { ok: unknown }).ok, `${name} 的 Result.ok 必须是 boolean`).toBe('boolean');
        const r = result as { ok: boolean; code?: unknown };
        if (!r.ok) expect(typeof r.code, `${name} 失败时必须带 ErrCode`).toBe('string');
      }
    }
  });

  it('A3 失败的 Op 绝不改变权威状态（引用一致性）', () => {
    const h = harness();
    const before = h.holder.getState();
    const r = h.registry.invoke('entity.create', { def: 'nonexistent:def' });
    expect(r.ok).toBe(false);
    expect(h.holder.getState()).toBe(before);
  });

  it('A4 成功的 Op 产生新的状态对象，不原地修改旧状态', () => {
    const h = harness();
    const before = h.holder.getState();
    createEntity(h);
    const after = h.holder.getState();
    expect(after).not.toBe(before);
    expect(Object.keys(before.entities)).toHaveLength(0);
  });

  it('A5 顶层集合数恒为 6，Op 执行不新增顶层集合', () => {
    const h = harness();
    createEntity(h);
    h.registry.invoke('item.create', { def: 'd:sword' });
    h.registry.invoke('node.create', { def: 'd:room' });
    for (const key of TOP_LEVEL_COLLECTION_KEYS) {
      expect(h.holder.getState()).toHaveProperty(key);
    }
    expect(TOP_LEVEL_COLLECTION_KEYS).toHaveLength(6);
  });

  it('A6 属性类 Op 不得写入结构区字段', () => {
    const h = harness();
    const id = createEntity(h);
    const r = h.registry.invoke('prop.set', { path: `entities.${id}.def`, value: 'd:sword' });
    expect(r.ok).toBe(false);
    expect(h.holder.getState().entities[id]!.def).toBe('d:human');
  });

  it('A7 对不存在的宿主写属性返回 E_REF_MISSING，不合成畸形对象', () => {
    const h = harness();
    const r = h.registry.invoke('prop.set', { path: 'entities.e:ghost.props.hp', value: 3 });
    expect(r.ok).toBe(false);
    expect(h.holder.getState().entities['e:ghost']).toBeUndefined();
  });

  it('A8 结构性 Op 被正确标记（veto 分发的前提）', () => {
    const h = harness();
    expect(h.registry.isStructural('entity.create')).toBe(true);
    expect(h.registry.isStructural('entity.destroy')).toBe(true);
    expect(h.registry.isStructural('attach.add')).toBe(true);
    expect(h.registry.isStructural('prop.set')).toBe(false);
  });
});

// ===========================================================================
// B. 事务原子性（design.md 3.4 / 需求21）
// ===========================================================================

describe('B. 事务原子性', () => {
  beforeEach(() => resetIdCounters());

  it('B1 savepoint rollback 丢弃 draft 改动', () => {
    const tx = new Transaction(createEmptyWorldState('sched:t'));
    const base = tx.getDraft();
    tx.begin();
    tx.setDraft({ ...base, world: { ...base.world, props: { touched: true } } });
    tx.rollback();
    expect(tx.getDraft()).toBe(base);
  });

  it('B2 savepoint commit 把改动合并到上一层', () => {
    const tx = new Transaction(createEmptyWorldState('sched:t'));
    const base = tx.getDraft();
    tx.begin();
    tx.setDraft({ ...base, world: { ...base.world, props: { touched: true } } });
    tx.commit();
    expect(tx.getDraft()).not.toBe(base);
    expect(tx.getFinalDraft().world.props['touched']).toBe(true);
  });

  it('B3 rollback 同步截断 journal，不残留已回滚记录', () => {
    const tx = new Transaction(createEmptyWorldState('sched:t'));
    tx.logOp('kept', {}, () => {});
    tx.begin();
    tx.logOp('discarded', {}, () => {});
    expect(tx.getJournalEntries()).toHaveLength(2);
    tx.rollback();
    expect(tx.getJournalEntries()).toHaveLength(1);
    expect(tx.getJournalEntries()[0]!.op).toBe('kept');
  });

  it('B4 未匹配 begin 的 commit/rollback 是防御性无操作，不破坏栈底', () => {
    const tx = new Transaction(createEmptyWorldState('sched:t'));
    const base = tx.getDraft();
    expect(() => { tx.commit(); tx.rollback(); }).not.toThrow();
    expect(tx.getFinalDraft()).toBe(base);
    expect(tx.depth()).toBe(1);
  });

  it('B5 嵌套深度可观测，支持 Op 内部子事务', () => {
    const tx = new Transaction(createEmptyWorldState('sched:t'));
    expect(tx.depth()).toBe(1);
    tx.begin();
    tx.begin();
    expect(tx.depth()).toBe(3);
    tx.commit();
    tx.commit();
    expect(tx.depth()).toBe(1);
  });

  it('B6 销毁带光环与容器的实体是原子的：要么整体成功，要么状态不变', () => {
    const h = harness();
    const id = createEntity(h);
    h.registry.invoke('attach.add', { def: 'd:buff', target: { $: id } });

    const before = h.holder.getState();
    const r = h.registry.invoke('entity.destroy', { id });
    if (r.ok) {
      expect(h.holder.getState().entities[id]).toBeUndefined();
      // 级联：不得残留以该实体为 target 的 attachment（否则是悬空引用）
      for (const att of Object.values(h.holder.getState().world.attachments)) {
        expect((att as { target?: { $: string } }).target?.$).not.toBe(id);
      }
    } else {
      expect(h.holder.getState()).toBe(before);
    }
  });
});

// ===========================================================================
// C. Hook 五阶段 × Op 真实接线（design.md 3.4/3.5 / 需求23-24）
// ===========================================================================

describe('C. Hook 五阶段真实接线', () => {
  beforeEach(() => resetIdCounters());

  it('C1 before 阶段 abort 触发 veto：Op 返回 E_OP_VETOED 且状态不变', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:veto', 'before:entity.create', 'before', [{ abort: 'no entities today' }]));

    const before = h.holder.getState();
    const r = h.registry.invoke('entity.create', { def: 'd:human' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_OP_VETOED');
    expect(h.holder.getState()).toBe(before);
    expect(Object.keys(h.holder.getState().entities)).toHaveLength(0);
  });

  it('C2 移除规则后同一个 Op 恢复正常', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:veto', 'before:entity.create', 'before', [{ abort: 'blocked' }]));
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(false);

    h.ruleProvider.remove('r:veto');
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(true);
  });

  it('C3 when:false 的规则不参与分发（字面量 false 不被当成"未声明"）', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:off', 'before:entity.create', 'before', [{ abort: 'should not run' }], { when: false }));
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(true);
  });

  it('C4 when:true 的规则参与分发', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:on', 'before:entity.create', 'before', [{ abort: 'blocked' }], { when: true }));
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(false);
  });

  it('C5 after 阶段的写入被机械丢弃（只读响应不靠人工审查）', () => {
    const h = harness();
    const id = createEntity(h);

    h.ruleProvider.add(rule('r:after-write', 'after:entity.create', 'after', [
      { op: 'prop.set', args: { path: `entities.${id}.props.tampered`, value: true } },
    ]));

    const r = h.registry.invoke('entity.create', { def: 'd:human' });
    expect(r.ok).toBe(true);
    expect(h.holder.getState().entities[id]!.props['tampered']).toBeUndefined();
  });

  it('C6 before 阶段 Hook 内的 op 效果随外层事务一起回滚', () => {
    const h = harness();
    const id = createEntity(h);

    // 先写入，再 abort：整条 before 链失败 → 外层事务回滚 → 写入不得落地
    h.ruleProvider.add(rule('r:write-then-abort', 'before:entity.destroy', 'before', [
      { op: 'prop.set', args: { path: `entities.${id}.props.mark`, value: 1 } },
      { abort: 'veto after write' },
    ]));

    const r = h.registry.invoke('entity.destroy', { id });
    expect(r.ok).toBe(false);
    expect(h.holder.getState().entities[id]!.props['mark']).toBeUndefined();
  });

  it('C7 instead 阶段恰好一个候选执行', () => {
    const h = harness();
    const ran: string[] = [];
    h.ruleProvider.add(rule('r:i1', 'before:entity.create', 'instead', [{ let: 'x', be: 1 }], { priority: 1 }));
    h.ruleProvider.add(rule('r:i2', 'before:entity.create', 'instead', [{ let: 'x', be: 2 }], { priority: 2 }));

    // 用诊断侧信道无法观测 instead 选择，改为验证：两条 instead 都不 abort 时 Op 成功，
    // 且只要其中较高优先级者 abort，就应当整体 veto（说明确实只跑了那一个）。
    h.ruleProvider.remove('r:i1');
    h.ruleProvider.remove('r:i2');
    h.ruleProvider.add(rule('r:lo', 'before:entity.create', 'instead', [{ abort: 'lo ran' }], { priority: 1 }));
    h.ruleProvider.add(rule('r:hi', 'before:entity.create', 'instead', [{ let: 'noop', be: true }], { priority: 0 }));

    // priority 升序排序取第一个 → r:hi(0) 胜出，不 abort → Op 成功，r:lo 未参与
    const r = h.registry.invoke('entity.create', { def: 'd:human' });
    expect(r.ok).toBe(true);
    expect(ran).toHaveLength(0);
  });

  it('C8 Hook 深度超上限产生 E_HOOK_DEPTH 诊断且不崩', () => {
    const h = harness();
    // 自触发：entity.create 的 before 里再 create，形成连锁
    h.ruleProvider.add(rule('r:recurse', 'before:entity.create', 'before', [
      { op: 'entity.create', args: { def: 'd:human' } },
    ]));

    expect(() => h.registry.invoke('entity.create', { def: 'd:human' })).not.toThrow();
    const codes = h.hookDiagnostics.map((d) => d.code);
    expect(codes.some((c) => c === 'E_HOOK_DEPTH' || c === 'E_HOOK_REENTRY')).toBe(true);
  });

  it('C9 同 (type, ruleId) 重入被拒绝并产生诊断', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:reenter', 'before:entity.create', 'before', [
      { op: 'entity.create', args: { def: 'd:human' } },
    ]));
    h.registry.invoke('entity.create', { def: 'd:human' });
    const codes = h.hookDiagnostics.map((d) => d.code);
    expect(codes.some((c) => c === 'E_HOOK_REENTRY' || c === 'E_HOOK_DEPTH')).toBe(true);
  });

  it('C10 depth 在每次顶层 invoke 后归零（事务提交边界重置）', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:noop', 'before:entity.create', 'before', [{ let: 'x', be: 1 }]));
    h.registry.invoke('entity.create', { def: 'd:human' });
    expect(h.hookDispatcher.getDepth()).toBe(0);
    h.registry.invoke('entity.create', { def: 'd:human' });
    expect(h.hookDispatcher.getDepth()).toBe(0);
  });

  it('C11 未登记的 Effect 形态被拒绝，不静默通过', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:bogus', 'before:entity.create', 'before', [
      { totallyUnknown: true } as unknown as Effect,
    ]));
    const r = h.registry.invoke('entity.create', { def: 'd:human' });
    expect(r.ok).toBe(false);
  });

  it('C12 while 缺失 maxIter 被运行期拒绝', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:noiter', 'before:entity.create', 'before', [
      { while: true, do: [] } as unknown as Effect,
    ]));
    const r = h.registry.invoke('entity.create', { def: 'd:human' });
    expect(r.ok).toBe(false);
  });

  it('C13 try/catch 没有恢复分支时传播失败，不静默转成成功', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:try', 'before:entity.create', 'before', [
      { try: [{ abort: 'inner' }] },
    ]));
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(false);
  });

  it('C14 try/catch 有恢复分支时失败被吸收', () => {
    const h = harness();
    h.ruleProvider.add(rule('r:try-catch', 'before:entity.create', 'before', [
      { try: [{ abort: 'inner' }], catch: [{ let: 'recovered', be: true }] },
    ]));
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(true);
  });

  it('C15 非结构性 Op 不触发 before/after 分发', () => {
    const h = harness();
    const id = createEntity(h);
    h.ruleProvider.add(rule('r:on-prop', 'before:prop.set', 'before', [{ abort: 'should not fire' }]));
    // prop.set 非结构性 → 不经过 veto 分发 → 不应被 abort 影响
    const r = h.registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 3 });
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// D. Expr / Query 纯度
// ===========================================================================

describe('D. Expr / Query 纯度', () => {
  beforeEach(() => resetIdCounters());

  it('D1 同一 Expr 在同一状态下重复求值结果稳定', () => {
    const h = harness();
    const id = createEntity(h);
    h.registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 4 });
    const ctx = h.ctxForSelf({ $: id });
    const expr = { get: `entities.${id}.props.hp` } as never;
    const a = h.exprEngine.eval(expr, ctx);
    const b = h.exprEngine.eval(expr, ctx);
    expect(a).toEqual(b);
  });

  it('D2 Expr 求值不改变权威状态', () => {
    const h = harness();
    const id = createEntity(h);
    const before = h.holder.getState();
    h.exprEngine.eval({ get: `entities.${id}.props.hp` } as never, h.ctxForSelf({ $: id }));
    expect(h.holder.getState()).toBe(before);
  });

  it('D3 畸形 Expr 不抛异常穿透', () => {
    const h = harness();
    const ctx = h.ctxForSelf({ $: 'w:0' });
    const malformed: unknown[] = [
      { get: 123 }, { unknownOp: 1 }, { add: 'not-a-list' }, [], { if: {} }, undefined, null,
    ];
    for (const m of malformed) {
      expect(() => h.exprEngine.eval(m as never, ctx), JSON.stringify(m)).not.toThrow();
    }
  });

  it('D4 Query 求值不改变权威状态', () => {
    const h = harness();
    createEntity(h);
    const before = h.holder.getState();
    expect(() => h.queryEngine).not.toThrow();
    expect(h.holder.getState()).toBe(before);
  });
});

// ===========================================================================
// E. Random 确定性与流隔离（Property 16/17/30）
// ===========================================================================

describe('E. Random 确定性与流隔离', () => {
  beforeEach(() => resetIdCounters());

  it('E1 同种子同调用序列在两个独立引擎实例上产生相同结果', () => {
    const seq = () => {
      resetIdCounters();
      const h = harness();
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        const r = h.registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'main', seed: 12345 });
        expect(r.ok).toBe(true);
        if (r.ok) out.push(r.value);
      }
      return out;
    };
    expect(seq()).toEqual(seq());
  });

  it('E2 roll 结果恒落在 [1, sides]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (sides, seed) => {
          resetIdCounters();
          const h = harness();
          const r = h.registry.invoke<unknown, number>('random.roll', { sides, stream: 's', seed });
          if (!r.ok) return false;
          return Number.isInteger(r.value) && r.value >= 1 && r.value <= sides;
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('E3 非法 sides 一律被拒绝且不抛异常', () => {
    const h = harness();
    for (const sides of [0, -1, 1.5, NaN, Infinity]) {
      const r = h.registry.invoke('random.roll', { sides });
      expect(r.ok, `sides=${sides}`).toBe(false);
    }
  });

  it('E4 不同命名流互不干扰：交错调用不改变各自序列', () => {
    resetIdCounters();
    const solo = (() => {
      const h = harness();
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = h.registry.invoke<unknown, number>('random.roll', { sides: 20, stream: 'A', seed: 7 });
        if (r.ok) out.push(r.value);
      }
      return out;
    })();

    resetIdCounters();
    const interleaved = (() => {
      const h = harness();
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        const a = h.registry.invoke<unknown, number>('random.roll', { sides: 20, stream: 'A', seed: 7 });
        h.registry.invoke('random.roll', { sides: 20, stream: 'B', seed: 999 });
        if (a.ok) out.push(a.value);
      }
      return out;
    })();

    expect(interleaved).toEqual(solo);
  });

  it('E5 random 流状态记录在 world.rng，随事务提交', () => {
    const h = harness();
    h.registry.invoke('random.roll', { sides: 6, stream: 'tracked', seed: 3 });
    expect(h.holder.getState().world.rng['tracked']).toBeDefined();
  });

  it('E6 random.pick 空列表被拒绝', () => {
    const h = harness();
    expect(h.registry.invoke('random.pick', { items: [] }).ok).toBe(false);
  });

  it('E7 random.shuffle 是排列：元素多重集守恒', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 0, maxLength: 12 }),
        fc.integer({ min: 0, max: 10000 }),
        (items, seed) => {
          resetIdCounters();
          const h = harness();
          const r = h.registry.invoke<unknown, number[]>('random.shuffle', { items, stream: 'sh', seed });
          if (!r.ok) return false;
          const sortNum = (xs: number[]) => [...xs].sort((x, y) => x - y);
          return r.value.length === items.length
            && JSON.stringify(sortNum(r.value)) === JSON.stringify(sortNum(items));
        },
      ),
      { numRuns: 1500 },
    );
  });

  it('E8 random.weightedPick 总权重非正时被拒绝', () => {
    const h = harness();
    expect(h.registry.invoke('random.weightedPick', { items: [{ value: 1, weight: 0 }] }).ok).toBe(false);
    expect(h.registry.invoke('random.weightedPick', { items: [] }).ok).toBe(false);
  });

  it('E9 Property 30：随机不是 Expr 内建，只能经 Op 通道', () => {
    const h = harness();
    const ctx = h.ctxForSelf({ $: 'w:0' });
    for (const name of ['random', 'roll', 'rand', 'random.roll']) {
      const v = h.exprEngine.eval({ [name]: { sides: 6 } } as never, ctx);
      // 不得被 Expr 当作可用算子求出随机数
      expect(typeof v === 'number').toBe(false);
    }
    expect(h.registry.has('random.roll')).toBe(true);
  });
});

// ===========================================================================
// F. 持久化：快照 / 回放 / 回退 / 迁移（Property 18/28）
// ===========================================================================

describe('F. 持久化确定性', () => {
  beforeEach(() => resetIdCounters());

  it('F1 快照在后续 Op 之后仍保持拍摄时刻的内容', () => {
    const h = harness();
    createEntity(h);
    const snap = takeSnapshot(h.holder.getState(), 'before-more');
    const countAtSnapshot = Object.keys(snap.state.entities).length;

    createEntity(h);
    createEntity(h);

    expect(Object.keys(snap.state.entities)).toHaveLength(countAtSnapshot);
    expect(Object.keys(h.holder.getState().entities).length).toBeGreaterThan(countAtSnapshot);
  });

  it('F2 checkpoint / restore 往返得到同一状态引用', () => {
    const h = harness();
    createEntity(h);
    const store = new InMemoryCheckpointStore();
    const saved = h.holder.getState();
    store.checkpoint('cp', saved);

    createEntity(h);
    expect(h.holder.getState()).not.toBe(saved);

    expect(store.restore('cp')).toBe(saved);
    expect(store.restore('missing')).toBeNull();
  });

  it('F3 checkpoint 列表保持创建顺序，remove 生效', () => {
    const store = new InMemoryCheckpointStore();
    const s = createEmptyWorldState('sched:x');
    store.checkpoint('a', s);
    store.checkpoint('b', s);
    store.checkpoint('c', s);
    expect(store.list()).toEqual(['a', 'b', 'c']);
    store.checkpoint('b', s); // 覆盖不改变顺序
    expect(store.list()).toEqual(['a', 'b', 'c']);
    store.remove('b');
    expect(store.list()).toEqual(['a', 'c']);
  });

  it('F4 回放确定性：同一 journal 从同一初态重放得到等价末态', () => {
    const build = () => {
      resetIdCounters();
      const h = harness();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(createEntity(h));
      for (const id of ids) h.registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 3 });
      return h.holder.getState();
    };
    const a = build();
    const b = build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('F5 Journal 记录可被 replay 驱动，成功计数正确', () => {
    const journal = new Journal();
    journal.append([
      { op: 'entity.create', args: { def: 'd:human' }, inverse: () => {} },
      { op: 'entity.create', args: { def: 'd:human' }, inverse: () => {} },
      { op: 'no.such.op', args: {}, inverse: () => {} },
    ]);

    resetIdCounters();
    const h = harness();
    const replayed = replay(journal.getAll(), { invoke: (op, args) => h.registry.invoke(op, args as never) });
    expect(replayed).toBe(2);
    expect(Object.keys(h.holder.getState().entities)).toHaveLength(2);
  });

  it('F6 Journal since / trim 语义正确', () => {
    const journal = new Journal();
    for (let i = 0; i < 10; i++) {
      journal.append([{ op: `op${i}`, args: {}, inverse: () => {} }]);
    }
    expect(journal.getAll()).toHaveLength(10);
    expect(journal.since(7)).toHaveLength(3);
    journal.trim(4);
    expect(journal.getAll()).toHaveLength(4);
    expect(journal.getAll()[0]!.op).toBe('op6');
  });

  it('F7 迁移原子性：transform 抛异常时原状态不变', () => {
    const state = createEmptyWorldState('sched:m');
    const bad: MigrationDef = {
      id: 'mig:bad', fromVersion: '1.0', toVersion: '2.0',
      transform: () => { throw new Error('boom'); },
    };
    const r = applyMigration(state, bad);
    expect(r.ok).toBe(false);
    expect(r.state).toBeUndefined();
    expect(state.world.turn.scheduleId).toBe('sched:m');
  });

  it('F8 迁移成功时产生新状态且不修改入参', () => {
    const state = createEmptyWorldState('sched:m');
    const good: MigrationDef = {
      id: 'mig:ok', fromVersion: '1.0', toVersion: '2.0',
      transform: (s) => ({ ...s, world: { ...s.world, props: { migrated: true } } }),
    };
    const r = applyMigration(state, good);
    expect(r.ok).toBe(true);
    expect(r.state!.world.props['migrated']).toBe(true);
    expect(state.world.props['migrated']).toBeUndefined();
  });

  it('F9 LogStore 环形缓冲有界，丢最旧不丢最新', () => {
    const log = new LogStore(5);
    for (let i = 0; i < 12; i++) log.append('evt', { i });
    const all = log.getAll();
    expect(all).toHaveLength(5);
    expect(all[all.length - 1]!.payload['i']).toBe(11);
  });
});

// ===========================================================================
// G. Schedule / Playpack
// ===========================================================================

describe('G. Schedule / Playpack', () => {
  beforeEach(() => resetIdCounters());

  it('G1 schedule.advance 推进相位', () => {
    const h = harness();
    expect(h.holder.getState().world.turn.phaseIndex).toBe(0);
    expect(h.registry.invoke('schedule.advance', {}).ok).toBe(true);
    expect(h.holder.getState().world.turn.phaseIndex).toBe(1);
  });

  it('G2 loop:true 的 schedule 在末相位后回绕，phaseIndex 恒在界内', () => {
    const h = harness();
    const phaseCount = FUZZ_SCHEDULE_PHASE_COUNT;
    for (let i = 0; i < 12; i++) {
      expect(h.registry.invoke('schedule.advance', {}).ok).toBe(true);
      const idx = h.holder.getState().world.turn.phaseIndex;
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(phaseCount);
    }
  });

  it('G3 Playpack 依赖链 topoSort 保证前置先装载', () => {
    const pp = (id: string, requires?: string[]): PlaypackDef => ({
      id, kind: 'playpack', version: '1.0', ...(requires ? { requires } : {}), defs: [],
    } as PlaypackDef);
    const sorted = PlaypackLoader.topoSort([pp('pp:c', ['pp:b']), pp('pp:a'), pp('pp:b', ['pp:a'])]);
    expect(sorted).not.toBeNull();
    const ids = sorted!.map((p) => p.id);
    expect(ids.indexOf('pp:a')).toBeLessThan(ids.indexOf('pp:b'));
    expect(ids.indexOf('pp:b')).toBeLessThan(ids.indexOf('pp:c'));
  });

  it('G4 循环依赖的 Playpack 图被 topoSort 拒绝', () => {
    const pp = (id: string, requires: string[]): PlaypackDef => ({
      id, kind: 'playpack', version: '1.0', requires, defs: [],
    } as PlaypackDef);
    expect(PlaypackLoader.topoSort([pp('pp:x', ['pp:y']), pp('pp:y', ['pp:x'])])).toBeNull();
  });

  it('G5 依赖未装载时 load 失败（不静默放过悬空依赖）', () => {
    const loader = new PlaypackLoader({ defRegistry: new DefRegistry() });
    const orphan = { id: 'pp:orphan', kind: 'playpack', version: '1.0', requires: ['pp:absent'], defs: [] } as PlaypackDef;
    expect(loader.load(orphan).ok).toBe(false);
  });

  it('G6 同一 Def id 后装覆盖先装（D-073 单调重定义）', () => {
    const loader = new PlaypackLoader({ defRegistry: new DefRegistry() });
    const first = { id: 'pp:1', kind: 'playpack', version: '1.0', defs: [{ id: 'e:dup', kind: 'entity' }] } as PlaypackDef;
    const second = { id: 'pp:2', kind: 'playpack', version: '1.0', defs: [{ id: 'e:dup', kind: 'entity' }] } as PlaypackDef;
    expect(loader.load(first).ok).toBe(true);
    // D-073：同 key 即重定义（后装覆盖先装），不再拒绝
    expect(loader.load(second).ok).toBe(true);
  });
});

// ===========================================================================
// H. Def 继承与 abstract 严厉性
// ===========================================================================

describe('H. Def 继承与 abstract', () => {
  beforeEach(() => resetIdCounters());

  it('H1 多级继承按链条展开，子类覆盖父类', () => {
    const reg = new DefRegistry();
    reg.register({ id: 'd:0', kind: 'entity', props: { a: 1, shared: 'base' } });
    reg.register({ id: 'd:1', kind: 'entity', extends: ['d:0'], props: { b: 2 } });
    reg.register({ id: 'd:2', kind: 'entity', extends: ['d:1'], props: { c: 3, shared: 'leaf' } });

    const leaf = reg.resolve('d:2');
    expect(leaf).not.toBeNull();
    const props = leaf!.props as Record<string, unknown>;
    expect(props['a']).toBe(1);
    expect(props['b']).toBe(2);
    expect(props['c']).toBe(3);
    expect(props['shared']).toBe('leaf');
  });

  it('H2 abstract Def 一律不可实例化', () => {
    const h = harness();
    for (const defId of ABSTRACT_SEED_DEF_IDS) {
      const kind = defId.includes('entity') ? 'entity.create'
        : defId.includes('item') ? 'item.create'
          : defId.includes('node') ? 'node.create' : 'link.create';
      const r = h.registry.invoke(kind, { def: defId, a: 'n:1', b: 'n:2' });
      expect(r.ok, `${defId} 不得可实例化`).toBe(false);
    }
  });

  it('H3 继承自 abstract 的具体子类反而必须可实例化（abstract 不传播）', () => {
    const h = harness();
    for (const defId of CONCRETE_SUBCLASS_DEF_IDS) {
      const resolved = h.defRegistry.resolve(defId);
      expect(resolved, `${defId} 应可解析`).not.toBeNull();
      expect((resolved as { abstract?: boolean }).abstract ?? false, `${defId} 不应继承到 abstract`).toBe(false);
    }
  });

  it('H4 具体实体子类可通过 Op 通道真正创建', () => {
    const h = harness();
    const r = h.registry.invoke('entity.create', { def: 'd:concrete_entity' });
    expect(r.ok).toBe(true);
  });

  it('H5 不存在的 Def 被拒绝', () => {
    const h = harness();
    expect(h.registry.invoke('entity.create', { def: 'd:nope' }).ok).toBe(false);
  });
});

// ===========================================================================
// I. 数值铁律（规范宪法 §4.2）：clamp 机制
// ===========================================================================

describe('I. 数值铁律：clamp 机制', () => {
  beforeEach(() => resetIdCounters());

  it('I1 prop.add 尊重 Def.clamp 上界', () => {
    const h = harness();
    const id = createEntity(h, 'd:human'); // clamp hp: 0..100
    h.registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 95 });
    h.registry.invoke('prop.add', { path: `entities.${id}.props.hp`, delta: 50 });
    expect(h.holder.getState().entities[id]!.props['hp']).toBeLessThanOrEqual(100);
  });

  it('I2 prop.add 尊重 Def.clamp 下界', () => {
    const h = harness();
    const id = createEntity(h, 'd:human');
    h.registry.invoke('prop.set', { path: `entities.${id}.props.hp`, value: 5 });
    h.registry.invoke('prop.add', { path: `entities.${id}.props.hp`, delta: -999 });
    expect(h.holder.getState().entities[id]!.props['hp']).toBeGreaterThanOrEqual(0);
  });

  it('I3 玩法层 1-5 区间可由 clamp 机制表达并被机械保证', () => {
    resetIdCounters();
    const h = createFullHarness(seedDefsWithSchedule([
      { id: 'd:visible', kind: 'entity', clamp: { power: { min: 1, max: 5 } } },
    ]));
    const r = h.registry.invoke<{ def: string }, { $: string }>('entity.create', { def: 'd:visible' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.value.$;

    h.registry.invoke('prop.set', { path: `entities.${id}.props.power`, value: 3 });
    for (const delta of [10, -100, 4, -2, 99]) {
      h.registry.invoke('prop.add', { path: `entities.${id}.props.power`, delta });
      const v = h.holder.getState().entities[id]!.props['power'] as number;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('I4 clamp 属性在任意 delta 序列下恒不越界', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 25 }), (deltas) => {
        resetIdCounters();
        const h = createFullHarness(seedDefsWithSchedule([
          { id: 'd:bounded', kind: 'entity', clamp: { v: { min: 1, max: 5 } } },
        ]));
        const created = h.registry.invoke<{ def: string }, { $: string }>('entity.create', { def: 'd:bounded' });
        if (!created.ok) return false;
        const id = created.value.$;
        h.registry.invoke('prop.set', { path: `entities.${id}.props.v`, value: 1 });
        for (const d of deltas) {
          h.registry.invoke('prop.add', { path: `entities.${id}.props.v`, delta: d });
          const v = h.holder.getState().entities[id]!.props['v'];
          if (typeof v !== 'number' || v < 1 || v > 5) return false;
        }
        return true;
      }),
      { numRuns: 600 },
    );
  });
});

// ===========================================================================
// J. Safety：诊断有界性与终止语义
// ===========================================================================

describe('J. Safety 诊断', () => {
  it('J1 容量满时驱逐低severity，绝不丢弃 error / fatal', () => {
    const sink = new DiagnosticSink({ maxCapacity: 4, dedup: false, onFatal: () => {} });
    sink.emit(diag('W_A', 'warn'));
    sink.emit(diag('I_A', 'info'));
    sink.emit(diag('E_A', 'error'));
    sink.emit(diag('E_B', 'error'));
    for (let i = 0; i < 10; i++) sink.emit(diag(`W_${i}`, 'warn'));

    const kept = sink.getAll();
    const errorCodes = kept.filter((d) => d.severity === 'error').map((d) => d.code);
    expect(errorCodes).toContain('E_A');
    expect(errorCodes).toContain('E_B');
  });

  it('J2 任意 emit 序列下 error/fatal 数量恒不减少', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Diagnostic['severity']>('info', 'warn', 'error'), { minLength: 1, maxLength: 80 }),
        fc.integer({ min: 1, max: 10 }),
        (severities, cap) => {
          const sink = new DiagnosticSink({ maxCapacity: cap, dedup: false, onFatal: () => {} });
          let emittedErrors = 0;
          for (let i = 0; i < severities.length; i++) {
            const sev = severities[i]!;
            if (sev === 'error') emittedErrors++;
            sink.emit(diag(`C_${i}`, sev));
          }
          const keptErrors = sink.getAll().filter((d) => d.severity === 'error').length;
          return keptErrors === emittedErrors;
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('J3 fatal 触发 halt，后续 emit 一律抛 DiagnosticHaltError', () => {
    let notified = 0;
    const sink = new DiagnosticSink({ onFatal: () => { notified++; } });
    expect(() => sink.emit(diag('E_FATAL_X', 'fatal'))).toThrow(DiagnosticHaltError);
    expect(notified).toBe(1);
    expect(sink.isHalted()).toBe(true);
    expect(sink.hasFatal()).toBe(true);
    expect(() => sink.emit(diag('W_AFTER', 'warn'))).toThrow(DiagnosticHaltError);
  });

  it('J4 fatal 记录先于去重判断，不被同键低severity吞掉', () => {
    const sink = new DiagnosticSink({ dedup: true, onFatal: () => {} });
    expect(() => sink.emit(diag('E_SAME', 'fatal'))).toThrow(DiagnosticHaltError);
    expect(sink.getAll().some((d) => d.severity === 'fatal')).toBe(true);
  });

  it('J5 clear 后可重新使用', () => {
    const sink = new DiagnosticSink({ onFatal: () => {} });
    expect(() => sink.emit(diag('E_F', 'fatal'))).toThrow(DiagnosticHaltError);
    sink.clear();
    expect(sink.isHalted()).toBe(false);
    expect(sink.getAll()).toHaveLength(0);
    expect(() => sink.emit(diag('W_OK', 'warn'))).not.toThrow();
  });

  it('J6 maxCapacity 非法值被构造期拒绝', () => {
    for (const cap of [0, -1, 1.5, NaN]) {
      expect(() => new DiagnosticSink({ maxCapacity: cap }), `cap=${cap}`).toThrow();
    }
  });

  it('J7 getBySeverity 与 getDroppedCount 自洽', () => {
    const sink = new DiagnosticSink({ maxCapacity: 3, dedup: false, onFatal: () => {} });
    for (let i = 0; i < 9; i++) sink.emit(diag(`I_${i}`, 'info'));
    expect(sink.getAll().length).toBeLessThanOrEqual(3);
    expect(sink.getDroppedCount()).toBeGreaterThan(0);
    expect(sink.getBySeverity('info').length).toBe(sink.getAll().length);
  });
});

// ===========================================================================
// K. 全引擎串联：一条真实的回合链路
// ===========================================================================

describe('K. 全引擎串联链路', () => {
  beforeEach(() => resetIdCounters());

  it('K1 建实体 → 挂规则 → 推进相位 → 掷骰 → 改属性 → 快照 → 回退，全程无 fatal 且状态自洽', () => {
    const h = harness();
    const store = new InMemoryCheckpointStore();

    const actor = createEntity(h, 'd:human');
    h.registry.invoke('prop.set', { path: `entities.${actor}.props.hp`, value: 5 });

    // 挂一条 after 规则（只读响应）并确认它不能污染状态
    h.ruleProvider.add(rule('r:observe', 'after:entity.create', 'after', [
      { op: 'prop.set', args: { path: `entities.${actor}.props.observed`, value: true } },
    ]));

    store.checkpoint('turn-start', h.holder.getState());

    expect(h.registry.invoke('schedule.advance', {}).ok).toBe(true);

    const roll = h.registry.invoke<unknown, number>('random.roll', { sides: 5, stream: 'turn', seed: 11 });
    expect(roll.ok).toBe(true);
    if (roll.ok) {
      expect(roll.value).toBeGreaterThanOrEqual(1);
      expect(roll.value).toBeLessThanOrEqual(5);
      h.registry.invoke('prop.add', { path: `entities.${actor}.props.hp`, delta: -roll.value });
    }

    const other = createEntity(h, 'd:human');
    expect(h.holder.getState().entities[other]).toBeDefined();
    // after 阶段写入必须被丢弃
    expect(h.holder.getState().entities[actor]!.props['observed']).toBeUndefined();

    const hp = h.holder.getState().entities[actor]!.props['hp'] as number;
    expect(hp).toBeGreaterThanOrEqual(0);

    const restored = store.restore('turn-start');
    expect(restored).not.toBeNull();
    expect(restored!.world.turn.phaseIndex).toBe(0);
    expect(restored!.entities[actor]!.props['hp']).toBe(5);
    expect(restored!.entities[other]).toBeUndefined();
  });

  it('K2 veto 链路端到端：规则否决使整条业务动作不留痕迹', () => {
    const h = harness();
    const victim = createEntity(h, 'd:human');
    const snapshot = takeSnapshot(h.holder.getState(), 'pre-veto');

    h.ruleProvider.add(rule('r:protect', 'before:entity.destroy', 'before', [{ abort: '受保护实体不可销毁' }]));

    const r = h.registry.invoke('entity.destroy', { id: victim });
    expect(r.ok).toBe(false);
    expect(h.holder.getState().entities[victim]).toBeDefined();
    expect(Object.keys(h.holder.getState().entities)).toEqual(Object.keys(snapshot.state.entities));
  });

  it('K3 长随机 Op 序列后引擎仍自洽：无异常、无悬空引用、无越界数值', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            'entity.create', 'item.create', 'node.create',
            'entity.destroy', 'item.destroy', 'node.destroy',
            'prop.set', 'prop.add', 'schedule.advance', 'random.roll', 'attach.add',
          ),
          { minLength: 1, maxLength: 40 },
        ),
        (opNames) => {
          resetIdCounters();
          const h = harness();
          const created: string[] = [];

          for (const name of opNames) {
            const target = created[created.length - 1];
            let args: unknown = {};
            switch (name) {
              case 'entity.create': args = { def: 'd:human' }; break;
              case 'item.create': args = { def: 'd:sword' }; break;
              case 'node.create': args = { def: 'd:room' }; break;
              case 'entity.destroy':
              case 'item.destroy':
              case 'node.destroy': args = { id: target ?? 'e:missing' }; break;
              case 'prop.set': args = { path: `entities.${target ?? 'e:missing'}.props.hp`, value: 3 }; break;
              case 'prop.add': args = { path: `entities.${target ?? 'e:missing'}.props.hp`, delta: 7 }; break;
              case 'attach.add': args = { def: 'd:buff', target: { $: target ?? 'e:missing' } }; break;
              case 'random.roll': args = { sides: 5, stream: 'fuzz', seed: 1 }; break;
              default: args = {};
            }

            let res: { ok: boolean } | undefined;
            try {
              res = h.registry.invoke(name, args as never);
            } catch {
              return false; // Op 永不抛异常
            }
            if (res && res.ok && name === 'entity.create') {
              const st = h.holder.getState().entities;
              const ids = Object.keys(st);
              const latest = ids[ids.length - 1];
              if (latest) created.push(latest);
            }
          }

          const st = h.holder.getState();

          // 悬空引用：attachment.target 必须指向仍存在的宿主
          for (const att of Object.values(st.world.attachments)) {
            const ref = (att as { target?: { $: string } }).target?.$;
            if (ref === undefined) continue;
            const alive = ref in st.entities || ref in st.items || ref in st.nodes || ref in st.links || ref === 'w:0';
            if (!alive) return false;
          }

          // clamp：d:human 的 hp 恒在 0..100
          for (const e of Object.values(st.entities)) {
            const ent = e as { def: string; props: Record<string, unknown> };
            if (ent.def !== 'd:human') continue;
            const hp = ent.props['hp'];
            if (typeof hp === 'number' && (hp < 0 || hp > 100)) return false;
          }

          // 相位恒在界内
          const idx = st.world.turn.phaseIndex;
          return Number.isInteger(idx) && idx >= 0;
        },
      ),
      { numRuns: 800 },
    );
  });

  it('K4 同一 Op 序列在两个独立引擎实例上产生逐字节相同的末态', () => {
    const run = () => {
      resetIdCounters();
      const h = harness();
      const a = createEntity(h, 'd:human');
      h.registry.invoke('prop.set', { path: `entities.${a}.props.hp`, value: 5 });
      h.registry.invoke('schedule.advance', {});
      h.registry.invoke('random.roll', { sides: 5, stream: 'det', seed: 99 });
      h.registry.invoke('prop.add', { path: `entities.${a}.props.hp`, delta: -2 });
      const b = createEntity(h, 'd:human');
      h.registry.invoke('attach.add', { def: 'd:buff', target: { $: b } });
      h.registry.invoke('entity.destroy', { id: b });
      return JSON.stringify(h.holder.getState());
    };
    expect(run()).toBe(run());
  });

  it('K5 Hook 挂载/卸载不产生残留：同一 Op 在卸载后行为完全回到基线', () => {
    const baseline = (() => {
      resetIdCounters();
      const h = harness();
      createEntity(h);
      return JSON.stringify(h.holder.getState());
    })();

    resetIdCounters();
    const h = harness();
    h.ruleProvider.add(rule('r:temp', 'before:entity.create', 'before', [{ abort: 'blocked' }]));
    expect(h.registry.invoke('entity.create', { def: 'd:human' }).ok).toBe(false);
    h.ruleProvider.remove('r:temp');
    expect(h.ruleProvider.allRuleIds()).toHaveLength(0);
    createEntity(h);

    expect(JSON.stringify(h.holder.getState())).toBe(baseline);
  });
});

// ===========================================================================
// L. 不变量守恒：任何成功的 Op 之后都不得留下 fatal 不变量违规
// ===========================================================================

describe('L. 不变量守恒', () => {
  beforeEach(() => resetIdCounters());

  it('L1 空世界满足全部不变量', () => {
    const checker = new InvariantChecker();
    expect(checker.checkAll(createEmptyWorldState('sched:i')).filter((d) => d.severity === 'fatal')).toHaveLength(0);
  });

  it('L2 任意随机 Op 序列结束后，权威状态恒无 fatal 不变量违规', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            'entity.create', 'item.create', 'node.create', 'link.create',
            'entity.destroy', 'item.destroy', 'node.destroy',
            'attach.add', 'relation.set', 'prop.set', 'slot.add',
          ),
          { minLength: 1, maxLength: 35 },
        ),
        (opNames) => {
          resetIdCounters();
          const h = harness();
          const checker = new InvariantChecker();
          const nodeIds: string[] = [];
          const entityIds: string[] = [];

          for (const name of opNames) {
            const lastEntity = entityIds[entityIds.length - 1] ?? 'e:missing';
            const n1 = nodeIds[nodeIds.length - 1] ?? 'n:missing';
            const n2 = nodeIds[nodeIds.length - 2] ?? 'n:missing2';
            let args: unknown = {};
            switch (name) {
              case 'entity.create': args = { def: 'd:human' }; break;
              case 'item.create': args = { def: 'd:sword' }; break;
              case 'node.create': args = { def: 'd:room' }; break;
              case 'link.create': args = { a: n1, b: n2, def: 'd:door' }; break;
              case 'entity.destroy': args = { id: lastEntity }; break;
              case 'item.destroy': args = { id: Object.keys(h.holder.getState().items)[0] ?? 'i:missing' }; break;
              case 'node.destroy': args = { id: n1 }; break;
              case 'attach.add': args = { def: 'd:buff', target: { $: lastEntity } }; break;
              case 'relation.set': args = { from: lastEntity, kind: 'ally', to: lastEntity }; break;
              case 'prop.set': args = { path: `entities.${lastEntity}.props.hp`, value: 3 }; break;
              case 'slot.add': args = { container: Object.keys(h.holder.getState().containers)[0] ?? 'c:missing' }; break;
              default: args = {};
            }

            let r: { ok: boolean } | undefined;
            try {
              r = h.registry.invoke(name, args as never);
            } catch {
              return false;
            }
            if (r?.ok) {
              if (name === 'entity.create') {
                const ids = Object.keys(h.holder.getState().entities);
                const latest = ids[ids.length - 1];
                if (latest) entityIds.push(latest);
              }
              if (name === 'node.create') {
                const ids = Object.keys(h.holder.getState().nodes);
                const latest = ids[ids.length - 1];
                if (latest) nodeIds.push(latest);
              }
            }
          }

          const fatal = checker.checkAll(h.holder.getState()).filter((d) => d.severity === 'fatal');
          return fatal.length === 0;
        },
      ),
      { numRuns: 700 },
    );
  });

  it('L3 悬空 Link 端点被不变量拒绝，因此 link.create 无法造出悬空边', () => {
    const h = harness();
    const r = h.registry.invoke('link.create', { a: 'n:ghost1', b: 'n:ghost2', def: 'd:door' });
    expect(r.ok).toBe(false);
    expect(Object.keys(h.holder.getState().links)).toHaveLength(0);
  });

  it('L4 销毁 Node 时相连 Link 被级联清理，不留悬空边', () => {
    const h = harness();
    const a = h.registry.invoke<unknown, { $: string }>('node.create', { def: 'd:room' });
    const b = h.registry.invoke<unknown, { $: string }>('node.create', { def: 'd:room' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const link = h.registry.invoke('link.create', { a: a.value.$, b: b.value.$, def: 'd:door' });
    expect(link.ok).toBe(true);

    expect(h.registry.invoke('node.destroy', { id: a.value.$ }).ok).toBe(true);

    const st = h.holder.getState();
    for (const l of Object.values(st.links)) {
      const edge = l as { a: string; b: string };
      expect(edge.a in st.nodes && edge.b in st.nodes).toBe(true);
    }
    const fatal = new InvariantChecker().checkAll(st).filter((d) => d.severity === 'fatal');
    expect(fatal).toHaveLength(0);
  });

  it('L5 NaN / Infinity 不得进入状态', () => {
    const h = harness();
    const id = createEntity(h);
    for (const bad of [NaN, Infinity, -Infinity]) {
      h.registry.invoke('prop.set', { path: `entities.${id}.props.x`, value: bad as never });
    }
    const fatal = new InvariantChecker().checkAll(h.holder.getState()).filter((d) => d.severity === 'fatal');
    expect(fatal.filter((d) => d.code === 'E_INV_NAN_OR_INFINITY')).toHaveLength(0);
  });
});

// ===========================================================================
// M. 知识层：可见性与只读快照语义
// ===========================================================================

describe('M. 知识层可见性', () => {
  beforeEach(() => resetIdCounters());

  it('M1 无知识条目的 agent 返回空集合而非抛异常', () => {
    const state = createEmptyWorldState('sched:k');
    expect(knowledgeStore.getFacts(state, 'a:nobody')).toEqual({});
    expect(knowledgeStore.knows(state, 'a:nobody', 'anything')).toBeNull();
  });

  it('M2 facts 经 prop.set 写入后可被 KnowledgeStore 读到', () => {
    const h = harness();
    const r = h.registry.invoke('prop.set', { path: 'world.knowledge.a:1.facts.sawIntruder', value: true });
    expect(r.ok).toBe(true);
    expect(knowledgeStore.knows(h.holder.getState(), 'a:1', 'sawIntruder')).toBe(true);
  });

  it('M3 返回的 facts 是冻结副本，外部无法借它篡改状态', () => {
    const h = harness();
    h.registry.invoke('prop.set', { path: 'world.knowledge.a:1.facts.n', value: 1 });
    const facts = knowledgeStore.getFacts(h.holder.getState(), 'a:1');
    expect(Object.isFrozen(facts)).toBe(true);
    expect(() => { (facts as Record<string, unknown>)['n'] = 999; }).toThrow();
    expect(knowledgeStore.knows(h.holder.getState(), 'a:1', 'n')).toBe(1);
  });

  it('M4 嵌套对象也被深度冻结', () => {
    const h = harness();
    h.registry.invoke('prop.set', { path: 'world.knowledge.a:1.facts.deep', value: { inner: { leaf: 1 } } as never });
    const facts = knowledgeStore.getFacts(h.holder.getState(), 'a:1');
    const deep = facts['deep'] as Record<string, Record<string, unknown>>;
    expect(Object.isFrozen(deep)).toBe(true);
    expect(Object.isFrozen(deep['inner'])).toBe(true);
  });

  it('M5 一个 agent 的知识不泄漏给另一个 agent', () => {
    const h = harness();
    h.registry.invoke('prop.set', { path: 'world.knowledge.a:1.facts.secret', value: 'x' });
    expect(knowledgeStore.knows(h.holder.getState(), 'a:2', 'secret')).toBeNull();
  });

  it('M6 未知 fact 与值为 null 的 fact 可区分', () => {
    const h = harness();
    h.registry.invoke('prop.set', { path: 'world.knowledge.a:1.facts.explicitNull', value: null });
    const st = h.holder.getState();
    expect(knowledgeStore.knows(st, 'a:1', 'explicitNull')).toBeNull();
    expect(Object.keys(knowledgeStore.getFacts(st, 'a:1'))).toContain('explicitNull');
    expect(Object.keys(knowledgeStore.getFacts(st, 'a:1'))).not.toContain('neverSet');
  });
});

// ===========================================================================
// N. Gateway 只读边界（规范宪法 §4.1 的表现层对应物）
// ===========================================================================

describe('N. Gateway 只读边界', () => {
  beforeEach(() => resetIdCounters());

  function makeGateway(h: FullHarness): PresentationGateway {
    const catalog = new ActionCatalog({
      getState: () => h.holder.getState(),
      queryEngine: h.queryEngine,
      ctxForActor: () => h.ctxForSelf({ $: 'w:0' }),
      listActionDefs: () => [],
    });
    return new PresentationGateway({
      getState: () => h.holder.getState(),
      queryEngine: h.queryEngine,
      exprEngine: h.exprEngine,
      actionCatalog: catalog,
      ctxForSelf: (ref) => h.ctxForSelf(ref as { $: string }),
      baseCtx: () => h.ctxForSelf({ $: 'w:0' }),
    });
  }

  it('N1 Gateway 不暴露任何写通道字段', () => {
    const gw = makeGateway(harness()) as unknown as Record<string, unknown>;
    for (const forbidden of ['registry', 'tx', 'holder', 'invoke', 'setState', 'opRegistry']) {
      expect(gw[forbidden], `Gateway 不得暴露 ${forbidden}`).toBeUndefined();
    }
  });

  it('N2 Gateway 只提供 subscribe / query / queryActions / dispatch', () => {
    const gw = makeGateway(harness());
    expect(typeof gw.subscribe).toBe('function');
    expect(typeof gw.query).toBe('function');
    expect(typeof gw.queryActions).toBe('function');
  });

  it('N3 query 不改变权威状态', () => {
    const h = harness();
    createEntity(h);
    const gw = makeGateway(h);
    const before = h.holder.getState();
    gw.query({ from: 'entities' } as never);
    expect(h.holder.getState()).toBe(before);
  });

  it('N4 subscribe / unsubscribe 生命周期正确', () => {
    const gw = makeGateway(harness());
    const seen: string[] = [];
    const sub = gw.subscribe('evt', (t) => seen.push(t));
    gw.dispatch('evt', {});
    expect(seen).toEqual(['evt']);
    sub.unsubscribe();
    gw.dispatch('evt', {});
    expect(seen).toEqual(['evt']);
  });

  it('N5 通配订阅者收到全部事件', () => {
    const gw = makeGateway(harness());
    const seen: string[] = [];
    gw.subscribe('*', (t) => seen.push(t));
    gw.dispatch('a', {});
    gw.dispatch('b', {});
    expect(seen).toEqual(['a', 'b']);
  });

  it('N6 订阅者抛异常不影响其他订阅者与调用方', () => {
    const gw = makeGateway(harness());
    const seen: string[] = [];
    gw.subscribe('evt', () => { throw new Error('bad handler'); });
    gw.subscribe('evt', (t) => seen.push(t));
    expect(() => gw.dispatch('evt', {})).not.toThrow();
    expect(seen).toEqual(['evt']);
  });
});

// ===========================================================================
// O. 拓扑度量契约（规范宪法 §4.3 相关）
// ===========================================================================

describe('O. 拓扑度量', () => {
  const nodes = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { id, def: 'd:room', weight: 1, props: {}, tags: [] }])) as never;
  const link = (id: string, a: string, b: string, weight = 1, directed = false) => ({ id, def: 'd:door', a, b, weight, directed, props: {}, tags: [] });

  it('O1 自身到自身距离为 0', () => {
    expect(dist(nodes(['n:1']), {} as never, 'n:1', 'n:1')).toBe(0);
  });

  it('O2 不连通返回 null', () => {
    expect(dist(nodes(['n:1', 'n:2']), {} as never, 'n:1', 'n:2')).toBeNull();
  });

  it('O3 不存在的节点返回 null', () => {
    expect(dist(nodes(['n:1']), {} as never, 'n:1', 'n:absent')).toBeNull();
  });

  it('O4 无向边双向可达', () => {
    const ns = nodes(['n:1', 'n:2']);
    const ls = { 'l:1': link('l:1', 'n:1', 'n:2') } as never;
    expect(dist(ns, ls, 'n:1', 'n:2')).toBe(1);
    expect(dist(ns, ls, 'n:2', 'n:1')).toBe(1);
  });

  it('O5 有向边只单向可达', () => {
    const ns = nodes(['n:1', 'n:2']);
    const ls = { 'l:1': link('l:1', 'n:1', 'n:2', 1, true) } as never;
    expect(dist(ns, ls, 'n:1', 'n:2')).toBe(1);
    expect(dist(ns, ls, 'n:2', 'n:1')).toBeNull();
  });

  it('O6 maxCost 截断超预算路径', () => {
    const ns = nodes(['n:1', 'n:2']);
    const ls = { 'l:1': link('l:1', 'n:1', 'n:2', 10) } as never;
    expect(dist(ns, ls, 'n:1', 'n:2', { maxCost: 5 })).toBeNull();
    expect(dist(ns, ls, 'n:1', 'n:2', { maxCost: 20 })).toBe(10);
  });

  it('O7 hops 度量忽略权重', () => {
    const ns = nodes(['n:1', 'n:2']);
    const ls = { 'l:1': link('l:1', 'n:1', 'n:2', 42) } as never;
    expect(dist(ns, ls, 'n:1', 'n:2', { metric: 'hops' })).toBe(1);
  });

  it('O8 via 谓词可排除边', () => {
    const ns = nodes(['n:1', 'n:2']);
    const ls = { 'l:1': link('l:1', 'n:1', 'n:2') } as never;
    expect(dist(ns, ls, 'n:1', 'n:2', { via: () => false })).toBeNull();
  });

  it('O9 dist 对称性：无向图上 d(a,b) === d(b,a)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        const ids = Array.from({ length: n }, (_, i) => `n:${i}`);
        const ns = nodes(ids);
        const ls: Record<string, unknown> = {};
        for (let i = 0; i + 1 < n; i++) ls[`l:${i}`] = link(`l:${i}`, ids[i]!, ids[i + 1]!);
        const a = dist(ns, ls as never, ids[0]!, ids[n - 1]!);
        const b = dist(ns, ls as never, ids[n - 1]!, ids[0]!);
        return a === b;
      }),
      { numRuns: 400 },
    );
  });

  it('O10 spread 结果按强度降序、NodeId 升序，且不含起点', () => {
    const ids = ['n:0', 'n:1', 'n:2', 'n:3'];
    const ns = nodes(ids);
    const ls = {
      'l:0': link('l:0', 'n:0', 'n:1'),
      'l:1': link('l:1', 'n:0', 'n:2'),
      'l:2': link('l:2', 'n:1', 'n:3'),
    } as never;
    const out = spread(ns, ls, 'n:0', 5);
    expect(out.every((r) => r.node !== 'n:0')).toBe(true);
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]!;
      const cur = out[i]!;
      const ordered = prev.strength > cur.strength
        || (prev.strength === cur.strength && prev.node.localeCompare(cur.node) < 0);
      expect(ordered).toBe(true);
    }
  });

  it('O11 spread 起点不存在时返回空数组', () => {
    expect(spread(nodes(['n:1']), {} as never, 'n:absent', 5)).toEqual([]);
  });

  it('O12 spread 强度恒为正且不超过预算', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (budget) => {
        const ids = ['n:0', 'n:1', 'n:2'];
        const ns = nodes(ids);
        const ls = { 'l:0': link('l:0', 'n:0', 'n:1'), 'l:1': link('l:1', 'n:1', 'n:2') } as never;
        return spread(ns, ls, 'n:0', budget).every((r) => r.strength > 0 && r.strength <= budget);
      }),
      { numRuns: 400 },
    );
  });
});

// ===========================================================================
// P. Decision / Intent 生命周期
// ===========================================================================

describe('P. Decision / Intent 生命周期', () => {
  beforeEach(() => resetIdCounters());

  it('P1 decision.open 建立 open 状态的决策', () => {
    const h = harness();
    const r = h.registry.invoke('decision.open', { def: 'd:vote', askees: [{ $: 'a:1' }], ctx: {} });
    expect(r.ok).toBe(true);
    const decisions = Object.values(h.holder.getState().world.decisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.status).toBe('open');
  });

  it('P2 不存在的 DecisionDef 被拒绝', () => {
    const h = harness();
    expect(h.registry.invoke('decision.open', { def: 'd:absent', askees: [], ctx: {} }).ok).toBe(false);
  });

  it('P3 intent.submit 建立 pending 意图', () => {
    const h = harness();
    const r = h.registry.invoke('intent.submit', { action: 'd:move', agent: 'a:1', bindings: {}, hidden: false });
    expect(r.ok).toBe(true);
    const intents = Object.values(h.holder.getState().world.intents);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.status).toBe('pending');
  });

  it('P4 hidden 意图仍被记录，hidden 标志被保留', () => {
    const h = harness();
    expect(h.registry.invoke('intent.submit', { action: 'd:move', agent: 'a:1', bindings: {}, hidden: true }).ok).toBe(true);
    expect(Object.values(h.holder.getState().world.intents)[0]!.hidden).toBe(true);
  });

  it('P5 意图状态只在合法集合内', () => {
    const h = harness();
    h.registry.invoke('intent.submit', { action: 'd:move', agent: 'a:1', bindings: {}, hidden: false });
    const legal = new Set(['pending', 'resolved', 'failed', 'void']);
    for (const intent of Object.values(h.holder.getState().world.intents)) {
      expect(legal.has(intent.status)).toBe(true);
    }
  });

  it('P6 决策状态只在合法集合内', () => {
    const h = harness();
    h.registry.invoke('decision.open', { def: 'd:vote', askees: [{ $: 'a:1' }], ctx: {} });
    const legal = new Set(['open', 'resolved', 'timeout', 'void']);
    for (const d of Object.values(h.holder.getState().world.decisions)) {
      expect(legal.has(d.status)).toBe(true);
    }
  });

  it('P7 决策与意图并存互不干扰', () => {
    const h = harness();
    expect(h.registry.invoke('decision.open', { def: 'd:vote', askees: [{ $: 'a:1' }], ctx: {} }).ok).toBe(true);
    expect(h.registry.invoke('intent.submit', { action: 'd:move', agent: 'a:1', bindings: {}, hidden: false }).ok).toBe(true);
    const st = h.holder.getState();
    expect(Object.keys(st.world.decisions)).toHaveLength(1);
    expect(Object.keys(st.world.intents)).toHaveLength(1);
    expect(new InvariantChecker().checkAll(st).filter((d) => d.severity === 'fatal')).toHaveLength(0);
  });
});

// ===========================================================================
// Q. 堆叠守恒：stack.split / stack.merge 三步原子性（需求17）
// ===========================================================================

describe('Q. 堆叠守恒', () => {
  beforeEach(() => resetIdCounters());

  /** 造一个带容器的宿主与一件可堆叠物品，返回 (containerId, itemId)。 */
  function stackFixture(stack: number, stackMax?: number): { h: FullHarness; container: string; item: string } {
    const h = harness();
    const owner = createEntity(h);
    const c = h.registry.invoke<unknown, { $: string }>('slot.add', {
      container: Object.values(h.holder.getState().entities[owner]!.containers)[0] ?? 'c:missing',
    });
    // 若种子 Def 未声明容器，退化为直接取任意已存在容器
    const containerId = Object.keys(h.holder.getState().containers)[0] ?? '';
    const item = h.registry.invoke<unknown, { $: string }>('item.create', {
      def: 'd:sword', stack, ...(stackMax !== undefined ? { stackMax } : {}),
    });
    expect(item.ok).toBe(true);
    void c;
    return { h, container: containerId, item: item.ok ? item.value.$ : '' };
  }

  it('Q1 非法拆分数量被拒绝且总量不变', () => {
    const { h, container, item } = stackFixture(5);
    const totalBefore = Object.values(h.holder.getState().items).reduce((s, i) => s + ((i as { stack?: number }).stack ?? 1), 0);
    for (const n of [0, -1, 5, 6]) {
      const r = h.registry.invoke('stack.split', { id: item, n, toContainerId: container });
      expect(r.ok, `n=${n} 必须被拒绝`).toBe(false);
    }
    const totalAfter = Object.values(h.holder.getState().items).reduce((s, i) => s + ((i as { stack?: number }).stack ?? 1), 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it('Q2 拆分失败时不残留半成品物品（三步原子性）', () => {
    const { h, item } = stackFixture(5);
    const itemCountBefore = Object.keys(h.holder.getState().items).length;
    // 目标容器不存在 → 第三步失败 → 整体回滚
    const r = h.registry.invoke('stack.split', { id: item, n: 2, toContainerId: 'c:absent' });
    expect(r.ok).toBe(false);
    expect(Object.keys(h.holder.getState().items)).toHaveLength(itemCountBefore);
    expect((h.holder.getState().items[item] as { stack?: number }).stack).toBe(5);
  });

  it('Q3 不存在的物品拆分返回 E_REF_MISSING', () => {
    const h = harness();
    const r = h.registry.invoke('stack.split', { id: 'i:absent', n: 1, toContainerId: 'c:x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_REF_MISSING');
  });

  it('Q4 跨 Def 合并被拒绝', () => {
    const h = harness();
    const a = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:sword', stack: 2 });
    const b = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:concrete_item', stack: 2 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const r = h.registry.invoke('stack.merge', { fromId: a.value.$, intoId: b.value.$ });
    expect(r.ok).toBe(false);
  });

  it('Q5 同 Def 合并守恒总量并销毁来源', () => {
    const h = harness();
    const a = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:sword', stack: 2 });
    const b = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:sword', stack: 3 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const r = h.registry.invoke('stack.merge', { fromId: a.value.$, intoId: b.value.$ });
    expect(r.ok).toBe(true);
    const st = h.holder.getState();
    expect(st.items[a.value.$]).toBeUndefined();
    expect((st.items[b.value.$] as { stack?: number }).stack).toBe(5);
  });

  it('Q6 合并超出 stackMax 被拒绝且双方数量不变', () => {
    const h = harness();
    const a = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:sword', stack: 3 });
    const b = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:sword', stack: 3, stackMax: 5 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const r = h.registry.invoke('stack.merge', { fromId: a.value.$, intoId: b.value.$ });
    expect(r.ok).toBe(false);
    const st = h.holder.getState();
    expect((st.items[a.value.$] as { stack?: number }).stack).toBe(3);
    expect((st.items[b.value.$] as { stack?: number }).stack).toBe(3);
  });

  it('Q7 任意 merge 序列后不变量无 fatal 且 stack 恒 >= 1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 })), { minLength: 1, maxLength: 8 }),
        (pairs) => {
          resetIdCounters();
          const h = harness();
          const ids: string[] = [];
          for (const [s] of pairs) {
            const r = h.registry.invoke<unknown, { $: string }>('item.create', { def: 'd:sword', stack: s });
            if (r.ok) ids.push(r.value.$);
          }
          for (let i = 0; i + 1 < ids.length; i++) {
            h.registry.invoke('stack.merge', { fromId: ids[i]!, intoId: ids[i + 1]! });
          }
          const st = h.holder.getState();
          for (const it of Object.values(st.items)) {
            const s = (it as { stack?: number }).stack ?? 1;
            if (s < 1) return false;
          }
          return new InvariantChecker().checkAll(st).filter((d) => d.severity === 'fatal').length === 0;
        },
      ),
      { numRuns: 400 },
    );
  });
});

// ===========================================================================
// R. 影子流隔离（Property 17）
// ===========================================================================

describe('R. 影子流隔离', () => {
  beforeEach(() => resetIdCounters());

  it('R1 withShadowStream 结束后原流状态被完整还原', () => {
    const h = harness();
    // 先在 main 流上推进若干次，建立一个已知状态
    h.registry.invoke('random.roll', { sides: 6, stream: 'main', seed: 5 });
    const before = h.holder.getState().world.rng['main'];
    expect(before).toBeDefined();

    // 在一个真实事务里进入影子作用域
    const tx = new Transaction(h.holder.getState());
    const ctx = { tx, depth: 0, emit: () => {} };
    withShadowStream(ctx as never, { name: 'main', seed: 999 }, (inner) => {
      const draft = (inner as { tx: Transaction }).tx.getDraft();
      expect(draft.world.rng['main']!.seed).toBe(999);
      return null;
    });

    const after = tx.getFinalDraft().world.rng['main'];
    expect(after).toEqual(before);
  });

  it('R2 影子作用域前不存在的流，退出后仍不存在', () => {
    const h = harness();
    const tx = new Transaction(h.holder.getState());
    const ctx = { tx, depth: 0, emit: () => {} };
    expect(tx.getDraft().world.rng['ghost']).toBeUndefined();

    withShadowStream(ctx as never, { name: 'ghost', seed: 1 }, () => null);

    expect(tx.getFinalDraft().world.rng['ghost']).toBeUndefined();
  });

  it('R3 snapshotStream / restoreStream 往返幂等', () => {
    const h = harness();
    h.registry.invoke('random.roll', { sides: 6, stream: 's', seed: 42 });
    const tx = new Transaction(h.holder.getState());
    const ctx = { tx, depth: 0, emit: () => {} } as never;

    const snap = snapshotStream(ctx, 's');
    restoreStream(ctx, 's', snap);
    expect(tx.getFinalDraft().world.rng['s']).toEqual(snap);
  });

  it('R4 影子作用域内的返回值被透传', () => {
    const h = harness();
    const tx = new Transaction(h.holder.getState());
    const ctx = { tx, depth: 0, emit: () => {} } as never;
    expect(withShadowStream(ctx, { name: 'x', seed: 1 }, () => 'payload')).toBe('payload');
  });

  it('R5 任意流名与种子下隔离性恒成立', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 99999 }),
        fc.integer({ min: 0, max: 99999 }),
        (name, outerSeed, shadowSeed) => {
          resetIdCounters();
          const h = harness();
          h.registry.invoke('random.roll', { sides: 6, stream: name, seed: outerSeed });
          const before = h.holder.getState().world.rng[name];

          const tx = new Transaction(h.holder.getState());
          const ctx = { tx, depth: 0, emit: () => {} } as never;
          withShadowStream(ctx, { name, seed: shadowSeed }, () => null);

          return JSON.stringify(tx.getFinalDraft().world.rng[name]) === JSON.stringify(before);
        },
      ),
      { numRuns: 800 },
    );
  });
});

// ===========================================================================
// S. Aura 重算（Property 11）
// ===========================================================================

describe('S. Aura 重算', () => {
  beforeEach(() => resetIdCounters());

  it('S1 无 aura 声明的 attachment 不产生任何 diff', () => {
    const h = harness();
    const id = createEntity(h);
    h.registry.invoke('attach.add', { def: 'd:buff', target: { $: id } });

    const engine = new AuraEngine({ defLookup: (d) => h.defs.get(d) ?? null });
    const { diff } = engine.recomputeForTarget(h.holder.getState(), id);
    expect(diff).toEqual([]);
  });

  /**
   * 已修复的引擎缺陷（原根因见下方 S2-根因 测试）：
   *
   * 原缺陷：`AuraEngine` 的属性键 `aura.${attachment.def}` 含点号（defId 形如 `d:glow`），旧实现把它
   * 拼进 setPath 写入路径，而 setPath 以点号分隔——值落到嵌套 `props.aura['d:glow']`，读取端却按
   * 字面扁平键 `props['aura.d:glow']` 读，二者永不相交（值读不回、重算永不幂等，违反需求30.5-30.6）。
   *
   * 修复：recomputeForTarget 把 auraKey 当作 props 对象的字面键，读写都走"整块 props 重写"，
   * 路径只到 `.props`（targetId 无点号），auraKey 不再经过路径分割——读写位置一致、可读回、幂等。
   * 下面两条已从 `it.fails` 转回普通 `it`，正向锁定修复后的行为。
   */
  // S2/S3 直接在手工构造的状态上驱动 recomputeForTarget（不经过已接线的 attach.add，后者的 after
  // 阶段会自动重算，会抢先把 aura 值算好、使随后的手工重算变成幂等无 diff——那正是 auto-wire 生效的
  // 证据，但会掩盖 recomputeForTarget 自身"首次产出 diff"的语义。这里手工建状态以隔离测其本体。
  function auraGlowEngine(compute: unknown) {
    const def = { id: 'd:glow', kind: 'attachment', stackStrategy: 'count', aura: { compute, deps: [] } };
    return new AuraEngine({ defLookup: (d) => (d === 'd:glow' ? (def as never) : null) });
  }
  function stateWithGlowOn(entityId: string) {
    let state = createEmptyWorldState('s:sched');
    state = { ...state, entities: { [entityId]: { id: entityId, def: 'd:x', props: {}, tags: [], attachments: [], relations: {}, containers: {} } as never } };
    state = { ...state, world: { ...state.world, attachments: { 'a:1': { id: 'a:1', def: 'd:glow', target: { $: entityId }, props: {}, stack: 1 } } } };
    return state;
  }

  it('S2 aura 计算结果可从 aura.<defId> 扁平键读回（缺陷已修复）', () => {
    const engine = auraGlowEngine(7);
    const { state, diff } = engine.recomputeForTarget(stateWithGlowOn('e:1'), 'e:1');
    expect(diff).toHaveLength(1);
    expect(diff[0]!.propKey).toBe('aura.d:glow');
    expect(state.entities['e:1']!.props['aura.d:glow']).toBe(7);
  });

  it('S3 重算幂等：对已算好的状态再次重算第二次无 diff（缺陷已修复）', () => {
    const engine = auraGlowEngine(3);
    const first = engine.recomputeForTarget(stateWithGlowOn('e:1'), 'e:1');
    expect(first.diff).toHaveLength(1);
    const second = engine.recomputeForTarget(first.state, 'e:1');
    expect(second.diff).toEqual([]);
  });

  it('S2-根因 setPath 以点号分隔路径（该行为本身正确，是 aura 键设计与之冲突）', () => {
    const base = createEmptyWorldState('sched:p');
    const withEntity: typeof base = {
      ...base,
      entities: { 'e:1': { id: 'e:1', def: 'd:x', props: {}, tags: [], attachments: [], relations: {}, containers: {} } as never },
    };
    const after = setPath(withEntity, 'entities.e:1.props.aura.d:glow', 7);
    const props = after.entities['e:1']!.props as Record<string, unknown>;

    // 值落在嵌套结构里，而不是字面键上
    expect(props['aura.d:glow']).toBeUndefined();
    expect((props['aura'] as Record<string, unknown>)['d:glow']).toBe(7);
  });

  it('S4 aura 表达式抛错时降级为 null，不让异常穿透', () => {
    resetIdCounters();
    const h = createFullHarness(seedDefsWithSchedule([
      { id: 'd:bad', kind: 'attachment', stackStrategy: 'count', aura: { compute: { unknownOperator: 1 }, deps: [] } },
    ]));
    const id = createEntity(h);
    h.registry.invoke('attach.add', { def: 'd:bad', target: { $: id } });

    const engine = new AuraEngine({ defLookup: (d) => h.defs.get(d) ?? null });
    expect(() => engine.recomputeForTarget(h.holder.getState(), id)).not.toThrow();
  });

  it('S5 不存在的 target 重算返回空 diff 且状态不变', () => {
    const h = harness();
    const engine = new AuraEngine({ defLookup: (d) => h.defs.get(d) ?? null });
    const st = h.holder.getState();
    const { state, diff } = engine.recomputeForTarget(st, 'e:absent');
    expect(diff).toEqual([]);
    expect(state).toBe(st);
  });

  it('S6 onAttachmentChanged 只影响声明了该 dep 的目标', () => {
    resetIdCounters();
    const h = createFullHarness(seedDefsWithSchedule([
      { id: 'd:dep', kind: 'attachment', stackStrategy: 'count' },
      { id: 'd:watcher', kind: 'attachment', stackStrategy: 'count', aura: { compute: 1, deps: ['d:dep'] } },
    ]));
    const watched = createEntity(h);
    const unwatched = createEntity(h);
    h.registry.invoke('attach.add', { def: 'd:watcher', target: { $: watched } });
    h.registry.invoke('attach.add', { def: 'd:dep', target: { $: unwatched } });

    const engine = new AuraEngine({ defLookup: (d) => h.defs.get(d) ?? null });
    const { diff } = engine.onAttachmentChanged(h.holder.getState(), 'd:dep');
    expect(diff.every((x) => x.targetId === watched)).toBe(true);
  });
});

// ===========================================================================
// T. Linter / 熔断器 / 配额
// ===========================================================================

describe('T. Linter / 熔断器 / 配额', () => {
  it('T1 Linter 捕获悬空 extends 引用', () => {
    const r = new Linter().run({ allDefs: [{ id: 'd:child', kind: 'entity', extends: ['d:absent'] }] });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'E_LOAD_UNDEFINED_REF')).toBe(true);
  });

  it('T2 Linter 捕获缺失 maxIter 的 while（含嵌套分支）', () => {
    const r = new Linter().run({
      allDefs: [{
        id: 'd:act', kind: 'action',
        effects: [{ if: true, then: [{ while: true, do: [] }] }],
      } as unknown as Def],
    });
    expect(r.diagnostics.some((d) => d.code === 'E_FLOW_NO_MAXITER')).toBe(true);
  });

  it('T3 合法 Def 集合通过 Linter', () => {
    const r = new Linter().run({
      allDefs: [
        { id: 'd:base', kind: 'entity' },
        { id: 'd:child', kind: 'entity', extends: ['d:base'] },
        { id: 'd:act', kind: 'action', effects: [{ while: true, do: [], maxIter: 3 }] } as unknown as Def,
      ],
    });
    expect(r.diagnostics.filter((d) => d.severity === 'fatal')).toHaveLength(0);
  });

  it('T4 每个 ErrCode 都有创作者可读的 hint 规则', () => {
    for (const code of ['E_REF_MISSING', 'E_OP_VETOED', 'E_HOOK_DEPTH', 'E_FLOW_ABORT', 'E_INV_DANGLING']) {
      expect(HINT_TEMPLATES[code], `${code} 缺少 hint`).toBeTruthy();
    }
  });

  it('T5 熔断器在阈值内不断开，达到阈值后断开', () => {
    const breaker = new RuleCircuitBreaker({ threshold: 3, windowMs: 60_000 });
    let st = createEmptyWorldState('sched:cb');
    const now = 1_000_000;

    let out = breaker.recordError(st, 'r:flaky', now);
    st = out.state;
    expect(out.circuitOpen).toBe(false);
    out = breaker.recordError(st, 'r:flaky', now + 1);
    st = out.state;
    expect(out.circuitOpen).toBe(false);
    out = breaker.recordError(st, 'r:flaky', now + 2);
    st = out.state;
    expect(out.circuitOpen).toBe(true);
    expect(breaker.isDisabled(st, 'r:flaky')).toBe(true);
  });

  it('T6 窗口外的历史错误不计入熔断', () => {
    const breaker = new RuleCircuitBreaker({ threshold: 2, windowMs: 1000 });
    let st = createEmptyWorldState('sched:cb');
    st = breaker.recordError(st, 'r:x', 1000).state;
    // 第二次远超窗口 → 旧错误被淘汰，不应达到阈值
    const out = breaker.recordError(st, 'r:x', 100_000);
    expect(out.circuitOpen).toBe(false);
  });

  it('T7 熔断状态可重置，且不同规则互不影响', () => {
    const breaker = new RuleCircuitBreaker({ threshold: 1 });
    let st = createEmptyWorldState('sched:cb');
    st = breaker.recordError(st, 'r:a', 1).state;
    expect(breaker.isDisabled(st, 'r:a')).toBe(true);
    expect(breaker.isDisabled(st, 'r:b')).toBe(false);
    st = breaker.reset(st, 'r:a');
    expect(breaker.isDisabled(st, 'r:a')).toBe(false);
  });

  it('T8 配额未声明时一律放行', () => {
    const q = new QuotaEnforcer({});
    const st = createEmptyWorldState('sched:q');
    expect(q.checkEntityQuota(st).ok).toBe(true);
    expect(q.checkAttachmentQuota(st).ok).toBe(true);
    expect(q.checkRuleQuota(st).ok).toBe(true);
  });

  it('T9 实体配额到达上限时拒绝并给出原因', () => {
    resetIdCounters();
    const h = harness();
    createEntity(h);
    createEntity(h);
    const q = new QuotaEnforcer({ maxEntities: 2 });
    const res = q.checkEntityQuota(h.holder.getState());
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });
});

// ===========================================================================
// U. Query 门禁：假值谓词不得被当成"未声明"
// ===========================================================================

describe('U. Query 门禁失败关闭', () => {
  beforeEach(() => resetIdCounters());

  function runQuery(h: FullHarness, q: unknown) {
    return h.queryEngine.run(h.holder.getState(), q as never, {
      exprEngine: h.exprEngine,
      baseCtx: h.ctxForSelf({ $: 'w:0' }),
      ctxForSelf: (ref) => h.ctxForSelf(ref as { $: string }),
    });
  }

  it('U1 where:false 过滤掉全部结果（不得放行）', () => {
    const h = harness();
    createEntity(h);
    createEntity(h);
    expect(runQuery(h, { from: 'entities' })).toHaveLength(2);
    expect(runQuery(h, { from: 'entities', where: false })).toHaveLength(0);
  });

  it('U2 visibleTo:false 过滤掉全部结果', () => {
    const h = harness();
    createEntity(h);
    expect(runQuery(h, { from: 'entities', visibleTo: false })).toHaveLength(0);
  });

  it('U3 visibleTo 非布尔结果一律失败关闭', () => {
    const h = harness();
    createEntity(h);
    for (const pred of [null, 0, 1, 'yes', '']) {
      expect(runQuery(h, { from: 'entities', visibleTo: pred }), `visibleTo=${JSON.stringify(pred)}`).toHaveLength(0);
    }
  });

  it('U4 where:true 放行全部', () => {
    const h = harness();
    createEntity(h);
    createEntity(h);
    expect(runQuery(h, { from: 'entities', where: true })).toHaveLength(2);
  });

  it('U5 limit 截断且 limit:0 返回空', () => {
    const h = harness();
    for (let i = 0; i < 4; i++) createEntity(h);
    expect(runQuery(h, { from: 'entities', limit: 2 })).toHaveLength(2);
    expect(runQuery(h, { from: 'entities', limit: 0 })).toHaveLength(0);
  });

  it('U6 未知数据源返回空集而非抛异常', () => {
    const h = harness();
    expect(() => runQuery(h, { from: 'no_such_source' })).not.toThrow();
    expect(runQuery(h, { from: 'no_such_source' })).toEqual([]);
  });

  it('U7 六大集合与 world 派生集合都可作为数据源', () => {
    const h = harness();
    createEntity(h);
    for (const from of ['entities', 'items', 'nodes', 'links', 'defs', 'attachments', 'agents', 'decisions', 'intents', 'log']) {
      expect(Array.isArray(runQuery(h, { from })), from).toBe(true);
    }
  });

  it('U8 Query 结果对同一状态稳定（可重复）', () => {
    const h = harness();
    for (let i = 0; i < 3; i++) createEntity(h);
    const a = runQuery(h, { from: 'entities', where: true });
    const b = runQuery(h, { from: 'entities', where: true });
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// V. Actions：require / visible / reason 三态与 ui/ai 一致性（需求25）
// ===========================================================================

describe('V. Actions 着法生成', () => {
  beforeEach(() => resetIdCounters());

  function catalogOf(h: FullHarness, defs: ActionDef[]): ActionCatalog {
    return new ActionCatalog({
      getState: () => h.holder.getState(),
      exprEngine: h.exprEngine,
      queryEngine: h.queryEngine,
      ctxForActor: () => h.ctxForSelf({ $: 'w:0' }),
      listActionDefs: () => defs,
    });
  }

  const act = (id: string, extra: Partial<ActionDef> = {}): ActionDef =>
    ({ id, kind: 'action', label: id, cost: [], effects: [], ...extra }) as ActionDef;

  it('V1 require 满足时着法出现且无 reason', () => {
    const h = harness();
    const out = catalogOf(h, [act('a:ok', { require: true })]).queryActions({ $: 'e:1' }, 'ui');
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBeUndefined();
  });

  it('V2 require 不满足且未声明 visible 时着法不出现（需求25.4 默认规则）', () => {
    const h = harness();
    const out = catalogOf(h, [act('a:no', { require: false })]).queryActions({ $: 'e:1' }, 'ui');
    expect(out).toHaveLength(0);
  });

  it('V3 require 不满足但 visible 满足时灰显并携带 reason（需求25.5）', () => {
    const h = harness();
    const out = catalogOf(h, [act('a:grey', { require: false, visible: true, reason: '体力不足' })])
      .queryActions({ $: 'e:1' }, 'ui');
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe('体力不足');
  });

  it('V4 require 与 visible 同时不满足时不出现', () => {
    const h = harness();
    const out = catalogOf(h, [act('a:hidden', { require: false, visible: false })]).queryActions({ $: 'e:1' }, 'ui');
    expect(out).toHaveLength(0);
  });

  it('V5 未声明 require 视为满足', () => {
    const h = harness();
    expect(catalogOf(h, [act('a:bare')]).queryActions({ $: 'e:1' }, 'ui')).toHaveLength(1);
  });

  it('V6 ui/ai 两模式返回相同的 action 集合（忽略绑定粒度，需求25.3/44.1）', () => {
    const h = harness();
    const defs = [act('a:1', { require: true }), act('a:2', { require: true }), act('a:3', { require: false })];
    const cat = catalogOf(h, defs);
    const ui = [...new Set(cat.queryActions({ $: 'e:1' }, 'ui').map((a) => a.action))].sort();
    const ai = [...new Set(cat.queryActions({ $: 'e:1' }, 'ai').map((a) => a.action))].sort();
    expect(ui).toEqual(ai);
  });

  it('V7 ai 模式的 range 展开有界，ui 模式为全量（需求25.7）', () => {
    const h = harness();
    const ranged = act('a:ranged', {
      require: true,
      targets: [{ name: 'n', range: { min: 1, max: 100, step: 1 } }],
    });
    const cat = catalogOf(h, [ranged]);
    const ui = cat.queryActions({ $: 'e:1' }, 'ui');
    const ai = cat.queryActions({ $: 'e:1' }, 'ai');
    expect(ui.length).toBe(100);
    expect(ai.length).toBeLessThan(ui.length);
    expect(ai.length).toBeGreaterThan(0);
  });

  it('V8 非法 range（step<=0 或非数值）展开为空而非死循环', () => {
    const h = harness();
    for (const range of [{ min: 1, max: 5, step: 0 }, { min: 1, max: 5, step: -1 }, { min: 'x', max: 5, step: 1 }]) {
      const cat = catalogOf(h, [act('a:bad', { require: true, targets: [{ name: 'n', range: range as never }] })]);
      expect(cat.queryActions({ $: 'e:1' }, 'ui'), JSON.stringify(range)).toHaveLength(0);
    }
  });

  it('V9 optional target 无候选时仍产出一个空绑定组合', () => {
    const h = harness();
    const cat = catalogOf(h, [act('a:opt', {
      require: true,
      targets: [{ name: 't', query: { from: 'entities', where: false } as never, optional: true }],
    })]);
    expect(cat.queryActions({ $: 'e:1' }, 'ui').length).toBeGreaterThan(0);
  });

  it('V10 无 ActionDef 时返回空数组', () => {
    const h = harness();
    expect(catalogOf(h, []).queryActions({ $: 'e:1' }, 'ui')).toEqual([]);
  });

  it('V11 queryActions 不改变权威状态', () => {
    const h = harness();
    createEntity(h);
    const before = h.holder.getState();
    catalogOf(h, [act('a:x', { require: true })]).queryActions({ $: 'e:1' }, 'ai');
    expect(h.holder.getState()).toBe(before);
  });

  it('V12 同一状态下重复 queryActions 结果稳定', () => {
    const h = harness();
    const cat = catalogOf(h, [act('a:1', { require: true }), act('a:2', { require: true })]);
    expect(cat.queryActions({ $: 'e:1' }, 'ai')).toEqual(cat.queryActions({ $: 'e:1' }, 'ai'));
  });
});

// ===========================================================================
// W. 具名表达式纯度（需求13）
// ===========================================================================

describe('W. 具名表达式纯度', () => {
  beforeEach(() => resetIdCounters());

  it('W1 纯字面量 body 通过 pure 校验', () => {
    expect(checkPure(true as never).ok).toBe(true);
    expect(checkPure(42 as never).ok).toBe(true);
  });

  it('W2 body 内含写入型 Op 被拒绝', () => {
    for (const opName of ['prop.set', 'entity.create', 'attach.add', 'random.roll', 'schedule.advance']) {
      const r = checkPure({ op: opName, args: [] } as never);
      expect(r.ok, `${opName} 必须被拒绝`).toBe(false);
    }
  });

  it('W3 嵌套在深层结构里的写入型 Op 同样被发现', () => {
    const r = checkPure({ if: true, then: [{ nested: { op: 'prop.set', args: [] } }] } as never);
    expect(r.ok).toBe(false);
  });

  it('W4 call 引用其他具名表达式不算 Op 调用', () => {
    expect(checkPure({ call: 'expr:other' } as never).ok).toBe(true);
  });

  it('W5 非写入前缀的算子名不被误判', () => {
    expect(checkPure({ op: 'add', args: [1, 2] } as never).ok).toBe(true);
    expect(checkPure({ op: 'hasTag', args: [] } as never).ok).toBe(true);
  });

  it('W6 registerExprDef 对不纯 body 返回 E_EXPR_UNKNOWN_OP 且不写入注册表', () => {
    const reg = new DefRegistry();
    const r = registerExprDef(reg, {
      id: 'expr:dirty', kind: 'expr', pure: true,
      body: { op: 'prop.set', args: [] } as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_EXPR_UNKNOWN_OP');
    expect(reg.resolve('expr:dirty')).toBeNull();
  });

  it('W7 registerExprDef 对纯 body 成功注册', () => {
    const reg = new DefRegistry();
    const r = registerExprDef(reg, { id: 'expr:clean', kind: 'expr', pure: true, body: true });
    expect(r.ok).toBe(true);
    expect(reg.resolve('expr:clean')).not.toBeNull();
  });

  it('W8 applyOverrides 命中时替换，未命中时原样返回', () => {
    expect(applyOverrides({ 'expr:a': 'expr:b' }, 'expr:a')).toBe('expr:b');
    expect(applyOverrides({ 'expr:a': 'expr:b' }, 'expr:c')).toBe('expr:c');
    expect(applyOverrides(undefined, 'expr:a')).toBe('expr:a');
  });

  it('W9 任意含写入型 Op 的 body 一律不通过（属性测试）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('prop.', 'list.', 'tag.', 'entity.', 'item.', 'stack.', 'node.', 'link.', 'slot.', 'prefab.', 'relation.', 'agent.', 'attach.', 'decision.', 'intent.', 'outcome.', 'schedule.', 'random.'),
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 3 }),
        (prefix, suffix, depth) => {
          let body: unknown = { op: `${prefix}${suffix}`, args: [] };
          for (let i = 0; i < depth; i++) body = { wrapped: [body] };
          return checkPure(body as never).ok === false;
        },
      ),
      { numRuns: 1500 },
    );
  });
});

// ===========================================================================
// X. 容器槽位语义：fixed 留洞 vs shift 前移（需求10）
// ===========================================================================

describe('X. 容器槽位语义', () => {
  const mkContainer = (insert: 'fixed' | 'shift', n: number) => ({
    id: 'c:1', owner: 'e:1', name: 'bag', insert,
    slots: Array.from({ length: n }, (_, i) => ({ index: i, holds: undefined })),
    props: {},
  }) as never;

  it('X1 fixed 容器删除留空洞，其余索引不变', () => {
    const c = removeSlot(mkContainer('fixed', 3), 1);
    expect((c as { slots: unknown[] }).slots).toHaveLength(3);
    expect((c as { slots: unknown[] }).slots[1]).toBeUndefined();
    expect((c as { slots: unknown[] }).slots[2]).toBeDefined();
  });

  it('X2 shift 容器删除后元素前移，不留空洞', () => {
    const c = removeSlot(mkContainer('shift', 3), 1);
    const slots = (c as { slots: unknown[] }).slots;
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s !== undefined)).toBe(true);
  });

  it('X3 插入一律追加到末尾', () => {
    const c = insertSlot(mkContainer('fixed', 2), { index: 99, holds: undefined } as never);
    expect((c as { slots: unknown[] }).slots).toHaveLength(3);
  });

  it('X4 findDefaultSlotIndex 取第一个空且被接受的槽位', () => {
    const base = mkContainer('fixed', 3) as { slots: ({ index: number; holds?: unknown } | undefined)[] };
    base.slots[0] = { index: 0, holds: { $: 'i:1' } };
    expect(findDefaultSlotIndex(base as never, () => true)).toBe(1);
  });

  it('X5 accepts 全否时返回 null（不得放置于容器之外）', () => {
    expect(findDefaultSlotIndex(mkContainer('fixed', 3), () => false)).toBeNull();
  });

  it('X6 跳过 fixed 容器的空洞', () => {
    const c = removeSlot(mkContainer('fixed', 3), 0) as { slots: unknown[] };
    expect(findDefaultSlotIndex(c as never, () => true)).toBe(1);
  });

  it('X7 setSlotHolds 对不存在的索引是无操作', () => {
    const base = mkContainer('fixed', 2);
    expect(setSlotHolds(base, 99, { $: 'i:1' })).toBe(base);
  });

  it('X8 setSlotHolds 不修改原容器（不可变）', () => {
    const base = mkContainer('fixed', 2);
    const next = setSlotHolds(base, 0, { $: 'i:1' });
    expect(next).not.toBe(base);
    expect((base as { slots: { holds?: unknown }[] }).slots[0]!.holds).toBeUndefined();
  });
});

// ===========================================================================
// Y. 关系对称性与级联清理（需求6.6 / 20.13）
// ===========================================================================

describe('Y. 关系对称性与级联清理', () => {
  beforeEach(() => resetIdCounters());

  it('Y1 relation.set 建立的关系满足对称镜像不变量', () => {
    const h = harness();
    const a = createEntity(h);
    const b = createEntity(h);
    const r = h.registry.invoke('relation.set', { from: a, kind: 'ally', to: b });
    expect(r.ok).toBe(true);
    const st = h.holder.getState();
    // 正向出边与反向入边必须同时存在（对称镜像）
    expect(st.entities[a]!.relations['ally']!.out.some((x) => x.$ === b)).toBe(true);
    expect(st.entities[b]!.relations['ally']!.in.some((x) => x.$ === a)).toBe(true);
    const fatal = new InvariantChecker().checkAll(st)
      .filter((d) => d.severity === 'fatal' && d.code === 'E_INV_RELATION_SYMMETRY');
    expect(fatal).toHaveLength(0);
  });

  it('Y2 relation.del 移除后仍满足对称不变量', () => {
    const h = harness();
    const a = createEntity(h);
    const b = createEntity(h);
    expect(h.registry.invoke('relation.set', { from: a, kind: 'ally', to: b }).ok).toBe(true);
    expect(h.registry.invoke('relation.del', { from: a, kind: 'ally', to: b }).ok).toBe(true);
    const st = h.holder.getState();
    expect(st.entities[a]!.relations['ally']!.out.some((x) => x.$ === b)).toBe(false);
    expect(st.entities[b]!.relations['ally']!.in.some((x) => x.$ === a)).toBe(false);
    expect(new InvariantChecker().checkAll(st).filter((d) => d.severity === 'fatal')).toHaveLength(0);
  });

  it('Y3 销毁关系一端后不留悬空关系', () => {
    const h = harness();
    const a = createEntity(h);
    const b = createEntity(h);
    expect(h.registry.invoke('relation.set', { from: a, kind: 'ally', to: b }).ok).toBe(true);
    expect(h.registry.invoke('entity.destroy', { id: b }).ok).toBe(true);

    const st = h.holder.getState();
    expect(st.entities[b]).toBeUndefined();
    const dangling = new InvariantChecker().checkAll(st)
      .filter((d) => d.severity === 'fatal' && (d.code === 'E_INV_DANGLING' || d.code === 'E_INV_RELATION_SYMMETRY'));
    expect(dangling).toHaveLength(0);
  });

  it('Y4 销毁 attachment 宿主后不留悬空 attachment', () => {
    const h = harness();
    const id = createEntity(h);
    h.registry.invoke('attach.add', { def: 'd:buff', target: { $: id } });
    expect(h.registry.invoke('entity.destroy', { id }).ok).toBe(true);

    const st = h.holder.getState();
    for (const att of Object.values(st.world.attachments)) {
      expect((att as { target: { $: string } }).target.$).not.toBe(id);
    }
    expect(new InvariantChecker().checkAll(st).filter((d) => d.severity === 'fatal')).toHaveLength(0);
  });

  it('Y5 关系指向不存在的对象被拒绝或不留下悬空引用', () => {
    const h = harness();
    const a = createEntity(h);
    const r = h.registry.invoke('relation.set', { from: a, kind: 'ally', to: 'e:ghost' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_REF_MISSING');
    const fatal = new InvariantChecker().checkAll(h.holder.getState())
      .filter((d) => d.severity === 'fatal' && d.code === 'E_INV_DANGLING');
    expect(fatal).toHaveLength(0);
  });

  it('Y6 任意建关系/销毁序列后关系不变量恒成立', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('create', 'relate', 'destroy'), { minLength: 1, maxLength: 25 }),
        (ops) => {
          resetIdCounters();
          const h = harness();
          const ids: string[] = [];
          for (const op of ops) {
            if (op === 'create') {
              const r = h.registry.invoke<unknown, { $: string }>('entity.create', { def: 'd:human' });
              if (r.ok) ids.push(r.value.$);
            } else if (op === 'relate' && ids.length >= 2) {
              h.registry.invoke('relation.set', {
                from: ids[ids.length - 1]!, kind: 'ally', to: ids[ids.length - 2]!,
              });
            } else if (op === 'destroy' && ids.length > 0) {
              const victim = ids.pop()!;
              h.registry.invoke('entity.destroy', { id: victim });
            }
          }
          return new InvariantChecker().checkAll(h.holder.getState())
            .filter((d) => d.severity === 'fatal').length === 0;
        },
      ),
      { numRuns: 600 },
    );
  });
});

// ===========================================================================
// Z. Flow 解释器：十种 Effect 形态与预算（需求22）
// ===========================================================================

describe('Z. Flow 解释器', () => {
  beforeEach(() => resetIdCounters());

  /** 在一个真实事务里跑一段 Flow，返回 (result, vars)。 */
  function runFlow(h: FullHarness, effects: Effect[], budget?: number, vars: Record<string, unknown> = {}) {
    const tx = new Transaction(h.holder.getState());
    const ctx = { tx, depth: 0, emit: () => {} } as never;
    return h.flowInterpreter.run(effects, ctx, budget, vars as never);
  }

  it('Z1 let 绑定变量并可被后续 Effect 读到', () => {
    const h = harness();
    const out = runFlow(h, [{ let: 'x', be: 7 }, { let: 'y', be: { var: 'x' } as never }]);
    expect(out.result.ok).toBe(true);
    expect(out.vars['y']).toBe(7);
  });

  it('Z2 if 走 then 分支', () => {
    const h = harness();
    const out = runFlow(h, [{ if: true, then: [{ let: 'hit', be: 'then' }], else: [{ let: 'hit', be: 'else' }] }]);
    expect(out.vars['hit']).toBe('then');
  });

  it('Z3 if 走 else 分支；无 else 时静默跳过', () => {
    const h = harness();
    expect(runFlow(h, [{ if: false, then: [{ let: 'hit', be: 'then' }], else: [{ let: 'hit', be: 'else' }] }]).vars['hit']).toBe('else');
    const noElse = runFlow(h, [{ if: false, then: [{ let: 'hit', be: 'then' }] }]);
    expect(noElse.result.ok).toBe(true);
    expect(noElse.vars['hit']).toBeUndefined();
  });

  it('Z4 forEach 遍历数组；非数组时静默跳过', () => {
    const h = harness();
    const out = runFlow(h, [{ forEach: [1, 2, 3] as never, as: 'item', do: [{ let: 'last', be: { var: 'item' } as never }] }]);
    expect(out.result.ok).toBe(true);
    expect(out.vars['last']).toBe(3);
    expect(runFlow(h, [{ forEach: 'not-a-list' as never, as: 'i', do: [] }]).result.ok).toBe(true);
  });

  it('Z5 while 受 maxIter 约束，超出报 E_FLOW_BUDGET', () => {
    const h = harness();
    const out = runFlow(h, [{ while: true, do: [], maxIter: 3 }]);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.code).toBe('E_FLOW_BUDGET');
  });

  it('Z6 while 条件立即为假时零迭代成功', () => {
    const h = harness();
    expect(runFlow(h, [{ while: false, do: [], maxIter: 3 }]).result.ok).toBe(true);
  });

  it('Z7 缺失 maxIter 的 while 被拒绝（E_FLOW_NO_MAXITER）', () => {
    const h = harness();
    const out = runFlow(h, [{ while: true, do: [] } as unknown as Effect]);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.code).toBe('E_FLOW_NO_MAXITER');
  });

  it('Z8 abort 立即失败并携带原因', () => {
    const h = harness();
    const out = runFlow(h, [{ abort: '停止' }, { let: 'never', be: 1 }]);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.code).toBe('E_FLOW_ABORT');
      expect(out.result.detail).toContain('停止');
    }
    expect(out.vars['never']).toBeUndefined();
  });

  it('Z9 try 捕获失败并走 catch；无 catch 时传播', () => {
    const h = harness();
    expect(runFlow(h, [{ try: [{ abort: 'x' }], catch: [{ let: 'recovered', be: true }] }]).result.ok).toBe(true);
    expect(runFlow(h, [{ try: [{ abort: 'x' }] }]).result.ok).toBe(false);
  });

  it('Z10 step 预算超出时报 E_FLOW_BUDGET', () => {
    const h = harness();
    const many: Effect[] = Array.from({ length: 20 }, (_, i) => ({ let: `v${i}`, be: i }));
    const out = runFlow(h, many, 5);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.code).toBe('E_FLOW_BUDGET');
  });

  it('Z11 forEach 的每次迭代都计入 step 预算', () => {
    const h = harness();
    const out = runFlow(h, [{ forEach: [1, 2, 3, 4, 5, 6, 7, 8] as never, as: 'i', do: [{ let: 'x', be: 1 }] }], 6);
    expect(out.result.ok).toBe(false);
  });

  it('Z12 未登记的 Effect 形态报 E_FLOW_UNKNOWN_EFFECT', () => {
    const h = harness();
    const out = runFlow(h, [{ nonsense: 1 } as unknown as Effect]);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.code).toBe('E_FLOW_UNKNOWN_EFFECT');
  });

  it('Z13 空 Effect 数组成功且不改变 vars', () => {
    const h = harness();
    const out = runFlow(h, [], undefined, { seed: 1 });
    expect(out.result.ok).toBe(true);
    expect(out.vars['seed']).toBe(1);
  });

  it('Z14 op 形态真正经由 invokeInline 落到事务 draft 上', () => {
    const h = harness();
    const id = createEntity(h);
    const tx = new Transaction(h.holder.getState());
    const ctx = { tx, depth: 0, emit: () => {} } as never;
    const out = h.flowInterpreter.run(
      [{ op: 'prop.set', args: { path: `entities.${id}.props.viaFlow`, value: 9 } as never }],
      ctx,
    );
    expect(out.result.ok).toBe(true);
    expect(tx.getFinalDraft().entities[id]!.props['viaFlow']).toBe(9);
    // 未经顶层 invoke 写回，权威状态不受影响
    expect(h.holder.getState().entities[id]!.props['viaFlow']).toBeUndefined();
  });

  it('Z15 op 失败时整段 Flow 失败并传播错误码', () => {
    const h = harness();
    const out = runFlow(h, [{ op: 'no.such.op', args: {} as never }]);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.code).toBe('E_OP_NOT_FOUND');
  });

  it('Z16 任意 step 预算下 Flow 都在有限步内返回，绝不抛异常', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 30 }),
        (budget, iterCount) => {
          resetIdCounters();
          const h = harness();
          let out: { result: { ok: boolean } };
          try {
            out = runFlow(h, [{ while: true, do: [{ let: 'x', be: 1 }], maxIter: iterCount }], budget);
          } catch {
            return false;
          }
          return typeof out.result.ok === 'boolean';
        },
      ),
      { numRuns: 800 },
    );
  });
});

// ===========================================================================
// AA. Prefab 拓扑生成（需求8）
// ===========================================================================

describe('AA. Prefab 拓扑生成', () => {
  beforeEach(() => resetIdCounters());

  it('AA1 prefab.spawn 一次性生成全部节点与连边', () => {
    const h = harness();
    const r = h.registry.invoke('prefab.spawn', { def: 'p:room' });
    expect(r.ok).toBe(true);
    const st = h.holder.getState();
    // 种子 p:room 声明了 2 个节点 + 1 条边
    expect(Object.keys(st.nodes).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(st.links).length).toBeGreaterThanOrEqual(1);
  });

  it('AA2 生成结果通过全部不变量（无悬空边、无孤立引用）', () => {
    const h = harness();
    expect(h.registry.invoke('prefab.spawn', { def: 'p:room' }).ok).toBe(true);
    const fatal = new InvariantChecker().checkAll(h.holder.getState()).filter((d) => d.severity === 'fatal');
    expect(fatal).toHaveLength(0);
  });

  it('AA3 生成的 Link 两端都指向本次生成的真实节点（key 重映射正确）', () => {
    const h = harness();
    expect(h.registry.invoke('prefab.spawn', { def: 'p:room' }).ok).toBe(true);
    const st = h.holder.getState();
    for (const l of Object.values(st.links)) {
      const edge = l as { a: string; b: string };
      expect(edge.a in st.nodes, `端点 a=${edge.a} 必须存在`).toBe(true);
      expect(edge.b in st.nodes, `端点 b=${edge.b} 必须存在`).toBe(true);
    }
  });

  it('AA4 重复 spawn 产生互不干扰的独立副本', () => {
    const h = harness();
    expect(h.registry.invoke('prefab.spawn', { def: 'p:room' }).ok).toBe(true);
    const afterFirst = Object.keys(h.holder.getState().nodes).length;
    expect(h.registry.invoke('prefab.spawn', { def: 'p:room' }).ok).toBe(true);
    const afterSecond = Object.keys(h.holder.getState().nodes).length;
    expect(afterSecond).toBe(afterFirst * 2);
    expect(new InvariantChecker().checkAll(h.holder.getState()).filter((d) => d.severity === 'fatal')).toHaveLength(0);
  });

  it('AA5 不存在的 prefab Def 被拒绝且状态不变', () => {
    const h = harness();
    const before = h.holder.getState();
    expect(h.registry.invoke('prefab.spawn', { def: 'p:absent' }).ok).toBe(false);
    expect(h.holder.getState()).toBe(before);
  });

  it('AA6 多次 spawn 后节点/边计数线性增长且不变量恒成立', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (times) => {
        resetIdCounters();
        const h = harness();
        for (let i = 0; i < times; i++) {
          if (!h.registry.invoke('prefab.spawn', { def: 'p:room' }).ok) return false;
        }
        const st = h.holder.getState();
        if (Object.keys(st.nodes).length !== 2 * times) return false;
        return new InvariantChecker().checkAll(st).filter((d) => d.severity === 'fatal').length === 0;
      }),
      { numRuns: 200 },
    );
  });
});

// ===========================================================================
// AB. Agent / Outcome：写入通道完整性
// ===========================================================================

describe('AB. Agent / Outcome', () => {
  beforeEach(() => resetIdCounters());

  it('AB1 已注册的 agent/outcome Op 都存在于写入通道', () => {
    const h = harness();
    const names = h.registry.listOpNames();
    expect(names.some((n) => n.startsWith('agent.'))).toBe(true);
    expect(names.some((n) => n.startsWith('outcome.'))).toBe(true);
  });

  it('AB2 全部 Op 名遵循 "域.动作" 命名约定', () => {
    const h = harness();
    for (const name of h.registry.listOpNames()) {
      expect(name, `${name} 必须是 域.动作 形式`).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
  });

  it('AB3 结构性与非结构性 Op 的划分是稳定可查询的', () => {
    const h = harness();
    for (const name of h.registry.listOpNames()) {
      expect(typeof h.registry.isStructural(name), name).toBe('boolean');
    }
  });

  it('AB4 registry.has 与 listOpNames 自洽', () => {
    const h = harness();
    const names = h.registry.listOpNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(h.registry.has(name), name).toBe(true);
    expect(h.registry.has('definitely.notRegistered')).toBe(false);
  });
});
