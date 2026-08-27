/**
 * 开发板的图层类型形状（devboard 侧自有）。
 *
 * 权威图层设计在 `docs/创作系统/01_创作工具与产权.md` §九「分层图层」L.1–L.10。
 * MapData floor→layers 契约扩展已落地：`src/play/map/types.ts` 的 `MapLayer`（含 backdrop/transform）
 * 与这里结构一致，经 `src/devboard/ports/map-contracts.ts` 桶透传。开发板保留这一层形状作为编辑态
 * 承载，与契约桶 `MapLayer` 结构等价——绑定由 `editor/map-io.ts` 导出规范化和导入边界完成。
 */
export interface LayerTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly tx: number;
  readonly ty: number;
}

export interface LayerBackdrop {
  readonly image: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * 一个图层（L.1/L.2/L.10）：
 * - 空画布 + 贴纸；`height` 可空（留空 = 三界外独立、无透视，可多个）；
 * - 参与透视的 height 去重；新建时不可与已有参与透视图层同高；
 * - `backdrop` 全屏=固定比例尺铺满 / 局部=贴纸（右下角确定后锁定，见 L.5）。
 */
export interface MapLayer {
  readonly id: string; // 图层稳定命名，无随机尾缀（01 §附ID规范）
  readonly name?: string;
  readonly height?: number; // 可空；参与透视则填正小数，留空=独立无透视
  readonly backdrop?: LayerBackdrop;
  readonly transform?: LayerTransform; // 缩放+平移，用于图层间对齐；不承载边界（候选3）
}

// 透明规则（L.3）：两层都填 height 时，opacity = clamp(1 - |Δheight| × 0.1, 0, 1)；
// 差满 10 或更大时全隐。任一侧留空 = 独立层，由调用方当作 opacity 1。
// 该公式在对局表现层由 `src/play/map/serialize.ts` 的 `layerOpacity` 统一提供（同一口径）；
// devboard 仅以本函数作为编辑器「预览/转译口径」，二者取同一公式、结果一致。
export function overlayOpacity(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined || b === undefined) return null; // 任一侧留空 = 三界外，不叠加（L.3）
  const d = Math.abs(a - b);
  return Math.max(0, Math.min(1, 1 - d * 0.1));
}
