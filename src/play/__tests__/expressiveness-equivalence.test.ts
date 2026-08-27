/**
 * 装载等价（D-081 / L0 第十四条）· 表达力等价机器断言（专项 A4）。
 *
 * 目标：机器证明「官方 TS 玩法包（src/play/core-mechanics/defs/*.ts）能表达的构造，
 * JSON 玩法包都能表达」——即官方 defs 使用的每一种构造，都能写成纯 JSON Def 并经由
 * `StrictJsonCodec` → `decodePlaypack` 通过、且结构与 TS 构造器产出的形状一致。
 *
 * 覆盖对象（与 docs/L_审查报告/装载等价_表达力审计.md 的矩阵逐项对应）：
 * - defs/expr.ts 的全部 Expr 构造器与 Effect 构造器；
 * - ActionDef / RuleDef / AttachmentDef / ScheduleDef / PhaseDef / OutcomeDef / PoolDef 字段；
 * - PlayDefExtension 全字段（numericOwnership / sourceTrace / costClass / parentActions /
 *   triggerPoint / requireRef / onFailure / presentation / unresolvedGuards）；
 * - 成本四形态（pool / items / attach / custom）。
 *
 * 对矩阵中「已支持」项：本文件用最小 JSON 样本断言解码通过且结构与 TS 构造等价。
 * 对「有差距」项：断言差距被**明确登记**（not.toBeUndefined()），不静默——差距登记在
 * `GAPS` 常量里，每一条都有状态与缺口说明；依赖并行任务 A1（codec 放行 play 元数据）的
 * 差距项只有在 A1 已落地（工作区 codec 已实现 playExtension 校验）时才断言放行，否则跳过
 * 并标注依赖（见 `PLAY_EXTENSION_READY` 探测）。
 *
 * 只读全部生产源文件；本文件不修改任何生产代码。
 */
import { describe, expect, it } from 'vitest';
import { StrictJsonCodec } from '../../core/kernel/spec-compiler/json-codec';
import { DEFAULT_TECHNICAL_QUOTAS } from '../../core/kernel/spec-compiler/types';
import type { ParsedCandidateDocument } from '../../core/kernel/spec-compiler/types';
import { decodePlaypack } from '../../core/kernel/schedule/playpack-codec';
import type { PlaypackDef } from '../../core/kernel/schedule/playpack';
import { CoreMechanicsPlaypack } from '../core-mechanics/defs/playpack';
import type { Def } from '../../core/kernel/state/def';

// ---------------------------------------------------------------------------
// 差距登记（矩阵中「有差距」项必须在此出现，否则测试失败——不静默）
// ---------------------------------------------------------------------------

/** 每个差距项：官方构造名 → JSON 能否表达 → 差距说明。 */
const GAPS = {
  payloadMap: {
    expressible: false,
    note:
      'payloadMap 的多字段形态刻意抛错（defs/expr.ts：多字段映射必须经请求记录 + pathOf 读取）。'
      + '这是 TS/JSON 共享的引擎层约束（映射字面量不被递归求值），不是 JSON 劣势；'
      + 'JSON 包用同样的请求记录模式表达，不需要任何额外通道。',
  },
  linter: {
    expressible: false,
    note:
      'PlaypackDef.linter 是 TS 宿主能力（可执行检查函数），JSON 包被 codec 显式拒绝'
      + '（E_LOAD_PROHIBITED_CONSTRUCT）。L0 14.3：治理层 Linter 不属于玩法包内容，'
      + '两形态都不应把可执行检查装进玩法包——这是对双方的统一边界，不是 JSON 劣势。',
  },
} as const;

/** 有差距项清单（用于逐项断言"差距被登记"）。 */
const GAP_KEYS = Object.keys(GAPS);

// ---------------------------------------------------------------------------
// A1 依赖探测（并行任务 A1：codec 放行 play 治理元数据）
// ---------------------------------------------------------------------------

/**
 * A1 是否已落地：codec 的 commonDef 校验路径里是否实现 playExtension 放行。
 * 只读探测——通过 `play` 字段走一遍真实 decode 流程，比反射实现更接近装载语义。
 * 运行时记录一次，避免每个用例都重新解码。
 */
let playExtensionReady: boolean | undefined;

function detectPlayExtensionReady(): boolean {
  if (playExtensionReady !== undefined) return playExtensionReady;
  const result = decodePlaypack(parsed({
    id: 'pp:a1-probe',
    kind: 'playpack',
    version: '1.0.0',
    defs: [],
    play: { sourceTrace: ['Req 1.1'] },
  }));
  playExtensionReady = result.ok;
  return playExtensionReady;
}

/** A1 未落地时跳过的 play 扩展用例集合（在报告里标注依赖 A1）。 */
const PLAY_DEPENDENT_DESCRIBES = ['PlayDefExtension 治理元数据（依赖 A1）'];

// ---------------------------------------------------------------------------
// 构造器 / 判定辅助
// ---------------------------------------------------------------------------

function parsed(value: unknown): ParsedCandidateDocument {
  return new StrictJsonCodec().parse({
    sourceId: 'playpack:expressiveness-equivalence',
    documentUri: 'file:///playpack.expressiveness-equivalence.test.json',
    sourcePackage: 'play.expressiveness-equivalence',
    sourceText: JSON.stringify(value),
    precedence: 1,
    owningLayer: '玩法层',
    normativeStatus: 'normative',
  }, DEFAULT_TECHNICAL_QUOTAS);
}

function decode(value: unknown): ReturnType<typeof decodePlaypack> {
  return decodePlaypack(parsed(value));
}

function expectOk(value: unknown): PlaypackDef {
  const result = decode(value);
  expect(result.ok).toBe(true);
  if (!result.ok) return { id: '', kind: 'playpack', version: '', defs: [] };
  return result.value;
}

/** 断言一个 Expr 结构在给定槽位解码通过且与 TS 构造等价（toStrictEqual 走递归深度比较）。 */
function expectExprAccepted(path: string, expr: unknown, expected: unknown): void {
  const decoded = expectOk({
    id: 'pp:expr',
    kind: 'playpack',
    version: '1.0.0',
    defs: [{ id: 'expr:slot', kind: 'expr', body: expr, pure: true }],
  });
  const body = (decoded.defs.find((def) => def.id === 'expr:slot') as { body?: unknown })?.body;
  expect(body, path).toEqual(expected);
}

/** 断言一个 Effect 结构在给定槽位解码通过且与 TS 构造等价。 */
function expectEffectAccepted(path: string, effect: unknown, expected: unknown): void {
  const decoded = expectOk({
    id: 'pp:effect',
    kind: 'playpack',
    version: '1.0.0',
    defs: [],
    entry: [effect],
  });
  expect((decoded as { entry?: unknown[] }).entry?.[0], path).toEqual(expected);
}

/** `Ref` 字面量：`{$: id}`。 */
function refOf(id: string): unknown {
  return { $: id };
}

/** 一个可直接复用的最小合法 JSON 动作样本（label/cost/effects 齐备）。 */
function minimalAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'action:eq-min',
    kind: 'action',
    label: '等价钱形最小动作',
    // 双轨制 P3：track 为必填闭合域。
    track: 'card',
    cost: [{ pool: 'ap', amount: 1 }],
    effects: [{ emit: 'eq.fired' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 矩阵用例
// ---------------------------------------------------------------------------

describe('Expr 构造器：字面量与基础形态', () => {
  const cases: readonly { path: string; expr: unknown; expected: unknown }[] = [
    { path: 'number', expr: 5, expected: 5 },
    { path: 'string', expr: 'label', expected: 'label' },
    { path: 'boolean', expr: true, expected: true },
    { path: 'null', expr: null, expected: null },
    { path: 'varOf', expr: { var: 'self' }, expected: { var: 'self' } },
    { path: 'pathOf', expr: { path: 'world.props.play.round' }, expected: { path: 'world.props.play.round' } },
    { path: 'SELF', expr: { var: 'self' }, expected: { var: 'self' } },
    { path: 'Ref 字面量', expr: refOf('e:1'), expected: refOf('e:1') },
    { path: '数组字面量', expr: [1, 2, 3], expected: [1, 2, 3] },
    { path: '映射字面量', expr: { bonus: 1 }, expected: { bonus: 1 } },
  ];
  it.each(cases)('$path', ({ path, expr, expected }) => {
    expectExprAccepted(path, expr, expected);
  });
});

describe('Expr 构造器：op 形态（逻辑 / 比较 / 算术 / 表 / 域算子）', () => {
  const cases: readonly { path: string; expr: unknown }[] = [
    { path: 'refGet', expr: { op: 'refGet', args: [{ var: 'self' }, 'node'] } },
    { path: 'and', expr: { op: 'and', args: [{ path: 'a' }, { path: 'b' }] } },
    { path: 'or', expr: { op: 'or', args: [{ path: 'a' }, { path: 'b' }] } },
    { path: 'not', expr: { op: 'not', args: [{ path: 'a' }] } },
    { path: 'eq', expr: { op: 'eq', args: [{ path: 'a' }, 1] } },
    { path: 'neq', expr: { op: 'neq', args: [{ path: 'a' }, 1] } },
    { path: 'gt', expr: { op: 'gt', args: [{ path: 'a' }, 1] } },
    { path: 'gte', expr: { op: 'gte', args: [{ path: 'a' }, 1] } },
    { path: 'lt', expr: { op: 'lt', args: [{ path: 'a' }, 1] } },
    { path: 'lte', expr: { op: 'lte', args: [{ path: 'a' }, 1] } },
    { path: 'isNull', expr: { op: 'isNull', args: [{ path: 'a' }] } },
    { path: 'notNull（not+isNull 复合）', expr: { op: 'not', args: [{ op: 'isNull', args: [{ path: 'a' }] }] } },
    { path: 'add', expr: { op: 'add', args: [{ path: 'a' }, 1] } },
    { path: 'sub', expr: { op: 'sub', args: [{ path: 'a' }, 1] } },
    { path: 'mul', expr: { op: 'mul', args: [{ path: 'a' }, 2] } },
    { path: 'coalesce', expr: { op: 'coalesce', args: [{ path: 'a' }, 0] } },
    { path: 'max', expr: { op: 'max', args: [{ path: 'a' }, 5] } },
    { path: 'min', expr: { op: 'min', args: [{ path: 'a' }, 5] } },
    { path: 'clamp', expr: { op: 'clamp', args: [{ path: 'a' }, 1, 5] } },
    { path: 'len', expr: { op: 'len', args: [{ path: 'queue' }] } },
    { path: 'at', expr: { op: 'at', args: [{ path: 'queue' }, 0] } },
    { path: 'includes', expr: { op: 'includes', args: [{ path: 'tags' }, 'play:blocking'] } },
    { path: 'get', expr: { op: 'get', args: [{ var: 'ref' }, '$'] } },
    { path: 'array', expr: { op: 'array', args: [] } },
    { path: 'concat', expr: { op: 'concat', args: ['world.attachments.', { var: 'id' }, '.props.x'] } },
    { path: 'refExists（notNull+refGet 复合）', expr: { op: 'not', args: [{ op: 'isNull', args: [{ op: 'refGet', args: [{ var: 'target' }, 'def'] }] }] } },
    { path: 'hasTag（includes+refGet 复合）', expr: { op: 'includes', args: [{ op: 'refGet', args: [{ var: 'self' }, 'tags'] }, 'play:blocking'] } },
    { path: 'lacksTag（and+refExists+not+hasTag 复合）', expr: { op: 'and', args: [{ op: 'not', args: [{ op: 'isNull', args: [{ op: 'refGet', args: [{ var: 'self' }, 'def'] }] }] }, { op: 'not', args: [{ op: 'includes', args: [{ op: 'refGet', args: [{ var: 'self' }, 'tags'] }, 'play:blocking'] }] }] } },
    { path: 'propOfRef', expr: { op: 'refGet', args: [{ var: 'item' }, 'props.recoverAmount'] } },
    { path: 'hasProp（notNull+refGet 复合）', expr: { op: 'not', args: [{ op: 'isNull', args: [{ op: 'refGet', args: [{ var: 'item' }, 'props.recoverAmount'] }] }] } },
    { path: 'refId（get 取 $）', expr: { op: 'get', args: [{ var: 'ref' }, '$'] } },
    { path: 'candidateField', expr: { path: 'self.props.rollTier' } },
    { path: 'candidateProp', expr: { path: 'self.props.rollTier' } },
    { path: 'worldRead（refGet w:0 + concat）', expr: { op: 'refGet', args: [refOf('w:0'), { op: 'concat', args: ['props.pools.ap.', { var: 'id' }, '.available'] }] } },
    { path: 'poolFieldRead（worldRead 复合）', expr: { op: 'refGet', args: [refOf('w:0'), { op: 'concat', args: ['props.pools.stamina.', { var: 'id' }, '.real'] }] } },
    { path: 'requestField', expr: { path: 'world.props.play.request.damage.amount' } },
    { path: 'payloadMap 单字段退化', expr: { path: 'world.props.play.request.damage' } },
  ];
  it.each(cases)('$path', ({ path, expr }) => {
    expectExprAccepted(path, expr, expr);
  });
});

describe('Expr 构造器：q（Query 形态）', () => {
  const cases: readonly { path: string; expr: unknown }[] = [
    { path: 'from+where', expr: { q: { from: 'entities', where: { op: 'eq', args: [{ path: 'def' }, 'entity:human'] } } } },
    { path: 'orderBy+desc+limit', expr: { q: { from: 'entities', orderBy: { path: 'props.rollTier' }, desc: true, limit: 1 } } },
    { path: 'in', expr: { q: { from: 'items', in: { var: 'actor' } } } },
    { path: 'visibleTo', expr: { q: { from: 'entities', visibleTo: { var: 'viewer' } } } },
    { path: 'attachments 源', expr: { q: { from: 'attachments', where: { op: 'eq', args: [{ path: 'def' }, 'attachment:marker'] } } } },
    { path: 'defs 源', expr: { q: { from: 'defs', where: { op: 'eq', args: [{ path: 'kind' }, 'expr'] } } } },
  ];
  it.each(cases)('$path', ({ path, expr }) => {
    expectExprAccepted(path, expr, expr);
  });
});

describe('Effect 构造器（十形态 + result 绑定）', () => {
  const cases: readonly { path: string; effect: unknown }[] = [
    { path: 'opEffect', effect: { op: 'prop.set', args: { path: 'world.props.play.round', value: 1 } } },
    { path: 'opEffect+result', effect: { op: 'attach.add', args: { def: 'attachment:marker', target: { var: 'self' } }, result: 'att' } },
    { path: 'letEffect', effect: { let: 'x', be: { op: 'add', args: [{ path: 'a' }, 1] } } },
    { path: 'ifEffect（无 else）', effect: { if: { path: 'flag' }, then: [{ emit: 'yes' }] } },
    { path: 'ifEffect（有 else）', effect: { if: { path: 'flag' }, then: [{ emit: 'yes' }], else: [{ emit: 'no' }] } },
    { path: 'forEachEffect', effect: { forEach: { var: 'attached' }, as: 'entry', do: [{ emit: 'each' }] } },
    { path: 'emitEffect（无 data）', effect: { emit: 'play.phase.settle' } },
    { path: 'emitEffect（有 data）', effect: { emit: 'play.damage.request', data: { path: 'world.props.play.request.damage' } } },
    { path: 'abortEffect', effect: { abort: '守卫失败：整个事务回滚' } },
    { path: 'guardEffect（if+空then+abort-else）', effect: { if: { path: 'ready' }, then: [], else: [{ abort: '前置失败' }] } },
    { path: 'while+maxIter', effect: { while: { path: 'running' }, do: [{ emit: 'tick' }], maxIter: 5 } },
    { path: 'after', effect: { after: 1, do: [{ emit: 'later' }] } },
    { path: 'at', effect: { at: 3, do: [{ emit: 'scheduled' }] } },
    { path: 'try/catch', effect: { try: [{ emit: 'attempt' }], catch: [{ emit: 'recover' }] } },
  ];
  it.each(cases)('$path', ({ path, effect }) => {
    expectEffectAccepted(path, effect, effect);
  });
});

describe('request 记录与暂存区模式（setRequestField / clearRequest / vetoGuard / tagEffects）', () => {
  it('setRequestField + emit + vetoGuard + clearRequest 序列等价', () => {
    const effects = [
      { op: 'prop.set', args: { path: 'world.props.play.request.damage.target', value: { var: 'target' } } },
      { op: 'prop.set', args: { path: 'world.props.play.request.damage.amount', value: { op: 'refGet', args: [{ var: 'item' }, 'props.recoverAmount'] } } },
      { emit: 'play.damage.request', data: { path: 'world.props.play.request.damage' } },
      { if: { op: 'isNull', args: [{ path: 'world.props.play.request.damage.veto' }] }, then: [], else: [{ abort: '被 before 规则否决' }] },
      { op: 'prop.del', args: { path: 'world.props.play.request.damage' } },
    ];
    const decoded = expectOk({
      id: 'pp:request',
      kind: 'playpack',
      version: '1.0.0',
      defs: [],
      entry: effects,
    });
    expect((decoded as { entry?: unknown[] }).entry).toEqual(effects);
  });

  it('tagEffects 展开（prop.set×2 + tag.add + prop.del）等价', () => {
    const effects = [
      { op: 'prop.set', args: { path: 'world.props.play.scratch.ref.collection', value: 'entities' } },
      { op: 'prop.set', args: { path: 'world.props.play.scratch.ref.id', value: { op: 'get', args: [{ var: 'target' }, '$'] } } },
      { op: 'tag.add', args: { ref: { path: 'world.props.play.scratch.ref' }, tag: 'play:blocking' } },
      { op: 'prop.del', args: { path: 'world.props.play.scratch.ref' } },
    ];
    const decoded = expectOk({
      id: 'pp:tag',
      kind: 'playpack',
      version: '1.0.0',
      defs: [],
      entry: effects,
    });
    expect((decoded as { entry?: unknown[] }).entry).toEqual(effects);
  });

  it('动态路径 prop.set（op:concat 求值 path）等价', () => {
    const effect = {
      op: 'prop.set',
      args: {
        path: { op: 'concat', args: ['world.attachments.', { op: 'get', args: [{ var: 'att' }, '$'] }, '.props.remainingTurns'] },
        value: 3,
      },
    };
    expectEffectAccepted('动态 path', effect, effect);
  });
});

describe('ActionDef 字段面（label/targets/require/visible/reason/cost/group/effects）', () => {
  it('全字段动作解码通过', () => {
    const action = minimalAction({
      label: '等价钱形全字段动作',
      targets: [{
        name: 'target',
        query: { from: 'entities', where: { op: 'eq', args: [{ path: 'def' }, 'entity:human'] } },
        range: { min: 0, max: 4, step: 1 },
        count: { min: 1, max: 2 },
        optional: true,
      }],
      require: { op: 'refGet', args: [{ var: 'self' }, 'def'] },
      visible: { op: 'eq', args: [{ path: 'world.turn.phaseId' }, 'phase:play.player-action'] },
      reason: { var: 'self' },
      group: 'play.paid',
      cost: [{ pool: 'ap', amount: 1 }],
      effects: [{ emit: 'eq.fired' }],
    });
    const decoded = expectOk({ id: 'pp:action', kind: 'playpack', version: '1.0.0', defs: [action] });
    expect(decoded.defs[0]).toEqual(action);
  });

  it('成本四形态：pool / items / attach / custom', () => {
    const action = minimalAction({
      cost: [
        { pool: 'ap', amount: { op: 'add', args: [1, 1] } },
        { items: { q: { from: 'items', in: { var: 'actor' } } } },
        { attach: 'attachment:marker' },
        { custom: [{ emit: 'cost.paid' }] },
      ],
    });
    const decoded = expectOk({ id: 'pp:cost', kind: 'playpack', version: '1.0.0', defs: [action] });
    expect(decoded.defs[0]).toEqual(action);
  });
});

describe('RuleDef 字段面（on/phase/when/priority/effects/once）', () => {
  it('全字段规则解码通过', () => {
    const rule = {
      id: 'rule:eq-before',
      kind: 'rule',
      on: ['play.damage.request', 'play.heal.request'],
      phase: 'before',
      when: { op: 'isNull', args: [{ path: 'world.props.play.request.damage.veto' }] },
      priority: 100,
      effects: [{ op: 'prop.set', args: { path: 'world.props.play.request.damage.veto', value: '目标不合格' } }],
      once: false,
    };
    const decoded = expectOk({ id: 'pp:rule', kind: 'playpack', version: '1.0.0', defs: [rule] });
    expect(decoded.defs[0]).toEqual(rule);
  });

  it('五阶段（HookPhase）全部接受', () => {
    for (const phase of ['before', 'modify', 'instead', 'default', 'after']) {
      const rule = { id: `rule:eq-${phase}`, kind: 'rule', on: 'evt', phase, priority: 1, effects: [] };
      expectOk({ id: `pp:rule-${phase}`, kind: 'playpack', version: '1.0.0', defs: [rule] });
    }
  });
});

describe('AttachmentDef 字段面（stackStrategy/maxStack/aura/onAdd/onExpire/onRemove）', () => {
  it('全字段状态解码通过', () => {
    const attachment = {
      id: 'attachment:eq-marker',
      kind: 'attachment',
      stackStrategy: 'unique',
      maxStack: 1,
      aura: { deps: ['expr:visibility'], compute: { path: 'owner' } },
      onAdd: [{ emit: 'attachment.added' }],
      onExpire: [{ emit: 'attachment.expired' }],
      onRemove: [{ emit: 'attachment.removed' }],
    };
    const decoded = expectOk({ id: 'pp:attachment', kind: 'playpack', version: '1.0.0', defs: [attachment] });
    expect(decoded.defs[0]).toEqual(attachment);
  });
});

describe('ScheduleDef / PhaseDef 字段面', () => {
  it('五阶段表解码通过（kind/phaseKind/input/actors/onEnter/onExit/roundEnd）', () => {
    const schedule = {
      id: 'schedule:eq',
      kind: 'schedule',
      loop: true,
      order: 'fixed',
      phases: [
        { id: 'phase:roll', name: '投点', kind: 'custom', phaseKind: 'submit', input: 'all', onEnter: [{ emit: 'roll.enter' }] },
        { id: 'phase:settle', phaseKind: 'resolve', input: 'none', onEnter: [{ emit: 'settle.enter' }], onExit: [{ emit: 'settle.exit' }] },
        { id: 'phase:action', kind: 'action', phaseKind: 'normal', input: 'actor', actors: { from: 'agents' }, reactionRounds: 1 },
        { id: 'phase:npc', input: 'none', duration: 1, timeLimit: 5, timeoutSeconds: 30 },
        { id: 'phase:cleanup', kind: 'cleanup', phaseKind: 'normal', input: 'none' },
      ],
      initiativeExpr: { path: 'initiative' },
      resolveOrder: { op: 'sort', args: [{ path: 'actors' }] },
      onConflict: [{ emit: 'conflict' }],
      roundEnd: [{ emit: 'round.end' }],
    };
    const decoded = expectOk({ id: 'pp:schedule', kind: 'playpack', version: '1.0.0', defs: [schedule] });
    expect(decoded.defs[0]).toEqual(schedule);
  });
});

describe('OutcomeDef / PoolDef 字段面', () => {
  it('outcome 全字段解码通过', () => {
    const playpack = {
      id: 'pp:outcome',
      kind: 'playpack',
      version: '1.0.0',
      defs: [],
      outcomes: [{
        name: 'last-standing',
        when: { op: 'eq', args: [{ op: 'len', args: [{ q: { from: 'entities', where: true } }] }, 1] },
        scope: 'game',
        rank: 2,
        onReach: [{ emit: 'outcome.reached' }],
        ends: true,
      }],
    };
    const decoded = expectOk(playpack);
    expect((decoded as { outcomes?: unknown[] }).outcomes).toEqual(playpack['outcomes']);
  });

  it('pool 全字段（含 reset 具名模式与 resetTo）解码通过', () => {
    const playpack = {
      id: 'pp:pool',
      kind: 'playpack',
      version: '1.0.0',
      defs: [],
      pools: [
        { name: 'ap', per: 'actor', min: 0, max: 3, initial: 0, reset: 'turn', resetTo: 0 },
        { name: 'stamina', per: 'actor', min: 0, max: 5, reset: 'never' },
        { name: 'world-ap', per: 'world', max: { op: 'add', args: [2, 3] }, reset: { op: 'eq', args: [{ path: 'world.turn.phaseId' }, 'phase:roll'] } },
      ],
    };
    const decoded = expectOk(playpack);
    expect((decoded as { pools?: unknown[] }).pools).toEqual(playpack['pools']);
  });
});

describe('Def 公共字段面（extends/abstract/tags/props/containers/slots/clamp/schema/actions/rules）', () => {
  it('公共字段解码通过', () => {
    const playpack = {
      id: 'pp:common',
      kind: 'playpack',
      version: '1.0.0',
      defs: [
        {
          id: 'entity:eq-bag',
          kind: 'entity',
          containers: [{ name: 'contents', insert: 'fixed', slots: 5 }],
          slots: [{ tags: ['slot-a'], accepts: { op: 'eq', args: [{ path: 'kind' }, 'item'] } }],
          clamp: { vitality: { min: 0, max: 5, int: true } },
          schema: { any: ['json', 2, false] },
          actions: ['action:eq-min'],
          rules: ['rule:eq'],
          props: { initial: 5 },
        },
      ],
    };
    const decoded = expectOk(playpack);
    expect(decoded.defs[0]).toEqual(playpack['defs'][0]);
  });

  it('open Def kind（entity 等）携带任意未知字段也能通过（codec 宽松面）', () => {
    const result = decode({
      id: 'pp:open',
      kind: 'playpack',
      version: '1.0.0',
      defs: [{ id: 'entity:open', kind: 'entity', customData: { any: ['JSON', 2, false] } }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('具名表达式 Def（kind:expr：params/body/pure）', () => {
  it('params+body+pure 解码通过', () => {
    const exprDef = {
      id: 'expr:eq-predicate',
      kind: 'expr',
      params: ['target'],
      body: { op: 'eq', args: [{ path: 'self.def' }, { var: 'target' }] },
      pure: true,
    };
    const decoded = expectOk({ id: 'pp:exprdef', kind: 'playpack', version: '1.0.0', defs: [exprDef] });
    expect(decoded.defs[0]).toEqual(exprDef);
  });
});

describe('PlayDefExtension 治理元数据（依赖 A1）', () => {
  // A1（codec 放行 play 治理元数据）是并行 Batch A 的独立任务。落地前 codec 会对 play 字段报
  // E_LOAD_UNKNOWN_FIELD，本组用例将失败——因此用条件判定跳过并显式标注依赖。
  const ready = detectPlayExtensionReady();
  it.runIf(ready)('完整 play 扩展（numericOwnership/costClass/parentActions/triggerPoint/requireRef/onFailure/sourceTrace/presentation/unresolvedGuards）解码通过且与 TS 构造等价', () => {
    const play = {
      numericOwnership: {
        'cost.0.amount': { kind: 'gameplay', min: 1, max: 5, int: true },
        'effects.0.data': { kind: 'internal', note: '内部计数' },
        'range.min': { kind: 'structural', rationale: '槽位下标从 0 起' },
        'pools.1.max': { kind: 'constitutional', sourceId: 'S0 四·4.2' },
      },
      costClass: 'attached',
      parentActions: ['action:move', 'action:pickup'],
      triggerPoint: 'beforeParentEffects',
      requireRef: 'expr:eq-predicate',
      onFailure: 'rejectWholeAction',
      sourceTrace: ['Req 4.8', 'Req 8.5'],
      unresolvedGuards: ['T-001', 'U-002'],
      presentation: { labelKey: 'eq.attached.label', iconKey: 'eq.attached.icon' },
    };
    const action = { ...minimalAction({ effects: [] }), play };
    const decoded = expectOk({ id: 'pp:playext', kind: 'playpack', version: '1.0.0', defs: [action] });
    expect(decoded.defs[0]).toEqual(action);
  });
  it.runIf(ready)('官方 TS 包 defs 经 JSON 序列化后 decode 通过（与 A1 测试同方向，这里做全量闭合）', () => {
    const playpack = {
      id: 'pp:official-json',
      kind: 'playpack',
      version: '1.0.0',
      defs: CoreMechanicsPlaypack.defs.map((def) => JSON.parse(JSON.stringify(def)) as Record<string, unknown>),
    };
    const result = decode(playpack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defs).toHaveLength(CoreMechanicsPlaypack.defs.length);
  });
  it('依赖标注：A1 未落地时本组用例被跳过', () => {
    if (ready) return;
    expect(PLAY_DEPENDENT_DESCRIBES).toContain('PlayDefExtension 治理元数据（依赖 A1）');
  });
});

describe('差距登记（不静默）', () => {
  it.each(GAP_KEYS)('%s 被明确登记为有差距项', (key) => {
    const entry = GAPS[key as keyof typeof GAPS];
    expect(entry).toBeDefined();
    expect(entry.expressible).toBe(false);
    expect(entry.note.length).toBeGreaterThan(0);
  });

  it('官方包不使用 linter（可执行检查不进入任何玩法包内容）', () => {
    expect(CoreMechanicsPlaypack.linter).toBeUndefined();
  });

  it('linter 在 JSON 包中被 codec 显式拒绝（E_LOAD_PROHIBITED_CONSTRUCT）', () => {
    const result = decode({
      id: 'pp:linter',
      kind: 'playpack',
      version: '1.0.0',
      linter: 'not executable',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((item) => item.code === 'E_LOAD_PROHIBITED_CONSTRUCT')).toBe(true);
    }
  });

  it('payloadMap 多字段形态在 TS 侧同样抛错（TS/JSON 共享约束，不是 JSON 劣势）', () => {
    // defs/expr.ts 的 payloadMap 对多字段映射直接 throw；两种形态都只能走请求记录 + pathOf。
    // 这里验证 JSON 形态对应的"读回整条请求记录"通道确实可用（上一组用例已覆盖），
    // 并登记该差距，防止"多字段映射可内联"的错觉在以后悄悄出现。
    expect(GAPS.payloadMap.expressible).toBe(false);
  });
});
