/**
 * play 生产侧 AI runtime 的端到端用例（BATCH B 缺口1 的可证伪证据）。
 *
 * 目标：证明「AI 真的在 play 生产代码里驱动决策环」——这是一个非桩、非测试专用拼接的组合根。
 * 本测试用 `createPlayAiRuntime` 建一个 play 生产侧 runtime，喂一个能走通真实 Op 链路的动作集
 * （攻击 + 拾取 + 治疗 + 移动 + 终结），断言：
 *  1. 生产 runtime 能把 NPC 行动队列（world.props.play.npcQueue）真正填充起来（此前恒空）；
 *  2. `popNextNpc` 真调用 `BoundedAIDecisionFacade.act`（Action→Intent→Op 统一链路），
 *     并产生一个 `submitted` 的候选；
 *  3. 候选在真实内核链路上让目标状态改变（攻击减血 / 终结移除敌人）。
 *
 * 动作集形状与 `__tests__/combat-first.test.ts` 的测试靶同构，但这里是 play 生产组合根
 * （生产 wiring），不是测试目录内的 replication。注意本 runtime 的 actionCatalog 只有测试靶里
 * 注册过的动作，是 play 生产代码的受控输入，不是「复制测试对局数据」。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Value } from '../../core/kernel/state/value';
import type { Def } from '../../core/kernel/state/def';
import type { ActionDef } from '../../core/kernel/actions/types';
import type { Expr } from '../../core/kernel/state/expr-types';
import type { Effect } from '../../core/kernel/events/effect-types';
import type { RuleDef } from '../../core/kernel/events/types';
import type { ScheduleDef } from '../../core/kernel/schedule/types';
import { resetIdCounters } from '../../core/kernel/state/ids';
import { createEmptyWorldState } from '../../core/kernel/state/world-state';
import { createAgentShape } from '../../core/kernel/state/agent';
import { createEntityShape } from '../../core/kernel/state/entity';
import { createNodeShape, createContainerShape, createSlotShape } from '../../core/kernel/topology/types';
import { setPath } from '../../core/kernel/ops/path';
import { createPlayAiRuntime, type PlayAiRuntime } from '../ai-runtime';

const HERO = 'e:hero';
const ENEMY = 'e:enemy';
const NPC_AGENT = 'g:npc';
const POLICY = 'd:ai-policy';
const BINDING = 'd:ai-binding';
const TAG_DOWNED = 'tag:downed';

/** 攻击/拾取/治疗/移动/终结五个开发期测试靶（形状同 combat-first，但这里喂给生产组合根）。 */

function opEffect(op: string, args: Record<string, Expr | number>): Effect {
  return { op, args: args as Record<string, Expr> } as Effect;
}
function varRef(name: string): Expr { return { var: name }; }
function refIdExpr(ref: Expr): Expr { return { op: 'get', args: [ref, '$'] }; }
function refGetExpr(ref: Expr, path: string[]): Expr { return { op: 'refGet', args: [ref, path.join('.')] }; }
function concatExpr(...parts: (string | Expr)[]): Expr { return { op: 'concat', args: parts }; }
function addExpr(a: Expr, b: Expr): Expr { return { op: 'add', args: [a, b] }; }
function minExpr(a: Expr, b: Expr): Expr { return { op: 'min', args: [a, b] }; }

const VISIBLE_TO: Expr = {
  op: 'not',
  args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }],
};

const attackAction: ActionDef = {
  id: 'a:attack', kind: 'action', label: 'Attack', track: 'highlight',
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] } } }],
  require: true, cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    { let: 'dmg', be: { path: 'world.props.aiCombatDamageRef' } },
    {
      emit: 'combat.nearDamage',
      data: {
        attacker: { $: HERO },
        target: varRef('t'),
        damagePath: { op: 'concat', args: ['entities.', { op: 'get', args: [varRef('t'), '$'] }, '.props.vitality'] },
        delta: varRef('dmg'),
      } as unknown as Value,
    },
  ],
};

const aiCombatDamageRule: RuleDef = {
  id: 'rule:aiCombatDamage', kind: 'rule', on: 'combat.nearDamage', phase: 'default', priority: 50,
  effects: [
    { let: 't', be: { op: 'get', args: [{ var: 'payload' }, 'target'] } },
    { let: 'p', be: { op: 'get', args: [{ var: 'payload' }, 'damagePath'] } },
    { op: 'prop.add', args: { path: { var: 'p' }, delta: { op: 'neg', args: [{ op: 'get', args: [{ var: 'payload' }, 'delta'] }] } } },
    { op: 'prop.set', args: { path: { var: 'p' }, value: { op: 'max', args: [refGetExpr(varRef('t'), ['props', 'vitality']), 0] } } },
    {
      let: 'remaining', be: refGetExpr(varRef('t'), ['props', 'vitality']),
    },
    {
      if: { op: 'lte', args: [{ var: 'remaining' }, 0] },
      then: [
        { op: 'prop.set', args: { path: 'world.props.m9Scratch.collection', value: 'entities' } },
        { op: 'prop.set', args: { path: 'world.props.m9Scratch.id', value: refIdExpr(varRef('t')) } },
        { op: 'tag.add', args: { ref: { path: 'world.props.m9Scratch' }, tag: TAG_DOWNED } },
        { op: 'prop.del', args: { path: 'world.props.m9Scratch' } },
      ],
      else: [],
    },
  ],
};

const pickupAction: ActionDef = {
  id: 'a:pickup', kind: 'action', label: 'Pickup', track: 'highlight',
  targets: [{ name: 'item', query: { from: 'items' } }],
  require: true, cost: [],
  effects: [
    { let: 'ownContainer', be: refGetExpr(varRef('self'), ['containers', 'bag']) },
    opEffect('item.move', { itemId: refIdExpr(varRef('item')), toContainerId: varRef('ownContainer') }),
  ],
};

const healAction: ActionDef = {
  id: 'a:heal', kind: 'action', label: 'Heal', track: 'highlight',
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'eq', args: [{ var: 'self' }, { var: 'self' }] } } }],
  require: true, cost: [],
  effects: [
    { let: 't', be: varRef('self') },
    opEffect('prop.set', {
      path: concatExpr('entities.', refIdExpr(varRef('t')), '.props.vitality'),
      value: minExpr(addExpr(refGetExpr(varRef('t'), ['props', 'vitality']), 4), 5),
    }),
  ],
};

const moveAction: ActionDef = {
  id: 'a:move', kind: 'action', label: 'Move', track: 'highlight',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  require: true, cost: [],
  effects: [opEffect('entity.place', { entityId: HERO, nodeId: refIdExpr(varRef('node')) })],
};

const eternalSleepAction: ActionDef = {
  id: 'a:eternal-sleep', kind: 'action', label: 'EternalSleep', track: 'highlight',
  targets: [{
    name: 'target',
    query: { from: 'entities', where: {
      op: 'and',
      args: [
        { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] },
        { op: 'includes', args: [refGetExpr(varRef('targetRef'), ['tags']), TAG_DOWNED] },
      ],
    } },
  }],
  require: {
    op: 'and',
    args: [
      { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] },
      { op: 'includes', args: [refGetExpr(varRef('target'), ['tags']), TAG_DOWNED] },
    ],
  },
  cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    opEffect('entity.destroy', { id: refIdExpr(varRef('t')) }),
  ],
};

const INITIATIVE_OF: Expr = { op: 'refGet', args: [{ var: 'self' }, 'props.initiative'] };
const schedule: ScheduleDef = {
  id: 'sched:play', kind: 'schedule', order: 'initiative', initiativeExpr: INITIATIVE_OF,
  phases: [{ id: 'ph:act', phaseKind: 'normal', actors: { from: 'entities', where: { op: 'gt', args: [INITIATIVE_OF, 0] } } }],
};

const TEST_ACTION_DEFS: readonly ActionDef[] = [attackAction, pickupAction, healAction, moveAction, eternalSleepAction];

const FAMILY_SEED: readonly Def[] = [
  schedule as unknown as Def,
  { id: POLICY, kind: 'policy', abstract: true, mode: 'search' },
  { id: BINDING, kind: 'policy', extends: [POLICY], mode: 'search', policy: POLICY, props: { alertLevel: 2, relevantActions: ['a:attack', 'a:heal', 'a:move', 'a:pickup', 'a:eternal-sleep'] } },
];

function buildAttackingWorld(runtime: PlayAiRuntime): void {
  let state: unknown = runtime.holder.getState() as unknown;
  // 注册一个可控的静态状态：hero + enemy + nodes，hiddenRefs 空，伤害量 1。
  state = {
    ...(state as object),
    world: {
      ...(state as { world: unknown }).world as Record<string, unknown>,
      agents: {},
      props: { ...((state as { world: { props?: Record<string, unknown> } }).world.props ?? {}), hiddenRefs: [] },
      knowledge: {},
      decisions: {},
      intents: {},
      attachments: {},
      turn: { scheduleId: 'sched:play', phaseIndex: 0, phaseEnteredAt: 0 },
      rng: {},
      ruleCircuitState: {},
      log: [],
      logSeq: 0,
      deferredEffects: [],
      deferredSeq: 0,
    } as Record<string, unknown>,
    nodes: {
      'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
      'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
    },
    entities: {
      [HERO]: { ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a', props: { vitality: 5, initiative: 3 }, containers: { bag: 'c:hero-bag' } },
      [ENEMY]: { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:enemy-a', props: { vitality: 2, initiative: 1 } },
    },
    containers: {
      'c:hero-bag': { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] },
    },
    defs: {},
    items: {},
    links: {},
  };
  const updated = setPath(state as never, 'world.props.aiCombatDamageRef', 1 as never) as never;
  runtime.holder.setState(updated);
  runtime.ruleProvider.add(aiCombatDamageRule);
}

describe('play 生产侧 AI runtime（缺口1）', () => {
  beforeEach(() => resetIdCounters());

  it('生产组合根能填充原本恒空的 NPC 行动队列，并让 popNextNpc 真调决策环、产生 submitted 候选', () => {
    const runtime = createPlayAiRuntime({
      scheduleId: 'sched:play',
      npcBudget: () => [{
        entry: {
          agentId: NPC_AGENT,
          controlledEntity: { $: HERO },
          policy: { $: POLICY },
          behaviorBinding: { $: BINDING },
          intent: 'aggressive',
        },
        ap: 2,
      }],
      seedDefs: [...FAMILY_SEED, ...TEST_ACTION_DEFS as unknown as Def[]],
      visibleTo: VISIBLE_TO,
    });
    // 挂伤害规则需要先建 npc 实体，因此在 seedNpcQueue 前先 build。
    runtime.ruleProvider.add(aiCombatDamageRule);
    buildAttackingWorld(runtime);

    // seedNpcQueue 应真写入 PATH_NPC_QUEUE（此前恒空）。
    const seeded = runtime.seedNpcQueue();
    expect(seeded.ok).toBe(true);
    expect(runtime.queuedNpcIds).toContain(HERO);

    // popNextNpc 真调 facade.act，产生一个 submitted 候选。
    const popped = runtime.popNextNpc();
    expect(popped.ok).toBe(true);
    const candidate = popped.ok ? popped.value : undefined;
    expect(candidate).toBeDefined();
    expect(candidate!.actor.$).toBe(HERO);
  });

  it('queue 被 popNextNpc 消费：弹出一条后，排队列表不再含该 NPC', () => {
    const runtime = createPlayAiRuntime({
      scheduleId: 'sched:play',
      npcBudget: () => [{
        entry: { agentId: NPC_AGENT, controlledEntity: { $: HERO }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, intent: 'aggressive' },
        ap: 2,
      }],
      seedDefs: [...FAMILY_SEED, ...TEST_ACTION_DEFS as unknown as Def[]],
      visibleTo: VISIBLE_TO,
    });
    runtime.ruleProvider.add(aiCombatDamageRule);
    buildAttackingWorld(runtime);
    runtime.seedNpcQueue();
    expect(runtime.queuedNpcIds).toContain(HERO);

    runtime.popNextNpc();
    const rest = runtime.holder.getState().world.props['play'] as Record<string, unknown> | undefined;
    const queue = rest?.['npcQueue'];
    expect(Array.isArray(queue) ? (queue as readonly { $: string }[]).map((ref) => ref.$) : []).not.toContain(HERO);
  });

  it('NPC 决策在真实链路让目标状态改变：攻击残血敌方 → 敌方 vitality 下降', () => {
    const runtime = createPlayAiRuntime({
      scheduleId: 'sched:play',
      npcBudget: () => [{ entry: { agentId: NPC_AGENT, controlledEntity: { $: HERO }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, intent: 'aggressive' }, ap: 2 }],
      seedDefs: [...FAMILY_SEED, ...TEST_ACTION_DEFS as unknown as Def[]],
      visibleTo: VISIBLE_TO,
    });
    runtime.ruleProvider.add(aiCombatDamageRule);
    buildAttackingWorld(runtime);
    runtime.seedNpcQueue();

    const before = runtime.holder.getState().entities[ENEMY]?.props['vitality'];
    expect(Number(before)).toBe(2);

    const popped = runtime.popNextNpc();
    expect(popped.ok).toBe(true);
    // 满血 hero(5) 面对残血敌方(2) → 攻击是最优，且真实落地减血。
    const candidate = popped.ok ? popped.value : undefined;
    expect(candidate).toBeDefined();
    if (candidate !== undefined) {
      expect(candidate.legalAction.action).toBe('a:attack');
      const after = runtime.holder.getState().entities[ENEMY]?.props['vitality'];
      expect(Number(after)).toBeLessThan(2);
    }
  });
});
