/**
 * 开发板核心纯逻辑单元测试（图层规则 + 加载/蓝本/导出 + 工作区态）。
 * 不依赖 React/浏览器，只用 vitest；devboard 逻辑层与渲染层分离。
 */
import { describe, expect, it } from 'vitest';
import {
  canSetHeight,
  hasDuplicateHeights,
  isVerticalTransition,
  isStrictlyHigher,
  shadowOnTransparency,
  verticalInteractionSide,
  visibleLayers,
} from '../layers/layer-rules';
import { overlayOpacity } from '../layers/layer-shapes';
import type { MapLayer } from '../layers/layer-shapes';
import { blueprintCopy, serializeMapPublish, stableMapId } from '../editor/map-io';
import { emptyLayer } from '../editor/workspace-state';
import type { MapData } from '../ports/map-contracts';

function layer(id: string, height?: number): MapLayer {
  return { id, ...(height !== undefined ? { height } : {}) };
}

describe('devboard 图层规则', () => {
  it('height 去重：参与透视的同高判重，留空(三界外)不判重', () => {
    expect(hasDuplicateHeights([layer('a', 1), layer('b', 1)])).toBe(true);
    expect(hasDuplicateHeights([layer('a', 1), layer('b', 2)])).toBe(false);
    // 留空可有多个
    expect(hasDuplicateHeights([layer('a'), layer('b'), layer('c', 3)])).toBe(false);
    expect(hasDuplicateHeights([layer('a'), layer('b')])).toBe(false);
  });

  it('canSetHeight：留空永远合法；填值不得与【其他】参与透视图层同高', () => {
    const ls = [layer('a', 1), layer('b', 2)];
    expect(canSetHeight(ls, 'c', undefined)).toBe(true); // 新建留空
    expect(canSetHeight(ls, 'c', 3)).toBe(true);
    expect(canSetHeight(ls, 'c', 1)).toBe(false); // 撞 a
    expect(canSetHeight(ls, 'b', 1)).toBe(false); // 改 b→1 撞 a
    // 与自身同高不算（例外：b 已是 2）
    expect(canSetHeight(ls, 'b', 2)).toBe(true);
  });

  it('当前图层可见性：只暴露当前图层及低于它的图层；严格更高层不可见；留空独立层始终可见', () => {
    const ls = [layer('low', 1), layer('cur', 2), layer('high', 3), layer('float')];
    const visible = visibleLayers(ls, 'cur').map((l) => l.id);
    expect(visible).toContain('low');
    expect(visible).toContain('cur');
    expect(visible).toContain('float'); // 三界外独立层可见
    expect(visible).not.toContain('high'); // 严格更高不可见
    // currentId null → 全部可见
    expect(visibleLayers(ls, null).length).toBe(ls.length);
  });

  it('isStrictlyHigher 与垂直过渡：高度不同才判垂直；越高侧可交互', () => {
    expect(isStrictlyHigher(layer('a', 3), layer('b', 1))).toBe(true);
    expect(isStrictlyHigher(layer('a', 1), layer('b', 1))).toBe(false);
    expect(isStrictlyHigher(layer('a'), layer('b', 1))).toBe(false); // 留空不判高低
    expect(isVerticalTransition(layer('a', 3), layer('b', 1))).toBe(true);
    expect(isVerticalTransition(layer('a', 2), layer('b', 2))).toBe(false);
    expect(isVerticalTransition(layer('a'), layer('b'))).toBe(false);
    // 可交互朝向偏高侧
    expect(verticalInteractionSide(layer('a', 5), layer('b', 2))).toBe('a');
    expect(verticalInteractionSide(layer('a', 2), layer('b', 5))).toBe('b');
    expect(verticalInteractionSide(layer('a', 5), layer('b', 5))).toBeNull();
    expect(verticalInteractionSide(layer('a'), layer('b', 5))).toBeNull();
  });

  it('遮挡落在透明处 → 淡显提示（这块不影响下层）', () => {
    expect(shadowOnTransparency(true)).toBe(true);
    expect(shadowOnTransparency(false)).toBe(false);
  });

  it('overlayOpacity：两侧都填 height → clamp(1 - |Δh| × 0.1, 0, 1)；任一侧留空 → null(三界外不叠加)', () => {
    expect(overlayOpacity(1, 2)).toBeCloseTo(0.9, 6);
    expect(overlayOpacity(1, 11)).toBe(0); // 差满 10 全隐
    expect(overlayOpacity(3, 3)).toBe(1);
    expect(overlayOpacity(undefined, 2)).toBeNull();
    expect(overlayOpacity(1, undefined)).toBeNull();
  });
});

describe('devboard 加载 / 蓝本 / 导出', () => {
  const baseMap: MapData = {
    schemaVersion: '1.0',
    id: 'sample_sleeper',
    name: '卧铺车厢',
    backdrop: { image: 'sleeper.png', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 },
    floors: [0],
    nodes: [],
    edges: [],
    placements: [],
  };

  it('blueprintCopy：内容复制 + 新稳定命名(无随机尾缀)，源图命名不受影响', () => {
    const copy = blueprintCopy(baseMap, 'office tower');
    expect(copy.id).toBe(stableMapId('office tower'));
    expect(copy.name).toBe('office tower');
    // 稳定命名不带随机尾缀（不出现 `_<hex>` 形态）；空格规整为下划线合法（`office_tower`）。
    expect(copy.id).toBe('office_tower');
    expect(copy.id).not.toMatch(/[0-9a-f]{4}$/);
    expect(copy.nodes).toEqual(baseMap.nodes);
    // 源图不变
    expect(baseMap.id).toBe('sample_sleeper');
    expect(copy.id).not.toBe(baseMap.id);
  });

  it('稳定命名规范化：去空白、去可能的随机尾缀形态', () => {
    expect(stableMapId('a b c')).toBe('a_b_c');
    expect(stableMapId('hello_7f3a')).toBe('hello'); // 剥掉 4 位 hex 尾缀
    expect(stableMapId('  ')).toBe('map'); // 全空兜底
  });

  it('serializeMapPublish：导出 canonical layers/layerId、不含 bounds；transform 保序', () => {
    const layers = [layer('l0', 1), { ...layer('l1'), transform: { scaleX: 2, scaleY: 2, tx: 10, ty: 20 } }];
    const json = serializeMapPublish({ map: baseMap, layers });
    expect(json).toContain('"l0"');
    expect(json).toContain('"scaleX"');
    expect(json).not.toContain('"bounds"');
    // canonical 输出：schemaVersion 升到 2.0，不再写 legacy floors/floor。
    const parsed = JSON.parse(json) as { schemaVersion: string; layers: MapLayer[]; nodes: { layerId?: string }[] };
    expect(parsed.schemaVersion).toBe('2.0');
    expect(json).not.toContain('"floors"');
    expect(parsed.layers.length).toBe(2);
    expect(parsed.layers[0]!.id).toBe('l0');
    expect(parsed.layers[1]!.transform!.tx).toBe(10);
    // 空地图节点归一化为 canonical 层引用（无节点时该约束空成立）。
    expect(parsed.nodes.every((n) => typeof n.layerId === 'string')).toBe(true);
  });

  it('emptyLayer：新建图层为空画布，height 未填(三界外)', () => {
    const e = emptyLayer('layer:0', '底');
    expect(e.id).toBe('layer:0');
    expect(e.name).toBe('底');
    expect(e.height).toBeUndefined();
  });
});
