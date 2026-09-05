/**
 * MovementSessionController — D-090 权威移动 Session 控制器。
 *
 * 核心契约：
 * 1. 废弃 status_traveling，移动为 transient movement session，不占状态槽，不消耗 AP。
 * 2. 5 秒纯 ORCA 预算（ORCA_BUDGET_MS = 5000）：
 *    - 仅累加 orca-interior 阶段且有实际位移的时间。
 *    - 暂停、等待、恢复对峙以及 connector-curve 均不计入预算。
 * 3. 5 秒到点延后截停：
 *    - 若在 connector-curve 上，不可中途截断在虚空，必须走完整条曲线到达目标场景后再截停。
 * 4. 截停/终点落点：
 *    - 在当前天然场景内寻找距离当前坐标最近的合法微型场景（等距按 ID 升序破平）。
 * 5. 扰动合并与非抢断 FIFO 队列：
 *    - 移动中受扰动记录 hasDisturbance，路线走完后合并触发一次 recovery。
 *    - 新移动请求不抢断，按 FIFO 排队执行。
 */

import type { Vec2 } from '../../../../play/map/types'
import type { MovementRoute } from './movement-route'

export const ORCA_BUDGET_MS = 5000

export type MovementSessionStatus =
  | 'idle'
  | 'moving'
  | 'awaiting-authority'
  | 'paused'
  | 'recovering'
  | 'completed'
  | 'failed'

export interface MicroSceneCandidate {
  readonly id: string
  readonly naturalSceneId: string
  readonly at: Vec2
}

export interface MovementRequest {
  readonly entityId: string
  readonly route: MovementRoute
  readonly targetNaturalSceneId: string
  readonly targetMicroSceneId?: string
  readonly startPosition: Vec2
}

export interface AuthoritativePlacement {
  readonly entityId: string
  readonly naturalSceneId: string
  readonly microSceneId?: string
  readonly position: Vec2
  readonly isTruncated: boolean
  readonly orcaElapsedMs: number
}

export interface MovementSessionState {
  readonly entityId: string
  readonly status: MovementSessionStatus
  readonly currentPhaseIndex: number
  readonly currentPosition: Vec2
  readonly currentNaturalSceneId: string
  readonly orcaElapsedMs: number
  readonly hasDisturbance: boolean
  readonly placement?: AuthoritativePlacement
  readonly queueLength: number
  readonly lastError?: string
}

export interface MovementSessionControllerDeps {
  readonly getMicroSceneCandidates?: (naturalSceneId: string) => readonly MicroSceneCandidate[]
  readonly onSubmitPlacement?: (placement: AuthoritativePlacement) => void
  readonly onSessionCompleted?: (entityId: string, placement: AuthoritativePlacement) => void
  readonly onSessionFailed?: (entityId: string, error: string) => void
}

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function findNearestMicroScene(
  point: Vec2,
  candidates: readonly MicroSceneCandidate[],
  naturalSceneId: string,
): MicroSceneCandidate | undefined {
  const filtered = candidates.filter((c) => c.naturalSceneId === naturalSceneId)
  if (filtered.length === 0) return undefined

  return filtered.slice().sort((a, b) => {
    const dA = distanceSq(a.at, point)
    const dB = distanceSq(b.at, point)
    if (Math.abs(dA - dB) > 1e-9) {
      return dA - dB
    }
    return a.id.localeCompare(b.id, 'en')
  })[0]
}

function interpolatePoints(points: readonly Vec2[], progress: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1 || progress <= 0) return { x: points[0]!.x, y: points[0]!.y }
  if (progress >= 1) return { x: points[points.length - 1]!.x, y: points[points.length - 1]!.y }

  const totalSegments = points.length - 1
  const segProgress = progress * totalSegments
  const index = Math.min(Math.floor(segProgress), totalSegments - 1)
  const localT = segProgress - index

  const p0 = points[index]!
  const p1 = points[index + 1]!

  return {
    x: p0.x + (p1.x - p0.x) * localT,
    y: p0.y + (p1.y - p0.y) * localT,
  }
}

export class MovementSessionController {
  private activeRequest?: MovementRequest
  private status: MovementSessionStatus = 'idle'
  private currentPhaseIndex = 0
  private phaseElapsedMs = 0
  private orcaElapsedMs = 0
  private currentPosition: Vec2 = { x: 0, y: 0 }
  private currentNaturalSceneId = ''
  private hasDisturbance = false
  private pendingPlacement?: AuthoritativePlacement
  private queue: MovementRequest[] = []
  private lastError?: string

  constructor(private readonly deps: MovementSessionControllerDeps = {}) {}

  /**
   * 提交新的移动请求。
   * 若当前已有活跃 session，则推入 FIFO 队列不抢断。
   */
  startMovement(request: MovementRequest): void {
    if (this.status !== 'idle' && this.status !== 'completed' && this.status !== 'failed') {
      this.queue.push(request)
      return
    }

    this.startRequest(request)
  }

  private startRequest(request: MovementRequest): void {
    this.activeRequest = request
    this.status = 'moving'
    this.currentPhaseIndex = 0
    this.phaseElapsedMs = 0
    this.orcaElapsedMs = 0
    this.currentPosition = { ...request.startPosition }
    this.currentNaturalSceneId = request.route.phases[0]?.naturalSceneId ?? request.targetNaturalSceneId
    this.hasDisturbance = false
    this.pendingPlacement = undefined
    this.lastError = undefined
  }

  /**
   * 暂停移动。暂停期间不累加 5 秒预算。
   */
  pause(): void {
    if (this.status === 'moving') {
      this.status = 'paused'
    }
  }

  /**
   * 恢复移动。
   */
  resume(): void {
    if (this.status === 'paused') {
      this.status = 'moving'
    }
  }

  /**
   * 标记移动期间受到扰动（例如被推挤、对峙）。
   * 不打断当前路线，在移动完成后去重触发一次 standoff recovery。
   */
  noteDisturbance(): void {
    this.hasDisturbance = true
  }

  /**
   * 时间步长推进。
   * @param dtMs 推进毫秒数
   * @param hasDisplacement 是否发生实际位移（若被阻挡无位移则不消耗 5 秒预算）
   */
  advance(dtMs: number, hasDisplacement = true): void {
    if (this.status !== 'moving' || !this.activeRequest) return

    const phases = this.activeRequest.route.phases
    if (phases.length === 0 || this.currentPhaseIndex >= phases.length) {
      this.reachDestination()
      return
    }

    const currentPhase = phases[this.currentPhaseIndex]!

    // 只有 orca-interior 且发生实际位移时才累加 5 秒预算
    if (currentPhase.kind === 'orca-interior') {
      if (currentPhase.naturalSceneId) {
        this.currentNaturalSceneId = currentPhase.naturalSceneId
      }
      if (hasDisplacement) {
        this.orcaElapsedMs += dtMs
      }
    }

    this.phaseElapsedMs += dtMs
    const phaseDuration = Math.max(currentPhase.durationMs, 1)
    const progress = Math.min(this.phaseElapsedMs / phaseDuration, 1)

    // 更新当前坐标
    if (currentPhase.points.length > 0) {
      this.currentPosition = interpolatePoints(currentPhase.points, progress)
    }

    // 检查 5 秒预算耗尽
    if (this.orcaElapsedMs >= ORCA_BUDGET_MS) {
      if (currentPhase.kind === 'orca-interior') {
        // 在场景内且耗尽预算：立即截停
        this.truncateAndSettle()
        return
      }
      // 如果当前在 connector-curve 阶段：不可中途截停在虚空，必须走完曲线
    }

    // 检查当前阶段是否完成
    if (this.phaseElapsedMs >= phaseDuration) {
      this.currentPhaseIndex++
      this.phaseElapsedMs = 0

      if (this.currentPhaseIndex >= phases.length) {
        this.reachDestination()
      } else {
        const nextPhase = phases[this.currentPhaseIndex]!
        if (nextPhase.naturalSceneId) {
          this.currentNaturalSceneId = nextPhase.naturalSceneId
        }
        // 如果进入新阶段前 5 秒预算已耗尽，且刚走完 connector-curve，则进入截停
        if (this.orcaElapsedMs >= ORCA_BUDGET_MS) {
          this.truncateAndSettle()
        }
      }
    }
  }

  private reachDestination(): void {
    if (!this.activeRequest) return
    const naturalSceneId = this.activeRequest.targetNaturalSceneId || this.currentNaturalSceneId
    this.settlePlacement(naturalSceneId, this.activeRequest.targetMicroSceneId, false)
  }

  private truncateAndSettle(): void {
    if (!this.activeRequest) return
    const naturalSceneId = this.currentNaturalSceneId || this.activeRequest.targetNaturalSceneId
    this.settlePlacement(naturalSceneId, undefined, true)
  }

  private settlePlacement(naturalSceneId: string, requestedMicroSceneId: string | undefined, isTruncated: boolean): void {
    if (!this.activeRequest) return

    let finalMicroSceneId = requestedMicroSceneId
    if (!finalMicroSceneId && this.deps.getMicroSceneCandidates) {
      const candidates = this.deps.getMicroSceneCandidates(naturalSceneId)
      const nearest = findNearestMicroScene(this.currentPosition, candidates, naturalSceneId)
      if (nearest) {
        finalMicroSceneId = nearest.id
      }
    }

    this.pendingPlacement = {
      entityId: this.activeRequest.entityId,
      naturalSceneId,
      microSceneId: finalMicroSceneId,
      position: { ...this.currentPosition },
      isTruncated,
      orcaElapsedMs: this.orcaElapsedMs,
    }

    if (this.hasDisturbance) {
      // 移动完成，若中途受扰动，进入恢复对峙状态
      this.status = 'recovering'
    } else {
      this.commitPlacement()
    }
  }

  /**
   * 完成恢复对峙。
   */
  finishRecovery(): void {
    if (this.status === 'recovering') {
      this.hasDisturbance = false
      this.commitPlacement()
    }
  }

  private commitPlacement(): void {
    if (!this.pendingPlacement) return
    this.status = 'awaiting-authority'
    if (this.deps.onSubmitPlacement) {
      this.deps.onSubmitPlacement(this.pendingPlacement)
    }
  }

  /**
   * 权威确认移动提交（例如收到 after:entity.place 且 revision 匹配）。
   */
  acknowledgeCommittedPlacement(_revision?: number): void {
    if (this.status !== 'awaiting-authority' || !this.pendingPlacement || !this.activeRequest) return

    const placement = this.pendingPlacement
    const entityId = this.activeRequest.entityId
    this.status = 'completed'

    if (this.deps.onSessionCompleted) {
      this.deps.onSessionCompleted(entityId, placement)
    }

    // 处理 FIFO 队列中的下一个请求
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      this.startRequest(next)
    }
  }

  /**
   * 权威拒绝或超时失败。
   */
  fail(reason: string): void {
    const entityId = this.activeRequest?.entityId ?? ''
    this.status = 'failed'
    this.lastError = reason

    if (this.deps.onSessionFailed && entityId) {
      this.deps.onSessionFailed(entityId, reason)
    }
  }

  getState(): MovementSessionState {
    return {
      entityId: this.activeRequest?.entityId ?? '',
      status: this.status,
      currentPhaseIndex: this.currentPhaseIndex,
      currentPosition: { ...this.currentPosition },
      currentNaturalSceneId: this.currentNaturalSceneId,
      orcaElapsedMs: this.orcaElapsedMs,
      hasDisturbance: this.hasDisturbance,
      placement: this.pendingPlacement ? { ...this.pendingPlacement } : undefined,
      queueLength: this.queue.length,
      lastError: this.lastError,
    }
  }

  get queueSize(): number {
    return this.queue.length
  }

  reset(): void {
    this.activeRequest = undefined
    this.status = 'idle'
    this.currentPhaseIndex = 0
    this.phaseElapsedMs = 0
    this.orcaElapsedMs = 0
    this.currentPosition = { x: 0, y: 0 }
    this.currentNaturalSceneId = ''
    this.hasDisturbance = false
    this.pendingPlacement = undefined
    this.queue = []
    this.lastError = undefined
  }
}
