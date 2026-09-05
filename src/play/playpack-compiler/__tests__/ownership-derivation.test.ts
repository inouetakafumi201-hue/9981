/**
 * assemble.ts 数值归属自动派生测试（装载等价收尾 P1）。
 *
 * 覆盖：不带 play 元数据的真实 UGC profile 经 compile → compileToPlaypackDef 自动获得
 * numericOwnership（分类真源 = numeric-classification 登记表）；文档显式 play 原样保留；
 * 装配产物经 loadCoreMechanics 可装载（无 E_LOAD_NUMERIC_OWNERSHIP）；带地图包（prefab）
 * 端到端装载成功。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compile, type PlaypackInput } from '../index';
import { compileToPlaypackDef } from '../assemble';
import type { CompiledPlaypack } from '../types';
import { loadCoreMechanics, type CoreMechanicsLoadOptions, type CoreMechanicsLoadResult } from '../../core-mechanics/load';
import { createLoadedCoreMechanics } from '../../core-mechanics/__tests__/state-machine-load-driver';
import type { FullHarness } from '../../../core/kernel/testing/full-harness';
import { resetIdCounters } from '../../../core/kernel/state/ids';

function makeInput(overrides?: Partial<PlaypackInput>): PlaypackInput {
  return {
    id: 'playpack:play.ownership-test',
    name: '归属派生测试包',
    version: '1.0.0',
    manifests: new Map(),
    assets: new Map(),
    source: 'uploaded',
    creatorSteamId: 'steam:ownership-test',
    ...overrides,
  };
}

/** 真实玩家风格的武器 profile：不带 play 元数据、带 damage/range 数值。 */
const PLAIN_WEAPON = JSON.stringify({
  id: 'item:ugc.plain-blade',
  name: '朴素短刃',
  classComposition: { classIds: ['weapon.class.melee'] },
  damage: 3,
  range: 1,
});

/** 真实玩家风格的物品 profile：不带 play 元数据、带 healRate 数值。 */
const PLAIN_ITEM = JSON.stringify({
  id: 'item:ugc.plain-medkit',
  name: '朴素急救包',
  classComposition: { classIds: ['item.class.consumable'] },
  healRate: 2,
});

/** 自带 play 元数据的 profile：文档声明优先，装配桥不得覆盖。 */
const EXPLICIT_WEAPON = JSON.stringify({
  id: 'item:ugc.explicit-blade',
  name: '声明刃',
  classComposition: { classIds: ['weapon.class.melee'] },
  damage: 4,
  play: {
    numericOwnership: {
      damage: { kind: 'gameplay', min: 1, max: 5, int: true },
    },
    sourceTrace: ['作者手写'],
  },
});

const SHELTER_MAP = JSON.stringify({
  schemaVersion: '1.0',
  id: 'ugc-plain-shelter',
  name: '朴素避难所',
  backdrop: { image: 'shelter.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: 'n1', def: 'scene.class.room', scale: 'small', at: { x: 0.5, y: 0.5 }, floor: 0 },
  ],
  edges: [],
  placements: [],
});

const SHELTER_MAP_PLAY = JSON.stringify({
  schemaVersion: '2.0', kind: 'map-play', mapPlayId: 'map-play:ugc-plain-shelter',
  mapId: 'ugc-plain-shelter', mapDataEntryId: 'maps/plain-shelter.json', entryNodeId: 'n1',
  capabilities: { rules: [], conditions: [], actions: [], states: [], outcomes: [], presentations: [] },
  localState: [], rules: [], timelines: [], outcomes: [],
});

async function compileArtifact(input: PlaypackInput): Promise<CompiledPlaypack> {
  const result = await compile(input);
  if (!result.ok) {
    throw new Error(`测试样本编译失败：${JSON.stringify(result.diagnostics)}`);
  }
  return result.artifact;
}

function runtimeOf(harness: FullHarness): CoreMechanicsLoadOptions['runtime'] {
  return {
    registry: harness.registry,
    defRegistry: harness.defRegistry,
    ruleProvider: harness.ruleProvider,
    playpackLoader: harness.playpackLoader,
    holder: harness.holder,
  };
}

function blockingCodes(load: CoreMechanicsLoadResult): readonly string[] {
  return load.diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'fatal')
    .map((d) => d.code);
}

describe('装配桥数值归属自动派生（P1）', () => {
  beforeEach(() => resetIdCounters());

  it('不带 play 元数据的 profile 自动获得 numericOwnership（damage→gameplay）', async () => {
    const artifact = await compileArtifact(makeInput({
      manifests: new Map([
        ['weapons/plain-blade.json', PLAIN_WEAPON],
        ['items/plain-medkit.json', PLAIN_ITEM],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);

    const blade = playpack.defs.find((def) => def.id === 'item:ugc.plain-blade');
    expect(blade).toBeDefined();
    const ownership = (blade as unknown as { play?: { numericOwnership: Record<string, { kind: string }> } }).play?.numericOwnership;
    expect(ownership?.['damage']).toEqual({ kind: 'gameplay', min: 1, max: 5, int: true });
    expect(ownership?.['range']).toBeDefined();
    expect((blade as unknown as { play?: { sourceTrace?: string[] } }).play?.sourceTrace).toBeDefined();
  });

  it('自动派生的包可经 loadCoreMechanics 装载（无 E_LOAD_NUMERIC_OWNERSHIP）', async () => {
    const artifact = await compileArtifact(makeInput({
      manifests: new Map([
        ['weapons/plain-blade.json', PLAIN_WEAPON],
        ['items/plain-medkit.json', PLAIN_ITEM],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);

    const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
    expect(officialLoad.ok).toBe(true);

    const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack });
    expect(ugcLoad.ok).toBe(true);
    expect(blockingCodes(ugcLoad)).not.toContain('E_LOAD_NUMERIC_OWNERSHIP');
    expect(harness.defRegistry.resolve('item:ugc.plain-blade')?.kind).toBe('item');
  });

  it('文档显式 play 原样保留，不覆盖', async () => {
    const artifact = await compileArtifact(makeInput({
      manifests: new Map([['weapons/explicit-blade.json', EXPLICIT_WEAPON]]),
    }));
    const playpack = compileToPlaypackDef(artifact);
    const blade = playpack.defs.find((def) => def.id === 'item:ugc.explicit-blade');
    const play = (blade as unknown as { play?: { numericOwnership: Record<string, unknown>; sourceTrace: string[] } }).play;
    expect(play?.numericOwnership).toEqual({ damage: { kind: 'gameplay', min: 1, max: 5, int: true } });
    expect(play?.sourceTrace).toEqual(['作者手写']);
  });

  it('带地图包（prefab 全 internal 归属）端到端装载成功', async () => {
    const artifact = await compileArtifact(makeInput({
      id: 'playpack:play.ugc-plain-shelter',
      manifests: new Map([
        ['weapons/plain-blade.json', PLAIN_WEAPON],
        ['maps/plain-shelter.json', SHELTER_MAP],
        ['maps/plain-shelter.map-play.json', SHELTER_MAP_PLAY],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);
    expect(playpack.defs.some((def) => def.id === 'd:map/ugc-plain-shelter' && def.kind === 'prefab')).toBe(true);

    const { load: officialLoad, harness, config } = createLoadedCoreMechanics();
    expect(officialLoad.ok).toBe(true);

    const ugcLoad = loadCoreMechanics({ runtime: runtimeOf(harness), config, playpack });
    expect(ugcLoad.ok).toBe(true);
    expect(blockingCodes(ugcLoad)).not.toContain('E_LOAD_NUMERIC_OWNERSHIP');
    expect(harness.defRegistry.resolve('d:map/ugc-plain-shelter')?.kind).toBe('prefab');
  });
});
