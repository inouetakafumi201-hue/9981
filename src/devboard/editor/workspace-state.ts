/**
 * 开发板工作区态（Design Data Model）。
 *
 * 编辑平面（devboard 内部）与契约平面（`MapData` 落盘）分离：devboard 在此维护编辑态，
 * 只在映射回 `MapData` 时交给 ports 桶。开发板绝不把这些字段写进 `MapData.layers` 之外。
 */
import type { MapData, MapNode } from '../ports/map-contracts';
import type { MapLayer } from '../layers/layer-shapes';

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
 * 把 devboard 编辑态（图层/贴纸）列表作为 plain 图层列表透传（契约扩展后的 devboard 先行版）。
 * canonical 落盘规范化由 `editor/map-io.ts` 负责，这里不做契约写入。
 */
export function projectLayers(state: Pick<WorkspaceState, 'layers'>): readonly MapLayer[] {
  return state.layers;
}

/**
 * 把编辑态楼层编号映射回当前图层 id。editor 仍以 floor 作为内部编辑轴，
 * 但导入 / 导出 / 预览消费都应通过这个桥读写 canonical layer id。
 */
export function layerIdForFloor(layers: readonly MapLayer[], floor: number): string | undefined {
  if (layers.length === 0) return undefined;
  const index = Math.max(0, Math.min(layers.length - 1, floor));
  return layers[index]?.id;
}

/** 节点层归属：devboard 以 `MapNode['layerId']` shape 表达（契约扩展后的扩展位）。 */
export function nodeLayerId(node: MapNode): string | undefined {
  return (node as { layerId?: string }).layerId;
}
