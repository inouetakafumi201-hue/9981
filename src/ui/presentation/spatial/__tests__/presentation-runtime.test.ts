/**
 * P6 端到端集成测试：after:entity.place → SpatialEntityStore → MoveChoreographer
 * → RenderCommandExecutor 全链路。
 */
import { describe, expect, it } from 'vitest'
import { createPresentationRuntime } from '../presentation-runtime'
import type { MapData } from '../../../../play/map/types'

const testMap = (): MapData => ({
  schemaVersion: '1.0',
  id: 'map:p6-e2e',
  name: 'P6 E2E Map',
  backdrop: { image: 'asset:backdrop/test', pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: 'n_start', def: 'd:scene/large', scale: 'large', at: { x: 0.1, y: 0.5 }, floor: 0, name: '起点' },
    { id: 'n_end',   def: 'd:scene/large', scale: 'large', at: { x: 0.9, y: 0.5 }, floor: 0, name: '终点' },
  ],
  edges: [
    { id: 'e1', def: 'd:link/path', a: 'n_start', b: 'n_end', directionality: 'bidirectional', path: [] },
  ],
  placements: [],
})

describe('PresentationRuntime P6 端到端', () => {
  it('after:entity.place 触发 move command 进 executor', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e_player', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 2,
    })

    // executor 中应有一条 active command
    expect(runtime.executor.activeSize()).toBe(1)

    runtime.dispose()
    // dispose 后所有 active 都清空
    expect(runtime.executor.activeSize()).toBe(0)
  })

  it('首次放置（无 previousNodeId）不触发 move command', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e_player', nodeId: 'n_end' },
      revision: 1,
    })

    expect(runtime.executor.activeSize()).toBe(0)
    runtime.dispose()
  })

  it('同节点移动（prev === next）不触发 move command', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e_player', previousNodeId: 'n_end', nodeId: 'n_end' },
      revision: 2,
    })

    expect(runtime.executor.activeSize()).toBe(0)
    runtime.dispose()
  })

  it('SpatialEntityStore 记录了 after:entity.place 的 nodeId', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n_end' },
      revision: 1,
    })
    expect(runtime.entities.getNode('e1')).toBe('n_end')
    runtime.dispose()
  })

  it('rebuildProjection 产出新 revision 的 SpatialProjection', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    const snap0 = runtime.projection.current()
    expect(snap0?.revision).toBe(0)

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n_start' },
      revision: 1,
    })
    runtime.rebuildProjection()

    const snap1 = runtime.projection.current()
    expect(snap1?.revision).toBe(1)
    expect(snap1?.entities.find((e) => e.entityId === 'e1')?.locationNodeId).toBe('n_start')

    runtime.dispose()
  })

  it('stale revision 事件被 EventBridge 丢弃', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n_start' },
      revision: 10,
    })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n_end' },
      revision: 5, // 旧 revision
    })

    // entity 仍记录在 n_start
    expect(runtime.entities.getNode('e1')).toBe('n_start')
    runtime.dispose()
  })

  it('多个连续 entity.place 顺序生成多条 move commands', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })

    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 1,
    })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e2', previousNodeId: 'n_end', nodeId: 'n_start' },
      revision: 2,
    })

    expect(runtime.executor.activeSize()).toBe(2)
    runtime.dispose()
  })

  it('executor 接受命令的 sourceRevision 必须 ≥ SpatialProjection revision', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    expect(runtime.projection.current()?.revision).toBe(0)

    // 第一次 place：entity 第一次进入 n_start，previousNodeId 缺失
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', nodeId: 'n_start' },
      revision: 1,
    })
    runtime.rebuildProjection()
    expect(runtime.projection.current()?.revision).toBe(1)
    // 首次进入没有 previousNodeId → 不产生 move command
    expect(runtime.executor.activeSize()).toBe(0)

    // 第二次 place：跨节点移动 → 产生一条 move command
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 2,
    })
    expect(runtime.executor.activeSize()).toBe(1)

    // 把 projection 推进到 revision 3
    runtime.rebuildProjection()
    expect(runtime.projection.current()?.revision).toBe(2) // bridge revision 跟随 event 流

    // 此时新产生的 move 命令 sourceRevision=2 (projection.revision)
    // executor 接受（2 < 2 是 false，stale 守卫通过）
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', previousNodeId: 'n_end', nodeId: 'n_start' },
      revision: 3,
    })
    expect(runtime.executor.activeSize()).toBe(2) // 累计 2 条

    runtime.dispose()
  })

  it('D-090: PresentationRuntime 接入 MovementSessionController 完整生命周期', () => {
    let completedPlacement: unknown
    const runtime = createPresentationRuntime({
      mapData: testMap(),
      movementDeps: {
        onSessionCompleted: (_id, p) => { completedPlacement = p },
      },
    })

    expect(runtime.movementSession).toBeDefined()
    expect(runtime.movementSession.getState().status).toBe('idle')

    runtime.startMovement({
      entityId: 'e_player',
      route: {
        phases: [
          {
            kind: 'orca-interior',
            points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
            durationMs: 1000,
            naturalSceneId: 'n_start',
          },
        ],
        totalDistance: 0.8,
      },
      targetNaturalSceneId: 'n_end',
      startPosition: { x: 0.1, y: 0.5 },
    })

    expect(runtime.movementSession.getState().status).toBe('moving')

    runtime.pauseMovement()
    expect(runtime.movementSession.getState().status).toBe('paused')

    runtime.resumeMovement()
    expect(runtime.movementSession.getState().status).toBe('moving')

    runtime.noteMovementDisturbance()
    expect(runtime.movementSession.getState().hasDisturbance).toBe(true)

    // 推进 1000ms 到达终点
    runtime.advanceMovement(1000, true)
    expect(runtime.movementSession.getState().status).toBe('recovering')

    // 完成恢复
    runtime.finishMovementRecovery()
    expect(runtime.movementSession.getState().status).toBe('awaiting-authority')

    // feed 权威确认
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e_player', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 5,
    })

    expect(runtime.movementSession.getState().status).toBe('completed')
    expect(completedPlacement).toBeDefined()

    runtime.dispose()
  })
})
