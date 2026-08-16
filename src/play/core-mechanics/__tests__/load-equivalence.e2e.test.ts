/**
 * 装载等价专项（D-081 / L0 第十四条）B1 交付物：官方 TS 包与语义等价 JSON 玩法包的双形态装载等价证明。
 *
 * 目标：同一机制两种表达手段——官方 TS 包 `CoreMechanicsPlaypack` 与一份纯 JSON fixture
 * （`fixtures/equivalent-playpack.json`，经 `StrictJsonCodec` → `decodePlaypack` 反序列化）——
 * 经同一个 `loadCoreMechanics({runtime, config, playpack})` 装载入口进入注册表后，契约面一致。
 *
 * 等价判据逐项（与专项交付物一一对应）：
 *   ① 池配置（name/per/min/max/reset）逐项一致；
 *   ② 调度阶段数 / 阶段顺序 / loop / order 一致（id 允许不同）；
 *   ③ 语义关键子集一致：attack/move/sleep-down 三动作的 cost/effects 结构深等；
 *      规则按（on 事件 / phase / priority）三要素的挂载面一致，且两套规则都真实挂进 ruleProvider；
 *   ④ 同一坏包注入（effects 引用未注册 Op）→ 两装载路径的拒绝诊断码集合一致（E_LOAD_LAYER_OWNERSHIP）；
 *   ⑤ 装载后投影可见动作集：fixture 的可见动作集与其在官方包中的对应子集一致，逐项 cost 一致。
 *
 * 另含一条「UGC 覆盖官方机制」证明：官方包与 fixture 顺序装载进**同一个**组合根（D-073 单调
 * 重定义），fixture 复用官方动作 id（action:play.attack 等）时后装覆盖先装，注册表里保留的是
 * fixture 版本（以 fixture 自带的 `tags:["ugc"]` 判别），两套规则并存于 ruleProvider。
 *
 * 如实记录的已知差异（不得忽略）：
 * - fixture 只覆盖专项指定的核心子集（3 付费动作 + 3 规则 + 3 附件 + 1 调度），因此注册 def 集合
 *   与官方全集不同；等价性断言只针对语义关键子集，不宣称全集一致。
 * - fixture 规则 id 与官方不同（rule:equivalent.*），事件挂载面（on/phase/priority）一致；
 *   动作 id 与官方相同（这是 UGC 覆盖语义本身）。
 * - fixture 的结算阶段刻意不带 settleComplete 完成标记写入/守卫：专项要求的规则子集不含
 *   AP 分配结算规则，因此 fixture 调度在结算阶段不能像官方那样"整轮可推进"——装载契约面不受影响，
 *   阶段推进不在本专项断言范围。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { StrictJsonCodec } from '../../../core/kernel/spec-compiler/json-codec.js';
import { DEFAULT_TECHNICAL_QUOTAS } from '../../../core/kernel/spec-compiler/types.js';
import { decodePlaypack } from '../../../core/kernel/schedule/playpack-codec.js';
import type { PlaypackDef } from '../../../core/kernel/schedule/playpack.js';
import type { LegalAction } from '../../../core/kernel/actions/types.js';
import type { ActionDef } from '../../../core/kernel/actions/types.js';
import { createFullHarness } from '../../../core/kernel/testing/full-harness.js';
import { ActionCatalog } from '../../../core/kernel/actions/catalog.js';
import { setPath } from '../../../core/kernel/ops/path.js';
import { resetIdCounters } from '../../../core/kernel/state/ids.js';
import { createEmptyWorldState, type WorldState } from '../../../core/kernel/state/world-state.js';
import { createEntityShape } from '../../../core/kernel/state/entity.js';
import { createAgentShape } from '../../../core/kernel/state/agent.js';
import { createNodeShape } from '../../../core/kernel/topology/types.js';
import type { WorldStateHolder } from '../../../core/kernel/ops/transaction.js';
import type { Value } from '../../../core/kernel/state/value.js';
import type { EvalContext } from '../../../core/kernel/expr/engine.js';
import type { CoreMechanicsLoadOptions } from '../load.js';
import { loadCoreMechanics } from '../load.js';
import { CoreMechanicsPlaypack } from '../defs/playpack.js';
import type { CoreMechanicsProjection } from '../projection.js';
import { officialCoreMechanicsConfig, ATTACK_DAMAGE_VALUE } from './official-state-machine-config.js';
import {
  ACT_ATTACK,
  ACT_MOVE,
  ACT_SLEEP_DOWN,
  PLAYPACK_ID,
  POOL_AP,
  POOL_STAMINA,
  RULE_DAMAGE_DEFAULT,
  RULE_OVERLOAD_APPLY,
  RULE_STAMINA_GRANT_DEFAULT,
  SCHEDULE_ID,
  TAG_ROLL_PARTICIPANT,
} from '../defs/ids.js';

// ---------------------------------------------------------------------------
// JSON fixture 装载（读磁盘 → StrictJsonCodec → decodePlaypack）
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'equivalent-playpack.json');

/** 从磁盘读取纯 JSON fixture，经 StrictJsonCodec + decodePlaypack 还原为 PlaypackDef。 */
function loadEquivalentFixtureFromDisk(): PlaypackDef {
  const parsed = new StrictJsonCodec().parse({
    sourceId: 'play/core-mechanics/__tests__/fixtures/equivalent-playpack.json',
    documentUri: 'file:///play/core-mechanics/__tests__/fixtures/equivalent-playpack.json',
    sourcePackage: 'play.core-mechanics.equivalent-fixture',
    sourceText: readFileSync(FIXTURE_PATH, 'utf8'),
    precedence: 100,
    owningLayer: '玩法层',
    normativeStatus: 'normative',
  }, DEFAULT_TECHNICAL_QUOTAS);
  const decoded = decodePlaypack(parsed);
  if (!decoded.ok) {
    throw new Error(`fixture decode failed: ${decoded.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`).join('; ')}`);
  }
  return decoded.value;
}

/** fixture 声明的三条规则 id（与官方规则按事件挂载面配对）。 */
const FIXTURE_RULES = [
  'rule:equivalent.damage.default-apply',
  'rule:equivalent.stamina.default-grant',
  'rule:equivalent.overload.apply',
] as const;

// ---------------------------------------------------------------------------
// 装载驱动（与 state-machine-load-driver.ts / load-injected-pack.test.ts 同构）
// ---------------------------------------------------------------------------

function runtimeOf(harness: ReturnType<typeof createFullHarness>): CoreMechanicsLoadOptions['runtime'] {
  const actionCatalog = new ActionCatalog({
    getState: () => harness.holder.getState(),
    exprEngine: harness.exprEngine,
    queryEngine: harness.queryEngine,
    // 把 ActionCatalog 展开的 target/node 绑定透传给 ctxForSelf（full-harness 的 ctxForSelf 接口
    // 声明为单参，但实现签名接受第二参 vars 并合并进求值上下文；不传的话带目标绑定的动作 require
    // 会在未绑定 var 上求值出 null，攻击/移动永远不可见，投影可见集断言就失去了意义）。
    ctxForActor: ((actor, bindings) =>
      (harness.ctxForSelf as unknown as (ref: { $: string }, vars: Record<string, Value>) => EvalContext)(actor, bindings)) as (
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

/** 预置装载期世界状态：attack 首条守卫读取的 damageAmountRef（与 createLoadedCoreMechanics 一致）。 */
function presetLoadWorld(holder: WorldStateHolder): void {
  holder.setState(setPath(
    holder.getState(),
    'world.props.play.damageAmountRef',
    ATTACK_DAMAGE_VALUE as never,
  ) as WorldState);
}

interface LoadedFixture {
  readonly load: ReturnType<typeof loadCoreMechanics>;
  readonly harness: ReturnType<typeof createFullHarness>;
}

/** 在全新组合根上装载指定玩法包（官方包或 JSON fixture 共用此入口）。 */
function loadOnFreshHarness(playpack: PlaypackDef): LoadedFixture {
  const harness = createFullHarness();
  presetLoadWorld(harness.holder);
  const load = loadCoreMechanics({
    runtime: runtimeOf(harness),
    config: officialCoreMechanicsConfig(),
    playpack,
  });
  return { load, harness };
}

// ---------------------------------------------------------------------------
// 世界里预置英雄/敌人/节点（与 state-machine e2e 的 seedWorld 同构）
// ---------------------------------------------------------------------------

const HERO = 'e:hero';
const ENEMY = 'e:enemy';
const HERO_AGENT = 'g:hero';
const HERO_REF = { $: HERO };

function seedWorld(initialStamina: number): WorldState {
  const base = createEmptyWorldState('sched:fuzz');
  const agents: WorldState['world']['agents'] = {
    [HERO_AGENT]: { ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'), controls: [HERO_REF] },
  };
  const entities: WorldState['entities'] = {
    [HERO]: {
      ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a',
      props: { vitality: 4, rollTier: 3 },
      tags: [TAG_ROLL_PARTICIPANT],
    },
    [ENEMY]: { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:enemy-a', props: { vitality: 3 }, tags: [] },
  };
  const nodes: WorldState['nodes'] = {
    'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
    'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
  };
  let state: WorldState = {
    ...base,
    world: { ...base.world, agents },
    entities,
    nodes,
  };
  state = setPath(state, 'world.props.pools.stamina.e:hero.real', initialStamina as never) as WorldState;
  state = setPath(state, 'world.props.pools.stamina.e:hero.available', initialStamina as never) as WorldState;
  return state;
}

/** 把 seedWorld 的世界叠进已装载的 holder（保留装载写入的玩法配置），并指回对应调度表。 */
function seedIntoHolder(holder: WorldStateHolder, scheduleId: string, initialStamina = 4): void {
  const seeded = seedWorld(initialStamina);
  const loadedState = holder.getState();
  holder.setState({
    ...loadedState,
    world: {
      ...loadedState.world,
      agents: seeded.world.agents,
      props: { ...(loadedState.world.props ?? {}), ...(seeded.world.props ?? {}) },
      turn: { ...loadedState.world.turn, scheduleId },
    },
    entities: seeded.entities,
    nodes: seeded.nodes,
  } as WorldState);
}

// ---------------------------------------------------------------------------
// 契约面等价断言
// ---------------------------------------------------------------------------

const CORE_ACTION_IDS = [ACT_ATTACK, ACT_MOVE, ACT_SLEEP_DOWN] as const;

/** 官方规则 id → 语义关键规则三要素（on 事件 / phase / priority）。 */
const OFFICIAL_RULE_SURFACE: Readonly<Record<string, { readonly on: string; readonly phase: string; readonly priority: number }>> = {
  [RULE_DAMAGE_DEFAULT]: { on: 'play.damage.request', phase: 'default', priority: 100 },
  [RULE_STAMINA_GRANT_DEFAULT]: { on: 'play.stamina.grant', phase: 'default', priority: 100 },
  [RULE_OVERLOAD_APPLY]: { on: 'play.overload.apply', phase: 'default', priority: 100 },
};

function ruleSurface(def: unknown): {
  readonly on: string; readonly phase: string; readonly priority: number;
} {
  const record = def as Record<string, unknown>;
  return { on: String(record['on']), phase: String(record['phase']), priority: Number(record['priority']) };
}

describe('装载等价：官方 TS 包 vs 语义等价 JSON 玩法包（D-081 / L0 第十四条）', () => {
  beforeEach(() => resetIdCounters());

  it('解码：fixture 从磁盘经 StrictJsonCodec + decodePlaypack 还原成功', () => {
    const pack = loadEquivalentFixtureFromDisk();
    expect(pack.kind).toBe('playpack');
    expect(pack.id).toBe('playpack:play.equivalent');
    expect(pack.schedule).toBe('schedule:equivalent');
    expect(pack.pools?.map((p) => p.name)).toEqual([POOL_AP, POOL_STAMINA]);
    expect(pack.defs.filter((d) => d.kind === 'action').map((d) => d.id).sort())
      .toEqual([...CORE_ACTION_IDS].sort());
    expect(pack.defs.filter((d) => d.kind === 'rule').map((d) => d.id).sort())
      .toEqual([...FIXTURE_RULES].sort());
    expect(pack.defs.filter((d) => d.kind === 'schedule')).toHaveLength(1);
    expect(pack.outcomes?.map((o) => o.name)).toEqual(['last-standing', 'round-checkpoint']);
  });

  it('① 池配置逐项一致：name/per/min/max/reset', () => {
    const official = loadOnFreshHarness(CoreMechanicsPlaypack);
    const fixture = loadOnFreshHarness(loadEquivalentFixtureFromDisk());

    expect(official.load.ok).toBe(true);
    expect(fixture.load.ok).toBe(true);
    expect(official.load.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'fatal')).toHaveLength(0);
    expect(fixture.load.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'fatal')).toHaveLength(0);

    const officialPools = official.harness.playpackLoader.loadedPlaypacks()[0]?.pools;
    const fixturePools = fixture.harness.playpackLoader.loadedPlaypacks()[0]?.pools;
    expect(officialPools).toBeDefined();
    expect(fixturePools).toBeDefined();
    expect(officialPools).toEqual(fixturePools);
    expect(officialPools).toEqual([
      { name: POOL_AP, per: 'actor', min: 0, max: 3, reset: 'turn' },
      { name: POOL_STAMINA, per: 'actor', min: 0, max: 5, reset: 'never' },
    ]);
  });

  it('② 调度阶段数 / 阶段顺序 / loop / order 一致（id 允许不同）', () => {
    const official = loadOnFreshHarness(CoreMechanicsPlaypack);
    const fixture = loadOnFreshHarness(loadEquivalentFixtureFromDisk());

    const officialSchedule = official.harness.defRegistry.resolve(SCHEDULE_ID);
    const fixtureSchedule = fixture.harness.defRegistry.resolve('schedule:equivalent');
    expect(officialSchedule).not.toBeNull();
    expect(fixtureSchedule).not.toBeNull();
    if (officialSchedule === null || fixtureSchedule === null) return;

    // id 必须不同（避免同 key 覆盖把两个包混在一起）。
    expect(fixtureSchedule.id).not.toBe(officialSchedule.id);

    const officialPhases = officialSchedule.phases as readonly { readonly id: string; readonly phaseKind?: string; readonly input?: string }[];
    const fixturePhases = fixtureSchedule.phases as readonly { readonly id: string; readonly phaseKind?: string; readonly input?: string }[];

    // 阶段数恒为 5。
    expect(fixturePhases).toHaveLength(5);
    expect(officialPhases).toHaveLength(fixturePhases.length);

    // 阶段顺序按 (phaseKind, input) 逐项一致。
    const shape = (phases: readonly { readonly phaseKind?: string; readonly input?: string }[]) =>
      phases.map((p) => `${p.phaseKind}:${p.input ?? ''}`);
    expect(shape(fixturePhases)).toEqual(shape(officialPhases));
    expect(shape(fixturePhases)).toEqual(['submit:all', 'resolve:none', 'normal:actor', 'normal:none', 'normal:none']);

    // loop / order 一致。
    expect(fixtureSchedule.loop).toBe(true);
    expect(fixtureSchedule.loop).toBe(officialSchedule.loop);
    expect(fixtureSchedule.order).toBe(officialSchedule.order);
  });

  it('③ 语义关键动作子集一致：attack/move/sleep-down 的 cost/effects 深等（同 key 覆盖语义）', () => {
    const official = loadOnFreshHarness(CoreMechanicsPlaypack);
    const fixture = loadOnFreshHarness(loadEquivalentFixtureFromDisk());

    for (const actionId of CORE_ACTION_IDS) {
      const officialAction = official.harness.defRegistry.resolve(actionId) as ActionDef | null;
      const fixtureAction = fixture.harness.defRegistry.resolve(actionId) as ActionDef | null;
      expect(officialAction, `${actionId} 在官方装载后存在`).not.toBeNull();
      expect(fixtureAction, `${actionId} 在 fixture 装载后存在`).not.toBeNull();
      if (officialAction === null || fixtureAction === null) continue;

      // 两个包都用同一动作 id 注册（这正是 UGC 覆盖官方机制的语义）。
      expect(fixtureAction.id).toBe(actionId);

      // cost 结构等价：恰好 [{pool:'ap', amount:1}]。
      expect(fixtureAction.cost).toEqual(officialAction.cost);
      expect(fixtureAction.cost).toEqual([{ pool: POOL_AP, amount: 1 }]);

      // effects 结构深等：fixture 逐字节镜像官方 paidAction 构造（含附着调用块）。
      expect(fixtureAction.effects).toEqual(officialAction.effects);

      // 付费成本类别一致（装载期 Linter 的 costClass 校验在两条路径上都通过——load.ok 已证明）。
      const fixturePlay = (fixtureAction as unknown as { play?: { costClass?: string } }).play;
      const officialPlay = (officialAction as unknown as { play?: { costClass?: string } }).play;
      expect(fixturePlay?.costClass).toBe('paid');
      expect(officialPlay?.costClass).toBe(fixturePlay?.costClass);
    }
  });

  it('③ 规则挂载面一致：fixture 每条规则按 (on 事件 / phase / priority) 与官方对应规则配对，且两套规则都挂进 ruleProvider', () => {
    const official = loadOnFreshHarness(CoreMechanicsPlaypack);
    const fixture = loadOnFreshHarness(loadEquivalentFixtureFromDisk());

    const officialRuleIds = Object.keys(OFFICIAL_RULE_SURFACE);
    for (let index = 0; index < officialRuleIds.length; index += 1) {
      const officialRuleId = officialRuleIds[index] as string;
      const fixtureRuleId = FIXTURE_RULES[index] as string;
      const expected = OFFICIAL_RULE_SURFACE[officialRuleId];

      const officialDef = official.harness.defRegistry.resolve(officialRuleId);
      const fixtureDef = fixture.harness.defRegistry.resolve(fixtureRuleId);
      expect(officialDef, `${officialRuleId} 已注册`).not.toBeNull();
      expect(fixtureDef, `${fixtureRuleId} 已注册`).not.toBeNull();
      if (officialDef === null || fixtureDef === null) continue;

      // 事件挂载面三要素一致。
      expect(ruleSurface(fixtureDef)).toEqual(expected);
      expect(ruleSurface(officialDef)).toEqual(expected);

      // 两套规则都真实挂进 Hook 管道（官方经 CORE_MECHANICS_RULES、fixture 经包内 rules 引用）。
      expect(official.harness.ruleProvider.has(officialRuleId)).toBe(true);
      expect(fixture.harness.ruleProvider.has(fixtureRuleId)).toBe(true);
    }

    // fixture 的常驻规则集合 = 声明集合（无遗漏、无多余挂载）。
    expect(fixture.harness.ruleProvider.allRuleIds().sort()).toEqual([...FIXTURE_RULES].sort());
  });

  it('④ 同一坏包注入：TS 路径与 JSON 路径的拒绝诊断码集合一致（E_LOAD_LAYER_OWNERSHIP）', () => {
    // 坏包 = 语义等价包 + 一条规则的效果引用未注册 Op（玩法层 Linter 的 Op 合法性校验命中）。
    const fixturePack = loadEquivalentFixtureFromDisk();
    const fixtureRule = fixturePack.defs.find((d) => d.id === 'rule:equivalent.damage.default-apply');
    expect(fixtureRule).toBeDefined();
    if (fixtureRule === undefined) return;
    (fixtureRule as unknown as { effects: unknown }).effects = [{ op: 'totally.not-registered-op', args: {} }];

    // 官方包做完全相同的破坏（只改同一条语义规则），作为拒绝码集合的对照基线。
    const officialPack = structuredClone(CoreMechanicsPlaypack);
    const officialRule = officialPack.defs.find((d) => d.id === RULE_DAMAGE_DEFAULT);
    expect(officialRule).toBeDefined();
    if (officialRule === undefined) return;
    (officialRule as unknown as { effects: unknown }).effects = [{ op: 'totally.not-registered-op', args: {} }];

    const badFixture = loadOnFreshHarness(fixturePack);
    const badOfficial = loadOnFreshHarness(officialPack);

    expect(badFixture.load.ok).toBe(false);
    expect(badOfficial.load.ok).toBe(false);

    const fixtureCodes = [...new Set(badFixture.load.diagnostics.map((d) => d.code))].sort();
    const officialCodes = [...new Set(badOfficial.load.diagnostics.map((d) => d.code))].sort();
    expect(fixtureCodes).toContain('E_LOAD_LAYER_OWNERSHIP');
    expect(officialCodes).toContain('E_LOAD_LAYER_OWNERSHIP');
    expect(fixtureCodes).toEqual(officialCodes);

    // 原子拒绝：玩法层 Linter 先于任何注册表改动拒绝，fixture 的 def 一条都没有进注册表。
    expect(badFixture.harness.defRegistry.resolve('rule:equivalent.damage.default-apply')).toBeNull();
    expect(badFixture.harness.defRegistry.resolve('action:play.attack')).toBeNull();
    expect(badFixture.harness.defRegistry.resolve('totally.not-registered-op')).toBeNull();
  });

  it('⑤ 装载后投影可见动作集：fixture 可见集 = 官方可见集在核心子集上的投影，逐项 cost 一致', () => {
    const official = loadOnFreshHarness(CoreMechanicsPlaypack);
    const fixture = loadOnFreshHarness(loadEquivalentFixtureFromDisk());
    seedIntoHolder(official.harness.holder, SCHEDULE_ID);
    seedIntoHolder(fixture.harness.holder, 'schedule:equivalent');

    const officialProjection = official.load.projection as unknown as CoreMechanicsProjection | null;
    const fixtureProjection = fixture.load.projection as unknown as CoreMechanicsProjection | null;
    expect(officialProjection).not.toBeNull();
    expect(fixtureProjection).not.toBeNull();
    if (officialProjection === null || fixtureProjection === null) return;

    const visibleIds = (groups: { paid: readonly (readonly LegalAction[])[]; attached: readonly (readonly LegalAction[])[] }) =>
      [...new Set([...groups.paid.flat(), ...groups.attached.flat()].map((a) => a.action))];
    const officialVisible = visibleIds(officialProjection.legalActions(HERO_REF, 'ui'));
    const fixtureVisible = visibleIds(fixtureProjection.legalActions(HERO_REF, 'ui'));

    // fixture 只声明核心子集 → 它的可见动作集恰好是这三个动作。
    expect([...fixtureVisible].sort()).toEqual([...CORE_ACTION_IDS].sort());

    // 官方在相同世界里也暴露这三个动作（且是同一批 id）。
    for (const actionId of CORE_ACTION_IDS) {
      expect(officialVisible).toContain(actionId);
    }

    // 核心子集上的投影等价：官方可见集 ∩ 核心动作 = fixture 可见集。
    const officialCore = officialVisible
      .filter((id) => (CORE_ACTION_IDS as readonly string[]).includes(id))
      .sort();
    expect(officialCore).toEqual([...fixtureVisible].sort());

    // 逐项 cost 一致（投影返回的合法动作都携带 cost）。
    const flatten = (groups: { paid: readonly (readonly LegalAction[])[]; attached: readonly (readonly LegalAction[])[] }) =>
      [...groups.paid.flat(), ...groups.attached.flat()];
    const officialAll = flatten(officialProjection.legalActions(HERO_REF, 'ui'));
    const fixtureAll = flatten(fixtureProjection.legalActions(HERO_REF, 'ui'));
    for (const actionId of CORE_ACTION_IDS) {
      const officialEntry = officialAll.find((a) => a.action === actionId);
      const fixtureEntry = fixtureAll.find((a) => a.action === actionId);
      expect(officialEntry, `${actionId} 在官方投影中可见`).toBeDefined();
      expect(fixtureEntry, `${actionId} 在 fixture 投影中可见`).toBeDefined();
      expect(fixtureEntry?.cost).toEqual(officialEntry?.cost);
      expect(fixtureEntry?.cost).toEqual([{ pool: POOL_AP, amount: 1 }]);
    }
  });

  it('UGC 覆盖官方机制：官方包与 fixture 顺序装载同一组合根，同 key 后装覆盖、两套规则并存', () => {
    const harness = createFullHarness();
    presetLoadWorld(harness.holder);
    const runtime = runtimeOf(harness);

    const first = loadCoreMechanics({ runtime, config: officialCoreMechanicsConfig(), playpack: CoreMechanicsPlaypack });
    expect(first.ok).toBe(true);

    const second = loadCoreMechanics({ runtime, config: officialCoreMechanicsConfig(), playpack: loadEquivalentFixtureFromDisk() });
    expect(second.ok).toBe(true);
    expect(second.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'fatal')).toHaveLength(0);

    // D-073 单调重定义：fixture 复用官方动作 id，后装覆盖先装 → 注册表里 action:play.attack
    // 是 fixture 版本（以 fixture 的 tags:['ugc'] 判别），且没有触发 E_LOAD_CONFLICT。
    const attack = harness.defRegistry.resolve(ACT_ATTACK);
    expect(attack?.tags).toEqual(['ugc']);

    // 两个包都在装载历史里，官方调度与 fixture 调度共存（id 不同不互相覆盖）。
    expect(harness.playpackLoader.loadedPlaypacks().map((p) => p.id).sort())
      .toEqual([PLAYPACK_ID, 'playpack:play.equivalent'].sort());
    expect(harness.defRegistry.resolve(SCHEDULE_ID)?.kind).toBe('schedule');
    expect(harness.defRegistry.resolve('schedule:equivalent')?.kind).toBe('schedule');

    // 官方规则（默认装载挂载）与 fixture 规则（包内 rules 引用挂载）并存于同一 Hook 管道。
    expect(harness.ruleProvider.has(RULE_DAMAGE_DEFAULT)).toBe(true);
    expect(harness.ruleProvider.has(RULE_STAMINA_GRANT_DEFAULT)).toBe(true);
    expect(harness.ruleProvider.has(RULE_OVERLOAD_APPLY)).toBe(true);
    expect(harness.ruleProvider.has('rule:equivalent.damage.default-apply')).toBe(true);
    expect(harness.ruleProvider.has('rule:equivalent.stamina.default-grant')).toBe(true);
    expect(harness.ruleProvider.has('rule:equivalent.overload.apply')).toBe(true);
  });
});
