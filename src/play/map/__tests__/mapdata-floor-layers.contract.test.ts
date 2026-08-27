/**
 * MapData floor→layers 契约扩展的核心闭环单测（Task 4 checkpoint）。
 *
 * 覆盖设计 Test Strategy 的 4 块定向单测：
 * - legacy → canonical 规范化（层派生 / layerId / height / 顺序）；
 * - validateMapStructure 的 canonical 诊断（重 id、缺引用、非法/重复 height、混合冲突）；
 * - serialize/parse roundtrip + 字段序 + 无 floor/floors 残留；
 * - layerOpacity 边界与对称性。
 *
 * 只断言规则，不为通过而针对特定输入打补丁（WakeUp 项目纪律）。
 */
import { describe, expect, it } from 'vitest';
import {
  deriveLayerId,
  normalizeMapDocument,
  type CanonicalMapData,
  type LegacyMapData,
  type MapLayer,
  type MapNode,
} from '../types';
import { validateMapStructure, type MapDiagnostic } from '../validate';
import { layerOpacity, parseMapData, serializeMapData } from '../serialize';

// ---------------------------------------------------------------------------
// 构造器：legacy v1 与 canonical v2 的合法夹具
// ---------------------------------------------------------------------------

function backdrop() {
  return { image: 'campus.png', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 };
}

function legacyNode(id: string, floor: number, overrides: Partial<LegacyMapData['nodes'][number]> = {}): LegacyMapData['nodes'][number] {
  return { id, def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.5, y: 0.5 }, floor, ...overrides };
}

function legacyMap(overrides: Partial<LegacyMapData> = {}): LegacyMapData {
  return {
    schemaVersion: '1.0',
    id: 'legacy_map',
    name: '旧地图',
    backdrop: backdrop(),
    floors: [0, 1],
    nodes: [
      legacyNode('n_ground', 0),
      legacyNode('n_roof', 1),
    ],
    edges: [],
    placements: [],
    ...overrides,
  };
}

function canonicalNode(id: string, layerId: string, overrides: Partial<MapNode> = {}): CanonicalMapData['nodes'][number] {
  return { id, def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.5, y: 0.5 }, layerId, ...overrides };
}

function canonicalMap(overrides: Partial<CanonicalMapData> = {}): CanonicalMapData {
  return {
    schemaVersion: '2.0',
    id: 'canonical_map',
    name: '新地图',
    backdrop: backdrop(),
    layers: [
      { id: 'layer:ground', name: '地面层', height: 0 },
      { id: 'layer:roof', name: '高架层', height: 1 },
    ],
    nodes: [
      canonicalNode('n_ground', 'layer:ground'),
      canonicalNode('n_roof', 'layer:roof'),
    ],
    edges: [],
    placements: [],
    ...overrides,
  };
}

function codesOf(findings: readonly MapDiagnostic[]): readonly string[] {
  return findings.map((finding) => finding.code);
}

// ---------------------------------------------------------------------------
// 规范化
// ---------------------------------------------------------------------------

describe('legacy → canonical 规范化', () => {
  it('为每个 distinct legacy floor 派生一个参与透视层，并把该 floor 值拷进 height', () => {
    const legacy = legacyMap({ floors: [0, 2], nodes: [legacyNode('a', 2), legacyNode('b', 0)] });
    const canonical = normalizeMapDocument(legacy);
    expect(canonical.schemaVersion).toBe('2.0');
    expect(canonical.layers).toEqual([
      { id: deriveLayerId(0), height: 0 },
      { id: deriveLayerId(2), height: 2 },
    ]);
    // 层按 floor 数值升序，稳定顺序
    expect(canonical.layers.map((layer) => layer.height)).toEqual([0, 2]);
  });

  it('未在 floors 声明但节点用到的 floor 也会被纳入层派生（不产生孤儿层）', () => {
    const legacy = legacyMap({ floors: [0], nodes: [legacyNode('a', 0), legacyNode('b', 3), legacyNode('c', 0)] });
    const canonical = normalizeMapDocument(legacy);
    const heights = canonical.layers.map((layer) => layer.height);
    expect(heights).toEqual([0, 3]);
  });

  it('节点 floor 映射为对应 canonical layer id（deriveLayerId）', () => {
    const canonical = normalizeMapDocument(legacyMap());
    expect(canonical.nodes.find((node) => node.id === 'n_ground')?.layerId).toBe('layer:floor:0');
    expect(canonical.nodes.find((node) => node.id === 'n_roof')?.layerId).toBe('layer:floor:1');
  });

  it('节点未声明 layerId 时回退到节点自己的 floor（不强行按文档声明）', () => {
    const canonical = normalizeMapDocument(canonicalMap({
      nodes: [
        // 故意删掉 layerId，只留 floor——normalizeNodeLayerRef 应回退 floor 而不是抛错
        { id: 'n_ground', def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.5, y: 0.5 }, floor: 0 } as unknown as CanonicalMapData['nodes'][number],
      ],
    }));
    expect(canonical.nodes[0]?.layerId).toBe('layer:floor:0');
  });

  it('canonical 文档原样保真（转成 canonical 内存形状，层顺序稳定）', () => {
    const input = canonicalMap();
    const canonical = normalizeMapDocument(input);
    expect(canonical.schemaVersion).toBe('2.0');
    expect(canonical.layers.map((layer) => layer.id)).toEqual(['layer:ground', 'layer:roof']);
    expect(canonical.nodes.map((node) => node.layerId)).toEqual(['layer:ground', 'layer:roof']);
  });
});

// ---------------------------------------------------------------------------
// 校验（validateMapStructure 对 canonical 的诊断）
// ---------------------------------------------------------------------------

describe('canonical 图层契约校验', () => {
  it('合法 canonical 地图零诊断', () => {
    expect(validateMapStructure(canonicalMap())).toEqual([]);
  });

  it('layer id 重复 → MAP_DUPLICATE_LAYER_ID', () => {
    const map = canonicalMap({ layers: [{ id: 'dup' }, { id: 'dup' }] as MapLayer[] });
    const findings = validateMapStructure(map);
    expect(codesOf(findings)).toContain('MAP_DUPLICATE_LAYER_ID');
    expect(findings.find((f) => f.code === 'MAP_DUPLICATE_LAYER_ID')?.correction).toContain('唯一');
  });

  it('layer id 为空 → MAP_EMPTY_LAYER_ID', () => {
    const map = canonicalMap({ layers: [{ id: '' }, { id: 'ok' }] as MapLayer[] });
    expect(codesOf(validateMapStructure(map))).toContain('MAP_EMPTY_LAYER_ID');
  });

  it('node.layerId 未命中任何层 → MAP_LAYER_REF_NOT_FOUND', () => {
    const map = canonicalMap({ nodes: [canonicalNode('a', 'layer:ghost')] });
    const findings = validateMapStructure(map);
    expect(codesOf(findings)).toContain('MAP_LAYER_REF_NOT_FOUND');
    expect(findings.find((f) => f.code === 'MAP_LAYER_REF_NOT_FOUND')?.subject).toBe('a');
  });

  it('canonical 节点缺少 layerId → MAP_NODE_NO_LAYER_REF', () => {
    const map = canonicalMap({
      nodes: [{ id: 'a', def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.5, y: 0.5 } } as unknown as CanonicalMapData['nodes'][number]],
    });
    expect(codesOf(validateMapStructure(map))).toContain('MAP_NODE_NO_LAYER_REF');
  });

  it('只剩节点 layerId、没有 layers 数组时引用必失配（不崩，明确诊断）', () => {
    const map = canonicalMap({
      layers: [],
      nodes: [canonicalNode('a', 'layer:ground')],
    });
    expect(codesOf(validateMapStructure(map))).toContain('MAP_LAYER_REF_NOT_FOUND');
  });

  it('参与透视 height 为 NaN → MAP_INVALID_LAYER_HEIGHT', () => {
    const map = canonicalMap({ layers: [{ id: 'a', height: Number.NaN }] as MapLayer[] });
    expect(codesOf(validateMapStructure(map))).toContain('MAP_INVALID_LAYER_HEIGHT');
  });

  it('参与透视 height 为负 → MAP_INVALID_LAYER_HEIGHT', () => {
    const map = canonicalMap({ layers: [{ id: 'a', height: -3 }] as MapLayer[] });
    const findings = validateMapStructure(map);
    expect(findings.filter((f) => f.code === 'MAP_INVALID_LAYER_HEIGHT')).toHaveLength(1);
  });

  it('两个参与透视层同高 → MAP_DUPLICATE_LAYER_HEIGHT', () => {
    const map = canonicalMap({ layers: [{ id: 'a', height: 2 }, { id: 'b', height: 2 }] as MapLayer[] });
    expect(codesOf(validateMapStructure(map))).toContain('MAP_DUPLICATE_LAYER_HEIGHT');
  });

  it('独立层（height 空）可有多个，不判重', () => {
    const map = canonicalMap({
      layers: [{ id: 'a', height: 1 }, { id: 'b' }, { id: 'c' }] as MapLayer[],
      nodes: [
        canonicalNode('n_ground', 'a'),
        canonicalNode('n_roof', 'b'),
      ],
    });
    expect(validateMapStructure(map)).toEqual([]);
  });

  it('legacy 与 canonical 字段混用 → MAP_MIXED_LEGACY_CANONICAL', () => {
    const map = {
      schemaVersion: '1.0' as const,
      id: 'mixed',
      name: '混用',
      backdrop: backdrop(),
      floors: [0],
      layers: [{ id: 'layer:ground', height: 0 }] as MapLayer[],
      nodes: [legacyNode('a', 0, { layerId: 'layer:ground' } as never)],
      edges: [],
      placements: [],
    } as unknown as CanonicalMapData;
    expect(codesOf(validateMapStructure(map))).toContain('MAP_MIXED_LEGACY_CANONICAL');
  });

  it('纯 legacy 地图 zero layer 诊断（legacy 由导入边界规范化，不判 mixed）', () => {
    expect(validateMapStructure(legacyMap())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 序列化 / 解析 roundtrip
// ---------------------------------------------------------------------------

describe('canonical 序列化 / 解析 roundtrip', () => {
  it('canonical 输出为确定性 pretty JSON，只含 canonical 字段，无 floor/floors', () => {
    const canonical = canonicalMap();
    const json = serializeMapData(canonical);
    expect(json).toContain('"schemaVersion": "2.0"');
    expect(json).not.toContain('"floors"');
    expect(json).not.toContain('"floor"');
    // 再序列化一次字节相同（确定性）
    expect(serializeMapData(canonical)).toBe(json);
  });

  it('独立层 height 为空时不输出 height 字段', () => {
    const canonical = canonicalMap({ layers: [{ id: 'a' }, { id: 'b', height: 1 }] as MapLayer[] });
    const json = serializeMapData(canonical);
    const parsed = JSON.parse(json) as { layers: Record<string, unknown>[] };
    expect(parsed.layers[0]).not.toHaveProperty('height');
    expect(parsed.layers[1]).toHaveProperty('height', 1);
  });

  it('canonical 序列化后 parse 读回等价结构（roundtrip 稳定）', () => {
    const canonical = canonicalMap();
    const fromJson = parseMapData(serializeMapData(canonical));
    expect(fromJson).toEqual(canonical);
  });

  it('建筑组分支跨 serialize/parse 保持，且相同局部 height 不合并', () => {
    const canonical = canonicalMap({
      buildingGroups: [
        { id: 'school-a', frame: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 }, shell: 'school-a-shell',
          floors: [{ id: 'a-1', ordinal: 1, height: 0, nodes: [] }, { id: 'a-2', ordinal: 2, height: 2, nodes: [] }], portals: [] },
        { id: 'school-b', frame: { x: 0.5, y: 0.1, width: 0.3, height: 0.3 }, shell: 'school-b-shell',
          floors: [{ id: 'b-1', ordinal: 1, height: 0, nodes: [] }, { id: 'b-2', ordinal: 2, height: 2, nodes: [] }], portals: [] },
      ],
    });
    const roundtripped = parseMapData(serializeMapData(canonical));
    expect(roundtripped.buildingGroups).toEqual(canonical.buildingGroups);
  });

  it('canonical 层顺序跨 serialize/parse 保持', () => {
    const canonical = canonicalMap({ layers: [{ id: 'z', height: 3 }, { id: 'a' }, { id: 'm', height: 1 }] as MapLayer[] });
    const roundtripped = parseMapData(serializeMapData(canonical));
    expect(roundtripped.layers.map((layer) => layer.id)).toEqual(['z', 'a', 'm']);
  });

  it('legacy 输入 parse → 规范化 → serialize 后再 parse，等价 canonical 且不再有 floor', () => {
    const json = serializeMapData(parseMapData(JSON.stringify(legacyMap())));
    expect(json).not.toContain('"floors"');
    expect(json).not.toContain('"floor"');
    const reparsed = JSON.parse(json) as CanonicalMapData;
    expect(reparsed.schemaVersion).toBe('2.0');
    // 层顺序 = floor 升序，引用按 deriveLayerId
    expect(reparsed.layers.map((l) => l.height)).toEqual([0, 1]);
    expect(reparsed.nodes.map((n) => n.layerId)).toEqual(['layer:floor:0', 'layer:floor:1']);
  });
});

// ---------------------------------------------------------------------------
// layerOpacity 纯函数
// ---------------------------------------------------------------------------

describe('layerOpacity', () => {
  it('两侧 height：0 差 → 1，差 ⩾10 → 0，中间线性', () => {
    expect(layerOpacity(3, 3)).toBe(1);
    expect(layerOpacity(0, 10)).toBe(0);
    expect(layerOpacity(10, 0)).toBe(0);
    expect(layerOpacity(1, 2)).toBeCloseTo(0.9, 6);
    expect(layerOpacity(5, 0)).toBeCloseTo(0.5, 6);
  });

  it('任一侧 height 空 → null（调用方渲染为 opacity 1）', () => {
    expect(layerOpacity(undefined, 2)).toBeNull();
    expect(layerOpacity(2, undefined)).toBeNull();
    expect(layerOpacity(undefined, undefined)).toBeNull();
  });

  it('对称：交换输入结果不变', () => {
    expect(layerOpacity(2, 7)).toBe(layerOpacity(7, 2));
  });
});
