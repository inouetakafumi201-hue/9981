import { describe, it, expect } from 'vitest';
import {
  COMPONENT_CATEGORIES,
  CATEGORY_SPECS,
  validateBatchRegistry,
  generateSampleRegistry,
  buildComponentsManifest,
} from '../../../scripts/asset-pipeline/batch-component-pipeline.mjs';
import {
  isSvg,
  isPng,
  isSupportedImage,
  parseSvgDimensions,
} from '../../../src/devboard/editor-shell/lib/file-upload';

describe('SVG 底图支持与 8 类素材组件管线测试', () => {
  it('确立 8 大标准素材类别，且包含正确的透视与状态配置', () => {
    expect(COMPONENT_CATEGORIES).toHaveLength(8);
    expect(COMPONENT_CATEGORIES).toEqual([
      'weapon-melee',
      'weapon-ranged',
      'weapon-firearm',
      'item-consumable',
      'item-tool',
      'item-equipment',
      'device',
      'environment',
    ]);

    for (const cat of COMPONENT_CATEGORIES) {
      expect(CATEGORY_SPECS[cat]).toBeDefined();
      expect(['axonometric', 'front']).toContain(CATEGORY_SPECS[cat].perspective);
      expect(CATEGORY_SPECS[cat].defaultStates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('validateBatchRegistry 校验 8 类素材清单的正确性', () => {
    const sample = generateSampleRegistry();
    const result = validateBatchRegistry(sample);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);

    const invalid = {
      kind: 'invalid',
      entries: [{ name: 'bad', type: 'invalid-type', desc: '' }],
    };
    const badResult = validateBatchRegistry(invalid);
    expect(badResult.ok).toBe(false);
    expect(badResult.errors.length).toBeGreaterThan(0);
  });

  it('buildComponentsManifest 生成并产出合法的 8 类资产目录', () => {
    const catalog = buildComponentsManifest();
    expect(catalog.kind).toBe('wakeup-component-catalog');
    expect(catalog.version).toBe(2);
    expect(catalog.count).toBe(8);
    expect(catalog.components.every((c) => c.runtimeBinding.selectableInEditor)).toBe(true);
  });

  it('file-upload 工具函数支持 SVG / PNG 类型判定与尺寸解析', () => {
    const fakeSvg = new File(['<svg viewBox="0 0 1920 1080"></svg>'], 'map.svg', { type: 'image/svg+xml' });
    const fakePng = new File(['\x89PNG\r\n\x1a\n12345678'], 'map.png', { type: 'image/png' });
    const fakeJpg = new File(['jpg'], 'map.jpg', { type: 'image/jpeg' });

    expect(isSvg(fakeSvg)).toBe(true);
    expect(isPng(fakePng)).toBe(true);
    expect(isSupportedImage(fakeSvg)).toBe(true);
    expect(isSupportedImage(fakePng)).toBe(true);
    expect(isSupportedImage(fakeJpg)).toBe(false);

    const dimsFromViewBox = parseSvgDimensions('<svg viewBox="0 0 2560 1440"></svg>');
    expect(dimsFromViewBox).toEqual({ width: 2560, height: 1440 });

    const dimsFromAttrs = parseSvgDimensions('<svg width="800" height="600"></svg>');
    expect(dimsFromAttrs).toEqual({ width: 800, height: 600 });
  });
});
