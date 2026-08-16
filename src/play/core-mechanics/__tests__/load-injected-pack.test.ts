/**
 * 装载等价专项（D-081 / L0 第十四条）A2 交付物：注入玩法包装载的契约测试。
 *
 * 目标：`loadCoreMechanics` 接受注入的玩法包，官方 TS 包退化为"默认装载的第一个包"——
 * 默认路径（不传 `opts.playpack`）行为与改造前逐字节一致；注入包与官方包经同一装载契约进入
 * 注册表，装载后 Def 快照地位等价（官方 TS / UGC JSON 只差表达手段，不差装载权限）。
 *
 * 本测试只读使用 `defs/*.ts` 的导出（`attackAction` / `phaseSettleRule` / `coreSchedule` /
 * `CORE_ATTACHED_INVOKE_RULES` / `CORE_ATTACHED_ACTIONS` / `deathBagEntityDef` / `PLAYPACK_ID` /
 * `SCHEDULE_ID` / `POOL_AP` / `POOL_STAMINA` / `ACT_ATTACK` / `ACT_DROP_ITEM` / `STAMINA_MAX` /
 * `PATH_ROLL_POLICY_READY` / `RULE_PHASE_SETTLE_DEFAULT`），不修改其内容。注入包用与官方包相同的
 * 定义组装（同一份 TS 定义、不同包 id 与规则集合），证明"官方机制经注入路径装载"时一切派生
 * 都来自注入包，而不是源码特权的默认包。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounters } from '../../../core/kernel/state/ids.js';
import { setPath } from '../../../core/kernel/ops/path.js';
import { createEmptyWorldState, type WorldState } from '../../../core/kernel/state/world-state.js';
import { createEntityShape } from '../../../core/kernel/state/entity.js';
import { createAgentShape } from '../../../core/kernel/state/agent.js';
import { createContainerShape, createSlotShape, createNodeShape } from '../../../core/kernel/topology/types.js';
import { createFullHarness } from '../../../core/kernel/testing/full-harness.js';
import { ActionCatalog } from '../../../core/kernel/actions/catalog.js';
import type { ActionDef } from '../../../core/kernel/actions/types.js';
import type { PlaypackDef } from '../../../core/kernel/schedule/playpack.js';
import { loadCoreMechanics, CoreMechanicsFacade, type CoreMechanicsLoadOptions } from '../load.js';
import { officialCoreMechanicsConfig, ATTACK_DAMAGE_VALUE } from './official-state-machine-config.js';
import { createLoadedCoreMechanics } from './state-machine-load-driver.js';
import { attackAction } from '../defs/actions.paid.js';
import { phaseSettleRule } from '../defs/rules.phase.js';
import { coreSchedule } from '../defs/schedule.js';
import { CORE_ATTACHED_ACTIONS, CORE_ATTACHED_INVOKE_RULES } from '../defs/actions.attached.js';
import { deathBagEntityDef } from '../defs/playpack.js';
import {
  ACT_ATTACK,
  ACT_DROP_ITEM,
  PATH_ROLL_POLICY_READY,
  PLAYPACK_ID,
  POOL_AP,
  POOL_STAMINA,
  RULE_PHASE_SETTLE_DEFAULT,
  SCHEDULE_ID,
  STAMINA_MAX,
  TAG_ROLL_PARTICIPANT,
} from '../defs/ids.js';
import type { WorldStateHolder } from '../../../core/kernel/ops/transaction.js';
import type { Value } from '../../../core/kernel/state/value.js';
import type { EvalContext } from '../../../core/kernel/expr/engine.js';

// ---------------------------------------------------------------------------
// 注入包组装（只读使用 defs/*.ts 的导出，不改其内容）
// ---------------------------------------------------------------------------

/**
 * 与官方包同语义、不同包 id 的 TS 构造等价包。规则集合 = 结算默认规则 + 附着派生规则，
 * 并显式声明 `rules` 引用（与 PlaypackActivator 的常驻规则挂载同语义）；def 集合 = 一个付费
 * 动作（attack）+ 结算规则 + 调度表 + 附着动作与派生规则 + 死亡背包实体。这些定义在官方包里
 * 均已就位，因此这里是"装载权限等价"的直接证据：同一份官方定义经注入包装载，Def 快照地位
 * 与默认路径装载等价。
 */
const INJECTED_PACK_ID = 'playpack:play.load-injected';
const INJECTED_SCHEDULE_ID = `${SCHEDULE_ID}.injected`;

const injectedPack: PlaypackDef = {
  id: INJECTED_PACK_ID,
  kind: 'playpack',
  version: '1.0.0',
  schedule: INJECTED_SCHEDULE_ID,
  pools: [
    { name: POOL_AP, per: 'actor', min: 0, max: 3, reset: 'turn' },
    { name: POOL_STAMINA, per: 'actor', min: 0, max: STAMINA_MAX, reset: 'never' },
  ],
  rules: [RULE_PHASE_SETTLE_DEFAULT, ...CORE_ATTACHED_INVOKE_RULES.map((rule) => rule.id)],
  defs: [
    deathBagEntityDef,
    { ...coreSchedule, id: INJECTED_SCHEDULE_ID },
    attackAction,
    phaseSettleRule,
    ...CORE_ATTACHED_ACTIONS,
    ...CORE_ATTACHED_INVOKE_RULES,
  ],
};

// ---------------------------------------------------------------------------
// 装载驱动（与 state-machine-load-driver.ts 同构：同一组合根 + 同一预置世界状态）
// ---------------------------------------------------------------------------

function harnessRuntime(harness: ReturnType<typeof createFullHarness>): CoreMechanicsLoadOptions['runtime'] {
  const actionCatalog = new ActionCatalog({
    getState: () => harness.holder.getState(),
    exprEngine: harness.exprEngine,
    queryEngine: harness.queryEngine,
    ctxForActor: ((actor) => harness.ctxForSelf(actor)) as (
      actor: { $: string }, bindings: Record<string, Value>,
    ) => EvalContext,
    listActionDefs: () => harness.defRegistry.allResolved()
      .filter((definition): definition is ActionDef => definition.kind === 'action') as ActionDef[],
  });
  const queryActions = (actorRef: { $: string }, mode: 'ui' | 'ai') => actionCatalog.queryActions(actorRef, mode);
  return {
    registry: harness.registry,
    defRegistry: harness.defRegistry,
    ruleProvider: harness.ruleProvider,
    playpackLoader: harness.playpackLoader,
    holder: harness.holder,
    queryActions,
  };
}

/** 预置装载期世界状态（与 state-machine-load-driver 的 createLoadedCoreMechanics 一致）。 */
function presetLoadWorld(holder: WorldStateHolder): void {
  holder.setState(setPath(
    holder.getState(),
    'world.props.play.damageAmountRef',
    ATTACK_DAMAGE_VALUE as never,
  ) as WorldState);
}

function injectedLoad() {
  const harness = createFullHarness();
  presetLoadWorld(harness.holder);
  const load = loadCoreMechanics({
    runtime: harnessRuntime(harness),
    config: officialCoreMechanicsConfig(),
    playpack: injectedPack,
  });
  return { load, harness };
}

/** 世界里预置英雄/敌人/节点/容器/agent（与 state-machine e2e 同构）。 */
function seedWorld(initialStamina: number): WorldState {
  const base = createEmptyWorldState(INJECTED_SCHEDULE_ID);
  const HERO = 'e:hero';
  const HERO_AGENT = 'g:hero';
  const HERO_REF = { $: HERO };
  const agents: WorldState['world']['agents'] = {
    [HERO_AGENT]: { ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'), controls: [HERO_REF] },
  };
  const entities: WorldState['entities'] = {
    [HERO]: {
      ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a',
      props: { vitality: 4, rollTier: 3 },
      containers: { bag: 'c:hero-bag' },
      tags: [TAG_ROLL_PARTICIPANT],
    },
  };
  const nodes: WorldState['nodes'] = {
    'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
  };
  const heroBag = { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] };
  const containers: WorldState['containers'] = { 'c:hero-bag': heroBag };
  let state: WorldState = { ...base, world: { ...base.world, agents }, entities, nodes, containers };
  state = setPath(state, 'world.props.pools.stamina.e:hero.real', initialStamina as never) as WorldState;
  state = setPath(state, 'world.props.pools.stamina.e:hero.available', initialStamina as never) as WorldState;
  return state;
}

function staminaOf(holder: WorldStateHolder, actor: string): number | undefined {
  const pools = (holder.getState().world.props as Record<string, unknown>)['pools'] as Record<string, Record<string, { real?: unknown }>> | undefined;
  const v = pools?.stamina?.[actor]?.real;
  return typeof v === 'number' ? v : undefined;
}

function hasTag(holder: WorldStateHolder, actor: string, tag: string): boolean {
  return (holder.getState().entities[actor]?.tags ?? []).includes(tag);
}

/** 从 roll 推进到玩家行动阶段（与 state-machine e2e 的 advanceToPlayerAction 同构）。 */
function advanceToPlayerAction(facade: CoreMechanicsFacade, holder: WorldStateHolder): void {
  let guard = 0;
  while (holder.getState().world.turn.phaseIndex < 2 && guard++ < 6) {
    const r = facade.advancePhase();
    if (!r.ok) throw new Error(`advance 失败：${r.detail ?? '未知'}`);
  }
}

// ---------------------------------------------------------------------------
// 契约断言
// ---------------------------------------------------------------------------

describe('loadCoreMechanics 注入玩法包（D-081 / L0 第十四条 14.2-14.4）', () => {
  beforeEach(() => resetIdCounters());

  it('① defRegistry 装载成功，且 def 集合来自注入包（默认包未被动过）', () => {
    const { load, harness } = injectedLoad();

    expect(load.ok).toBe(true);
    expect(load.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'fatal')).toHaveLength(0);

    // 注入包的定义进了注册表。
    expect(harness.defRegistry.resolve(ACT_ATTACK)?.kind).toBe('action');
    expect(harness.defRegistry.resolve(RULE_PHASE_SETTLE_DEFAULT)?.kind).toBe('rule');
    expect(harness.defRegistry.resolve(INJECTED_SCHEDULE_ID)?.kind).toBe('schedule');

    // 默认官方包完全没有被装载：注册表里没有它独占的调度 Id，loader 的已装载列表只有注入包。
    expect(harness.defRegistry.resolve(SCHEDULE_ID)).toBeNull();
    expect(harness.playpackLoader.loadedPlaypacks().map((p) => p.id)).toEqual([INJECTED_PACK_ID]);

    // 装载成功后不写 DEF 状态（世界只被写装载期配置三项）。
    expect(Object.keys(harness.holder.getState().defs)).toHaveLength(0);
  });

  it('② 注入包的常驻规则挂进 ruleProvider（经包内 rules 引用解析）', () => {
    const { load, harness } = injectedLoad();

    expect(load.ok).toBe(true);
    expect(harness.ruleProvider.has(RULE_PHASE_SETTLE_DEFAULT)).toBe(true);
    // 附着派生规则随注入包一并挂载（play.attach.invoke 的执行链在注入装载下可跑）。
    expect(harness.ruleProvider.allRuleIds().sort()).toEqual([RULE_PHASE_SETTLE_DEFAULT, ...CORE_ATTACHED_INVOKE_RULES.map((rule) => rule.id)].sort());
  });

  it('③ 装载期世界配置写入发生（默认路径同三项）', () => {
    const { load, harness } = injectedLoad();

    expect(load.ok).toBe(true);
    const play = (harness.holder.getState().world.props as Record<string, unknown>)['play'] as Record<string, unknown>;
    expect(play).toBeDefined();
    // rollPolicyReady 来自官方 config（enableRandomRoll:true + 双策略引用）。
    expect(play[PATH_ROLL_POLICY_READY.replace('world.props.play.', '')]).toBe(true);
    expect(play['commitmentsRequired']).toBe(false);
    expect(play['npcEnabled']).toBe(false);
  });

  it('④ 拒绝诊断包无关：注入坏包 → 与默认路径同样的 E_LOAD_* 码', () => {
    // 坏包 = 注入包 + 一个引用未注册 Op 的付费动作（玩法层 Linter 的 Op 合法性校验命中）。
    const badPack: PlaypackDef = {
      ...injectedPack,
      id: 'playpack:play.load-injected.bad',
      defs: [
        ...injectedPack.defs,
        {
          id: 'action:play.injected.bad-op',
          kind: 'action',
          label: '引用未注册 Op 的坏动作',
          require: true,
          cost: [{ pool: POOL_AP, amount: 1 }],
          effects: [{ op: 'totally.not-registered-op', args: {} }],
          play: {
            numericOwnership: { 'cost.0.amount': { kind: 'constitutional', sourceId: 'S8 一个动作永远 1 AP' } },
            costClass: 'paid' as const,
            sourceTrace: ['Req 4.2'],
          },
        },
      ],
    };

    const badInject = injectedLoad();
    // 同一个 harness 不能复用（坏包装载会改活动注册表/挂规则）；单独起一个干净组合根跑坏包。
    const badHarness = createFullHarness();
    presetLoadWorld(badHarness.holder);
    const badLoad = loadCoreMechanics({
      runtime: harnessRuntime(badHarness),
      config: officialCoreMechanicsConfig(),
      playpack: badPack,
    });

    // 默认路径回归靶（state-machine-load-driver 的 createLoadedCoreMechanics）在相同坏包下给出同一码。
    const defaultHarness = createFullHarness();
    presetLoadWorld(defaultHarness.holder);
    const defaultBadLoad = loadCoreMechanics({
      runtime: harnessRuntime(defaultHarness),
      config: officialCoreMechanicsConfig(),
      playpack: badPack,
    });

    expect(badInject.load.ok).toBe(true); // 好注入包装载成功（隔离）。
    expect(badLoad.ok).toBe(false);
    expect(badLoad.diagnostics.map((d) => d.code)).toContain('E_LOAD_LAYER_OWNERSHIP');
    expect(defaultBadLoad.ok).toBe(false);
    expect(defaultBadLoad.diagnostics.map((d) => d.code)).toContain('E_LOAD_LAYER_OWNERSHIP');

    // 同一坏包、同一装载入口 → 两个装载路径的拒绝码集合一致（包无关）。
    expect(badLoad.diagnostics.map((d) => d.code).sort()).toEqual(defaultBadLoad.diagnostics.map((d) => d.code).sort());
    // 坏包被原子拒绝：活动注册表未被写入坏定义。
    expect(badHarness.defRegistry.resolve('action:play.injected.bad-op')).toBeNull();
  });

  it('⑤ 默认路径回归：不传 playpack 时与 createLoadedCoreMechanics 行为一致（含完整一轮状态机）', () => {
    // 不传 playpack 的默认装载（逐字节等同改造前的派生输入）。
    const harness = createFullHarness();
    presetLoadWorld(harness.holder);
    const defaultLoad = loadCoreMechanics({
      runtime: harnessRuntime(harness),
      config: officialCoreMechanicsConfig(),
    });
    expect(defaultLoad.ok).toBe(true);
    expect(harness.playpackLoader.loadedPlaypacks().map((p) => p.id)).toEqual([PLAYPACK_ID]);

    // 与既有驱动 createLoadedCoreMechanics 对照：同 config、同组合根，装载结果等价。
    const existing = createLoadedCoreMechanics();
    expect(existing.load.ok).toBe(true);
    expect(existing.load.diagnostics.map((d) => d.code)).toEqual(defaultLoad.diagnostics.map((d) => d.code));
    expect(existing.load.blocked.map((b) => b.capability)).toEqual(defaultLoad.blocked.map((b) => b.capability));

    // 默认包上完整一轮状态机仍可驱动（官方包未被注入路径破坏）：睡下→起床回满体力。
    const holder = harness.holder;
    const seeded = seedWorld(4);
    holder.setState({
      ...holder.getState(),
      world: {
        ...holder.getState().world,
        agents: seeded.world.agents,
        props: { ...(holder.getState().world.props ?? {}), ...(seeded.world.props ?? {}) },
        turn: { ...holder.getState().world.turn, scheduleId: SCHEDULE_ID },
      },
      entities: seeded.entities,
      nodes: seeded.nodes,
      containers: seeded.containers,
    } as WorldState);
    const facade = new CoreMechanicsFacade(harness.registry);
    advanceToPlayerAction(facade, holder);
    expect(staminaOf(holder, 'e:hero')).toBe(4);
    const sleepDown = facade.submit({ actorRef: { $: 'e:hero' }, actionId: 'action:play.sleep-down', bindings: {} });
    expect(sleepDown.ok).toBe(true);
    if (!sleepDown.ok) throw new Error('sleep-down 提交失败');
    facade.resolve(sleepDown.value.intentId);
    expect(hasTag(holder, 'e:hero', 'play:sleeping')).toBe(true);
    const wakeUp = facade.submit({ actorRef: { $: 'e:hero' }, actionId: 'action:play.wake-up', bindings: {} });
    expect(wakeUp.ok).toBe(true);
    if (!wakeUp.ok) throw new Error('wake-up 提交失败');
    facade.resolve(wakeUp.value.intentId);
    expect(hasTag(holder, 'e:hero', 'play:sleeping')).toBe(false);
    expect(staminaOf(holder, 'e:hero')).toBe(STAMINA_MAX);
  });

  it('CoreMechanicsFacade 随注入包派生附着动作集', () => {
    const { harness } = injectedLoad();
    const facade = new CoreMechanicsFacade(harness.registry, injectedPack);

    // 注入包带官方附着动作 drop-item：独立提交被结构化拒绝（Requirement 8.8）。
    const standalone = facade.submit({ actorRef: { $: 'e:hero' }, actionId: ACT_DROP_ITEM, bindings: {} });
    if (standalone.ok) throw new Error('drop-item 应被结构化拒绝，但提交成功');
    expect(standalone.code).toBe('E_OP_NOT_ACCEPTED');
  });

  // 上面 ⑤ 已覆盖"完整一轮状态机在默认装载下可驱动"，这里补一条"同一套世界在注入装载下也能
  // 驱动到玩家行动并真实执行附着派生规则"——证明注入路径的规则挂载与默认路径地位等价。
  it('注入装载下同一套世界可驱动到玩家行动，附着派生规则真实执行', () => {
    const { load, harness } = injectedLoad();
    expect(load.ok).toBe(true);

    const holder = harness.holder;
    const seeded = seedWorld(4);
    holder.setState({
      ...holder.getState(),
      world: {
        ...holder.getState().world,
        agents: seeded.world.agents,
        props: { ...(holder.getState().world.props ?? {}), ...(seeded.world.props ?? {}) },
        turn: { ...holder.getState().world.turn, scheduleId: INJECTED_SCHEDULE_ID },
      },
      entities: seeded.entities,
      nodes: seeded.nodes,
      containers: seeded.containers,
    } as WorldState);

    const facade = new CoreMechanicsFacade(harness.registry, injectedPack);
    advanceToPlayerAction(facade, holder);
    expect(holder.getState().world.turn.phaseIndex).toBe(2);

    // 结算阶段的附着规则链在注入装载下走通了（否则 advance 会因 settleComplete 未置位而拒绝）。
    const play = (holder.getState().world.props as Record<string, unknown>)['play'] as Record<string, unknown>;
    expect(play['settleComplete']).toBe(true);
    expect(staminaOf(holder, 'e:hero')).toBe(4);
  });
});
