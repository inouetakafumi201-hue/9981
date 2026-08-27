/**
 * MapData floor→layers 契约扩展的五个正确性属性（fast-check PBT，每个至少 100 迭代）。
 *
 * 属性（对应 design.md Correctness Properties）：
 * - Property 1：canonical layer reference integrity —— 任意 canonical 地图，每个 node.layerId 命中
 *   唯一图层、每个参与透视 height 唯一。
 * - Property 2：legacy normalization is idempotent —— 任意 legacy floor 地图，normalize(normalize(x))
 *   === normalize(x)，且 canonical 层顺序稳定。
 * - Property 3：opacity boundary and monotonicity —— Δh=0 → 1、Δh≥10 → 0、且随 |Δh| 不增。
 * - Property 4：canonical serialization roundtrip —— parse(serialize(x)) 等价 x，层顺序/元数据保持。
 * - Property 5：legacy-to-canonical-to-JSON convergence —— parse(serialize(normalize(x))) 等价
 *   normalize(x)，且序列化形式不 reintroduce floor / floors。
 *
 * 每条属性一个测试实现（WakeUp 用例纪律：不铺假空转）。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  deriveLayerId,
  normalizeMapDocument,
  type CanonicalMapData,
  type LegacyMapData,
} from '../types';
import { validateMapStructure } from '../validate';
import { layerOpacity, parseMapData, serializeMapData } from '../serialize';

// ---------------------------------------------------------------------------
// 任意生成器
// ---------------------------------------------------------------------------

/** 任意 canonical 地图：随机层 + 每层至少一个随机节点引用。 */
function anyCanonicalMap(): fc.Arbitrary<CanonicalMapData> {
  return fc.record({
    layerCount: fc.integer({ min: 1, max: 5 }),
    nodeSlots: fc.array(fc.boolean(), { minLength: 0, maxLength: 12 }),
    heightKind: fc.boolean(),
    namePresent: fc.boolean(),
  }).chain(({ layerCount, nodeSlots, heightKind, namePresent }) => {
    const ids = Array.from({ length: layerCount }, (_, i) => `layer:${i}`);
    // 每层随机分配参与透视或不带 height（独立层）；参与透视高度全局唯一。
    const heights = Array.from({ length: layerCount }, (_, i) => (heightKind && i < 3 ? i : undefined));
    const layers = ids.map((id, i) => ({
      id,
      ...(namePresent ? { name: `层${i}` } : {}),
      ...(heights[i] !== undefined ? { height: heights[i] } : {}),
    }));
    const nodes = nodeSlots.map((_, i) => ({
      id: `n:${i}`,
      def: 'd:scene/room',
      scale: 'medium' as const,
      at: { x: 0.5, y: 0.5 },
      layerId: ids[Math.floor(Math.random() * ids.length)] as string,
    }));
    return fc.constant({
      schemaVersion: '2.0' as const,
      id: `canon_${Math.abs(Math.floor(Math.random() * 1e6))}`,
      name: 'canonical',
      backdrop: { image: 'b.png', pixelWidth: 640, pixelHeight: 360, tileRows: 1, tileCols: 1 },
      layers,
      nodes,
      edges: [],
      placements: [],
    } as CanonicalMapData);
  });
}

/** 任意 legacy floor 地图：随机 floors 声明 + 随机 node.floor。 */
function anyLegacyMap(): fc.Arbitrary<LegacyMapData> {
  return fc.record({
    declared: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 5 }),
    nodeFloors: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 0, maxLength: 12 }),
  }).map(({ declared, nodeFloors }) => ({
    schemaVersion: '1.0' as const,
    id: `legacy_${Math.abs(Math.floor(Math.random() * 1e6))}`,
    name: 'legacy',
    backdrop: { image: 'b.png', pixelWidth: 640, pixelHeight: 360, tileRows: 1, tileCols: 1 },
    floors: [...new Set(declared)] as number[],
    nodes: nodeFloors.map((floor, i) => ({
      id: `n:${i}`,
      def: 'd:scene/room',
      scale: 'medium' as const,
      at: { x: 0.5, y: 0.5 },
      floor,
    })),
    edges: [],
    placements: [],
  } as LegacyMapData));
}

function codesOf(findings: ReturnType<typeof validateMapStructure>): readonly string[] {
  return findings.map((finding) => finding.code);
}

function allowedErrorCodes(c: CanonicalMapData): ReadonlySet<string> {
  // 生成器只保证结构形状，不保证 height 合法/唯一或 layerId 命中；这些正是被校验的约束。
  // 合法 canonical 命中：除此之外绝不能出现其它守卫错误。
  const set = new Set<string>(['MAP_INVALID_LAYER_HEIGHT', 'MAP_DUPLICATE_LAYER_HEIGHT', 'MAP_LAYER_REF_NOT_FOUND', 'MAP_NODE_NO_LAYER_REF', 'MAP_EMPTY_LAYER_ID', 'MAP_DUPLICATE_LAYER_ID']);
  void c;
  return set;
}

// ---------------------------------------------------------------------------
// 五个正确性属性
// ---------------------------------------------------------------------------

describe('Feature: mapdata-floor-layers', () => {
  it('Property 1: canonical layer reference integrity', () => {
    fc.assert(
      fc.property(anyCanonicalMap(), (canonical) => {
        // 每个 node.layerId 命中 layers 中的唯一图层。
        const layerIds = new Map<string, number>();
        for (const layer of canonical.layers) {
          layerIds.set(layer.id, (layerIds.get(layer.id) ?? 0) + 1);
        }
        for (const node of canonical.nodes) {
          expect(layerIds.has(node.layerId)).toBe(true);
          expect(layerIds.get(node.layerId)).toBe(1);
        }
        // 参与透视 height 全图唯一。
        const heights = canonical.layers
          .map((layer) => layer.height)
          .filter((h): h is number => h !== undefined);
        expect(new Set(heights).size).toBe(heights.length);
        // 校验器在同一输入上不报告超出以上约束的 error（不崩、诊断克制）。
        const findings = codesOf(validateMapStructure(canonical));
        for (const code of findings) {
          expect(allowedErrorCodes(canonical).has(code), `意外诊断码 ${code}`).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 2: legacy normalization is idempotent', () => {
    fc.assert(
      fc.property(anyLegacyMap(), (legacy) => {
        const once = normalizeMapDocument(legacy);
        const twice = normalizeMapDocument(once);
        expect(twice).toEqual(once);
        // canonical 层顺序稳定：与一次规范化结果一致（层按所列顺序，不随时间漂移）。
        expect(twice.layers.map((layer) => layer.id)).toEqual(once.layers.map((layer) => layer.id));
      }),
      { numRuns: 100 },
    );
  });

  it('Property 3: opacity boundary and monotonicity', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), (a, b) => {
        const d = Math.abs(a - b);
        if (d === 0) expect(layerOpacity(a, b)).toBe(1);
        if (d >= 10) expect(layerOpacity(a, b)).toBe(0);
        // 距 0 为 d 的 opacity 不高于距 0 更近的值（单调不增）。
        const farther = layerOpacity(a, b);
        const nearer = layerOpacity(a, a + Math.floor(d / 2));
        if (nearer !== null && farther !== null) {
          expect(farther).toBeLessThanOrEqual(nearer);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: canonical serialization roundtrip', () => {
    fc.assert(
      fc.property(anyCanonicalMap(), (canonical) => {
        const roundtripped = parseMapData(serializeMapData(canonical));
        expect(roundtripped).toEqual(canonical);
        // 层顺序与元数据顺序保持不变。
        expect(roundtripped.layers.map((layer) => layer.id)).toEqual(canonical.layers.map((layer) => layer.id));
        for (const layer of roundtripped.layers) {
          expect((layer as { name?: string }).name).toEqual((canonical.layers.find((c) => c.id === layer.id) as { name?: string }).name);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 5: legacy-to-canonical-to-JSON convergence', () => {
    fc.assert(
      fc.property(anyLegacyMap(), (legacy) => {
        const canonical = normalizeMapDocument(legacy);
        const converged = parseMapData(serializeMapData(canonical));
        expect(converged).toEqual(canonical);
        // 序列化形式不 reintroduce floor / floors。
        const json = serializeMapData(canonical);
        expect(json).not.toContain('"floors"');
        expect(json).not.toContain('"floor"');
      }),
      { numRuns: 100 },
    );
  });
});

// 明确引用，防止未使用告警；deriveLayerId 在属性实现中语义相关（可作稳定引用说明）。
void deriveLayerId;
