/**
 * MovementRoute — D-090 移动阶段与路线分解。
 *
 * 移动划分为两类阶段：
 * 1. orca-interior: 场景内 ORCA 寻路移动（计入 5 秒纯位移预算）。
 * 2. connector-curve: 场景间 MapEdge 贝塞尔曲线过渡（不计入 5 秒预算，且中途不可截停）。
 */

import type { Vec2, MapNode, MapEdge } from '../../../../play/map/types'

export type MovementPhaseKind = 'orca-interior' | 'connector-curve'

export interface MovementPhase {
  readonly kind: MovementPhaseKind
  readonly points: readonly Vec2[]
  readonly durationMs: number
  readonly naturalSceneId?: string
  readonly edgeId?: string
}

export interface MovementRoute {
  readonly phases: readonly MovementPhase[]
  readonly totalDistance: number
}

function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function calculatePathLength(points: readonly Vec2[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += distance(points[i]!, points[i + 1]!)
  }
  return total
}

export function createMovementRoute(phases: readonly MovementPhase[]): MovementRoute {
  let totalDistance = 0
  for (const phase of phases) {
    totalDistance += calculatePathLength(phase.points)
  }
  return {
    phases: Object.freeze([...phases]),
    totalDistance,
  }
}

export interface RouteDecompositionSegment {
  readonly fromNode: MapNode
  readonly toNode: MapNode
  readonly edge?: MapEdge
  readonly startPoint?: Vec2
  readonly endPoint?: Vec2
}

/**
 * 将多场景寻路或单场景寻路分解为结构化的 MovementPhase 列表。
 */
export function decomposeMovementRoute(segments: readonly RouteDecompositionSegment[]): MovementRoute {
  const phases: MovementPhase[] = []

  for (const seg of segments) {
    const isSameScene = seg.fromNode.id === seg.toNode.id

    if (isSameScene) {
      const pStart = seg.startPoint ?? seg.fromNode.at
      const pEnd = seg.endPoint ?? seg.toNode.at
      const points = [pStart, pEnd]
      const dist = calculatePathLength(points)
      phases.push({
        kind: 'orca-interior',
        points: Object.freeze(points),
        durationMs: Math.max(100, Math.round(dist * 2000)),
        naturalSceneId: seg.fromNode.id,
      })
    } else {
      // 跨场景移动：
      // 1. 起点场景内部移动到边起点
      const pStart = seg.startPoint ?? seg.fromNode.at
      const edgeStart = seg.edge?.path && seg.edge.path.length > 0 ? seg.edge.path[0]! : seg.fromNode.at
      const interior1Points = [pStart, edgeStart]
      phases.push({
        kind: 'orca-interior',
        points: Object.freeze(interior1Points),
        durationMs: Math.max(50, Math.round(calculatePathLength(interior1Points) * 2000)),
        naturalSceneId: seg.fromNode.id,
      })

      // 2. 场景间贝塞尔连接曲线
      const curvePoints = seg.edge?.path && seg.edge.path.length > 0
        ? [...seg.edge.path]
        : [seg.fromNode.at, seg.toNode.at]
      phases.push({
        kind: 'connector-curve',
        points: Object.freeze(curvePoints),
        durationMs: Math.max(300, Math.round(calculatePathLength(curvePoints) * 3000)),
        edgeId: seg.edge?.id,
      })

      // 3. 终点场景内部移动到目标点
      const edgeEnd = seg.edge?.path && seg.edge.path.length > 0 ? seg.edge.path[seg.edge.path.length - 1]! : seg.toNode.at
      const pTarget = seg.endPoint ?? seg.toNode.at
      const interior2Points = [edgeEnd, pTarget]
      phases.push({
        kind: 'orca-interior',
        points: Object.freeze(interior2Points),
        durationMs: Math.max(50, Math.round(calculatePathLength(interior2Points) * 2000)),
        naturalSceneId: seg.toNode.id,
      })
    }
  }

  return createMovementRoute(phases)
}
