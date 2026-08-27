/**
 * orca-bridge.ts —— 表现层接线专项 E 阶段交付。
 *
 * 职责：把 after:entity.place 事件中的 prev/next 节点坐标转换为 OrcaAgent 数组，
 * 调用 `orcaStep`（P11 已落地）计算下一步位置。**不写 SpatialEntityStore**——新
 * 位置通过 `after:entity.place` 事件回流给 PresentationRuntime（其 `feed()` 内部
 * EventBridge 推进 SpatialEntityStore）。
 *
 * 不责任：
 * - 不修改 `PresentationRuntime` 内部实现
 * - 不引 rvo2-js 外部库；走 P11 纯 TS `orcaStep`
 *
 * 写锁：本文件在 `src/devboard/wiring/presentation-wiring/**` 内。
 */

import { orcaStep, type OrcaAgent } from '../../../ui/presentation/spatial/algorithms/orca-engine'
import type { MapData } from '../../../play/map/types'
import type { GameplayEvent } from '../../../ui/presentation/spatial/choreography/event-bridge'

export interface OrcaBridgeDeps {
  readonly mapData: MapData
  readonly playerEntityId?: string
  readonly maxSpeed?: number
  readonly agentRadius?: number
}

export interface OrcaBridge {
  /** 处理 after:entity.place 事件：若包含 ORCA 所需的 prev/next，则推进 agent 位置 */
  feed(event: GameplayEvent): OrcaBridgeResult | null
  /** 直接从 prev/next 节点 id 推进（被 feed 内部调用；公开给测试用） */
  stepToEntity(entityId: string, prevNodeId: string, nextNodeId: string): OrcaBridgeResult | null
}

export interface OrcaBridgeResult {
  readonly entityId: string
  readonly prevNodeId: string
  readonly nextNodeId: string
  readonly prevPosition: { x: number; y: number }
  readonly nextPosition: { x: number; y: number }
  readonly orcaSteps: readonly { agentId: string; newPosition: { x: number; y: number } }[]
  readonly fellBackToLinear: boolean
}

export function createOrcaBridge(deps: OrcaBridgeDeps): OrcaBridge {
  const maxSpeed = deps.maxSpeed ?? 0.05
  const agentRadius = deps.agentRadius ?? 0.02

  function findNode(nodeId: string): MapData['nodes'][number] | undefined {
    return deps.mapData.nodes.find((n) => n.id === nodeId)
  }

  function stepToEntity(entityId: string, prevNodeId: string, nextNodeId: string): OrcaBridgeResult | null {
    const prevNode = findNode(prevNodeId)
    const nextNode = findNode(nextNodeId)
    if (!prevNode || !nextNode) return null

    const prevPosition = prevNode.at
    const nextPosition = nextNode.at

    const preferredVelocity = {
      x: nextPosition.x - prevPosition.x,
      y: nextPosition.y - prevPosition.y,
    }

    const agent: OrcaAgent = {
      id: entityId,
      position: prevPosition,
      radius: agentRadius,
      preferredVelocity,
      maxSpeed,
    }

    const steps = orcaStep([agent], { timeHorizon: 1.0, maxSpeed, fallbackToLinear: true })
    const firstStep = steps[0]
    const fellBackToLinear = !firstStep
      || (firstStep.newPosition.x === prevPosition.x && firstStep.newPosition.y === prevPosition.y)
    const newPosition = firstStep ? firstStep.newPosition : nextPosition

    return {
      entityId,
      prevNodeId,
      nextNodeId,
      prevPosition,
      nextPosition: newPosition,
      orcaSteps: steps.map((s) => ({ agentId: s.agent.id, newPosition: s.newPosition })),
      fellBackToLinear,
    }
  }

  return {
    feed(event: GameplayEvent): OrcaBridgeResult | null {
      if (event.type !== 'after:entity.place') return null
      const { entityId, previousNodeId, nodeId } = event.payload
      if (!previousNodeId || !nodeId || previousNodeId === nodeId) return null
      return stepToEntity(entityId, previousNodeId, nodeId)
    },
    stepToEntity,
  }
}
