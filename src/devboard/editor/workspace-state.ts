/**
 * 开发板工作区态（Design Data Model）。
 *
 * 编辑平面（devboard 内部）与契约平面（`MapData` 落盘）分离：devboard 在此维护编辑态，
 * 只在映射回 `MapData` 时交给 ports 桶。开发板绝不把这些字段写进 `MapData.layers` 之外。
 */
import type { MapData, MapNode } from '../ports/map-contracts.js';
import type { MapLayer } from '../layers/layer-shapes.js';

/** 贴纸编辑态：点「确定」后 locked=true → 不可再选（L.1/L.5）。 */
export interface StickerEdit {
  readonly id: string;
  readonly layerId: string;
  readonly image: string;
  readonly transform: { readonly scaleX: number; readonly scaleY: number; readonly tx: number; readonly ty: number };
  readonly locked: boolean;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface SelectionTarget {
  readonly kind: 'node' | 'edge' | 'sticker' | 'layer' | 'placement';
  readonly id: string;
  readonly layerId: string | undefined;
}

export interface WorkspaceState {
  readonly map: MapData;
  readonly layers: readonly MapLayer[]; // 以 height 排序；参与透视 height 去重（留空可有多个）
  readonly currentLayerId: string | null; // 当前图层；null = 无图层
  readonly stickers: readonly StickerEdit[];
  readonly selection: SelectionTarget | null;
  readonly history: readonly { readonly undo: () => void }[]; // 占位，undo/redo 后置
}

/** 新建一个空图层（空画布，L.1）。 */
export function emptyLayer(id: string, name?: string): MapLayer {
  return { id, ...(name ? { name } : {}), height: undefined };
}

/**
 * 把 devboard 编辑态（图层/贴纸）映射回 `MapData.layers` 形状（L.10 的 devboard 先行版）。
 * 契约扩展落地后可无缝承接；当前 layers 未进契约，因此不修改传入的 `map`，返回纯图层列表。
 */
export function projectLayers(state: Pick<WorkspaceState, 'layers'>): readonly MapLayer[] {
  return state.layers;
}

/** 节点层归属：devboard 侧暂以 `MapNode['layerId']` shape 表达（契约扩展前用占位 map）。 */
export function nodeLayerId(node: MapNode): string | undefined {
  return (node as { layerId?: string }).layerId;
}
