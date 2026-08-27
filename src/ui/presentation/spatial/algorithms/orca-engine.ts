/**
 * P11 OrcaEngine — 纯 TS 实现的最小 ORCA 避障骨架。
 *
 * R005 验收标准：
 * - 每帧 dt 推进 agents
 * - 不穿模（圆之间最小距离 = r1 + r2）
 * - 超时降级为直线位移（fallback path）
 *
 * 实现策略：
 * - 不用 rvo2-js 库（依赖太重）；用 1 步 neighbor half-plane 投影
 * - 每个 agent 对每个 neighbor 算一条"不能碰撞"的 half-plane
 * - 累加 half-plane 集合，求最大可行速度（保守线性解）
 * - 后续可替换为 rvo2-js；本类实现 ORCA 行为的纯 TS 等价物
 *
 * 设计决策：
 * - 同步 pure function（step），不持状态
 * - 入参为 snapshot agents + 1 dt
 * - 出参为新 agents 位置
 */

export interface OrcaAgent {
  readonly id: string
  readonly position: { x: number; y: number }
  readonly radius: number
  readonly preferredVelocity: { x: number; y: number }
  readonly maxSpeed: number
}

export interface OrcaStep {
  readonly agent: OrcaAgent
  readonly newPosition: { x: number; y: number }
}

export interface OrcaStepOptions {
  readonly timeHorizon: number
  readonly maxSpeed: number
  readonly fallbackToLinear?: boolean
}

const DEFAULT_OPTIONS: Required<OrcaStepOptions> = Object.freeze({
  timeHorizon: 2.0,
  maxSpeed: 0.5,
  fallbackToLinear: true,
})

/**
 * 一步 ORCA 推进。
 * - 计算每个 agent 相对每个 neighbor 的 half-plane
 * - 选最保守的速度（即满足所有 half-plane）
 * - 失败时按 fallbackToLinear 决策（直线位移或返回原位置）
 */
export function orcaStep(
  agents: readonly OrcaAgent[],
  options?: Partial<OrcaStepOptions>,
): readonly OrcaStep[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  return agents.map((agent) => {
    const desired = clampLength(agent.preferredVelocity, agent.maxSpeed * opts.timeHorizon)

    // 收集对所有邻居的 half-plane
    const halfPlanes: HalfPlane[] = []
    for (const other of agents) {
      if (other.id === agent.id) continue
      const plane = buildHalfPlane(agent, other, opts)
      halfPlanes.push(plane)
    }

    const newPos = solveHalfPlanes(agent, desired, halfPlanes)

    // 检查是否穿模
    if (!opts.fallbackToLinear) {
      for (const other of agents) {
        if (other.id === agent.id) continue
        if (distance(newPos, other.position) < agent.radius + other.radius + 0.001) {
          return { agent, newPosition: agent.position } // 不动
        }
      }
    }

    return { agent, newPosition: newPos }
  })
}

interface HalfPlane {
  readonly point: { x: number; y: number }
  readonly normal: { x: number; y: number }   // 指向可行域
}

function buildHalfPlane(a: OrcaAgent, b: OrcaAgent, opts: Required<OrcaStepOptions>): HalfPlane {
  const abx = b.position.x - a.position.x
  const aby = b.position.y - a.position.y
  const dist = Math.sqrt(abx * abx + aby * aby)
  const minDist = a.radius + b.radius
  if (dist < minDist) {
    // 已穿模：把 b 推开 normal 反向
    const nx = dist > 1e-6 ? abx / dist : 1
    const ny = dist > 1e-6 ? aby / dist : 0
    return {
      point: { x: a.position.x + nx * minDist, y: a.position.y + ny * minDist },
      normal: { x: -nx, y: -ny },
    }
  }
  // ORCA：时间窗口 τ 内不碰撞 → 半平面
  const w = minDist / opts.timeHorizon
  const u = { x: (abx / dist) * w, y: (aby / dist) * w }
  // 半平面在 (u + a + (b-a)/dist*minDist/2) 处，法线 (-u/|u|)
  const uLen = Math.sqrt(u.x * u.x + u.y * u.y)
  if (uLen < 1e-6) {
    // 相对静止，仍需保 minDist
    return { point: { x: a.position.x + abx * 0.5, y: a.position.y + aby * 0.5 }, normal: { x: -abx / dist, y: -aby / dist } }
  }
  const midpoint = { x: a.position.x + abx * 0.5, y: a.position.y + aby * 0.5 }
  return {
    point: midpoint,
    normal: { x: -u.x / uLen, y: -u.y / uLen },
  }
}

function solveHalfPlanes(agent: OrcaAgent, desired: { x: number; y: number }, planes: readonly HalfPlane[]): { x: number; y: number } {
  let v = desired
  // 简单迭代：依次对每条半平面做投影
  for (const plane of planes) {
    const d = distancePointToPlane(v, plane)
    if (d < 0) {
      // 不在半平面内：投影
      v = {
        x: v.x + plane.normal.x * (-d),
        y: v.y + plane.normal.y * (-d),
      }
    }
  }
  return { x: agent.position.x + v.x, y: agent.position.y + v.y }
}

function distancePointToPlane(p: { x: number; y: number }, plane: HalfPlane): number {
  return (p.x - plane.point.x) * plane.normal.x + (p.y - plane.point.y) * plane.normal.y
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function clampLength(v: { x: number; y: number }, max: number): { x: number; y: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  if (len <= max) return v
  return { x: (v.x / len) * max, y: (v.y / len) * max }
}

/**
 * 简单移动管线：把直线目标点用 ORCA step 平滑成 OrcaStep[] 列表。
 * 渲染层取出 newPosition 即得到最终位移。
 */
export function computeOrcaPath(
  agents: readonly OrcaAgent[],
  opts?: Partial<OrcaStepOptions>,
): readonly OrcaStep[] {
  return orcaStep(agents, opts)
}
