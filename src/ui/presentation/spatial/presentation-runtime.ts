/**
 * PresentationRuntime — P4/P5/P6/D-090: 表现层全量装配 + 端到端事件流。
 *
 * 组装顺序：
 *   SpatialEntityStore ← EventBridge ← kernel after:entity.place
 *   ClusterStore      ← EventBridge
 *   SpatialProjectionStore ← ProjectionBuilder(mapData + entities + clusters)
 *   RenderCommandExecutor ← MoveChoreographer.drainPending()（按需 resolve）
 *   MovementSessionController ← D-090 移动状态机与 5 秒预算权威结算
 *
 * 职责：
 * - EventBridge 收到 after:entity.place → 推进 SpatialEntityStore + acknowledgeCommittedPlacement
 * - MoveChoreographer 根据 prev → next 位置差生成直线 RenderCommand 并 submit 到 executor
 * - MovementSessionController 管理 transient 移动 session、5 秒 ORCA 预算、延后截停与非抢断队列
 * - executor 接收命令、revision 守卫、等待 resolve()
 */

import { EventBridge, type GameplayEvent } from './choreography/event-bridge'
import { SpatialEntityStore } from './stores/spatial-entity-store'
import { ClusterStore } from './stores/cluster-store'
import { SpatialProjectionStore } from './stores/projection-store'
import { RenderCommandExecutor } from './commands/render-command-executor'
import { MoveChoreographer } from './choreography/move-choreographer'
import { ProjectionBuilder } from './stores/projection-builder'
import { DisposableStack } from './disposable'
import { BuildingScopeStore } from './building-scope-store'
import type { BuildingScopeAction, BuildingScopeState } from './building-scope-state'
import type { MapData } from '../../../../src/play/map/types'
import { DEFAULT_ACCESSIBILITY, isMoveDegraded, type AccessibilityConfig } from './accessibility-config'
import {
  MovementSessionController,
  type MovementRequest,
  type MovementSessionControllerDeps,
  type MicroSceneCandidate,
} from './choreography/movement-session'

export interface PresentationRuntimeDeps {
  readonly mapData: MapData
  readonly accessibility?: AccessibilityConfig
  readonly movementDeps?: MovementSessionControllerDeps
}

export interface PresentationRuntime {
  readonly entities: SpatialEntityStore
  readonly clusters: ClusterStore
  readonly projection: SpatialProjectionStore
  readonly choreographer: MoveChoreographer
  readonly executor: RenderCommandExecutor
  readonly buildingScope: BuildingScopeStore
  readonly movementSession: MovementSessionController
  readonly isDisposed: () => boolean
  readonly accessibility: AccessibilityConfig

  /** kernel 事件入口（接 wire-hooks 的 after:${opName}） */
  feed(event: GameplayEvent): void

  /** 触发一次投影快照重建（外层在合适时机调用） */
  rebuildProjection(): void

  /** Building-scope action 派发入口（UI hover/enter/exit） */
  dispatchBuildingScope(action: BuildingScopeAction): void

  /** Building-scope 当前状态（read-only） */
  buildingScopeState(): BuildingScopeState

  /** D-090 移动 Session 接口 */
  startMovement(request: MovementRequest): void
  advanceMovement(dtMs: number, hasDisplacement?: boolean): void
  pauseMovement(): void
  resumeMovement(): void
  noteMovementDisturbance(): void
  finishMovementRecovery(): void

  /** 销毁，释放全部订阅 */
  dispose(): void
}

let commandSeq = 0
function nextCommandId(): string {
  return `move-${++commandSeq}`
}

export function createPresentationRuntime(deps: PresentationRuntimeDeps): PresentationRuntime {
  const { mapData } = deps

  const entities = new SpatialEntityStore()
  const clusters = new ClusterStore()
  const buildingScope = new BuildingScopeStore()
  const bridge = new EventBridge({ entities, clusters })

  const projection = new SpatialProjectionStore()
  // P3 baseline：启动时 commit 一个 revision=0 的空投影，确保 executor 的 revision 守卫
  // 不会因为 current() === null 而把第一条命令判为 stale。
  projection.commit({
    revision: 0,
    layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [],
    buildingRenderMode: { kind: 'exterior' as const },
  })
  const executor = new RenderCommandExecutor(projection)
  const choreographer = new MoveChoreographer({ projection, mode: 'single' })

  // D-090: 移动会话控制器装配
  const defaultMicroSceneCandidates = (naturalSceneId: string): readonly MicroSceneCandidate[] => {
    // 从 mapData 中查找属于该 naturalScene 的子微型场景节点
    const nodes = mapData.nodes.filter((n) => n.parent === naturalSceneId || n.id === naturalSceneId)
    return nodes.map((n) => ({
      id: n.id,
      naturalSceneId: n.parent ?? n.id,
      at: { x: n.at.x, y: n.at.y },
    }))
  }

  const movementSession = new MovementSessionController({
    getMicroSceneCandidates: deps.movementDeps?.getMicroSceneCandidates ?? defaultMicroSceneCandidates,
    onSubmitPlacement: deps.movementDeps?.onSubmitPlacement,
    onSessionCompleted: deps.movementDeps?.onSessionCompleted,
    onSessionFailed: deps.movementDeps?.onSessionFailed,
  })

  // EventBridge → MoveChoreographer & MovementSession（after:entity.place 触发）
  bridge.subscribe((event) => {
    if (event.type !== 'after:entity.place') return

    // D-090: 确认权威已完成提交，避免二次重演动画
    movementSession.acknowledgeCommittedPlacement(event.revision)

    const prev = event.payload.previousNodeId
    const next = event.payload.nodeId ?? event.payload.microScene?.existingMicroSceneId
    if (!prev || !next || prev === next) return

    const prevNode = mapData.nodes.find((n) => n.id === prev)
    const nextNode = mapData.nodes.find((n) => n.id === next)
    if (!prevNode || !nextNode) return

    const path = Object.freeze([
      { x: prevNode.at.x, y: prevNode.at.y },
      { x: nextNode.at.x, y: nextNode.at.y },
    ])

    const result = choreographer.submit({
      entityId: event.payload.entityId,
      toRevision: event.revision,
      path,
    })
    if (!result.accepted) return

    // 命令的 sourceRevision 取当前 SpatialProjection 的 revision（commit 之前的乐观提交）
    // 这样在源更新时由 executor 的 revision 守卫拒为 stale。
    const sourceRevision = projection.current()?.revision ?? event.revision
    for (const req of choreographer.drainPending()) {
      const payload: Record<string, unknown> = {
        type: 'move',
        entityId: req.entityId,
        path: req.path,
      }
      // R11: reducedMotion 时标记 degraded，通知下游渲染层跳帧
      if (isMoveDegraded(accessibility)) payload.degraded = true
      executor.submit({
        commandId: nextCommandId(),
        semanticId: 'entity.move',
        sourceRevision,
        trigger: 'after-event',
        advancesJourney: false,
        payload: Object.freeze(payload),
      })
    }
  })

  // R9: 注册所有可释放资源，dispose() 时链式释放
  const disposables = new DisposableStack([entities, clusters, projection, executor, buildingScope])
  const isDisposed = (): boolean => disposables.isDisposed

  // R11: 渲染策略，向下传播
  const accessibility = { ...DEFAULT_ACCESSIBILITY, ...deps.accessibility }

  return {
    entities,
    clusters,
    projection,
    choreographer,
    executor,
    buildingScope,
    movementSession,
    isDisposed,
    accessibility,

    feed(event) {
      if (disposables.isDisposed) return
      bridge.consume(event)
    },

    rebuildProjection() {
      if (disposables.isDisposed) return
      const builder = new ProjectionBuilder({ mapData, entities, clusters, buildingScope, revision: bridge.revision })
      projection.commit(builder.build())
    },

    dispatchBuildingScope(action) {
      buildingScope.dispatch(action)
    },

    buildingScopeState() {
      return buildingScope.current().state
    },

    startMovement(request) {
      movementSession.startMovement(request)
    },

    advanceMovement(dtMs, hasDisplacement = true) {
      movementSession.advance(dtMs, hasDisplacement)
    },

    pauseMovement() {
      movementSession.pause()
    },

    resumeMovement() {
      movementSession.resume()
    },

    noteMovementDisturbance() {
      movementSession.noteDisturbance()
    },

    finishMovementRecovery() {
      movementSession.finishRecovery()
    },

    dispose() {
      disposables.dispose()
    },
  }
}
