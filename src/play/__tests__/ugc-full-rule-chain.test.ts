/**
 * 装载等价收尾 P5 交付物：完整规则玩法包走真实上传链端到端装载。
 *
 * 链路：uploaded zip（playpack.json 清单 + profiles + 可选地图）→ compile() →
 * compileToPlaypackDef() → loadCoreMechanics() → 新玩法层。
 *
 * 与 B2（ugc-load-chain.test.ts）的关系：B2 证明 profile 型包的 ①②③④⑤；本文件补的是
 * P5 合并——playpack 清单（defs/rules/schedule/actions）与 profiles/maps 展开 defs 的并集装载：
 *  - ① compile() 识别 playpack.json 清单（artifact.playpackDef 非空）且与 profiles 并存；
 *  - ② assemble 以清单为基合并：包级声明（schedule/pools/rules/outcomes）取自清单，清单 defs
 *    原样并入 + profiles/maps 展开 defs 追加；
 *  - ③ loadCoreMechanics 装载成功：清单动作可提交（intent 链路）、清单规则挂进 ruleProvider、
 *    调度表注册、池配置生效；
 *  - ④ 与官方同 key 的清单动作后装覆盖官方版（D-073）；
 *  - ⑤ 清单缺 play 扩展的 def（auto 派生样本）自动补归属后同样装载成功——玩家包不写归属也能进。
 *
 * 自主设计判断（如实记录）：
 * - 清单样本带独立 id/调度/池/规则，避免与官方包 key 撞车干扰 ③ 的纯装载断言；覆盖语义单列
 *   （④ 用同 key 动作）。两样本独立装载，互不污染。
 * - auto 派生样本的规则效果只引用引擎已注册 Op（prop.set / emit），规避 E_LOAD_LAYER_OWNERSHIP
 *   （引擎 Op 合法性由玩法层 Linter 校验，UGC 只允许引用已注册 Op，与 B2 同一纪律）。
 * - 动作 cost 固定 [{pool:'ap', amount:1}]（玩法层 Linter 对付费动作成本的硬性要求）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { compile, compileToPlaypackDef, type PlaypackInput } from '../playpack-compiler/index';
import { loadCoreMechanics, CoreMechanicsFacade, type CoreMechanicsLoadOptions } from '../core-mechanics/load';
import { createLoadedCoreMechanics } from '../core-mechanics/__tests__/state-machine-load-driver';
import { ACT_ATTACK, POOL_AP } from '../core-mechanics/defs/ids';
import { setPath } from '../../core/kernel/ops/path';
import { resetIdCounters } from '../../core/kernel/state/ids';
import type { FullHarness } from '../../core/kernel/testing/full-harness';
import { createEmptyWorldState, type WorldState } from '../../core/kernel/state/world-state';
import { createEntityShape } from '../../core/kernel/state/entity';
import { createAgentShape } from '../../core/kernel/state/agent';
import { createContainerShape, createSlotShape, createNodeShape } from '../../core/kernel/topology/types';
import type { PlaypackDef } from '../../core/kernel/schedule/playpack';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
}

/** 完整规则清单样本：独立 id/调度/池/规则（与官方 key 不撞，纯装载断言用）。 */
const FULL_MANIFEST = readFixture('ugc-full-rule-manifest.json');

/** 与官方同 key 攻击动作的覆盖样本（D-073 后装覆盖断言用）。 */
const OVERRIDE_MANIFEST = readFixture('ugc-override-attack-manifest.json');

/** weapons profile（与清单并存：同包允许 profile + 清单）。 */
const UGC_WEAPON_PROFILE = JSON.stringify({
  id: 'item:ugc.energy-blade',
  name: '能量刃',
  classComposition: { classIds: ['weapon.class.melee'] },
  damage: 3,
  range: 1,
});

/** 缺 play 扩展的裸动作（auto 派生样本）：assemble 应自动补归属后装载成功。 */
const BARE_ACTION_PROFILE = JSON.stringify({
  id: 'action:play.ugc.bare-probe',
  kind: 'action',
  label: '裸探针',
  group: 'play.paid',
  require: true,
  cost: [{ pool: POOL_AP, amount: 1 }],
  effects: [{ op: 'prop.set', args: { path: 'world.props.play.ugcBareProbe', value: 1 } }],
});

function makeUploadedInput(manifests: ReadonlyMap<string, string>, id: string): PlaypackInput {
  return {
    id,
    name: 'UGC 完整规则包',
    version: '1.0.0',
    manifests,
    assets: new Map(),
    source: 'uploaded',
    creatorSteamId: 'steam:test-ugc-creator',
  };
}

/** 与 state-machine-load-driver 同构的装载 runtime（queryActions 转发，投影可用）。 */
function runtimeOf(harness: FullHarness): CoreMechanicsLoadOptions['runtime'] {
  return {
    registry: harness.registry,
    defRegistry: harness.defRegistry,
    ruleProvider: harness.ruleProvider,
    playpackLoader: harness.playpackLoader,
    holder: harness.holder,
    queryActions: (actorRef: { $: string }, mode: 'ui' | 'ai') => harness.actionCatalog.queryActions(actorRef, mode),
  };
}

function blockingCodes(load: { diagnostics: readonly { readonly code: string; readonly severity: string }[] }): readonly string[] {
  return load.diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'fatal')
    .map((d) => d.code);
}

/** 种入英雄/敌人/节点/容器/agent 并推进到玩家行动阶段（与 state-machine e2e 的 makeFixture 同构）。 */
function seedActionWorld(harness: FullHarness, pack: PlaypackDef): void {
  const holder = harness.holder;
  const HERO = 'e:hero';
  const ENEMY = 'e:enemy';
  const HERO_AGENT = 'g:hero';
  const HERO_REF = { $: HERO };
  void HERO_REF;
  // 保留装载写入的玩法配置，在其上叠加实体/节点/容器/agent，并把 turn 指向清单调度表。
  const loadedState = holder.getState();
  const seeded = ((): WorldState => {
    const base = createEmptyWorldState(pack.schedule ?? 'schedule:play.core');
    const agents: WorldState['world']['agents'] = {
      [HERO_AGENT]: { ...createAgentShape(HERO_AGENT, 'human', 'ks:hero'), controls: [{ $: HERO }] },
    };
    const entities: WorldState['entities'] = {
      [HERO]: {
        ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a',
        props: { vitality: 4, rollTier: 3 },
        containers: { bag: 'c:hero-bag' },
        tags: ['play:roll-participant'],
      },
      [ENEMY]: { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:enemy-a', props: { vitality: 3 }, tags: [] },
    };
    const nodes: WorldState['nodes'] = {
      'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
      'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
    };
    const heroBag = { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] };
    return { ...base, world: { ...base.world, agents }, entities, nodes, containers: { 'c:hero-bag': heroBag } };
  })();
  holder.setState({
    ...loadedState,
    world: {
      ...loadedState.world,
      agents: seeded.world.agents,
      props: { ...(loadedState.world.props ?? {}), ...(seeded.world.props ?? {}) },
      turn: { ...loadedState.world.turn, scheduleId: pack.schedule ?? 'schedule:play.core' },
    },
    entities: seeded.entities,
    nodes: seeded.nodes,
    containers: seeded.containers,
  } as WorldState);
  // 直接进入行动阶段：清单调度只有行动/结算两阶段，行动阶段即索引 0。
  holder.setState(setPath(
    holder.getState(),
    'world.turn.phaseIndex',
    0 as never,
  ) as WorldState);
  // 预置英雄的 AP 池（cost-frozen 按 controlled-entity 作用域读 `pools.ap.<entity>.available`）。
  // loadCoreMechanics 不调 `playpack.activate`（池初始化在 `activate` Op 里走，见
  // playpack-runtime.ts:66），因此测试侧需显式写池，与 state-machine e2e 的 stamina 池预置
  // 同一纪律（state-machine.e2e.test.ts:103-104）。
  const HERO_ENTITY = 'e:hero';
  holder.setState(setPath(holder.getState(), `world.props.pools.ap.${HERO_ENTITY}.real`, 1) as WorldState);
  holder.setState(setPath(holder.getState(), `world.props.pools.ap.${HERO_ENTITY}.available`, 1) as WorldState);
}

describe('P5：完整规则玩法包上传链端到端（playpack 清单合并装载）', () => {
  beforeEach(() => resetIdCounters());

  it('① compile() 识别 playpack.json 清单，且与 profiles 并存', async () => {
    const input = makeUploadedInput(new Map<string, string>([
      ['playpack.json', FULL_MANIFEST],
      ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
    ]), 'playpack:play.ugc-full-rule');
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('带清单+profile 的包应编译通过');
    expect(result.artifact.playpackDef).toBeDefined();
    expect(result.artifact.profiles).toHaveLength(1);
    expect(result.artifact.maps).toHaveLength(0);
  });

  it('② assemble 以清单为基合并：包级声明取自清单，清单 defs + profile defs 并集', async () => {
    const input = makeUploadedInput(new Map<string, string>([
      ['playpack.json', FULL_MANIFEST],
      ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
    ]), 'playpack:play.ugc-full-rule');
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('编译应成功');
    const pack = compileToPlaypackDef(result.artifact);

    // 包级声明来自清单（清单解码产物优先于 input）。
    expect(pack.id).toBe('playpack:play.ugc-full-rule');
    expect(pack.schedule).toBe('schedule:ugc-full');
    expect(pack.pools?.map((p) => p.name)).toEqual([POOL_AP]);
    expect(pack.rules).toEqual(['rule:ugc-full.taunt']);

    // defs = 清单 defs（动作/规则/调度）+ profile defs。
    const ids = pack.defs.map((d) => d.id);
    expect(ids).toContain('action:play.ugc.taunt');
    expect(ids).toContain('rule:ugc-full.taunt');
    expect(ids).toContain('schedule:ugc-full');
    expect(ids).toContain('item:ugc.energy-blade');
    // 清单 defs 的 play 扩展原样保留（不覆盖、不丢失）。
    const taunt = pack.defs.find((d) => d.id === 'action:play.ugc.taunt');
    expect((taunt as { play?: { costClass?: string } }).play?.costClass).toBe('paid');
    // 装配 props 透传叠加。
    expect(pack.props?.['source']).toBe('uploaded');
  });

  it('③ loadCoreMechanics 装载成功：清单动作可提交、规则挂进 ruleProvider、调度与池生效', async () => {
    const input = makeUploadedInput(new Map<string, string>([
      ['playpack.json', FULL_MANIFEST],
      ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
    ]), 'playpack:play.ugc-full-rule');
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('编译应成功');
    const ugcPack = compileToPlaypackDef(result.artifact);

    const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
    expect(officialLoad.ok).toBe(true);
    const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack: ugcPack });
    expect(ugcLoad.ok).toBe(true);
    expect(blockingCodes(ugcLoad)).toEqual([]);

    // 清单 def 全部进入注册表。
    expect(harness.defRegistry.resolve('action:play.ugc.taunt')?.kind).toBe('action');
    expect(harness.defRegistry.resolve('rule:ugc-full.taunt')?.kind).toBe('rule');
    expect(harness.defRegistry.resolve('schedule:ugc-full')?.kind).toBe('schedule');
    // 清单规则挂进 ruleProvider（经包内 rules 引用，官方包同一装载语义）。
    expect(harness.ruleProvider.has('rule:ugc-full.taunt')).toBe(true);
    // profile def 一并进入。
    expect(harness.defRegistry.resolve('item:ugc.energy-blade')?.kind).toBe('item');

    // 清单动作可经 facade 提交（intent 链路走通：submit → resolve）。
    // 需要真实行动者（agent.controls + roll-participant + 结算过的 turnOrder），因此先种入
    // 与 state-machine e2e 同构的英雄世界并推进到玩家行动阶段。
    seedActionWorld(harness, ugcPack);
    const facade = new CoreMechanicsFacade(harness.registry, ugcPack);
    const submitted = facade.submit({ actorRef: { $: 'e:hero' }, actionId: 'action:play.ugc.taunt', bindings: {} });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(`taunt 提交失败：${submitted.detail ?? '未知'}`);
    const resolved = facade.resolve(submitted.value.intentId);
    expect(resolved.ok).toBe(true);
    // 效果真实落地：taunt 效果 prop.set `world.props.play.ugcTauntUsed`=1（清单 rule 挂进
    // ruleProvider，结算走 production 的请求记录/规则管道）；这里经 intent.resolve 触发。
    expect((harness.holder.getState().world.props as Record<string, unknown>)['play'])
      .toMatchObject({ ugcTauntUsed: 1 });
  });

  it('④ 与官方同 key 的清单动作后装覆盖官方版（D-073 单调重定义）', async () => {
    const input = makeUploadedInput(new Map<string, string>([
      ['playpack.json', OVERRIDE_MANIFEST],
    ]), 'playpack:play.ugc-override-attack');
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('覆盖样本应编译通过');
    const ugcPack = compileToPlaypackDef(result.artifact);
    expect(ugcPack.defs.map((d) => d.id)).toContain(ACT_ATTACK);

    const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
    expect(officialLoad.ok).toBe(true);
    const officialAttack = harness.defRegistry.resolve(ACT_ATTACK);
    expect(officialAttack?.kind).toBe('action');

    const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack: ugcPack });
    expect(ugcLoad.ok).toBe(true);
    expect(blockingCodes(ugcLoad)).toEqual([]);

    const overridden = harness.defRegistry.resolve(ACT_ATTACK);
    expect(overridden?.kind).toBe('action');
    // 注册表以 UGC 版为准：effects 是 UGC 版本，且与官方版不同。
    expect((overridden as { effects?: unknown }).effects).toEqual([
      { op: 'prop.set', args: { path: 'world.props.play.ugcAttackUsed', value: 1 } },
    ]);
    expect((overridden as { effects?: unknown }).effects).not.toEqual(officialAttack?.effects);
  });

  it('⑤ 清单缺 play 扩展的 def 自动补归属后同样装载成功（玩家包不写归属也能进）', async () => {
    // 无清单：一个裸 action profile（无 play 扩展）→ 自动派生归属 → 装载成功。
    const input = makeUploadedInput(new Map<string, string>([
      ['weapons/ugc_bare.json', BARE_ACTION_PROFILE],
    ]), 'playpack:play.ugc-bare-action');
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('裸动作包应编译通过');
    const ugcPack = compileToPlaypackDef(result.artifact);

    const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
    expect(officialLoad.ok).toBe(true);
    const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack: ugcPack });
    expect(ugcLoad.ok).toBe(true);
    expect(blockingCodes(ugcLoad)).toEqual([]);
    expect(harness.defRegistry.resolve('action:play.ugc.bare-probe')?.kind).toBe('action');

    // 清单 defs（缺 play）经 ensurePlayExtension 自动派生：数值叶全部有归属，Linter 不再拒绝。
    const bare = harness.defRegistry.resolve('action:play.ugc.bare-probe') as { play?: { numericOwnership?: Record<string, unknown> } };
    expect(bare.play?.numericOwnership?.['cost.0.amount']).toBeDefined();
    expect(bare.play?.numericOwnership?.['effects.0.args.value']).toBeDefined();
  });
});
