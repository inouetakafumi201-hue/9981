/**
 * 开发板只读消费 `src/play/map` 的契约桶（barrel）。
 *
 * 开发板不直接 import `src/play/map/{types,validate,compile,curve}.ts` 的报文小路径，
 * 统一经此桶消费；这是"开发板 import 游戏契约、但不修改契约本身"的单一入口。
 * 当 `MapData` 将来按权威文稿扩出 `layers`（`docs/创作系统/01_创作工具与产权.md` §九 L.10），
 * 此桶把 `MapLayer`/`LayerBackdrop`/`LayerTransform` 的透传接上即可，
 * devboard 其余代码不因契约扩展而改。当前 `layers` 未落契约，devboard 层面类型见
 * `../layers/layer-shapes.ts`。
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
} from '../../play/map/types.js';
export {
  COORD_MIN,
  COORD_MAX,
  CONNECTION_LIMIT,
  ADMITTED_CHILD_SCALES,
  EXPR_DISCRIMINANT_KEYS,
} from '../../play/map/types.js';
export {
  validateMapStructure,
  validateMapAgainstClasses,
  canPublish,
  SNAP_TOLERANCE,
} from '../../play/map/validate.js';
export type { MapDiagnostic, MapClassIndex, Severity } from '../../play/map/validate.js';
export { compileMap, adjacencyOf, connectedGroups } from '../../play/map/compile.js';
export type { CompileResult } from '../../play/map/compile.js';
export {
  distance,
  pathLength,
  perpendicularDistance,
  simplifyPath,
  resamplePath,
  insertControlPoint,
  findSnapTarget,
} from '../../play/map/curve.js';
