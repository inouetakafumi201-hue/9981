/**
 * ProjectionBuilder — P3: MapData + SpatialEntityStore → SpatialProjection。
 *
 * 责任：
 * - 把 MapData 节点/边转成 NodeView/EdgeView
 * - 把 SpatialEntityStore 的 entity→nodeId 映射转成 EntityView
 * - 把 ClusterStore 的 active clusters 转成 ClusterView
 * - 整个 snapshot 深冻结
 *
 * 不责任：
 * - 不订阅事件（由 EventBridge 驱动）
 * - 不修改任何 store（只读）
 * - 不发 RenderCommand
 */

import type { MapData } from '../../../../play/map/types'
import type { SpatialProjection, NodeView, EdgeView, EntityView, ClusterView } from '../spatial-view'
import type { SpatialEntityStore } from '../stores/spatial-entity-store'
import type { ClusterStore } from '../stores/cluster-store'
import type { BuildingScopeStore } from '../building-scope-store'
import { deepFreeze } from '../stores/projection-store'

export interface ProjectionBuilderDeps {
  readonly mapData: MapData
  readonly entities: SpatialEntityStore
  readonly clusters: ClusterStore
  readonly revision: number
}

export class ProjectionBuilder {
  private readonly deps: ProjectionBuilderDeps

  constructor(deps: ProjectionBuilderDeps) {
    this.deps = deps
  }

  build(): SpatialProjection {
    const { mapData, entities, clusters, revision } = this.deps
    const entitySnap = entities.current()
    const nodeById = new Map(mapData.nodes.map((n) => [n.id, n]))
    const nodeViews: NodeView[] = mapData.nodes.map((node) => ({
      id: node.id,
      def: node.def ?? `d:scene/${node.scale}`,
      at: { x: node.at.x, y: node.at.y },
      scale: node.scale,
      name: node.name,
      floor: node.floor ?? 0,
    }))

    const edgeViews: EdgeView[] = mapData.edges.map((edge) => ({
      id: edge.id,
      def: edge.def ?? 'd:link/path',
      a: edge.a,
      b: edge.b,
      directionality: edge.directionality,
      path: edge.path ?? [],
      semanticAnchor: edge.semanticAnchor ?? 'neutral',
    }))

    const entityViews: EntityView[] = entitySnap.records.map((record) => {
      const mapNode = nodeById.get(record.nodeId)
      return {
        entityId: record.entityId,
        viewToken: `view:${record.entityId}`,
        definitionId: mapNode?.def,
        locationNodeId: record.nodeId,
        posture: undefined,
        statusIds: [],
        resources: [],
        salientStates: [],
        remembered: false,
      }
    })

    const clusterViews: ClusterView[] = clusters.active().map((cluster) => ({
      id: cluster.clusterId,
      center: cluster.center,
      entityIds: cluster.entityIds,
      glowRadius: 0, // 由 GroundGlowStore 派生；这里不重算
    }))

    return deepFreeze({
      revision,
      layers: [],
      nodes: nodeViews,
      edges: edgeViews,
      entities: entityViews,
      clusters: clusterViews,
      tiles: [],
    })
  }
}
