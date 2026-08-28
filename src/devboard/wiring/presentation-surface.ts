import type { UiResult } from '../../ui/model/diagnostic'
import type { RenderCommandApi } from '../../ui/presentation/spatial/render-command-api'
import type { SpatialProjection } from '../../ui/presentation/spatial/spatial-view'

export interface PresentationSurface {
  projection(): UiResult<Readonly<SpatialProjection>>
  readonly commands: RenderCommandApi
}

function freezeProjection(projection: SpatialProjection): Readonly<SpatialProjection> {
  return Object.freeze({
    ...projection,
    layers: Object.freeze([...projection.layers]),
    nodes: Object.freeze([...projection.nodes]),
    edges: Object.freeze([...projection.edges]),
    entities: Object.freeze([...projection.entities]),
    clusters: Object.freeze([...projection.clusters]),
    tiles: Object.freeze([...projection.tiles]),
    buildingGroups: projection.buildingGroups
      ? Object.freeze(projection.buildingGroups.map((group) => Object.freeze({
          ...group,
          frame: Object.freeze({ ...group.frame }),
          floors: Object.freeze(group.floors.map((floor) => Object.freeze({ ...floor, nodeIds: Object.freeze([...floor.nodeIds]) }))),
        })))
      : undefined,
  })
}

/**
 * Composition boundary for the renderer. It exposes a frozen read projection
 * and the existing command port; it never owns spatial or gameplay state.
 */
export function createPresentationSurface(
  readProjection: () => UiResult<SpatialProjection>,
  commands: RenderCommandApi,
): PresentationSurface {
  return Object.freeze({
    projection: () => {
      const result = readProjection()
      return result.ok ? { ...result, value: freezeProjection(result.value) } : result
    },
    commands,
  })
}
