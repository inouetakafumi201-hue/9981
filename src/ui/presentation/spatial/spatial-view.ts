/**
 * 空间投影面（R013）。
 *
 * 表现层向下消费 `MapData` 与 `ReadOnlySemanticProjection`，向上暴露只读的空间视图：
 * `LayerView` / `NodeView` / `EdgeView` / `EntityView` / `ClusterView` / `TileView`。
 *
 * 边界纪律：
 * - 本文件只声明只读形状，不声明任何写入能力。
 * - 坐标来自 `MapData`（0..1 归一化），表现层只做映射，不重算几何。
 * - 所有视图必须深冻结，由 `projection-port.ts` 的边界断言保证。
 */

import type { Vec2 } from '../../../play/map/types';
import type { ResourceDescriptor } from '../../../l2/model/projection';
import type { SpatialSalienceView } from './salience-extension';

/** 图层视图：只暴露渲染需要的图层元数据。 */
export interface LayerView {
  readonly id: string;
  readonly name: string;
  readonly height: number;
  readonly opacity: number;
}

/** 场景节点视图：地图拓扑节点 → 渲染坐标。 */
export interface NodeView {
  readonly id: string;
  readonly def: string;
  readonly at: Vec2;
  readonly scale: 'small' | 'medium' | 'large';
  readonly name: string | undefined;
  readonly floor: number;
  readonly layerId: string | undefined;
}

/** 边/连接视图：地图拓扑边 → 渲染路径。 */
export interface EdgeView {
  readonly id: string;
  readonly def: string;
  readonly a: string;
  readonly b: string;
  readonly directionality: 'bidirectional' | 'unidirectional' | 'one-way-down' | 'one-way-up';
  readonly path: readonly Vec2[];
  readonly semanticAnchor: 'high' | 'low' | 'neutral';
}

/** 实体视图：语义投影实体 → 渲染状态。 */
export interface EntityView {
  readonly entityId: string;
  readonly viewToken: string;
  readonly definitionId: string | undefined;
  readonly locationNodeId: string | undefined;
  readonly posture: string | undefined;
  readonly statusIds: readonly string[];
  readonly resources: readonly ResourceDescriptor[];
  readonly salientStates: readonly SpatialSalienceView[];
  readonly remembered: boolean;
}

/** 对峙群视图：渲染泛光圈。 */
export interface ClusterView {
  readonly id: string;
  readonly center: Vec2;
  readonly entityIds: readonly string[];
  readonly glowRadius: number;
}

/** 瓦片视图：地图静态几何 → 可通行域栅格。 */
export interface TileView {
  readonly row: number;
  readonly col: number;
  readonly traversable: boolean;
}

/** 完整空间投影快照。 */
export interface SpatialProjection {
  readonly revision: number;
  readonly layers: readonly LayerView[];
  readonly nodes: readonly NodeView[];
  readonly edges: readonly EdgeView[];
  readonly entities: readonly EntityView[];
  readonly clusters: readonly ClusterView[];
  readonly tiles: readonly TileView[];
  /** 建筑视野渲染模式：exterior / hover / transition / occupied */
  readonly buildingRenderMode: import('./building-scope-state').BuildingRenderMode;
}
