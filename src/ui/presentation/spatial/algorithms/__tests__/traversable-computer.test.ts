/**
 * P9 专项测试：TraversableComputer。
 *
 * 重要：节点中心 cell 强制可通行（precompute 逻辑）。
 * 所有测试中的静态障碍物必须放在 节点中心之外 的 cell，
 * 否则障碍会被节点覆盖而失效。
 */
import { describe, expect, it } from 'vitest'
import { TraversableComputer, toCell, isCellPassable, isLinePathPassable } from '../../algorithms/traversable-computer'
import type { MapData } from '../../../../../play/map/types'

/** 中央节点，远离边角，方便障碍物放在其他区域 */
const mapWithCentralNode = (): MapData => ({
  schemaVersion: '1.0',
  id: 'p9-test',
  name: 'P9 Test',
  backdrop: { image: 'asset:b', pixelWidth: 512, pixelHeight: 512, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: 'n0', def: 'd:scene/small', scale: 'small', at: { x: 0.5, y: 0.5 }, floor: 0, name: 'Node0' },
    { id: 'n1', def: 'd:scene/small', scale: 'small', at: { x: 0.5, y: 0.5 }, floor: 0, name: 'Node1' }, // same cell as n0
  ],
  edges: [],
  placements: [],
})

describe('P9 toCell', () => {
  it('左上角 (0,1) → row=0 col=0', () => {
    const { row, col } = toCell(0, 1, 32, 32)
    expect(row).toBe(0)
    expect(col).toBe(0)
  })

  it('右下角 (1,0) → row=31 col=31', () => {
    const { row, col } = toCell(1, 0, 32, 32)
    expect(row).toBe(31)
    expect(col).toBe(31)
  })

  it('中心 (0.5,0.5) → row=16 col=16', () => {
    const { row, col } = toCell(0.5, 0.5, 32, 32)
    expect(row).toBe(16)
    expect(col).toBe(16)
  })

  it('越界 clamp 到边界内', () => {
    // x=1.5 → clamp col=31; y=-0.5 → (1-(-0.5))*32=48 → clamp row=31
    const { row, col } = toCell(1.5, -0.5, 32, 32)
    expect(row).toBe(31)
    expect(col).toBe(31)
  })
})

describe('P9 TraversableComputer precompute', () => {
  it('节点中心 cell 强制可通行', () => {
    const tc = new TraversableComputer({ cols: 32, rows: 32 })
    const domain = tc.precompute(mapWithCentralNode())
    const { row, col } = toCell(0.5, 0.5, 32, 32)
    const idx = row * 32 + col
    expect(domain.blocked.has(idx)).toBe(false)
  })

  it('无障碍时节点路径之外也视为可通行', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(mapWithCentralNode())
    // cell 0 不在节点中心（节点在中央 cell 8），应当可通行
    expect(domain.blocked.has(0)).toBe(false)
  })

  it('静态障碍标记为 blocked', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    // 障碍 (0.5, 0.5, 0.5, 0.5) 覆盖 cell (2,2)(2,3)(3,2)(3,3)
    // 节点中心 (0.5, 0.5) → cell (2,2)，强制可通行
    // 右下 cell (3,3) = idx 15，被障碍覆盖
    const domain = tc.precompute(mapWithCentralNode(), [
      { id: 'obs1', x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ])
    expect(isCellPassable(domain, 3 * 4 + 3)).toBe(false) // cell (3,3) 右下被障碍
  })

  it('静态障碍不覆盖节点中心', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(mapWithCentralNode(), [
      { id: 'obs1', x: 0.0, y: 0.0, width: 0.3, height: 0.3 }, // 左下角，远离中央节点
    ])
    const { row, col } = toCell(0.5, 0.5, 4, 4)
    const idx = row * 4 + col
    expect(domain.blocked.has(idx)).toBe(false)
  })

  it('nodeCells 记录节点 cell', () => {
    const tc = new TraversableComputer({ cols: 32, rows: 32 })
    const domain = tc.precompute(mapWithCentralNode())
    expect(domain.nodeCells.has('n0')).toBe(true)
    expect(domain.nodeCells.has('n1')).toBe(true)
    expect(domain.nodeCells.has('nonexistent')).toBe(false)
  })

  it('precompute 返回冻结对象', () => {
    const tc = new TraversableComputer()
    const domain = tc.precompute(mapWithCentralNode())
    expect(Object.isFrozen(domain)).toBe(true)
    expect(Object.isFrozen(domain.blocked)).toBe(true)
    expect(Object.isFrozen(domain.nodeCells)).toBe(true)
  })
})

describe('P9 isCellPassable', () => {
  it('不在 blocked 集合 → true', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(mapWithCentralNode())
    expect(isCellPassable(domain, 0)).toBe(true)  // 左下角，非节点中心
  })

  it('在 blocked 集合 → false', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(mapWithCentralNode(), [
      { id: 'o', x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ])
    // cell 15 = (3,3) 被障碍覆盖
    expect(isCellPassable(domain, 15)).toBe(false)
  })
})

describe('P9 isLinePathPassable', () => {
  it('直线完全可通行 → true', () => {
    const tc = new TraversableComputer({ cols: 32, rows: 32 })
    const domain = tc.precompute(mapWithCentralNode())
    // 从 (0,0) 到 (31,31) 都是无障碍
    const from = 0 * 32 + 0
    const to = 31 * 32 + 31
    expect(isLinePathPassable(domain, from, to)).toBe(true)
  })

  it('同点 → true（no-op）', () => {
    const tc = new TraversableComputer({ cols: 4, rows: 4 })
    const domain = tc.precompute(mapWithCentralNode())
    expect(isLinePathPassable(domain, 5, 5)).toBe(true)
  })

  it('直线穿过障碍 → false', () => {
    const tc = new TraversableComputer({ cols: 8, rows: 8 })
    // 障碍覆盖 x=0.30-0.50，即 col 2-3
    // 路径 (0,0)→(7,7) 对角线穿过 col 2: cell (2,2) 命中障碍
    const domain = tc.precompute(mapWithCentralNode(), [
      { id: 'wall', x: 0.30, y: 0.0, width: 0.20, height: 1.0 },
    ])
    const from = 0 * 8 + 0
    const to = 7 * 8 + 7
    expect(isLinePathPassable(domain, from, to)).toBe(false)
  })
})
