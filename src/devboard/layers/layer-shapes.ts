/**
 * 开发板的图层类型形状（devboard 侧自有）。
 *
 * 权威图层设计在 `docs/创作系统/01_创作工具与产权.md` §九「分层图层」L.1–L.10。
 * `MapData.layers` 尚未落进 `src/play/map` 契约（那是独立契约扩展专项）；开发板在这里
 * 按 L.10 定义图层/图层背景/变换的形状，作为编辑态承载，契约扩展落地后由 ports 桶
 * 透传同名接口无缝承接。开发板绝不发明与权威文稿相左的字段。
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

// 透明规则（L.3）：对局表现为 min(1, |Δheight| × 0.1)；差满 10 全隐。
// 该公式是**对局表现层**规则，`compileMap` 把 height 当几何丢弃。devboard 仅以它为
// 编辑器「预览/转译口径」，不改变契约。
export function overlayOpacity(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined || b === undefined) return null; // 任一侧留空 = 三界外，不叠加（L.3）
  const d = Math.abs(a - b);
  return Math.min(1, d * 0.1);
}
