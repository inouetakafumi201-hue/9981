import type { SpatialEntityStore } from '../stores/spatial-entity-store'
import type { ClusterStore, MicroSceneEvent } from '../stores/cluster-store'

/**
 * GameplayEvent — P2: 表现层订阅的真实事件流。
 *
 * 源：kernel/wire-hooks.ts 的 after:${opName}。
 * 桥：EventBridge 消费 kernel 事件，驱动表现层 stores；不修改 kernel。
 *
 * R1, R2, R6, R9 覆盖。
 */

export type GameplayEventType =
  | 'after:entity.place'
  | 'after:entity.move'
  | 'after:rule-settled'

/**
 * 最小化 EventPlace payload（与 structural-ops.ts EntityPlaceArgs 形状一致）。
 * 与表现层解耦：这里只取 presentation 需要的两个字段。
 */
export interface EntityPlacePayload {
  readonly entityId: string
  /** 直接拓扑目标：场景框节点。 */
  readonly nodeId?: string
  /** 微型场景目标：进入现有 microScene 或创建新 microScene。 */
  readonly microScene?: {
    readonly hostNodeId: string
    readonly existingMicroSceneId?: string
    readonly microSceneDefId: string
  }
  /** 上一个 nodeId，event-bridge 据此检测离开旧 microScene。 */
  readonly previousNodeId?: string
}

export interface EntityMovePayload {
  readonly entityId: string
  readonly toNodeId: string
}

export interface RuleSettledPayload {
  readonly reason: string
}

export type GameplayEvent =
  | { readonly type: 'after:entity.place'; readonly payload: EntityPlacePayload; readonly revision: number }
  | { readonly type: 'after:entity.move'; readonly payload: EntityMovePayload; readonly revision: number }
  | { readonly type: 'after:rule-settled'; readonly payload: RuleSettledPayload; readonly revision: number }

/**
 * EventBridge — 表现层唯一的事件接入点。
 *
 * 责任：
 * 1. 把 after:entity.place 翻译成 SpatialEntityStore.update + ClusterStore.apply。
 * 2. 把 after:entity.move 翻译成 SpatialEntityStore.update。
 * 3. 把 after:rule-settled 透传给上层订阅者。
 *
 * 不责任：
 * - 不直接生成 RenderCommand（那交给 MoveChoreographer）。
 * - 不计算 ORCA（那交给 OrcaEngine）。
 * - 不处理 presentation:* 事件（kernel 根本没发射；那是 spec 文档里的设计占位）。
 */
export interface EventBridgeDeps {
  readonly entities: SpatialEntityStore
  readonly clusters: ClusterStore
}

export class EventBridge {
  private readonly deps: EventBridgeDeps
  private currentRevision = 0
  private listeners = new Set<(event: GameplayEvent) => void>()

  constructor(deps: EventBridgeDeps) {
    this.deps = deps
  }

  /** kernel 事件入口（P2: 真正驱动 stores） */
  consume(event: GameplayEvent): void {
    if (event.revision < this.currentRevision) return
    this.currentRevision = event.revision

    if (event.type === 'after:entity.place') {
      this.handlePlace(event.payload, event.revision)
    } else if (event.type === 'after:entity.move') {
      this.deps.entities.update(
        { entityId: event.payload.entityId, nodeId: event.payload.toNodeId },
        event.revision,
      )
    } else if (event.type === 'after:rule-settled') {
      // 透传给上游（MoveChoreographer / 投影消费者）。
    }

    for (const listener of this.listeners) listener(event)
  }

  /**
   * P2 关键：after:entity.place 必须同时处理：
   * 1. entity 进入新拓扑（nodeId / microScene）
   * 2. entity 离开旧 microScene（previousNodeId 是 microScene）
   * 3. 旧 microScene 若归零则发 destroyed
   * 4. 新 microScene 若有 entityIds 列表则发 occupants-changed / created
   */
  private handlePlace(payload: EntityPlacePayload, revision: number): void {
    // 1. 更新 entity → nodeId 映射
    const targetNodeId = payload.nodeId ?? payload.microScene?.existingMicroSceneId ?? payload.microScene?.hostNodeId
    if (targetNodeId) {
      this.deps.entities.update({ entityId: payload.entityId, nodeId: targetNodeId }, revision)
    }

    // 2. 离开旧 microScene
    if (payload.previousNodeId) {
      // 表现层不持有完整 microScene occupant 表（那是运行期的职责）；
      // 这里只推送 occupants-changed，cluster-store 不会重建因为它没有该 entity 的旧状态。
      // 实际"最后一个实体离开 → 注销"由运行期在 entity.place 之后派发 destroyed；
      // 表现层只是被动接收。
      this.deps.clusters.apply({
        type: 'occupants-changed',
        microSceneId: payload.previousNodeId,
        entityIds: [], // 表现层无法知道具体减员；运行期发 destroyed
        revision,
      })
    }

    // 3. 进入新 microScene
    if (payload.microScene) {
      const msId = payload.microScene.existingMicroSceneId ?? `${payload.microScene.hostNodeId}::${payload.microScene.microSceneDefId}`
      this.deps.clusters.apply({
        type: 'occupants-changed',
        microSceneId: msId,
        entityIds: [payload.entityId], // 表现层只记新增；实际 occupants 是运行期的 facts
        revision,
      })
    }
  }

  subscribe(handler: (event: GameplayEvent) => void): () => void {
    this.listeners.add(handler)
    return () => { this.listeners.delete(handler) }
  }

  get revision(): number {
    return this.currentRevision
  }

  clear(): void {
    this.listeners.clear()
  }
}
