/**
 * uploaded 玩法包全链路测试（装载等价专项 D-081 / L0 第十四条，B2 交付物）。
 *
 * 验证「zip manifests → compile() → compileToPlaypackDef → loadCoreMechanics → 新玩法层」整条链：
 *  - ① compile() 通过且 deliveryForm 正确（无地图 ordinary / 带地图 entry-by-map）；
 *  - ② compileToPlaypackDef 产出可装载 PlaypackDef（id/version/defs 非空、props 透传）；
 *  - ③ 经 loadCoreMechanics 装载后活动注册表包含 UGC def（defRegistry.resolve 断言）；
 *  - ④ D-073 单调重定义：同 key 后装覆盖先装——UGC action:play.attack 覆盖官方版（effects 不同）；
 *  - ⑤ 剔除（回滚）语义：PlaypackLoader.restoreLoaded + 重装官方包后，注册表恢复官方定义。
 *
 * 多包顺序装载约束：createFullHarness 的 playpackLoader 在 harness 创建后即固定，因此 ④⑤
 * 必须在**同一个 harness** 上依次 load（先官方后 UGC、再回滚重装官方），断言注册表最终状态。
 *
 * 自主设计判断（如实记录）：
 * 1. UGC 动作的效果引用引擎已注册 Op `prop.set`（参照 defs/actions.paid.ts 只使用已注册 Op 的
 *    纪律），避免被玩法层 Linter 以 E_LOAD_LAYER_OWNERSHIP 拒绝。
 * 2. 带地图样本只断言编译与装配两层（deliveryForm entry-by-map、defs 含 prefab），不执行
 *    loadCoreMechanics：map-compile 产出的 PrefabDef 不带 `play` 扩展命名空间，而玩法层 Linter
 *    的 validateNumericOwnership 对无 play 扩展的 def 恒报 E_LOAD_NUMERIC_OWNERSHIP——态二
 *    （进图装整包）的装载最后一步当前被阻塞。已登记为交接项（修复归属：装配桥跳过 prefab /
 *    Linter 豁免 prefab / prefab 补 play 扩展，待相关线裁决），本文件不把它断言成通过。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compile, compileToPlaypackDef, type PlaypackInput } from '../playpack-compiler/index.js';
import { loadCoreMechanics, type CoreMechanicsLoadOptions, type CoreMechanicsLoadResult } from '../core-mechanics/load.js';
import { createLoadedCoreMechanics } from '../core-mechanics/__tests__/state-machine-load-driver.js';
import { ACT_ATTACK } from '../core-mechanics/defs/ids.js';
import { CoreMechanicsPlaypack } from '../core-mechanics/defs/playpack.js';
import { resetIdCounters } from '../../core/kernel/state/ids.js';
import type { FullHarness } from '../../core/kernel/testing/full-harness.js';

// ---------------------------------------------------------------------------
// UGC 包样本（uploaded 来源，strict JSON 解析可接受：无注释/尾逗号/重复键）
// ---------------------------------------------------------------------------

/** weapons profile：组合基类层近战类，数值全部落在 1-5 且声明归属。 */
const UGC_WEAPON_PROFILE = JSON.stringify({
  id: 'item:ugc.energy-blade',
  name: '能量刃',
  classComposition: { classIds: ['weapon.class.melee'] },
  damage: 3,
  range: 1,
  play: {
    numericOwnership: {
      damage: { kind: 'gameplay', min: 1, max: 5, int: true },
      range: { kind: 'gameplay', min: 1, max: 5, int: true },
    },
    sourceTrace: ['D-081'],
  },
});

/** items profile：组合基类层消耗品类，healRate 落在 1-5 且声明归属。 */
const UGC_ITEM_PROFILE = JSON.stringify({
  id: 'item:ugc.medkit',
  name: '急救包',
  classComposition: { classIds: ['item.class.consumable'] },
  healRate: 2,
  play: {
    numericOwnership: {
      healRate: { kind: 'gameplay', min: 1, max: 5, int: true },
    },
    sourceTrace: ['D-081'],
  },
});

/**
 * UGC 版 `action:play.attack`：与官方同 id、不同 effects（官方走 play.damage.request 事件链，
 * 这里只写一条 prop.set）。必须引用引擎已注册 Op，否则被 E_LOAD_LAYER_OWNERSHIP 拒绝。
 */
const UGC_ATTACK_EFFECTS = [
  { op: 'prop.set', args: { path: 'world.props.play.ugcAttackUsed', value: 1 } },
];

/** 同 key 重定义的 UGC 攻击 profile（weapons 目录 + 显式 kind:'action'）。 */
const UGC_ATTACK_PROFILE = JSON.stringify({
  id: ACT_ATTACK,
  kind: 'action',
  name: 'UGC 攻击',
  label: 'UGC 重击',
  group: 'play.paid',
  require: true,
  cost: [{ pool: 'ap', amount: 1 }],
  effects: UGC_ATTACK_EFFECTS,
  play: {
    numericOwnership: {
      'cost.0.amount': { kind: 'constitutional', sourceId: 'S8 一个动作永远 1 AP' },
      'effects.0.args.value': { kind: 'gameplay', min: 1, max: 5, int: true },
    },
    costClass: 'paid',
    sourceTrace: ['D-081'],
  },
});

/** 合法地图样本（结构校验零诊断，compileMap 产出 prefab）。 */
const UGC_SHELTER_MAP = JSON.stringify({
  schemaVersion: '1.0',
  id: 'ugc-shelter',
  name: 'UGC 避难所',
  backdrop: { image: 'shelter.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: 'n1', def: 'scene.class.room', scale: 'small', at: { x: 0.5, y: 0.5 }, floor: 0 },
  ],
  edges: [],
  placements: [],
});

function makeUploadedInput(
  manifests: ReadonlyMap<string, string>,
  overrides?: Partial<PlaypackInput>,
): PlaypackInput {
  return {
    id: 'playpack:play.ugc-shelter-kit',
    name: 'UGC 避难套件',
    version: '1.0.0',
    manifests,
    assets: new Map(),
    source: 'uploaded',
    creatorSteamId: 'steam:test-ugc-creator',
    ...overrides,
  };
}

/** 与 state-machine-load-driver 同构的装载 runtime（queryActions 省略，projection 为 null 即可）。 */
function runtimeOf(harness: FullHarness): CoreMechanicsLoadOptions['runtime'] {
  return {
    registry: harness.registry,
    defRegistry: harness.defRegistry,
    ruleProvider: harness.ruleProvider,
    playpackLoader: harness.playpackLoader,
    holder: harness.holder,
  };
}

function blockingDiagnostics(load: CoreMechanicsLoadResult): readonly string[] {
  return load.diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'fatal')
    .map((d) => d.code);
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

describe('uploaded 玩法包全链路（D-081 / L0 第十四条，B2）', () => {
  beforeEach(() => resetIdCounters());

  describe('编译与装配（① ②）', () => {
    it('① 无地图 uploaded 包 → compile ok 且 deliveryForm=ordinary', async () => {
      const input = makeUploadedInput(new Map<string, string>([
        ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
        ['items/ugc_medkit.json', UGC_ITEM_PROFILE],
      ]));

      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('无地图 uploaded 包应编译通过');
      expect(result.artifact.deliveryForm).toBe('ordinary');
      expect(result.artifact.profiles).toHaveLength(2);
      expect(result.artifact.maps).toHaveLength(0);
    });

    it('① 带地图 uploaded 包 → compile ok 且 deliveryForm=entry-by-map', async () => {
      const input = makeUploadedInput(new Map<string, string>([
        ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
        ['items/ugc_medkit.json', UGC_ITEM_PROFILE],
        ['maps/ugc_shelter.json', UGC_SHELTER_MAP],
      ]), { id: 'playpack:play.ugc-map-shelter' });

      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('带地图 uploaded 包应编译通过');
      expect(result.artifact.deliveryForm).toBe('entry-by-map');
      expect(result.artifact.maps).toHaveLength(1);
    });

    it('② compileToPlaypackDef 产出可装载 PlaypackDef（id/version/defs 非空、props 透传）', async () => {
      const input = makeUploadedInput(new Map<string, string>([
        ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
        ['items/ugc_medkit.json', UGC_ITEM_PROFILE],
      ]));
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('编译应成功');

      const pack = compileToPlaypackDef(result.artifact);
      expect(pack.id).toBe(input.id);
      expect(pack.kind).toBe('playpack');
      expect(pack.version).toBe('1.0.0');
      expect(pack.defs.length).toBe(2);
      // props 透传：deliveryForm / referencedClassIds（稳定排序）/ source。
      expect(pack.props?.['deliveryForm']).toBe('ordinary');
      expect(pack.props?.['source']).toBe('uploaded');
      expect(pack.props?.['referencedClassIds']).toEqual(['item.class.consumable', 'weapon.class.melee']);
      // defs 展开：两个 profile → 两个可注册 def。
      expect(pack.defs.map((d) => d.id)).toEqual(['item:ugc.energy-blade', 'item:ugc.medkit']);
      expect(pack.defs.every((d) => d.kind === 'item')).toBe(true);
    });

    it('② 带地图包装配：defs 并入 prefab def，props 透传 entry-by-map', async () => {
      const input = makeUploadedInput(new Map<string, string>([
        ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
        ['items/ugc_medkit.json', UGC_ITEM_PROFILE],
        ['maps/ugc_shelter.json', UGC_SHELTER_MAP],
      ]), { id: 'playpack:play.ugc-map-shelter' });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('编译应成功');

      const pack = compileToPlaypackDef(result.artifact);
      expect(pack.props?.['deliveryForm']).toBe('entry-by-map');
      expect(pack.props?.['source']).toBe('uploaded');
      expect(pack.defs.some((d) => d.id === 'd:map/ugc-shelter' && d.kind === 'prefab')).toBe(true);
      expect(pack.defs.some((d) => d.id === 'item:ugc.energy-blade')).toBe(true);
      expect(pack.defs).toHaveLength(3);
    });
  });

  describe('装载（③）', () => {
    it('③ loadCoreMechanics 装载 UGC 包后活动注册表包含 UGC def', async () => {
      const input = makeUploadedInput(new Map<string, string>([
        ['weapons/ugc_blade.json', UGC_WEAPON_PROFILE],
        ['items/ugc_medkit.json', UGC_ITEM_PROFILE],
      ]));
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('编译应成功');
      const ugcPack = compileToPlaypackDef(result.artifact);

      // 同一 harness：先官方（createLoadedCoreMechanics 内部完成），后 UGC。
      const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
      expect(officialLoad.ok).toBe(true);

      const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack: ugcPack });
      expect(ugcLoad.ok).toBe(true);
      expect(blockingDiagnostics(ugcLoad)).toHaveLength(0);

      // 活动注册表以 UGC 的 def 为准（resolve 断言）。
      expect(harness.defRegistry.resolve('item:ugc.energy-blade')?.kind).toBe('item');
      expect(harness.defRegistry.resolve('item:ugc.medkit')?.kind).toBe('item');
      expect(harness.playpackLoader.loadedPlaypacks().map((p) => p.id)).toContain(ugcPack.id);
    });
  });

  describe('同 key 后装覆盖先装与回滚（④ ⑤，D-073）', () => {
    it('UGC attack 覆盖官方 attack；restoreLoaded + 重装官方后官方定义恢复', async () => {
      const input = makeUploadedInput(new Map<string, string>([
        ['weapons/ugc_attack.json', UGC_ATTACK_PROFILE],
      ]), { id: 'playpack:play.ugc-attack' });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('UGC 攻击包应编译通过');
      const ugcPack = compileToPlaypackDef(result.artifact);
      expect(ugcPack.defs.map((d) => d.id)).toContain(ACT_ATTACK);

      const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
      expect(officialLoad.ok).toBe(true);

      // ④ 同 key 后装覆盖先装（同一 harness，先官方后 UGC）。
      const officialAttack = harness.defRegistry.resolve(ACT_ATTACK);
      expect(officialAttack?.kind).toBe('action');

      const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack: ugcPack });
      expect(ugcLoad.ok).toBe(true);
      expect(blockingDiagnostics(ugcLoad)).toHaveLength(0);

      const overridden = harness.defRegistry.resolve(ACT_ATTACK);
      expect(overridden?.kind).toBe('action');
      // 注册表以 UGC 版为准：effects 是 UGC 版本，且与官方版不同。
      expect((overridden as { effects?: { op: string; args: { path: string } }[] }).effects).toEqual(UGC_ATTACK_EFFECTS);
      expect((overridden as { effects?: unknown }).effects).not.toEqual(officialAttack?.effects);
      expect((overridden as { play?: { costClass?: string } }).play?.costClass).toBe('paid');

      // ⑤ 剔除（回滚）：restoreLoaded 移除 UGC 包后重新装载官方包，官方定义恢复。
      harness.playpackLoader.restoreLoaded([CoreMechanicsPlaypack]);
      const reload = loadCoreMechanics({ runtime: runtimeOf(harness), config });
      expect(reload.ok).toBe(true);
      const restored = harness.defRegistry.resolve(ACT_ATTACK);
      expect(restored?.kind).toBe('action');
      expect(restored?.effects).toEqual(officialAttack?.effects);
      // 装载列表不再包含 UGC 包。
      expect(harness.playpackLoader.loadedPlaypacks().map((p) => p.id)).not.toContain(ugcPack.id);
    });
  });
});
