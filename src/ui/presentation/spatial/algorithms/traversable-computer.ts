/**
 * P9 TraversableComputer — 可通行域预运算。
 *
 * 输入：MapData + 静态碰撞箱（建筑、障碍物等不可动体）。
 * 输出：TraversableDomain（布尔栅格 + node→cell 索引）。
 *
 * 设计决策：
 * - 不在主线程阻塞：precompute() 保持纯同步，Worker 化是上层装配的职责
 * - 网格密度 32x32，覆盖 0-1 归一化空间
 * - 节点中心 cell 一定可通行（强制），节点之间的边缘路径由 PathfindingService 处理
 * - 静态障碍（rect）标记为不可通行
 */

import type { MapData } from '../../../../play/map/types'

/** TraversableComputer 配置。 */
export interface TraversableConfig {
  /** 网格列数（>=8），默认 32 */
  readonly cols?: number
  /** 网格行数（>=8），默认 32 */
  readonly rows?: number
}

/** 静态碰撞箱（不可动物理障碍）。 */
export interface StaticCollisionBox {
  readonly id: string
  readonly x: number   // 0-1
  readonly y: number   // 0-1
  readonly width: number   // 0-1
  readonly height: number  // 0-1
}

export interface TraversableDomain {
  readonly cols: number
  readonly rows: number
  /** 不可通行 cell 的索引集合（index = row * cols + col） */
  readonly blocked: ReadonlySet<number>
  /** nodeId → 该节点占据的 cell 索引列表 */
  readonly nodeCells: ReadonlyMap<string, readonly number[]>
}

function cellIndex(row: number, col: number, cols: number): number {
  return row * cols + col
}

/** 归一化 (0-1) 坐标 → 网格 (row, col)。y 上方向 → row=0 是底部。 */
export function toCell(x: number, y: number, cols: number, rows: number): { row: number; col: number } {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(x * cols)))
  const row = Math.max(0, Math.min(rows - 1, Math.floor((1 - y) * rows)))
  return { row, col }
}

export class TraversableComputer {
  private readonly cols: number
  private readonly rows: number

  constructor(config?: TraversableConfig) {
    this.cols = Math.max(8, config?.cols ?? 32)
    this.rows = Math.max(8, config?.rows ?? 32)
  }

  /** 派生可通行域（同步纯函数）。 */
  precompute(mapData: MapData, staticObstacles: readonly StaticCollisionBox[] = []): TraversableDomain {
    const blocked = new Set<number>()
    const nodeCells = new Map<string, number[]>()

    // 1. 节点中心 cell 强制可通行
    for (const node of mapData.nodes) {
      const { row, col } = toCell(node.at.x, node.at.y, this.cols, this.rows)
      const idx = cellIndex(row, col, this.cols)
      blocked.delete(idx)
      const arr = nodeCells.get(node.id) ?? []
      arr.push(idx)
      nodeCells.set(node.id, arr)
    }

    // 2. 静态障碍标记为不可通行
    for (const obs of staticObstacles) {
      const c0 = toCell(obs.x, obs.y, this.cols, this.rows)
      const c1 = toCell(obs.x + obs.width, obs.y + obs.height, this.cols, this.rows)
      const r0 = Math.min(c0.row, c1.row)
      const r1 = Math.max(c0.row, c1.row)
      const c_0 = Math.min(c0.col, c1.col)
      const c_1 = Math.max(c0.col, c1.col)
      for (let r = r0; r <= r1; r++) {
        for (let c = c_0; c <= c_1; c++) {
          blocked.add(cellIndex(r, c, this.cols))
        }
      }
    }

    return Object.freeze({
      cols: this.cols,
      rows: this.rows,
      blocked: Object.freeze(new Set(blocked)),
      nodeCells: Object.freeze(new Map(nodeCells)),
    })
  }
}

/** cell 是否可通行。 */
export function isCellPassable(domain: TraversableDomain, idx: number): boolean {
  return !domain.blocked.has(idx)
}

/** Bresenham 直线算法：判断 from→to cell 是否全可通行。 */
export function isLinePathPassable(domain: TraversableDomain, from: number, to: number): boolean {
  const cols = domain.cols
  const r0 = Math.floor(from / cols)
  const c0 = from % cols
  const r1 = Math.floor(to / cols)
  const c1 = to % cols

  const dx = Math.abs(c1 - c0)
  const dy = Math.abs(r1 - r0)
  const sx = c0 < c1 ? 1 : -1
  const sy = r0 < r1 ? 1 : -1
  let err = dx - dy
  let x = c0
  let y = r0

  while (true) {
    if ((x !== c0 || y !== r0) && !isCellPassable(domain, cellIndex(y, x, cols))) return false
    if (x === c1 && y === r1) return true
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx)  { err += dx; y += sy }
  }
}
