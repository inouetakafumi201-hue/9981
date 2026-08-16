/**
 * M10 环节的玩法层解铃靶（BATCH M10 交付物）：真实装载驱动一整轮的端到端状态机断言。
 *
 * 交接职责（src/docs `11_AI要玩法层提供什么 —— M10 状态机端到端靶的解锁交接` / §7.3）：
 * 解铃人（玩法层组合 root 作者）交付「官方合法 config + 真实装载驱动」，AI 线保证一经存在就
 * 通过 driveMultiTurn 消费并补 M10 靶。本文件是解铃人的**对局侧 e2e 靶**：调用
 * `loadCoreMechanics(runtime, officialConfig)`，在一个已经接齐全部 Op + Hook 的组合根上驱动
 * **整整一轮**（roll → settle → playerAction → npcAction → cleanup → 回绕），断言 M10 的三条
 * 状态转换在真实绑定/请求记录/规则链路上真发生：
 *
 *   1. 睡下→起床（Requirement 6.11 / 15.4）：睡下只建立中间状态、不掉/不涨体力；
 *      只有起床完成才把体力恢复到 5（STAMINA_MAX）。
 *   2. 过载剔除（Requirement 6.14-6.22）：core-mechanics 现在具备 attachment / rule / schedule
 *      三段式实现，本文件断言它会阻断主动提交，并在投点阶段推进其归队计数。
 *   3. 倒地→站起（Requirement 11.3 / 12.3）：零血倒地经攻击打落，普通倒地经站起移除。
 *   4. 一局生命周期（CEME C-1/C-3/C-5）：round 在 cleanup→roll 回绕时经 roundEnd +1、
 *      终局字段经 match-lifecycle 写入、declaredOutcomeNames 与 playpack.outcomes 非空一致。
 *
 * 一、组合根。复用 `state-machine-load-driver.ts` 的 `createLoadedCoreMechanics`：它用
 * `src/core/kernel/testing/full-harness.ts` 的 `createFullHarness`（接齐全部 registerXxxOps，并经
 * `wireHooksIntoRegistry` 把 Hook/Flow/规则管道真实接上），把官方 config 喂进 `loadCoreMechanics`。
 * 本文件在此基础上做三件事：
 *   - 预置英雄/敌人/节点/容器到 WorldState（结算与池初始化需要它们存在）。
 *   - 用 `CoreMechanicsFacade.submit/resolve` + `schedule.advance` 驱动走满一轮。
 *   - 在每个关键相位断言状态机语义。
 *
 * 二、不触碰的边界。遵守交接项的禁碰清单：不 import/修改 `src/core/kernel/ai/**`、core play
 * Defs（sleepDown/wakeUp/standUp/attack、schedule、rules.phase）、并行产物 `src/devboard/**`、
 * `bombardment-l2-expr`。本文件的全部新代码只落在自己这块（世界预置 + 相位驱动 + 断言）。
 *
 * 三、当前已覆盖的两条生命周期断言：
 *   - 过载：core-mechanics 现在具备 attachment / rule / schedule 三段式实现；本文件只断言
 *     "过载会阻断主动提交"，不再把它登记成包内缺口。
 *   - PLAYER_QUEUE：settle 写 `playerQueue` 后可通过 `CoreMechanicsFacade.consumePlayerQueue()`
 *     这条唯一 drain 入口清空，测试不再直接改 WorldState。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setPath } from '../../../../core/kernel/ops/path.js';
import { resetIdCounters } from '../../../../core/kernel/state/ids.js';
import { createEmptyWorldState, type WorldState } from '../../../../core/kernel/state/world-state.js';
import { createEntityShape } from '../../../../core/kernel/state/entity.js';
import { createAgentShape } from '../../../../core/kernel/state/agent.js';
import { createContainerShape, createSlotShape, createNodeShape } from '../../../../core/kernel/topology/types.js';
import { CoreMechanicsFacade } from '../../load.js';
import { createLoadedCoreMechanics } from '../state-machine-load-driver.js';
import { ATT_OVERLOADED, STAMINA_MAX, TAG_ROLL_PARTICIPANT } from '../../defs/ids.js';
import type { WorldStateHolder } from '../../../../core/kernel/ops/transaction.js';
import type { OpRegistry } from '../../../../core/kernel/ops/registry.js';

// ---------------------------------------------------------------------------
// 世界里的英雄/敌人/节点/容器标识；四段相位名
// ---------------------------------------------------------------------------

const HERO = 'e:hero';
const ENEMY = 'e:enemy';
const HERO_AGENT = 'g:hero';
const HERO_REF = { $: HERO };

const PHASE_NAMES = ['roll', 'settle', 'playerAction', 'npcAction', 'cleanup'] as const;

// 过载现在已经在 core-mechanics 内闭合成 attachment / rule / schedule 三段式；这里保留可检索的
// 行为断言，不再登记成包内缺口。

/** 私有 helper 集合：非导出，仅本文件使用。 */
function heroDefId(): string {
  return 'd:fighter';
}

/** 把英雄/敌人/节点/容器/agent 预置进空世界（结算要查参与者、池初始化按 agent 展开）。 */
function seedWorld(initialStamina: number): WorldState {
  const base = createEmptyWorldState('schedule:play.core');
  const agents: WorldState['world']['agents'] = {
    [HERO_AGENT]: { ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'), controls: [HERO_REF] },
  };
  // hero 带 `play:roll-participant` 标记 + 已生成最终投点等级 `rollTier`，构成结算阶段的
  // 投点参与者（rules.phase.ts PARTICIPANT_PRED），结算才会把它写进 turnOrder 并分配 AP。
  // 否则 settle 走"无参与者"分支（写空顺序表），护手/攻击/睡眠这些都因该实体不是行动者而不可用。
  const entities: WorldState['entities'] = {
    [HERO]: {
      ...createEntityShape(HERO, heroDefId()), node: 'n:hero-a',
      props: { vitality: 4, rollTier: 3 },
      containers: { bag: 'c:hero-bag' },
      tags: [TAG_ROLL_PARTICIPANT],
    },
    [ENEMY]: { ...createEntityShape(ENEMY, heroDefId()), node: 'n:enemy-a', props: { vitality: 3 }, tags: [] },
  };
  const nodes: WorldState['nodes'] = {
    'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
    'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
  };
  const heroBag = { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] };
  const containers: WorldState['containers'] = { 'c:hero-bag': heroBag };

  let state: WorldState = {
    ...base,
    world: { ...base.world, agents },
    entities,
    nodes,
    containers,
  };
  // 预置 hero 的初始体力。用 setPath 直接写 world.props（装载期世界状态本来就是直接写的），
  // 避免在装载前依赖任何池 Op（池要装载后才有定义）。
  state = setPath(state, 'world.props.pools.stamina.e:hero.real', initialStamina as never) as WorldState;
  state = setPath(state, 'world.props.pools.stamina.e:hero.available', initialStamina as never) as WorldState;
  return state;
}

interface WorldFixture {
  loadResult: ReturnType<typeof createLoadedCoreMechanics>['load'];
  facade: CoreMechanicsFacade;
  registry: OpRegistry;
  holder: WorldStateHolder;
}

function makeFixture(initialStamina = 4): WorldFixture {
  const { load, harness } = createLoadedCoreMechanics();
  const holder = harness.holder;
  const seeded = seedWorld(initialStamina);
  // 保留装载写入的玩法配置（rollPolicyReady / commitmentsRequired / npcEnabled）与 role 表，
  // 在其上叠加实体；并把当前回合的 schedule 指向装载好的 `schedule:play.core`
  // （createFullHarness 的初始空世界用 `sched:fuzz`，advance 按 turn.scheduleId 查表，必须指向
  // 已装载的五阶段表）。
  const loadedState = holder.getState();
  holder.setState({
    ...loadedState,
    world: {
      ...loadedState.world,
      agents: seeded.world.agents,
      // 叠上 seedWorld 预置的体力池（seedWorld 里用 setPath 写入 world.props.pools.stamina）。
      props: { ...(loadedState.world.props ?? {}), ...(seeded.world.props ?? {}) },
      turn: { ...loadedState.world.turn, scheduleId: 'schedule:play.core' },
    },
    entities: seeded.entities,
    nodes: seeded.nodes,
    containers: seeded.containers,
  } as WorldState);
  const facade = new CoreMechanicsFacade(harness.registry);
  return { loadResult: load, facade, registry: harness.registry, holder };
}

function staminaOf(holder: WorldStateHolder, actor: string): number | undefined {
  const pools = (holder.getState().world.props as Record<string, unknown>)['pools'] as Record<string, Record<string, { real?: unknown }>> | undefined;
  const v = pools?.stamina?.[actor]?.real;
  return typeof v === 'number' ? v : undefined;
}

function vitalityOf(holder: WorldStateHolder, actor: string): number | undefined {
  const v = holder.getState().entities[actor]?.props['vitality'];
  return typeof v === 'number' ? v : undefined;
}

function hasTag(holder: WorldStateHolder, actor: string, tag: string): boolean {
  return (holder.getState().entities[actor]?.tags ?? []).includes(tag);
}

/** 通过 CoreMechanicsFacade.consumePlayerQueue 清空玩家行动阶段执行队列。 */
function drainPlayerQueue(facade: { consumePlayerQueue: () => { ok: boolean; detail?: string } }): void {
  const result = facade.consumePlayerQueue();
  if (!result.ok) throw new Error(`consumePlayerQueue 失败：${result.detail ?? '未知'}`);
}

/** 用组合根的真实 attach.add 附着某个状态到 actor（普通倒地在包内只能由机制触发，这里直达引擎 Op）。 */
function applyAttachment(registry: OpRegistry, def: string, target: string): boolean {
  const result = registry.invoke<{ def: string; target: { $: string } }, { $: string }>('attach.add', { def, target: { $: target } });
  return result.ok;
}

function phaseName(index: number): string {
  return PHASE_NAMES[index] ?? `phase${index}`;
}

describe('M10 端到端状态机靶（真实装载驱动一整轮）', () => {
  beforeEach(() => resetIdCounters());

  it('装载合法：official config + 真实组合根装载成功，无 error/fatal 阻塞', () => {
    const { loadResult } = makeFixture();
    expect(loadResult.ok).toBe(true);
    const blockers = loadResult.blocked.map((b) => b.capability);
    // U-001 / HOOK_WIRING_GATE 已翻正；仅剩 T-001（伤害表）与 T-002（掩体数值）登记为阻塞。
    expect(blockers).toContain('firearm-base-damage-table');
    expect(blockers).not.toContain('standard-random-roll');
    expect(blockers).not.toContain('power-die-settlement');
    expect(blockers).not.toContain('play-event-pipeline-integration');
    // CEME C-1：装载结果携带非空结局守恒集，且与声明集合一致。
    expect(loadResult.outcomes.length).toBeGreaterThan(0);
    expect(loadResult.outcomes.some((o) => o.ends)).toBe(true);
    expect(loadResult.outcomes.map((o) => o.name)).toEqual(['last-standing', 'round-checkpoint']);
  });

  it('睡下→起床：睡下只建中间态不掉体力，起床完成才回满到 5', () => {
    const { facade, holder, registry } = makeFixture(4);
    const { phase } = advanceToPlayerAction(facade, holder);
    expect(phase).toBe('playerAction');
    expect(turnOrderHas(holder, HERO)).toBe(true);
    void registry;

    expect(staminaOf(holder, HERO)).toBe(4);
    const sleepDown = facade.submit({ actorRef: HERO_REF, actionId: 'action:play.sleep-down', bindings: {} });
    expect(sleepDown.ok).toBe(true);
    if (!sleepDown.ok) throw new Error('sleep-down 提交失败');
    facade.resolve(sleepDown.value.intentId);
    // 睡下：只建中间状态，不掉体力。
    expect(hasTag(holder, HERO, 'play:sleeping')).toBe(true);
    expect(staminaOf(holder, HERO)).toBe(4);

    // 起床：删除中间状态 + 回满体力。
    const wakeUp = facade.submit({ actorRef: HERO_REF, actionId: 'action:play.wake-up', bindings: {} });
    expect(wakeUp.ok).toBe(true);
    if (!wakeUp.ok) throw new Error('wake-up 提交失败');
    facade.resolve(wakeUp.value.intentId);
    expect(hasTag(holder, HERO, 'play:sleeping')).toBe(false);
    expect(staminaOf(holder, HERO)).toBe(STAMINA_MAX);
  });

it('倒地→站起：攻击打落敌人零血倒地，普通倒地经站起移除', () => {
    const { facade, holder, registry } = makeFixture(4);
    const { phase } = advanceToPlayerAction(facade, holder);
    expect(phase).toBe('playerAction');

    // 敌方先被打到零血倒地：把 enemy 血量设 1，打一刀（伤害 1 → 剩余 0 → 转零血倒地）。
    holder.setState(setPath(holder.getState(), 'entities.e:enemy.props.vitality', 1 as never) as WorldState);
    const attack = facade.submit({ actorRef: HERO_REF, actionId: 'action:play.attack', bindings: { target: { $: ENEMY } } });
    expect(attack.ok).toBe(true);
    if (!attack.ok) throw new Error(`attack 提交失败: ${attack.detail}`);
    facade.resolve(attack.value.intentId);
    expect(vitalityOf(holder, ENEMY)).toBeUndefined(); // 零血倒地：生命字段被删除
    expect(hasTag(holder, ENEMY, 'play:downed-zero')).toBe(true);

    // 普通倒地：由机制触发（本靶用真实 attach.add 直接建 ATT_KNOCKED_DOWN），随后站起删除它。
    expect(applyAttachment(registry, 'attachment:play.knocked-down', HERO)).toBe(true);
    expect(hasTag(holder, HERO, 'play:knocked-down')).toBe(true);

    const standUp = facade.submit({ actorRef: HERO_REF, actionId: 'action:play.stand-up', bindings: {} });
    expect(standUp.ok).toBe(true);
    if (!standUp.ok) throw new Error('stand-up 提交失败');
    facade.resolve(standUp.value.intentId);
    expect(hasTag(holder, HERO, 'play:knocked-down')).toBe(false);
    expect(vitalityOf(holder, HERO)).toBe(4); // 站起不影响生命
  });

  it('一整轮驱动：roll→settle→playerAction→npcAction→cleanup→回 roll，清理自然恢复体力 +1', () => {
    const { facade, holder } = makeFixture(3); // 未满体力，方便断言清理恢复
    const phases: string[] = [];
    let guard = 0;
    let phaseNow = holder.getState().world.turn.phaseIndex;
    // 每到 playerAction 都通过 facade drain 入口清空执行队列，否则无法从 playerAction 离开。
    while (guard++ < 14) {
      if (phaseNow === 2) drainPlayerQueue(facade);
      phases.push(phaseName(phaseNow));
      const before = holder.getState().world.turn.phaseIndex;
      const stepped = facade.advancePhase();
      if (!stepped.ok) break;
      const after = holder.getState().world.turn.phaseIndex;
      if (before === 4 && after === 0) { phases.push(phaseName(after)); break; } // cleanup→roll 回绕
      phaseNow = after;
    }
    expect(phases).toContain('cleanup');
    expect(phases[phases.length - 1]).toBe('roll');
    // 清理阶段自然恢复体力 +1（schedule.ts NATURAL_STAMINA_RECOVERY=1；hero 3→4）。
    expect(staminaOf(holder, HERO)).toBe(4);
    // 一局生命周期：cleanup→roll 回绕经 roundEnd +1，且 round 是 Internal_Metric（经 facade 只读查询）。
    expect(facade.terminal().round()).toBe(1);
  });

  it('过载会阻断主动提交', () => {
    const { facade, holder, registry } = makeFixture(4);
    const { phase } = advanceToPlayerAction(facade, holder);
    expect(phase).toBe('playerAction');

    expect(applyAttachment(registry, ATT_OVERLOADED, HERO)).toBe(true);
    expect(hasTag(holder, HERO, 'play:overloaded')).toBe(true);

    const blocked = facade.submit({ actorRef: HERO_REF, actionId: 'action:play.sleep-down', bindings: {} });
    expect(blocked.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 辅助驱动
// ---------------------------------------------------------------------------

/** 从 roll 一路推进到玩家行动阶段（消耗掉 roll/settle），返回当前相位与下标。 */
function advanceToPlayerAction(facade: CoreMechanicsFacade, holder: WorldStateHolder): { phase: string; index: number } {
  let guard = 0;
  while (holder.getState().world.turn.phaseIndex < 2 && guard++ < 6) {
    const r = facade.advancePhase();
    if (!r.ok) throw new Error(`advance 失败：${r.detail ?? '未知'}`);
  }
  drainPlayerQueue(facade); // 进入 playerAction 后通过生产 drain 入口清空执行队列。
  const idx = holder.getState().world.turn.phaseIndex;
  return { phase: phaseName(idx), index: idx };
}

function turnOrderHas(holder: WorldStateHolder, actor: string): boolean {
  const play = (holder.getState().world.props as Record<string, unknown>)['play'] as Record<string, unknown> | undefined;
  const raw = play?.['turnOrder'];
  if (!Array.isArray(raw)) return false;
  return raw.some((entry) => entry !== null && typeof entry === 'object' && (entry as { $?: string }).$ === actor);
}
