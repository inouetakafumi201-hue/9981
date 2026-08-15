/**
 * 地图加载 / 蓝本 / 导出 端口（要求 2，Design Components 5）。
 *
 * 开发板不直接碰游戏装载器，只与 `MapData` 契约交互：加载已加载地图、新建（可选蓝本）、
 * 导出玩法包/地图 JSON 文件。蓝本复制必须产出**新的稳定命名（无随机尾缀）**，源图命名不被破坏
 * （`01` §附ID规范 2026-08-15）。导出沿用 `asset-pipeline` 样例格式，**不生成 bounds**（候选3）。
 */
import type { MapData } from '../ports/map-contracts.js';
import type { MapLayer } from '../layers/layer-shapes.js';

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
    // 蓝本复制不保留源的随机尾缀命名；layers 未进契约，蓝图新建后的图层由 devboard 态接管。
  };
}

/** 组合一个 devboard 导出的 MapData（含 devboard 侧图层投射）。契约扩展后透传 `layers`。 */
export interface ExportBundle {
  readonly map: MapData;
  readonly layers: readonly MapLayer[];
}

/** 导出为玩法包/地图 JSON 文件内容；不生成 bounds（候选3）。 */
export function serializeMapPublish(bundle: ExportBundle): string {
  const published = {
    schemaVersion: bundle.map.schemaVersion,
    id: bundle.map.id,
    name: bundle.map.name,
    backdrop: bundle.map.backdrop,
    floors: bundle.map.floors,
    layers: bundle.layers.map((l) => ({
      id: l.id,
      ...(l.name !== undefined ? { name: l.name } : {}),
      ...(l.height !== undefined ? { height: l.height } : {}),
      ...(l.backdrop ? { backdrop: l.backdrop } : {}),
      ...(l.transform ? { transform: l.transform } : {}),
    })),
    nodes: bundle.map.nodes,
    edges: bundle.map.edges,
    placements: bundle.map.placements,
  };
  return JSON.stringify(published, null, 2);
}
