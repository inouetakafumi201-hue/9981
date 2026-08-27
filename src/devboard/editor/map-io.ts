/**
 * 地图加载 / 蓝本 / 导出 端口（要求 2，Design Components 5）。
 *
 * 开发板不直接碰游戏装载器，只与 `MapData` 契约交互：加载已加载地图、新建（可选蓝本）、
 * 导出玩法包/地图 JSON 文件。蓝本复制必须产出**新的稳定命名（无随机尾缀）**，源图命名不被破坏
 * （`01` §附ID规范 2026-08-15）。
 *
 * 导出只写 canonical 形状：devboard 以 layer 列表（层显示元数据）为权威，把 legacy floor 地图
 * 规范化成 `layers` / `node.layerId`，不再输出 legacy `floor` / `floors`（MapData floor→layers 契约扩展）。
 */
import { normalizeMapDocument, deriveLayerId } from '../ports/map-contracts';
import type { MapData, MapLayer } from '../ports/map-contracts';

/** 生成一个无随机尾缀的稳定命名。地图锚点 key 不裹尾缀（`01` §附ID规范）。 */
export function stableMapId(displayName: string): string {
  // 保留原命名的稳定部分，去除任何可能混入的随机尾缀形态（_<hex>）。
  const stripped = displayName.replace(/_?[0-9a-f]{4}$/i, '');
  const slug = stripped.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return slug || 'map';
}

/** 复制一张地图作为蓝本：内容复制，但 id 换成新的稳定命名（蓝本是复制基底，不是别名）。 */
export function blueprintCopy(source: MapData, newName: string): MapData {
  return {
    ...source,
    id: stableMapId(newName),
    name: newName,
    // 蓝本复制不保留源的随机尾缀命名；图层由 devboard 态接管。
  };
}

/** 组合一个 devboard 导出的 MapData（含 devboard 侧图层投射）。契约扩展后经 canonical 规范化。 */
export interface ExportBundle {
  readonly map: MapData;
  readonly layers: readonly MapLayer[];
}

/**
 * 节点层归属：devboard 尚未给节点写 `layerId`，导出时按 floor 就近归类到列出的图层；
 * 带 `layerId` 的节点优先用其显式引用。floor 超出图层数时回退到 deriveLayerId。
 */
interface NodeLayerRef { readonly floor?: number; readonly layerId?: string }
function publishLayerOf(node: NodeLayerRef, ordered: readonly MapLayer[]): string {
  if (node.layerId !== undefined) return node.layerId;
  const listed = ordered.map((layer) => layer.id);
  const idx = Math.max(0, Math.min(listed.length - 1, node.floor ?? 0));
  return listed[idx] ?? deriveLayerId(node.floor ?? 0);
}

/**
 * 把 devboard 编辑态规范化为 canonical 形状。
 *
 * devboard 的 layer 列表是权威图层（name/height/backdrop/transform）。这里把列出的图层直接作为
 * canonical `layers`，节点根据 floor 就近归类到所列图层（带显式 layerId 的节点用其引用），产出
 * canonical v2 文档——不经过 legacy floor 派生层，故不会出现 deriveLayerId 的 `layer:floor:N` 层。
 */
function canonicalizeForPublish(bundle: ExportBundle): ReturnType<typeof normalizeMapDocument> {
  const ordered = bundle.layers;
  return normalizeMapDocument({
    schemaVersion: '2.0',
    id: bundle.map.id,
    name: bundle.map.name,
    backdrop: bundle.map.backdrop,
    layers: ordered,
    nodes: bundle.map.nodes.map((node) => ({
      id: node.id,
      def: node.def,
      scale: node.scale,
      at: node.at,
      ...(node.parent !== undefined ? { parent: node.parent } : {}),
      ...(node.name !== undefined ? { name: node.name } : {}),
      layerId: publishLayerOf(node, ordered),
    })),
    edges: bundle.map.edges,
    placements: bundle.map.placements,
  } as never);
}

/** 层显示元数据序列化：只写出有值的字段，字段顺序固定（确定性 pretty JSON）。 */
function serializeLayer(layer: MapLayer): Record<string, unknown> {
  const record: Record<string, unknown> = { id: layer.id };
  if (layer.name !== undefined) record['name'] = layer.name;
  if (layer.height !== undefined) record['height'] = layer.height;
  if (layer.backdrop !== undefined) {
    record['backdrop'] = {
      image: layer.backdrop.image,
      pixelWidth: layer.backdrop.pixelWidth,
      pixelHeight: layer.backdrop.pixelHeight,
    };
  }
  if (layer.transform !== undefined) {
    record['transform'] = {
      scaleX: layer.transform.scaleX,
      scaleY: layer.transform.scaleY,
      tx: layer.transform.tx,
      ty: layer.transform.ty,
    };
  }
  return record;
}

/**
 * 导出为玩法包/地图 JSON 文件内容；不生成 bounds（候选3）。
 * 只输出 canonical `layers` / `node.layerId`，不再输出 legacy `floors` / `floor`。
 */
export function serializeMapPublish(bundle: ExportBundle): string {
  const canonical = canonicalizeForPublish(bundle);
  const published = {
    schemaVersion: canonical.schemaVersion,
    id: canonical.id,
    name: canonical.name,
    backdrop: canonical.backdrop,
    layers: canonical.layers.map(serializeLayer),
    nodes: canonical.nodes.map((node) => ({
      id: node.id,
      def: node.def,
      scale: node.scale,
      at: { x: node.at.x, y: node.at.y },
      layerId: node.layerId,
      ...(node.parent !== undefined ? { parent: node.parent } : {}),
      ...(node.name !== undefined ? { name: node.name } : {}),
    })),
    edges: canonical.edges,
    placements: canonical.placements,
  };
  return JSON.stringify(published, null, 2);
}
