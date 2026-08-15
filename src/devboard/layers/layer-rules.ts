/**
 * 图层编辑规则（开发板 UI 侧，对应 `01` §九 L.1–L.9）。
 *
 * 这些是编辑器行为规则，不是 `MapData.layers` 契约本身（契约扩展在独立专项）。
 * 规则来源：L.1 空画布+贴纸锁定、L.2 height 可空+去重、L.4 当前图层可见性、
 * L.8 障碍物落透明淡显、L.9 跨层过渡垂直态/双向判定。
 */
import type { MapLayer } from './layer-shapes.js';

export interface LayerTreeInput {
  readonly layers: readonly MapLayer[];
}

/** L.2：参与透视（填了 height）的 height 去重；留空（三界外）图层可有多个。 */
export function hasDuplicateHeights(layers: readonly MapLayer[]): boolean {
  const seen = new Set<number>();
  for (const l of layers) {
    if (l.height !== undefined) {
      if (seen.has(l.height)) return true;
      seen.add(l.height);
    }
  }
  return false;
}

/**
 * L.2：新建/改图层的 height 合法性。
 * - 留空 → 永远合法（独立层，三界外，可多个）。
 * - 填了值 → 不得与【其他】参与透视图层的 height 相同。
 */
export function canSetHeight(layers: readonly MapLayer[], layerId: string, height: number | undefined): boolean {
  if (height === undefined) return true;
  return !layers.some((l) => l.id !== layerId && l.height === height);
}

/** L.4：给定当前图层，暴露给编辑的图层 = 当前图层及其以下（height ≤ 当前）。
 *  留空（三界外）图层：作为独立层始终可见（不与任何 height 比较），但严格更高层不可见。 */
export function visibleLayers(
  layers: readonly MapLayer[],
  currentId: string | null,
): readonly MapLayer[] {
  if (currentId === null) return layers;
  const current = layers.find((l) => l.id === currentId);
  if (!current) return layers;
  const curH = current.height;
  return layers.filter((l) => {
    if (l.id === currentId) return true;
    // 三界外（留空）图层：本身无高度可比，作为独立层始终可见；但若它严格更高则不可见——此处按"无 height 的独立层"返回可见。
    if (l.height === undefined) return true;
    if (curH === undefined) return true; // 当前是三界外独立层 → 只它自己+其他独立层可见
    return l.height <= curH;
  });
}

/** 图层是否比另一图层"严格更高"（同为参与透视时按 height；任一侧留空不判高低）。 */
export function isStrictlyHigher(a: MapLayer, b: MapLayer): boolean {
  if (a.height === undefined || b.height === undefined) return false;
  return a.height > b.height;
}

/** 跨层连线是否成"垂直过渡场景"（L.9）：两端最高度不同，且路径中间有过渡场景。 */
export function isVerticalTransition(from: MapLayer | undefined, to: MapLayer | undefined): boolean {
  if (!from || !to) return false;
  if (from.height === undefined || to.height === undefined) return false;
  return from.height !== to.height;
}

/** L.9：垂直过渡场景的可交互朝向在偏高的一侧。返回 'a'|'b'（偏高那一侧）；无高度/同高/任一侧缺 → null。 */
export function verticalInteractionSide(
  a: MapLayer | undefined,
  b: MapLayer | undefined,
): 'a' | 'b' | null {
  if (!a || !b) return null;
  if (a.height === undefined || b.height === undefined) return null;
  if (a.height === b.height) return null;
  return a.height > b.height ? 'a' : 'b';
}

/**
 * L.8：障碍物/遮挡框落在图层的透明位置 → 淡显提示（这块不影响下层）。
 * 开发板只据此决定要不要给该框画淡显；"影响下层"与否由表现层按漏风+height 判定，
 * 编辑器仅提示，不改变存储。返回 true 表示应淡显。
 */
export function shadowOnTransparency(stickerHasTransparencyAt: boolean): boolean {
  return stickerHasTransparencyAt; // 该框落在透明洞 → 淡显
}
