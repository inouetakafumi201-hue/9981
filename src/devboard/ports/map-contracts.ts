/**
 * 开发板只读消费 `src/play/map` 的契约桶（barrel）。
 *
 * 开发板不直接 import `src/play/map/{types,validate,compile,curve}.ts` 的报文小路径，
 * 统一经此桶消费；这是"开发板 import 游戏契约、但不修改契约本身"的单一入口。
 * 契约扩展（floor→layers）已落地：本桶透传 canonical `MapLayer`/`LayerBackdrop`/
 * `LayerTransform`/`CanonicalMapData`/`CanonicalMapNode` 与规范化/序列化/opacity 辅助，
 * devboard 其余代码统一经此消费 canonical layer shape（`MapData.layers` / `node.layerId`）。
 */
export type {
  MapData,
  MapNode,
  MapEdge,
  MapPlacement,
  MapBackdrop,
  Vec2,
  ObstructionSpec,
  TransitionWindowPoints,
  SceneScale,
  Directionality,
  MapLayer,
  LayerBackdrop,
  LayerTransform,
  CanonicalMapData,
  CanonicalMapNode,
  LegacyMapData,
  LegacyMapNode,
  MapDataDocument,
} from '../../play/map/types';
export {
  COORD_MIN,
  COORD_MAX,
  CONNECTION_LIMIT,
  ADMITTED_CHILD_SCALES,
  EXPR_DISCRIMINANT_KEYS,
  deriveLayerId,
  normalizeMapDocument,
} from '../../play/map/types';
export {
  validateMapStructure,
  validateMapAgainstClasses,
  canPublish,
  SNAP_TOLERANCE,
} from '../../play/map/validate';
export type { MapDiagnostic, MapClassIndex, Severity } from '../../play/map/validate';
export {
  compileMap,
  adjacencyOf,
  connectedGroups,
} from '../../play/map/compile';
export type { CompileResult } from '../../play/map/compile';
export {
  distance,
  pathLength,
  perpendicularDistance,
  simplifyPath,
  resamplePath,
  insertControlPoint,
  findSnapTarget,
} from '../../play/map/curve';
export {
  serializeMap,
  serializeMapData,
  deserializeMap,
  parseMapData,
  importLegacyMap,
} from '../../play/map/serialize';
