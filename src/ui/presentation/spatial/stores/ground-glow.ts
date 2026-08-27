import type { Vec2 } from '../../../../play/map/types'
import type { ClusterRecord } from './cluster-store'

export type GroundGlowVisibility = 'weak' | 'highlighted' | 'selected' | 'fading'

export interface GroundGlowFootprint {
  readonly footprintId: string
  readonly center: Vec2
  readonly radiusX: number
  readonly radiusY: number
  readonly rotation: 0
  readonly occupantIds: readonly string[]
  readonly visibility: GroundGlowVisibility
  readonly interactive: boolean
  readonly revision: number
}

export interface FootprintSnapshot {
  readonly revision: number
  readonly footprints: readonly GroundGlowFootprint[]
}

export interface FootprintSelectionState {
  readonly highlightedFootprintIds: readonly string[]
  readonly selectedFootprintId: string | undefined
}

/** FootprintSelectionState using a Set is valid internally; this helper builds the public readonly form. */
export function selectionState(highlighted: Set<string>, selected?: string): FootprintSelectionState {
  return {
    highlightedFootprintIds: [...highlighted],
    selectedFootprintId: selected,
  }
}

const BASE_RADIUS_X = 32
const BASE_RADIUS_Y = 16
const PER_ENTITY_X = 8
const PER_ENTITY_Y = 4

export function orcaRadiusFromFootprint(fp: GroundGlowFootprint): number {
  return Math.max(fp.radiusX, fp.radiusY) * 0.5
}

export function hitTestFootprint(point: Vec2, fp: GroundGlowFootprint): boolean {
  if (fp.radiusX <= 0 || fp.radiusY <= 0) return false
  const dx = (point.x - fp.center.x) / fp.radiusX
  const dy = (point.y - fp.center.y) / fp.radiusY
  return dx * dx + dy * dy <= 1
}

export function clusterToFootprint(
  cluster: ClusterRecord,
  selection: FootprintSelectionState,
  fallbackRevision: number,
): GroundGlowFootprint {
  const count = cluster.entityIds.length
  const radiusX = BASE_RADIUS_X + count * PER_ENTITY_X
  const radiusY = BASE_RADIUS_Y + count * PER_ENTITY_Y
  const visibility: GroundGlowVisibility = cluster.visibility === 'fading'
    ? 'fading'
    : selection.selectedFootprintId === cluster.clusterId
      ? 'selected'
      : selection.highlightedFootprintIds.includes(cluster.clusterId)
        ? 'highlighted'
        : 'weak'
  return {
    footprintId: cluster.clusterId,
    center: cluster.center,
    radiusX,
    radiusY,
    rotation: 0,
    occupantIds: cluster.entityIds,
    visibility,
    interactive: cluster.visibility === 'active',
    revision: cluster.revision ?? fallbackRevision,
  }
}
