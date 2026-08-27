/**
 * P10 专项测试：PathfindingService。
 */
import { describe, expect, it } from 'vitest'
import { PathfindingService } from '../pathfinding-service'
import { TraversableComputer } from '../traversable-computer'
import type { MapData } from '../../../../../play/map/types'

const openMap = (): MapData => ({
  schemaVersion: '1.0', id: 'p10', name: 'P10',
  backdrop: { image: 'a', pixelWidth: 512, pixelHeight: 512, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [{ id: 'n0', def: 'd', scale: 'small', at: { x: 0.5, y: 0.5 }, floor: 0, name: 'N0' }],
  edges: [], placements: [],
})

describe('P10 PathfindingService findPath', () => {
  it('同点返回 [from]', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(openMap())
    const pf = new PathfindingService()
    const { row, col } = (() => {
      const x = 0.5 * 4, y = (1 - 0.5) * 4
      return { row: Math.floor(x), col: Math.floor(y) }
    })()
    const idx = row * 4 + col
    const result = pf.findPath(domain, idx, idx)
    expect(result).not.toBeNull()
    expect(result!.cells).toEqual([idx])
  })

  it('无障碍开放场直达', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(openMap())
    const pf = new PathfindingService()
    // 左上 → 右下
    const result = pf.findPath(domain, 0, 3 * 4 + 3)
    expect(result).not.toBeNull()
    expect(result!.cells.length).toBeGreaterThan(1)
    expect(result!.cells[0]).toBe(0)
    expect(result!.cells[result!.cells.length - 1]).toBe(15)
  })

  it('起/终点被 block → null', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    // 无 node 阻塞；用完整 4x4 障碍覆盖 cell 0
    const empty: MapData = { ...openMap(), nodes: [] }
    const domain = tc.precompute(empty, [
      { id: 'block_start', x: 0, y: 0.75, width: 0.25, height: 0.25 }, // cell 0
    ])
    const pf = new PathfindingService()
    expect(pf.findPath(domain, 0, 15)).toBeNull()
  })

  it('完全隔断 → null', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(openMap(), [
      { id: 'wall', x: 0.40, y: 0.0, width: 0.05, height: 1.0 }, // col 1-2
    ])
    const pf = new PathfindingService()
    // 左侧 → 右侧，被 col 1-2 阻挡
    const left = 0 * 4 + 0
    const right = 0 * 4 + 3
    expect(pf.findPath(domain, left, right)).toBeNull()
  })

  it('可绕行路径存在', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    // 障碍只在 col 1 row 0 那一格，绕行可行
    const domain = tc.precompute(openMap(), [
      { id: 'small', x: 0.20, y: 0.70, width: 0.05, height: 0.05 },
    ])
    const pf = new PathfindingService()
    const result = pf.findPath(domain, 0, 15)
    expect(result).not.toBeNull()
    expect(result!.cells).toContain(15)
  })

  it('对角移动防跨角被阻断（corner cutting prevention）', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(openMap())
    const pf = new PathfindingService()
    const result = pf.findPath(domain, 0, 15)
    expect(result).not.toBeNull()
    expect(result!.cells.length).toBeGreaterThan(1)
    expect(result!.cells.length).toBeLessThanOrEqual(12) // 对角线最短≈5.66/1=6步
  })

  it('路径包含起终点', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(openMap())
    const pf = new PathfindingService()
    const result = pf.findPath(domain, 5, 10)
    expect(result!.cells[0]).toBe(5)
    expect(result!.cells[result!.cells.length - 1]).toBe(10)
  })

  it('路径连续相邻', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(openMap())
    const pf = new PathfindingService()
    const result = pf.findPath(domain, 0, 5)!
    for (let i = 1; i < result.cells.length; i++) {
      const prev = result.cells[i - 1]!
      const curr = result.cells[i]!
      const dRow = Math.abs(Math.floor(curr / 4) - Math.floor(prev / 4))
      const cPrev = prev % 4
      const cCurr = curr % 4
      const dCol = Math.min(Math.abs(cCurr - cPrev), 4 - Math.abs(cCurr - cPrev))
      expect(dRow + dCol).toBeGreaterThan(0)
      expect(dRow + dCol).toBeLessThanOrEqual(2)
    }
  })
})
