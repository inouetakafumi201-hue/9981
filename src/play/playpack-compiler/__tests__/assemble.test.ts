/**
 * compileToPlaypackDef（CompiledPlaypack → PlaypackDef 装配桥）测试。
 *
 * 用例覆盖：profile 展开（种类 / id / 引用字段透传）、地图 prefab 条目、无地图时不产生 prefab
 * def、包级 id/version/source 透传、deliveryForm / referencedClassIds / compileWarnings 进 props、
 * 文档显式 kind 优先于类别推导、无 id 的 profile 跳过、装配产物可被 PlaypackLoader 装载。
 */
import { describe, expect, it } from 'vitest';
import { compile, type PlaypackInput } from '../index';
import { compileToPlaypackDef } from '../assemble';
import type { CompiledPlaypack } from '../types';
import type { PlaypackDef } from '../../../core/kernel/schedule/playpack';
import { PlaypackLoader } from '../../../core/kernel/schedule/playpack';
import { DefRegistry } from '../../../core/kernel/state/def';

function makeInput(overrides?: Partial<PlaypackInput>): PlaypackInput {
  const manifests = new Map(overrides?.manifests ?? []);
  for (const [path, source] of [...manifests]) {
    try {
      const map = JSON.parse(source) as { id?: string; nodes?: readonly { id: string }[]; kind?: string };
      if (map.kind !== 'map-play' && map.id && Array.isArray(map.nodes)) {
        manifests.set(`${path}.map-play.json`, JSON.stringify({
          schemaVersion: '2.0', kind: 'map-play', mapPlayId: `map-play:${map.id}`, mapId: map.id,
          mapDataEntryId: path, entryNodeId: map.nodes[0]?.id ?? 'missing',
          capabilities: { rules: [], conditions: [], actions: [], states: [], outcomes: [], presentations: [] },
          localState: [], rules: [], timelines: [], outcomes: [],
        }));
      }
    } catch {
      // Invalid JSON is handled by compiler tests.
    }
  }
  return {
    id: 'test-pack-001', name: '测试玩法包', version: '1.0.0',
    assets: new Map(), source: 'llm-generated', creatorSteamId: 'test-steam-id', ...overrides,
    manifests,
  };
}

function simpleMap(id = 'map-001'): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    id,
    name: '测试地图',
    backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
    floors: [0],
    nodes: [
      { id: 'n1', def: 'scene.class.room', scale: 'small', at: { x: 0.5, y: 0.5 }, floor: 0 },
    ],
    edges: [],
    placements: [],
  };
}

const ITEM_PROFILE = JSON.stringify({
  id: 'item-bandage',
  name: '绷带',
  classComposition: {
    classIds: ['item.class.consumable'],
    capabilityIds: ['item.capability.recover'],
  },
  volume: 1,
  actions: [
    {
      name: '使用绷带',
      apCost: 1,
      target: 'self',
      effects: [
        { op: 'prop.add', path: 'entities.{actor}.props.hp', delta: 2, clamp: { min: 0, max: 5 } },
      ],
      kernelOps: ['prop.add'],
    },
  ],
  kernelOps: ['prop.add'],
});

const WEAPON_PROFILE = JSON.stringify({
  id: 'wp-katana',
  name: '武士刀',
  classComposition: {
    classIds: ['weapon.class.melee'],
    capabilityIds: ['weapon.capability.damage_reference'],
  },
  damage: 3,
  range: 1,
  volume: 1,
  actions: [
    {
      name: '斩击',
      apCost: 1,
      target: 'adjacent',
      effects: [{ op: 'prop.add', path: 'entities.{target}.props.hp', delta: -3 }],
      kernelOps: ['prop.add'],
      kernelEvents: ['OnDamage'],
    },
  ],
  kernelOps: ['prop.add'],
  kernelEvents: ['OnDamage'],
});

async function compileArtifact(input: PlaypackInput): Promise<CompiledPlaypack> {
  const result = await compile(input);
  if (!result.ok) {
    throw new Error(`测试样本编译失败：${JSON.stringify(result.diagnostics)}`);
  }
  return result.artifact;
}

describe('compileToPlaypackDef', () => {
  it('装配 profile（item/weapon）+ 地图：defs 数量/种类/顺序/id/引用字段透传，包级 id/version 透传', async () => {
    const artifact = await compileArtifact(makeInput({
      source: 'player-uploaded',
      manifests: new Map([
        ['items/bandage.json', ITEM_PROFILE],
        ['weapons/katana.json', WEAPON_PROFILE],
        ['maps/test-map.json', JSON.stringify(simpleMap())],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);

    expect(playpack.kind).toBe('playpack');
    expect(playpack.id).toBe('test-pack-001');
    expect(playpack.version).toBe('1.0.0');

    // defs 顺序 = profiles（编译产物顺序）→ prefabs
    expect(playpack.defs.map((def) => def.id)).toEqual([
      'item-bandage',
      'wp-katana',
      'd:map/map-001',
    ]);
    expect(playpack.defs.map((def) => def.kind)).toEqual(['item', 'item', 'prefab']);

    const itemDef = playpack.defs[0];
    const weaponDef = playpack.defs[1];
    const prefabDef = playpack.defs[2];
    expect(itemDef).toBeDefined();
    expect(weaponDef).toBeDefined();
    expect(prefabDef).toBeDefined();

    // 引用字段透传：classComposition / 数值 / actions 原样保留
    expect((itemDef as unknown as Record<string, unknown>)['classComposition']).toEqual({
      classIds: ['item.class.consumable'],
      capabilityIds: ['item.capability.recover'],
    });
    expect(Array.isArray((itemDef as unknown as Record<string, unknown>)['actions'])).toBe(true);
    expect((weaponDef as unknown as Record<string, unknown>)['damage']).toBe(3);

    // 地图 → prefab def（PrefabDef 形状）
    expect(prefabDef?.id).toBe('d:map/map-001');
    expect((prefabDef as unknown as { nodes?: unknown[] }).nodes).toHaveLength(1);
    expect((prefabDef as unknown as { links?: unknown[] }).links).toHaveLength(0);

    // referencedClassIds 进 props（数组形态，稳定排序）
    const refs = playpack.props?.['referencedClassIds'];
    expect(Array.isArray(refs)).toBe(true);
    expect(refs).toContain('item.class.consumable');
    expect(refs).toContain('weapon.class.melee');
    expect(refs).toEqual(['item.class.consumable', 'weapon.class.melee']);

    // player-uploaded 不产生上传态辨形
    expect(playpack.props?.['deliveryForm']).toBeUndefined();
    // 无 warning 时不产生 compileWarnings
    expect(playpack.props?.['compileWarnings']).toBeUndefined();
  });

  it('uploaded 带地图 → deliveryForm entry-by-map 透传进 props', async () => {
    const artifact = await compileArtifact(makeInput({
      source: 'uploaded',
      manifests: new Map([
        ['weapons/katana.json', WEAPON_PROFILE],
        ['maps/test-map.json', JSON.stringify(simpleMap())],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);
    expect(playpack.props?.['deliveryForm']).toBe('entry-by-map');
    expect(playpack.defs.some((def) => def.kind === 'prefab')).toBe(true);
  });

  it('uploaded 不带地图 → deliveryForm ordinary，且无 prefab def', async () => {
    const artifact = await compileArtifact(makeInput({
      source: 'uploaded',
      manifests: new Map([['weapons/katana.json', WEAPON_PROFILE]]),
    }));
    const playpack = compileToPlaypackDef(artifact);
    expect(playpack.props?.['deliveryForm']).toBe('ordinary');
    expect(playpack.defs.some((def) => def.kind === 'prefab')).toBe(false);
    expect(playpack.defs).toHaveLength(1);
  });

  it('source 透传进 props.source', async () => {
    const artifact = await compileArtifact(makeInput({
      source: 'uploaded',
      manifests: new Map([['weapons/katana.json', WEAPON_PROFILE]]),
    }));
    expect(compileToPlaypackDef(artifact).props?.['source']).toBe('uploaded');
  });

  it('编译 warning 携带进 props.compileWarnings', async () => {
    const artifact = await compileArtifact(makeInput({
      manifests: new Map([
        ['weapons/w-1.json', JSON.stringify({ id: 'w-1', damage: 3, unknownNumeric: 2 })],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);
    const warnings = playpack.props?.['compileWarnings'];
    expect(Array.isArray(warnings)).toBe(true);
    const list = warnings as unknown as ReadonlyArray<{ code: string; severity: string }>;
    expect(list.some((warning) => warning.code === 'PLAY-NUM-UNCLASSIFIED' && warning.severity === 'warning')).toBe(true);
  });

  it('无 id 的 profile 被跳过，不产生 def 也不捏造 id', () => {
    const artifact: CompiledPlaypack = {
      input: makeInput(),
      profiles: [
        { path: 'items/no-id.json', category: 'items', document: { name: '无名' } },
        {
          path: 'items/ok.json',
          category: 'items',
          document: { id: 'item-ok', classComposition: { classIds: ['item.class.consumable'] } },
        },
      ],
      maps: [],
      mapPlays: [],
      referencedClassIds: new Set(),
      diagnostics: [],
      complexityScore: 0,
    };
    const playpack = compileToPlaypackDef(artifact);
    expect(playpack.defs).toHaveLength(1);
    expect(playpack.defs[0]?.id).toBe('item-ok');
    expect(playpack.defs[0]?.kind).toBe('item');
  });

  it('文档显式合法 kind 优先于类别推导；非法 kind 回退到类别推导', () => {
    const artifact: CompiledPlaypack = {
      input: makeInput(),
      profiles: [
        { path: 'npcs/z.json', category: 'npcs', document: { id: 'z-1', kind: 'entity' } },
        { path: 'items/x.json', category: 'items', document: { id: 'x-1', kind: 'bogus-kind' } },
      ],
      maps: [],
      mapPlays: [],
      referencedClassIds: new Set(),
      diagnostics: [],
      complexityScore: 0,
    };
    const playpack = compileToPlaypackDef(artifact);
    const z = playpack.defs.find((def) => def.id === 'z-1');
    const x = playpack.defs.find((def) => def.id === 'x-1');
    expect(z?.kind).toBe('entity');
    expect(x?.kind).toBe('item'); // 非法 kind 回退到 items→item
  });

  it('五个类别缺省 kind 时按类别推导', () => {
    const artifact: CompiledPlaypack = {
      input: makeInput(),
      profiles: [
        { path: 'items/i.json', category: 'items', document: { id: 'i-1' } },
        { path: 'npcs/n.json', category: 'npcs', document: { id: 'n-1' } },
        { path: 'statuses/s.json', category: 'statuses', document: { id: 's-1' } },
        { path: 'vehicles/v.json', category: 'vehicles', document: { id: 'v-1' } },
        { path: 'weapons/w.json', category: 'weapons', document: { id: 'w-1' } },
      ],
      maps: [],
      mapPlays: [],
      referencedClassIds: new Set(),
      diagnostics: [],
      complexityScore: 0,
    };
    const playpack = compileToPlaypackDef(artifact);
    const kinds = new Map(playpack.defs.map((def) => [def.id, def.kind] as const));
    expect(kinds.get('i-1')).toBe('item');
    expect(kinds.get('n-1')).toBe('entity');
    expect(kinds.get('s-1')).toBe('attachment');
    expect(kinds.get('v-1')).toBe('entity');
    expect(kinds.get('w-1')).toBe('item');
  });

  it('prefab 为 null 的地图不产生 prefab def', () => {
    const artifact: CompiledPlaypack = {
      input: makeInput(),
      profiles: [],
      maps: [{ path: 'maps/m.json', data: {}, prefab: null }],
      mapPlays: [],
      referencedClassIds: new Set(),
      diagnostics: [],
      complexityScore: 0,
    };
    const playpack = compileToPlaypackDef(artifact);
    expect(playpack.defs.some((def) => def.kind === 'prefab')).toBe(false);
    expect(playpack.defs).toHaveLength(0);
  });

  it('装配产物可被 PlaypackLoader 装载（无 error/fatal 诊断）', async () => {
    const artifact = await compileArtifact(makeInput({
      source: 'player-uploaded',
      manifests: new Map([
        ['items/bandage.json', ITEM_PROFILE],
        ['weapons/katana.json', WEAPON_PROFILE],
        ['maps/test-map.json', JSON.stringify(simpleMap())],
      ]),
    }));
    const playpack = compileToPlaypackDef(artifact);
    const loader = new PlaypackLoader({ defRegistry: new DefRegistry() });
    const result = loader.load(playpack);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  // 类型哨兵：确保签名与产物类型符合装载入口的契约。
  const _typeSentinel: PlaypackDef = compileToPlaypackDef({
    input: makeInput(),
    profiles: [],
    maps: [],
    mapPlays: [],
    referencedClassIds: new Set(),
    diagnostics: [],
    complexityScore: 0,
  });
  void _typeSentinel;
});
