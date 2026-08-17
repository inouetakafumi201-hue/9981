/**
 * 共享夹具：test/ai-tuning 的真实决策 e2e 靶组合根（动作集 + 伤害规则 + schedule）。
 *
 * 与 `src/core/kernel/ai/tuning/__tests__/live-runner.test.ts` 同构的生产装配（play
 * 组合根 `createPlayAiRuntime`），供本目录的验收测试复用以保证「真实决策 = 生产组合根
 * 决策」；不 import 任何 src 测试私有文件。
 */
import type { Value } from '../../src/core/kernel/state/value.js';
import type { Def } from '../../src/core/kernel/state/def.js';
import type { ActionDef } from '../../src/core/kernel/actions/types.js';
import type { Expr } from '../../src/core/kernel/state/expr-types.js';
import type { Effect } from '../../src/core/kernel/events/effect-types.js';
import type { RuleDef } from '../../src/core/kernel/events/types.js';
import type { ScheduleDef } from '../../src/core/kernel/schedule/types.js';
import { createPlayAiRuntime, type PlayAiRuntime } from '../../src/play/ai-runtime.js';
import { defaultDesignCurrencyConfig } from '../../src/core/kernel/ai/tuning/config-design-currency.js';
import { createEmptyWorldState } from '../../src/core/kernel/state/world-state.js';
import type { WorldState } from '../../src/core/kernel/state/world-state.js';

export const POLICY = 'd:ai-policy';
export const BINDING = 'd:ai-binding';
export const TAG_DOWNED = 'tag:downed';
export const HERO = 'e:hero';

function opEffect(op: string, args: Record<string, Expr | number>): Effect { return { op, args: args as Record<string, Expr> } as Effect; }
function varRef(name: string): Expr { return { var: name }; }
function refIdExpr(ref: Expr): Expr { return { op: 'get', args: [ref, '$'] }; }
function refGetExpr(ref: Expr, path: string[]): Expr { return { op: 'refGet', args: [ref, path.join('.')] }; }
function concatExpr(...parts: (string | Expr)[]): Expr { return { op: 'concat', args: parts }; }
function addExpr(a: Expr, b: Expr): Expr { return { op: 'add', args: [a, b] }; }
function minExpr(a: Expr, b: Expr): Expr { return { op: 'min', args: [a, b] }; }

const VISIBLE_TO: Expr = { op: 'not', args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }] };

const attackAction: ActionDef = {
  id: 'a:attack', kind: 'action', label: 'Attack',
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] } } }],
  require: true, cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    { let: 'dmg', be: { path: 'world.props.aiCombatDamageRef' } },
    { emit: 'combat.nearDamage', data: {
      attacker: { $: HERO }, target: varRef('t'),
      damagePath: { op: 'concat', args: ['entities.', { op: 'get', args: [varRef('t'), '$'] }, '.props.vitality'] }, delta: varRef('dmg'),
    } as unknown as Value },
  ],
};
const aiCombatDamageRule: RuleDef = {
  id: 'rule:aiCombatDamage', kind: 'rule', on: 'combat.nearDamage', phase: 'default', priority: 50,
  effects: [
    { let: 't', be: { op: 'get', args: [{ var: 'payload' }, 'target'] } },
    { let: 'p', be: { op: 'get', args: [{ var: 'payload' }, 'damagePath'] } },
    { op: 'prop.add', args: { path: { var: 'p' }, delta: { op: 'neg', args: [{ op: 'get', args: [{ var: 'payload' }, 'delta'] }] } } },
    { op: 'prop.set', args: { path: { var: 'p' }, value: { op: 'max', args: [refGetExpr(varRef('t'), ['props', 'vitality']), 0] } } },
    { let: 'remaining', be: refGetExpr(varRef('t'), ['props', 'vitality']) },
    { if: { op: 'lte', args: [{ var: 'remaining' }, 0] }, then: [
      { op: 'prop.set', args: { path: 'world.props.m9Scratch.collection', value: 'entities' } },
      { op: 'prop.set', args: { path: 'world.props.m9Scratch.id', value: refIdExpr(varRef('t')) } },
      { op: 'tag.add', args: { ref: { path: 'world.props.m9Scratch' }, tag: TAG_DOWNED } },
      { op: 'prop.del', args: { path: 'world.props.m9Scratch' } },
    ], else: [] },
  ],
};
const healAction: ActionDef = {
  id: 'a:heal', kind: 'action', label: 'Heal',
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'eq', args: [{ var: 'self' }, { var: 'self' }] } } }],
  require: true, cost: [],
  effects: [
    { let: 't', be: varRef('self') },
    opEffect('prop.set', { path: concatExpr('entities.', refIdExpr(varRef('t')), '.props.vitality'), value: minExpr(addExpr(refGetExpr(varRef('t'), ['props', 'vitality']), 4), 5) }),
  ],
};
const moveAction: ActionDef = {
  id: 'a:move', kind: 'action', label: 'Move',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  require: true, cost: [],
  effects: [opEffect('entity.place', { entityId: HERO, nodeId: refIdExpr(varRef('node')) })],
};
const eternalSleepAction: ActionDef = {
  id: 'a:eternal-sleep', kind: 'action', label: 'EternalSleep',
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'and', args: [
    { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] },
    { op: 'includes', args: [refGetExpr(varRef('targetRef'), ['tags']), TAG_DOWNED] },
  ] } } }],
  require: { op: 'and', args: [
    { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] },
    { op: 'includes', args: [refGetExpr(varRef('target'), ['tags']), TAG_DOWNED] },
  ] },
  cost: [], effects: [{ let: 't', be: varRef('target') }, opEffect('entity.destroy', { id: refIdExpr(varRef('t')) })],
};
const pickupAction: ActionDef = {
  id: 'a:pickup', kind: 'action', label: 'Pickup',
  targets: [{ name: 'item', query: { from: 'items' } }],
  require: true, cost: [],
  effects: [{ let: 'ownContainer', be: refGetExpr(varRef('self'), ['containers', 'bag']) }, opEffect('item.move', { itemId: refIdExpr(varRef('item')), toContainerId: varRef('ownContainer') })],
};
const TEST_ACTIONS: readonly ActionDef[] = [attackAction, healAction, moveAction, eternalSleepAction, pickupAction];

const INITIATIVE_OF: Expr = { op: 'refGet', args: [{ var: 'self' }, 'props.initiative'] };
const schedule: ScheduleDef = {
  id: 'sched:round', kind: 'schedule', order: 'initiative', initiativeExpr: INITIATIVE_OF,
  phases: [{ id: 'ph:act', phaseKind: 'normal', actors: { from: 'entities', where: { op: 'gt', args: [INITIATIVE_OF, 0] } } }],
};
const FAMILY_SEED: readonly Def[] = [
  schedule as unknown as Def,
  { id: POLICY, kind: 'policy', abstract: true, mode: 'search' },
  { id: BINDING, kind: 'policy', extends: [POLICY], mode: 'search', policy: POLICY, props: { alertLevel: 2, relevantActions: ['a:attack', 'a:heal', 'a:move', 'a:pickup', 'a:eternal-sleep'] } },
];

/** 构造真实 play 组合根 runtime（注入 config 则真实决策用该费目表）。 */
export function makeRuntimeFor(config = defaultDesignCurrencyConfig()): PlayAiRuntime {
  const runtime = createPlayAiRuntime({
    scheduleId: 'sched:round',
    npcBudget: () => [],
    seedDefs: [...FAMILY_SEED, ...TEST_ACTIONS as unknown as Def[]],
    visibleTo: VISIBLE_TO,
    designCurrencyConfig: config,
  });
  runtime.ruleProvider.add(aiCombatDamageRule);
  return runtime;
}

/** 构造 combat 世界快照（hero 满血 + enemy 残血，可 downed）。 */
export function combatWorld(heroVitality: number, enemyVitality: number, opts: { downed?: boolean } = {}): string {
  const state: WorldState = createEmptyWorldState('sched:round');
  state.world.props.hiddenRefs = [] as never;
  state.world.props.aiCombatDamageRef = 1 as never;
  state.world.agents['g:ai'] = { ...(state.world.agents['g:ai'] ?? { kind: 'ai', knowledgeVersion: 'ks:ai' }) } as never;
  state.entities['e:hero'] = { def: 'd:fighter', kind: 'entity', node: 'n:hero-a', props: { vitality: heroVitality, initiative: 3 } } as never;
  state.entities['e:enemy'] = {
    def: 'd:fighter', kind: 'entity', node: 'n:enemy-a', props: { vitality: enemyVitality, initiative: opts.downed ? 0 : 2 },
    ...(opts.downed ? { tags: ['tag:downed'] } : {}),
  } as never;
  state.nodes['n:hero-a'] = { def: 'd:room', kind: 'node' } as never;
  state.nodes['n:enemy-a'] = { def: 'd:room', kind: 'node' } as never;
  state.nodes['n:far-a'] = { def: 'd:room' } as never;
  return JSON.stringify(state);
}

/** 固定 correlationId 的 requestFor（tie-draw 确定性关键：selectTie 对 correlationId 取指纹）。 */
export function fixedReq(correlationId: string) {
  return (_serialized: string) => ({
    category: 'npc-behavior' as const,
    mode: 'act' as const,
    agent: { $: 'g:ai' },
    controlledEntity: { $: HERO },
    policy: { $: POLICY },
    behaviorBinding: { $: BINDING },
    tier: 'exact' as const,
    budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 },
    correlationId,
  });
}
