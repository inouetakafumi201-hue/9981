/**
 * 空间投影端口（R013、design.md §3.1）。
 *
 * 绑定关系：`fetchProjection` → `createSpatialProjection(mapData, runtimeState, scope)`；
 * 投影结果必须深冻结，UI 侧会在 projection-cache 再做一次 `Object.isFrozen` 断言。
 *
 * 本端口实现负责：
 * 1. 把 `MapData` 读进空间视图（LayerView / NodeView / EdgeView / EntityView）。
 * 2. 合并语义投影（ReadOnlySemanticProjection → EntityView、SpatialSalienceView、SpatialResourceView）。
 * 3. 生成 ClusterView 与 TileView（由 TraversableComputer 投影产出）。
 *
 * 边界断言：返回结构必须深冻结，UI projection-cache 视作契约最后一道防线。
 */

import type {
  SpatialProjection,
  NodeView,
  EdgeView,
  LayerView,
  EntityView,
  ClusterView,
  TileView,
} from './spatial-view';
import type { MapData } from '../../../play/map/types';
import type { ReadOnlySemanticProjection, ResourceDescriptor } from '../../../l2/model/projection';
import type { UiResult } from '../../model/diagnostic';
import type { SpatialSalienceView } from './salience-extension';

/**
 * 将 MapData 节点转为 NodeView
 */
export function nodeFromMapNode(node: MapData['nodes'][0], _mapData: MapData): NodeView {
  return {
    id: node.id,
    def: node.def ?? `d:scene/${node.scale}`,
    at: { x: node.at.x, y: node.at.y },
    scale: node.scale,
    name: node.name,
    floor: node.floor ?? 0,
    layerId: undefined,
  };
}

/**
 * 将 MapData 边转为 EdgeView
 */
export function edgeFromMapEdge(edge: MapData['edges'][0], _mapData: MapData): EdgeView {
  return {
    id: edge.id,
    def: edge.def ?? 'd:link/path',
    a: edge.a,
    b: edge.b,
    directionality: edge.directionality,
    path: edge.path ?? [],
    semanticAnchor: edge.semanticAnchor ?? 'neutral',
  };
}

/**
 * 将 MapData 图层转为 LayerView（注意：MapData 目前不直接包含 layers 列表，
 * 这里从 floors 推导出图层列表）
 */
export function layerFromFloor(floorIndex: number, floor: number): LayerView {
  return {
    id: `floor:${floor}`,
    name: `楼层 ${floor}`,
    height: floor,
    opacity: 1,
  };
}

/**
 * 从 MapData 生成图层列表
 */
export function layersFromMapData(mapData: MapData): LayerView[] {
  return mapData.floors.map((floor, index) => layerFromFloor(index, floor));
}

/**
 * 从语义投影创建实体视图
 *
 * 注意：SemanticStateEntry 不包含 resources/salientStates，
 * 这些字段在 UiView 级别。这里传递占位，实际由 runtime projection 提供。
 */
export function entitiesFromSemanticProjection(
  projection: ReadOnlySemanticProjection,
  mapData: MapData
): EntityView[] {
  const entityViews: EntityView[] = [];

  for (const entity of projection.entities) {
    const mapNode = mapData.nodes.find((n) => n.id === entity.entityId);
    const resources: ResourceDescriptor[] = [];

    entityViews.push({
      entityId: entity.entityId,
      viewToken: `view:${entity.entityId}`,
      definitionId: mapNode?.def,
      locationNodeId: undefined,
      posture: entity.posture,
      statusIds: entity.statusIds ?? [],
      resources,
      salientStates: [] as readonly SpatialSalienceView[],
      remembered: false,
    });
  }

  return entityViews;
}

/**
 * 创建空间投影（MapData + 语义投影 → SpatialProjection）
 *
 * 注意：MapData 目前没有 layers 列表，我们使用 floors 作为图层来源。
 * 未来 canonical MapData 会包含 layers。
 */
export function createSpatialProjection(
  mapData: MapData,
  projection: ReadOnlySemanticProjection
): SpatialProjection {
  const layers: LayerView[] = layersFromMapData(mapData);
  const nodes: NodeView[] = mapData.nodes.map((n) => nodeFromMapNode(n, mapData));
  const edges: EdgeView[] = mapData.edges.map((e) => edgeFromMapEdge(e, mapData));
  const entities: EntityView[] = entitiesFromSemanticProjection(projection, mapData);

  return Object.freeze({
    revision: projection.semanticStateFingerprint.length,
    layers: Object.freeze([...layers]),
    nodes: Object.freeze([...nodes]),
    edges: Object.freeze([...edges]),
    entities: Object.freeze([...entities]),
    clusters: [] as readonly ClusterView[],
    tiles: [] as readonly TileView[],
  });
}
