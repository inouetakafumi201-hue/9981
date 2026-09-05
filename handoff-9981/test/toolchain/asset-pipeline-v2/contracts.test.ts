/**
 * V0 混合素材生成管线 v2 契约测试
 *
 * 验证：
 * 1. component-types.v2.json 机器事实源（8类组件、视角规则）；
 * 2. job.v2.schema.json 与 manifest.v2.schema.json 契约合法性；
 * 3. manifest.v2.minimal.json 最小样例符合 Schema；
 * 4. icon-index.json 304 项符号语义库的完备性与契约；
 * 5. MapData 占位切片 (Crop-to-Sprite) 契约与校验。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { validateMapStructure } from '../../../src/play/map/validate';
import { normalizeMapDocument, type MapData } from '../../../src/play/map/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

describe('素材生成管线 v2: component-types 事实源', () => {
  const catalogPath = resolve(ROOT, '.agents/skills/sprite-forge/catalogs/component-types.v2.json');

  it('component-types.v2.json 存在且结构合法', () => {
    expect(existsSync(catalogPath)).toBe(true);
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    expect(catalog.schemaVersion).toBe('2.0');
    expect(Array.isArray(catalog.types)).toBe(true);
    expect(catalog.types.length).toBe(8);

    const typeIds = catalog.types.map((t: { id: string }) => t.id);
    const expected = [
      'weapon-melee',
      'weapon-ranged',
      'weapon-firearm',
      'item-consumable',
      'item-tool',
      'item-equipment',
      'device',
      'environment',
    ];
    expect(typeIds).toEqual(expected);
  });

  it('视角规则严格分流：物品类 front view，其余 front-top axonometric view', () => {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const itemTypes = new Set(['item-consumable', 'item-tool', 'item-equipment']);

    for (const item of catalog.types) {
      if (itemTypes.has(item.id)) {
        expect(item.perspective, `${item.id} 必须为 front view`).toBe('front view');
      } else {
        expect(item.perspective, `${item.id} 必须为 front-top axonometric view`).toBe('front-top axonometric view');
      }
    }
  });
});

describe('素材生成管线 v2: JSON Schema 与 Manifest Fixture', () => {
  const jobSchemaPath = resolve(ROOT, '.agents/skills/sprite-forge/schemas/job.v2.schema.json');
  const manifestSchemaPath = resolve(ROOT, '.agents/skills/sprite-forge/schemas/manifest.v2.schema.json');
  const fixturePath = resolve(ROOT, '.agents/skills/sprite-forge/fixtures/manifest.v2.minimal.json');

  const ajv = new Ajv({ allErrors: true });

  it('job.v2.schema.json 是合法的 JSON Schema', () => {
    expect(existsSync(jobSchemaPath)).toBe(true);
    const schema = JSON.parse(readFileSync(jobSchemaPath, 'utf8'));
    const validate = ajv.compile(schema);
    expect(typeof validate).toBe('function');
  });

  it('manifest.v2.schema.json 是合法的 JSON Schema', () => {
    expect(existsSync(manifestSchemaPath)).toBe(true);
    const schema = JSON.parse(readFileSync(manifestSchemaPath, 'utf8'));
    const validate = ajv.compile(schema);
    expect(typeof validate).toBe('function');
  });

  it('manifest.v2.minimal.json fixture 满足 manifest.v2.schema.json 约束', () => {
    expect(existsSync(fixturePath)).toBe(true);
    const schema = JSON.parse(readFileSync(manifestSchemaPath, 'utf8'));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const validate = ajv.compile(schema);
    const valid = validate(fixture);
    if (!valid) {
      console.error('Validation errors:', validate.errors);
    }
    expect(valid).toBe(true);
    expect(fixture.schemaVersion).toBe('2.0');
    expect(fixture.status).toBe('ready');
    expect(fixture.frames.length).toBeGreaterThan(0);
    expect(fixture.frames[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('素材生成管线 v2: 符号语义库 (icon-semantics)', () => {
  const indexPath = resolve(ROOT, '.agents/skills/sprite-forge/icon-semantics/icon-index.json');
  const svgDir = resolve(ROOT, 'src/svg-game-icons');

  it('icon-index.json 包含完整的 304 个图标定义', () => {
    expect(existsSync(indexPath)).toBe(true);
    const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(indexData.schemaVersion).toBe('2.0');
    expect(indexData.totalCount).toBe(304);
    expect(indexData.icons.length).toBe(304);

    for (const icon of indexData.icons) {
      expect(icon.id).toBeDefined();
      expect(icon.name).toBeDefined();
      expect(icon.category).toBeDefined();
      expect(icon.usage).toBeDefined();
      expect(icon.sourceSvg).toBeDefined();
    }
  });

  it('icon-index.json 与 src/svg-game-icons 中的实际文件 1:1 双向对应', () => {
    const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
    const svgFiles = readdirSync(svgDir).filter((f) => f.endsWith('.svg'));
    expect(svgFiles.length).toBe(304);

    const svgIds = new Set(svgFiles.map((f) => f.replace(/^game-icons--/, '').replace(/\.svg$/, '')));
    const indexIds = new Set(indexData.icons.map((i: { id: string }) => i.id));

    expect(svgIds.size).toBe(304);
    expect(indexIds.size).toBe(304);

    for (const id of svgIds) {
      expect(indexIds.has(id), `SVG id ${id} missing in icon-index.json`).toBe(true);
    }
  });
});

describe('素材生成管线 v2: 原生组件占位切片 (Crop-to-Sprite) 数据契约', () => {
  it('MapData placeholderBoxes 规范化与保留', () => {
    const mapData: MapData = {
      schemaVersion: '1.0',
      id: 'test_crop_map',
      name: '测试地图',
      backdrop: { image: 'b.png', pixelWidth: 1000, pixelHeight: 1000, tileRows: 1, tileCols: 1 },
      floors: [0],
      nodes: [
        { id: 'n1', def: 'd:scene/room', scale: 'medium', at: { x: 0.2, y: 0.2 }, floor: 0 },
        { id: 'n2', def: 'd:scene/room', scale: 'medium', at: { x: 0.8, y: 0.8 }, floor: 0 },
      ],
      edges: [
        { id: 'e1', def: 'd:transition/door', a: 'n1', b: 'n2', directionality: 'bidirectional', path: [] },
      ],
      placements: [],
      placeholderBoxes: [
        {
          id: 'door_subway_45',
          type: 'transition',
          bounds: { x: 0.1, y: 0.2, width: 0.15, height: 0.25 },
          connectedEdgeId: 'e1',
          sourceCrop: 'crops/door_subway_45.png',
          spriteRef: 'd:item/door_subway_45',
        },
      ],
    };

    const canonical = normalizeMapDocument(mapData);
    expect(canonical.placeholderBoxes).toBeDefined();
    expect(canonical.placeholderBoxes?.length).toBe(1);
    const firstBox = canonical.placeholderBoxes?.[0];
    expect(firstBox?.id).toBe('door_subway_45');
    expect(firstBox?.spriteRef).toBe('d:item/door_subway_45');

    const findings = validateMapStructure(canonical);
    expect(findings).toEqual([]);
  });
});
