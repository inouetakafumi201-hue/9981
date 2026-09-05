/**
 * MovementRoute 单元测试 (D-090)。
 *
 * 验证：
 * 1. 同场景内移动生成单个 orca-interior 阶段。
 * 2. 跨场景寻路自动分解为 orca-interior 与 connector-curve 阶段组合。
 * 3. 路径长度与持续时间计算正确。
 */

import { describe, expect, it } from 'vitest'
import {
  decomposeMovementRoute,
  createMovementRoute,
  calculatePathLength,
  type MovementPhase,
} from '../choreography/movement-route'
import type { MapNode, MapEdge } from '../../../../play/map/types'

describe('MovementRoute (D-090)', () => {
  const nodeA: MapNode = {
    id: 'node_a',
    def: 'd:scene/large',
    scale: 'large',
    at: { x: 0.1, y: 0.1 },
    floor: 0,
    name: 'A 场景',
  }

  const nodeB: MapNode = {
    id: 'node_b',
    def: 'd:scene/medium',
    scale: 'medium',
    at: { x: 0.8, y: 0.8 },
    floor: 0,
    name: 'B 场景',
  }

  const edgeAB: MapEdge = {
    id: 'edge_ab',
    def: 'd:link/path',
    a: 'node_a',
    b: 'node_b',
    directionality: 'bidirectional',
    path: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.3 },
      { x: 0.8, y: 0.8 },
    ],
  }

  it('calculatePathLength 准确计算多段折线总长度', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]
    expect(calculatePathLength(points)).toBeCloseTo(7, 5)
  })

  it('单场景内移动分解为单个 orca-interior 阶段', () => {
    const route = decomposeMovementRoute([
      {
        fromNode: nodeA,
        toNode: nodeA,
        startPoint: { x: 0.1, y: 0.1 },
        endPoint: { x: 0.2, y: 0.2 },
      },
    ])

    expect(route.phases.length).toBe(1)
    expect(route.phases[0]!.kind).toBe('orca-interior')
    expect(route.phases[0]!.naturalSceneId).toBe('node_a')
    expect(route.phases[0]!.points.length).toBe(2)
  })

  it('跨场景移动分解为 起点 orca-interior -> 曲线 connector-curve -> 终点 orca-interior 阶段', () => {
    const route = decomposeMovementRoute([
      {
        fromNode: nodeA,
        toNode: nodeB,
        edge: edgeAB,
        startPoint: { x: 0.05, y: 0.05 },
        endPoint: { x: 0.85, y: 0.85 },
      },
    ])

    expect(route.phases.length).toBe(3)

    // 阶段 1：node_a 内部到边起点
    expect(route.phases[0]!.kind).toBe('orca-interior')
    expect(route.phases[0]!.naturalSceneId).toBe('node_a')

    // 阶段 2：场景间贝塞尔过渡
    expect(route.phases[1]!.kind).toBe('connector-curve')
    expect(route.phases[1]!.edgeId).toBe('edge_ab')
    expect(route.phases[1]!.points.length).toBe(3)

    // 阶段 3：node_b 内部从边终点到目标
    expect(route.phases[2]!.kind).toBe('orca-interior')
    expect(route.phases[2]!.naturalSceneId).toBe('node_b')
  })

  it('createMovementRoute 封装冻结 phases 并统计总距离', () => {
    const phases: MovementPhase[] = [
      {
        kind: 'orca-interior',
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        durationMs: 1000,
        naturalSceneId: 'node_a',
      },
    ]
    const route = createMovementRoute(phases)
    expect(route.phases).toHaveLength(1)
    expect(route.totalDistance).toBe(1)
  })
})
