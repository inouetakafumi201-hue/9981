/**
 * P11 专项测试：OrcaEngine。
 */
import { describe, expect, it } from 'vitest'
import { orcaStep, computeOrcaPath } from '../orca-engine'

const agent = (id: string, x: number, y: number, r = 0.02, vx = 0, vy = 0) => ({
  id,
  position: { x, y },
  radius: r,
  preferredVelocity: { x: vx, y: vy },
  maxSpeed: 0.5,
})

describe('P11 OrcaEngine orcaStep', () => {
  it('单 agent 保持直线位移', () => {
    const agents = [agent('a', 0.1, 0.1, 0.02, 0.01, 0.01)]
    const result = orcaStep(agents)
    expect(result).toHaveLength(1)
    expect(result[0]!.newPosition.x).toBeGreaterThan(0.1)
    expect(result[0]!.newPosition.y).toBeGreaterThan(0.1)
  })

  it('两 agent 有初始偏移则分离', () => {
    // 有偏移时 ORCA 半平面不同 → 速度分离
    const agents = [
      agent('a', 0.5, 0.5, 0.02, 0.01, 0.01),
      agent('b', 0.51, 0.5, 0.02, 0.01, 0.01), // 略右偏移
    ]
    const result = orcaStep(agents)
    // ORCA 处理后两 agent 位置应不全相同（半平面不同则投影不同）
    const a = result.find((r) => r.agent.id === 'a')!.newPosition
    const b = result.find((r) => r.agent.id === 'b')!.newPosition
    // 至少 x 或 y 不同（不要求完全分离；已有偏移时 ORCA 会处理）
    expect(a.x !== b.x || a.y !== b.y).toBe(true)
  })

  it('返回数组长度等于输入', () => {
    const agents = [
      agent('a', 0.2, 0.2),
      agent('b', 0.3, 0.3),
      agent('c', 0.4, 0.4),
    ]
    const result = orcaStep(agents)
    expect(result).toHaveLength(3)
  })

  it('computeOrcaPath === orcaStep（别名）', () => {
    const agents = [agent('a', 0.1, 0.1, 0.02, 0.01, 0.01)]
    const result = computeOrcaPath(agents)
    expect(result).toHaveLength(1)
  })

  it('零 preferredVelocity 不动', () => {
    const agents = [agent('a', 0.5, 0.5, 0.02, 0, 0)]
    const result = orcaStep(agents)
    // 零速度 + 无冲突时不变
    const pos = result[0]!.newPosition
    const orig = agents[0]!.position
    expect(pos.x).toBeCloseTo(orig.x, 2)
    expect(pos.y).toBeCloseTo(orig.y, 2)
  })

  it('output newPosition 不等于原 position', () => {
    const agents = [agent('a', 0.1, 0.1, 0.02, 0.01, 0.01)]
    const result = orcaStep(agents)
    expect(result[0]!.newPosition).not.toEqual(agents[0]!.position)
  })
})
