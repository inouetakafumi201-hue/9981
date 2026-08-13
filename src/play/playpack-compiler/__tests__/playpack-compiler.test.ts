/**
 * 玩法包编译器测试。
 *
 * 验证统一出口头能正确组合现有编译器，并返回结构化诊断。
 */
import { describe, expect, it } from 'vitest';
import { compile, suggestPriceTier, type PlaypackInput } from '../index.js';

function makeInput(overrides?: Partial<PlaypackInput>): PlaypackInput {
  return {
    id: 'test-pack-001',
    name: '测试玩法包',
    version: '1.0.0',
    manifests: new Map(),
    assets: new Map(),
    source: 'llm-generated',
    creatorSteamId: 'test-steam-id',
    ...overrides,
  };
}

describe('玩法包编译器', () => {
  describe('JSON 解析阶段', () => {
    it('合法 JSON 通过解析', async () => {
      const input = makeInput({
        manifests: new Map([['weapons/test.json', '{"id": "wp-001", "damage": 3}']]),
      });
      const result = await compile(input);
      // 可能有 warning（类型推断失败），但不应有 error
      if (!result.ok) {
        expect(result.diagnostics.every((d) => d.severity !== 'error')).toBe(true);
      }
    });

    it('非法 JSON 返回 PLAYPACK_JSON_PARSE_ERROR', async () => {
      const input = makeInput({
        manifests: new Map([['weapons/bad.json', '{id: "wp-001"}']]), // 缺引号
      });
      const result = await compile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'PLAYPACK_JSON_PARSE_ERROR',
              severity: 'error',
              file: 'weapons/bad.json',
            }),
          ]),
        );
      }
    });

    it('JSON 解析失败立刻终止，不进入后续阶段', async () => {
      const input = makeInput({
        manifests: new Map([
          ['weapons/bad.json', 'not json at all'],
          ['weapons/good.json', '{"id": "wp-001"}'],
        ]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // 只应该有 JSON 解析错误，不应有数值审计或地图编译错误
        expect(result.diagnostics.every((d) => d.code === 'PLAYPACK_JSON_PARSE_ERROR')).toBe(true);
      }
    });
  });

  describe('Profile 分类与审计', () => {
    it('从路径推断 profile 类别', async () => {
      const input = makeInput({
        manifests: new Map([
          [
            'weapons/katana.json',
            JSON.stringify({
              id: 'wp-katana',
              classComposition: { classIds: ['weapon.class.melee'] },
              damage: 3,
            }),
          ],
        ]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.profiles).toHaveLength(1);
        expect(result.artifact.profiles[0]?.category).toBe('weapons');
      }
    });

    it('数值越界返回 PLAY-NUM-OUT-OF-RANGE 且 autoFixable=true', async () => {
      const input = makeInput({
        manifests: new Map([
          [
            'weapons/overpowered.json',
            JSON.stringify({
              id: 'wp-op',
              classComposition: { classIds: ['weapon.class.melee'] },
              damage: 99, // 越界
            }),
          ],
        ]),
      });
      const result = await compile(input, { fullAudit: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const outOfRange = result.diagnostics.find((d) => d.code === 'PLAY-NUM-OUT-OF-RANGE');
        expect(outOfRange).toBeDefined();
        expect(outOfRange?.autoFixable).toBe(true);
        expect(outOfRange?.suggestedFix).toBe(5); // 限幅到 5
      }
    });

    it('fullAudit=false 跳过数值审计', async () => {
      const input = makeInput({
        manifests: new Map([
          [
            'weapons/overpowered.json',
            JSON.stringify({
              id: 'wp-op',
              classComposition: { classIds: ['weapon.class.melee'] },
              damage: 99,
            }),
          ],
        ]),
      });
      const result = await compile(input, { fullAudit: false });
      // 没有数值审计，不应有 PLAY-NUM-* 诊断
      if (!result.ok) {
        expect(result.diagnostics.every((d) => !d.code.startsWith('PLAY-NUM-'))).toBe(true);
      }
    });
  });

  describe('地图编译', () => {
    it('合法地图编译成功', async () => {
      const mapData = {
        schemaVersion: '1.0' as const,
        id: 'map-001',
        name: '测试地图',
        backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
        floors: [0],
        nodes: [
          { id: 'n1', def: 'scene.class.room', scale: 'small' as const, at: { x: 0.5, y: 0.5 }, floor: 0 },
        ],
        edges: [],
        placements: [],
      };
      const input = makeInput({
        manifests: new Map([['maps/test-map.json', JSON.stringify(mapData)]]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.maps).toHaveLength(1);
        expect(result.artifact.maps[0]?.prefab).toBeDefined();
      }
    });

    it('地图结构错误阻止编译', async () => {
      const badMapData = {
        schemaVersion: '1.0' as const,
        id: 'map-bad',
        name: '坏地图',
        backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
        floors: [0],
        nodes: [
          { id: 'n1', def: 'scene.class.room', scale: 'small' as const, at: { x: 2.0, y: 0.5 }, floor: 0 }, // 坐标越界
        ],
        edges: [],
        placements: [],
      };
      const input = makeInput({
        manifests: new Map([['maps/bad-map.json', JSON.stringify(badMapData)]]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'MAP_COORD_OUT_OF_RANGE',
              severity: 'error',
              file: 'maps/bad-map.json',
            }),
          ]),
        );
      }
    });
  });

  describe('复杂度评分', () => {
    it('空包评分为 0', async () => {
      const input = makeInput();
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.complexityScore).toBe(0);
      }
    });

    it('10 个实例 = 100 分 = Tier 1', async () => {
      const manifests = new Map<string, string>();
      for (let i = 0; i < 10; i++) {
        manifests.set(
          `weapons/wp-${i}.json`,
          JSON.stringify({ id: `wp-${i}`, classComposition: { classIds: [] }, damage: 3 }),
        );
      }
      const input = makeInput({ manifests });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.complexityScore).toBe(100);
        expect(suggestPriceTier(result.artifact.complexityScore)).toBe(1);
      }
    });

    it('1 张地图 = 50 分 = Tier 1，但接近 Tier 2', async () => {
      const mapData = {
        schemaVersion: '1.0' as const,
        id: 'map-001',
        name: '测试地图',
        backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
        floors: [0],
        nodes: [
          { id: 'n1', def: 'scene.class.room', scale: 'small' as const, at: { x: 0.5, y: 0.5 }, floor: 0 },
        ],
        edges: [],
        placements: [],
      };
      const input = makeInput({
        manifests: new Map([['maps/test-map.json', JSON.stringify(mapData)]]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.complexityScore).toBe(50);
        expect(suggestPriceTier(result.artifact.complexityScore)).toBe(1);
      }
    });

    it('50 个实例 + 1 张地图 = 550 分 = Tier 3', async () => {
      const manifests = new Map<string, string>();
      for (let i = 0; i < 50; i++) {
        manifests.set(
          `weapons/wp-${i}.json`,
          JSON.stringify({ id: `wp-${i}`, classComposition: { classIds: [] }, damage: 3 }),
        );
      }
      const mapData = {
        schemaVersion: '1.0' as const,
        id: 'map-001',
        name: '测试地图',
        backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
        floors: [0],
        nodes: [
          { id: 'n1', def: 'scene.class.room', scale: 'small' as const, at: { x: 0.5, y: 0.5 }, floor: 0 },
        ],
        edges: [],
        placements: [],
      };
      manifests.set('maps/test-map.json', JSON.stringify(mapData));
      const input = makeInput({ manifests });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.complexityScore).toBe(550);
        expect(suggestPriceTier(result.artifact.complexityScore)).toBe(3);
      }
    });
  });

  describe('基类引用收集', () => {
    it('收集所有 .class. 引用', async () => {
      const input = makeInput({
        manifests: new Map([
          [
            'weapons/katana.json',
            JSON.stringify({
              id: 'wp-katana',
              classComposition: {
                classIds: ['weapon.class.melee', 'damage-type.class.slash'],
              },
              actions: [{ classId: 'action.class.attack' }],
            }),
          ],
        ]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.referencedClassIds).toContain('weapon.class.melee');
        expect(result.artifact.referencedClassIds).toContain('damage-type.class.slash');
        expect(result.artifact.referencedClassIds).toContain('action.class.attack');
      }
    });
  });

  describe('混合包（profile + 地图）', () => {
    it('同时编译 profile 和地图', async () => {
      const mapData = {
        schemaVersion: '1.0' as const,
        id: 'map-001',
        name: '测试地图',
        backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
        floors: [0],
        nodes: [
          { id: 'n1', def: 'scene.class.room', scale: 'small' as const, at: { x: 0.5, y: 0.5 }, floor: 0 },
        ],
        edges: [],
        placements: [],
      };
      const input = makeInput({
        manifests: new Map([
          [
            'weapons/katana.json',
            JSON.stringify({
              id: 'wp-katana',
              classComposition: { classIds: ['weapon.class.melee'] },
              damage: 3,
            }),
          ],
          ['maps/test-map.json', JSON.stringify(mapData)],
        ]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact.profiles).toHaveLength(1);
        expect(result.artifact.maps).toHaveLength(1);
        expect(result.artifact.complexityScore).toBe(60); // 1 profile * 10 + 1 map * 50
      }
    });
  });

  describe('诊断的 autoFixable 标志', () => {
    it('数值越界可自动修正', async () => {
      const input = makeInput({
        manifests: new Map([
          [
            'weapons/op.json',
            JSON.stringify({
              id: 'wp-op',
              classComposition: { classIds: ['weapon.class.melee'] },
              damage: 47,
            }),
          ],
        ]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const diag = result.diagnostics.find((d) => d.code === 'PLAY-NUM-OUT-OF-RANGE');
        expect(diag?.autoFixable).toBe(true);
        expect(diag?.suggestedFix).toBe(5);
      }
    });

    it('地图结构错误不可自动修正', async () => {
      const badMapData = {
        schemaVersion: '1.0' as const,
        id: 'map-bad',
        name: '坏地图',
        backdrop: { image: 'test.png', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
        floors: [0],
        nodes: [
          { id: 'n1', def: 'scene.class.room', scale: 'small' as const, at: { x: 2.0, y: 0.5 }, floor: 0 },
        ],
        edges: [],
        placements: [],
      };
      const input = makeInput({
        manifests: new Map([['maps/bad-map.json', JSON.stringify(badMapData)]]),
      });
      const result = await compile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const diag = result.diagnostics.find((d) => d.code === 'MAP_COORD_OUT_OF_RANGE');
        expect(diag?.autoFixable).toBe(false);
      }
    });
  });
});
