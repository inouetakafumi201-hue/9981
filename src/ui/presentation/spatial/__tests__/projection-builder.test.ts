import { describe, expect, it } from 'vitest'
import { ProjectionBuilder } from '../stores/projection-builder'
import { SpatialEntityStore } from '../stores/spatial-entity-store'
import { ClusterStore } from '../stores/cluster-store'
import { BuildingScopeStore } from '../building-scope-store'
import type { MapData } from '../../../../play/map/types'

const fixtureMap = (): MapData => ({
  schemaVersion: '1.0',
  id: 'map:test',
  name: 'Test Map',
  backdrop: { image: 'asset:backdrop/test', pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: 'n1', def: 'd:scene/large', scale: 'large', at: { x: 0.1, y: 0.1 }, floor: 0 },
    { id: 'n2', def: 'd:scene/small', scale: 'small', at: { x: 0.9, y: 0.1 }, floor: 0 },
  ],
  edges: [
    { id: 'e1', def: 'd:link/path', a: 'n1', b: 'n2', directionality: 'bidirectional', path: [] },
  ],
  placements: [],
})

describe('ProjectionBuilder (P3)', () => {
  it('builds a deep-frozen SpatialProjection from MapData + stores', () => {
    const entities = new SpatialEntityStore()
    entities.update({ entityId: 'e1', nodeId: 'n1' }, 1)
    const clusters = new ClusterStore()
    const buildingScope = new BuildingScopeStore()
    const builder = new ProjectionBuilder({
      mapData: fixtureMap(),
      entities,
      clusters,
      buildingScope,
      revision: 5,
    })
    const proj = builder.build()
    expect(proj.revision).toBe(5)
    expect(proj.nodes).toHaveLength(2)
    expect(proj.edges).toHaveLength(1)
    expect(proj.entities).toHaveLength(1)
    expect(Object.isFrozen(proj)).toBe(true)
  })

  it('EntityView.locationNodeId is the latest entity → nodeId', () => {
    const entities = new SpatialEntityStore()
    entities.update({ entityId: 'e1', nodeId: 'n1' }, 1)
    entities.update({ entityId: 'e1', nodeId: 'n2' }, 2)
    const buildingScope = new BuildingScopeStore()
    const builder = new ProjectionBuilder({
      mapData: fixtureMap(),
      entities,
      clusters: new ClusterStore(),
      buildingScope,
      revision: 2,
    })
    const proj = builder.build()
    expect(proj.entities[0]?.locationNodeId).toBe('n2')
  })

  it('reads active clusters into ClusterView', () => {
    const entities = new SpatialEntityStore()
    const clusters = new ClusterStore({ fadeMs: 1000 })
    clusters.apply({
      type: 'created', microSceneId: 'm1', center: { x: 0.5, y: 0.5 }, entityIds: ['e1', 'e2'], revision: 1,
    })
    const buildingScope = new BuildingScopeStore()
    const builder = new ProjectionBuilder({
      mapData: fixtureMap(),
      entities,
      clusters,
      buildingScope,
      revision: 1,
    })
    const proj = builder.build()
    expect(proj.clusters).toHaveLength(1)
    expect(proj.clusters[0]?.entityIds).toEqual(['e1', 'e2'])
  })

  it('does not include destroyed clusters (they are no longer active)', () => {
    const entities = new SpatialEntityStore()
    const clusters = new ClusterStore({ fadeMs: 1000 })
    clusters.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 1 })
    clusters.apply({ type: 'destroyed', microSceneId: 'm1', revision: 2 })
    const buildingScope = new BuildingScopeStore()
    const builder = new ProjectionBuilder({
      mapData: fixtureMap(),
      entities,
      clusters,
      buildingScope,
      revision: 2,
    })
    const proj = builder.build()
    expect(proj.clusters).toHaveLength(0)
  })
})
