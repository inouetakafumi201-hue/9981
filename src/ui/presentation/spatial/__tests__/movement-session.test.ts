/**
 * MovementSessionController 单元测试 (D-090)。
 *
 * 1. 仅累计实际位移的 ORCA 内部时间，暂停/等待不计时。
 * 2. 5 秒到了如果在贝塞尔线上继续走完，不会中途停在虚空。
 * 3. 到达 5 秒后在当前天然场景权威落点到最近微型场景（等距 ID 排序稳定裁决）。
 * 4. 扰动与新输入不抢断当前路径，新输入 FIFO 排队，扰动合并恢复。
 */

import { describe, expect, it } from 'vitest'
import {
  MovementSessionController,
  findNearestMicroScene,
  type AuthoritativePlacement,
  type MicroSceneCandidate,
  type MovementRequest,
} from '../choreography/movement-session'
import { createMovementRoute, type MovementPhase } from '../choreography/movement-route'

describe('MovementSessionController (D-090)', () => {
  const mockCandidates: MicroSceneCandidate[] = [
    { id: 'ms_a', naturalSceneId: 'scene_1', at: { x: 0.2, y: 0.2 } },
    { id: 'ms_b', naturalSceneId: 'scene_1', at: { x: 0.8, y: 0.8 } },
    { id: 'ms_c', naturalSceneId: 'scene_2', at: { x: 0.5, y: 0.5 } },
    { id: 'ms_d', naturalSceneId: 'scene_2', at: { x: 0.6, y: 0.6 } },
  ]

  it('findNearestMicroScene 正确挑选最近且在等距时按 ID 升序破平', () => {
    const nearest1 = findNearestMicroScene({ x: 0.21, y: 0.21 }, mockCandidates, 'scene_1')
    expect(nearest1?.id).toBe('ms_a')

    // 等距测试：{x: 0.55, y: 0.55} 到 ms_c {0.5,0.5} 和 ms_d {0.6,0.6} 距离完全相同
    const nearestEqual = findNearestMicroScene({ x: 0.55, y: 0.55 }, mockCandidates, 'scene_2')
    expect(nearestEqual?.id).toBe('ms_c') // ms_c < ms_d
  })

  it('5 秒 ORCA 预算仅累加实际位移的 orca-interior 时间，暂停与无位移不计入', () => {
    let submittedPlacement: AuthoritativePlacement | undefined
    const session = new MovementSessionController({
      getMicroSceneCandidates: () => mockCandidates,
      onSubmitPlacement: (p) => { submittedPlacement = p },
    })

    const phases: MovementPhase[] = [
      {
        kind: 'orca-interior',
        points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }],
        durationMs: 6000,
        naturalSceneId: 'scene_1',
      },
    ]
    const route = createMovementRoute(phases)
    const request: MovementRequest = {
      entityId: 'hero',
      route,
      targetNaturalSceneId: 'scene_1',
      startPosition: { x: 0.1, y: 0.1 },
    }

    session.startMovement(request)
    expect(session.getState().status).toBe('moving')

    // 推进 2000ms 有位移
    session.advance(2000, true)
    expect(session.getState().orcaElapsedMs).toBe(2000)

    // 暂停 1000ms
    session.pause()
    expect(session.getState().status).toBe('paused')
    session.advance(1000, true) // 暂停中 advance 不生效
    expect(session.getState().orcaElapsedMs).toBe(2000)

    // 恢复后推进 1000ms（无位移，比如原地等待）
    session.resume()
    expect(session.getState().status).toBe('moving')
    session.advance(1000, false)
    expect(session.getState().orcaElapsedMs).toBe(2000) // 无位移不计入

    // 推进 3000ms 有位移 → 达到 5000ms 预算耗尽
    session.advance(3000, true)
    expect(session.getState().orcaElapsedMs).toBe(5000)
    expect(session.getState().status).toBe('awaiting-authority')
    expect(submittedPlacement?.isTruncated).toBe(true)
    expect(submittedPlacement?.entityId).toBe('hero')
    expect(submittedPlacement?.naturalSceneId).toBe('scene_1')
  })

  it('5 秒预算耗尽时如果在 connector-curve 阶段，继续走完整个曲线段到达目标场景后再截停', () => {
    let submittedPlacement: AuthoritativePlacement | undefined
    const session = new MovementSessionController({
      getMicroSceneCandidates: (sceneId) => mockCandidates.filter((c) => c.naturalSceneId === sceneId),
      onSubmitPlacement: (p) => { submittedPlacement = p },
    })

    const phases: MovementPhase[] = [
      // 阶段 1: scene_1 内部 4500ms
      {
        kind: 'orca-interior',
        points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }],
        durationMs: 4500,
        naturalSceneId: 'scene_1',
      },
      // 阶段 2: 贝塞尔过渡曲线 2000ms
      {
        kind: 'connector-curve',
        points: [{ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.45 }, { x: 0.6, y: 0.6 }],
        durationMs: 2000,
        edgeId: 'e_bridge',
      },
      // 阶段 3: scene_2 内部 3000ms
      {
        kind: 'orca-interior',
        points: [{ x: 0.6, y: 0.6 }, { x: 0.9, y: 0.9 }],
        durationMs: 3000,
        naturalSceneId: 'scene_2',
      },
    ]

    const route = createMovementRoute(phases)
    session.startMovement({
      entityId: 'scout',
      route,
      targetNaturalSceneId: 'scene_2',
      startPosition: { x: 0.1, y: 0.1 },
    })

    // 推进 4500ms 走完阶段 1
    session.advance(4500, true)
    expect(session.getState().orcaElapsedMs).toBe(4500)
    expect(session.getState().currentPhaseIndex).toBe(1) // 进入 connector-curve
    expect(session.getState().status).toBe('moving')

    // 推进 1000ms 曲线（connector-curve 不累加 orcaElapsedMs）
    session.advance(1000, true)
    expect(session.getState().orcaElapsedMs).toBe(4500)
    expect(session.getState().status).toBe('moving') // 不在曲线中途截断

    // 走完剩余 1000ms 曲线并进入阶段 3，再推进 500ms 消耗完 5000ms 预算
    session.advance(1000, true)
    expect(session.getState().currentPhaseIndex).toBe(2) // 进入 scene_2 内部

    session.advance(500, true)
    expect(session.getState().orcaElapsedMs).toBe(5000)
    expect(session.getState().status).toBe('awaiting-authority')
    expect(submittedPlacement?.isTruncated).toBe(true)
    expect(submittedPlacement?.naturalSceneId).toBe('scene_2')
    expect(submittedPlacement?.microSceneId).toBe('ms_d') // 距离 {0.6, 0.6} 最近的 ms_d
  })

  it('移动中受扰动记录 hasDisturbance，路线走完后进入 recovery 状态，新请求 FIFO 排队', () => {
    let completedCount = 0
    let lastPlacement: AuthoritativePlacement | undefined

    const session = new MovementSessionController({
      getMicroSceneCandidates: () => mockCandidates,
      onSubmitPlacement: (p) => { lastPlacement = p },
      onSessionCompleted: () => { completedCount++ },
    })

    const route1 = createMovementRoute([
      {
        kind: 'orca-interior',
        points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
        durationMs: 1000,
        naturalSceneId: 'scene_1',
      },
    ])
    const route2 = createMovementRoute([
      {
        kind: 'orca-interior',
        points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
        durationMs: 1000,
        naturalSceneId: 'scene_1',
      },
    ])

    session.startMovement({
      entityId: 'runner',
      route: route1,
      targetNaturalSceneId: 'scene_1',
      startPosition: { x: 0.1, y: 0.1 },
    })

    // 新移动请求在 moving 期间提交 → FIFO 排队，不抢断当前路径
    session.startMovement({
      entityId: 'runner',
      route: route2,
      targetNaturalSceneId: 'scene_1',
      startPosition: { x: 0.2, y: 0.2 },
    })
    expect(session.queueSize).toBe(1)

    // 推进 500ms 并标记受到扰动
    session.advance(500, true)
    session.noteDisturbance()
    expect(session.getState().hasDisturbance).toBe(true)

    // 走完第一个路线
    session.advance(500, true)
    // 因为有扰动，进入 recovering 状态
    expect(session.getState().status).toBe('recovering')

    // 完成恢复
    session.finishRecovery()
    expect(session.getState().status).toBe('awaiting-authority')

    // 权威确认第一个完成
    session.acknowledgeCommittedPlacement(1)
    expect(completedCount).toBe(1)
    expect(lastPlacement?.entityId).toBe('runner')

    // 自动启动排队的第二个请求
    expect(session.getState().status).toBe('moving')
    expect(session.queueSize).toBe(0)

    // 走完第二个请求
    session.advance(1000, true)
    expect(session.getState().status).toBe('awaiting-authority')
    session.acknowledgeCommittedPlacement(2)
    expect(completedCount).toBe(2)
    expect(session.getState().status).toBe('completed')
  })
})
