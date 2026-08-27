/**
 * P10 PathfindingService — A* 寻路。
 *
 * 按 R004 验收标准：
 * - 基于 TraversableDomain 布尔栅格
 * - 8 方向移动（含对角线）
 * - 禁止跨角：对角移动要求相邻两格均可通行
 * - 寻路失败返回 null
 *
 * 设计决策：
 * - 与具体渲染/动画无关，纯同步算法
 * - 暂不引入 `pathfinding` npm 包；网格 A* 手工实现足够快（<10ms）
 * - Cell 索引 = row * cols + col
 */

import type { TraversableDomain } from './traversable-computer'

/** 寻路结果：路径点数组（cell 索引），或 null 表示无路径。 */
export interface PathResult {
  readonly cells: readonly number[]
}

/** 最小堆（用于 A* open set）。 */
class MinHeap {
  private heap: { cell: number; f: number }[] = []

  push(cell: number, f: number): void {
    this.heap.push({ cell, f })
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): { cell: number; f: number } | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  get length(): number {
    return this.heap.length
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.heap[parent]!.f <= this.heap[i]!.f) break
      ;[this.heap[parent], this.heap[i]] = [this.heap[i]!, this.heap[parent]!]
      i = parent
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length
    while (true) {
      let smallest = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && this.heap[l]!.f < this.heap[smallest]!.f) smallest = l
      if (r < n && this.heap[r]!.f < this.heap[smallest]!.f) smallest = r
      if (smallest === i) break
      ;[this.heap[smallest], this.heap[i]] = [this.heap[i]!, this.heap[smallest]!]
      i = smallest
    }
  }
}

export class PathfindingService {
  /**
   * 在 TraversableDomain 上执行 A*。
   * @param domain 可通行域
   * @param from 起点 cell 索引
   * @param to 终点 cell 索引
   * @returns 路径 cell 索引数组（含起点和终点），或 null（无路径）
   */
  findPath(domain: TraversableDomain, from: number, to: number): PathResult | null {
    if (from === to) return { cells: [from] }
    if (domain.blocked.has(from) || domain.blocked.has(to)) return null

    const { cols, rows } = domain

    const rowOf = (cell: number) => Math.floor(cell / cols)
    const colOf = (cell: number) => cell % cols

    // Octile distance heuristic（匹配 8 方向移动）
    const heuristic = (cell: number): number => {
      const dr = Math.abs(rowOf(cell) - rowOf(to))
      const dc = Math.abs(colOf(cell) - colOf(to))
      return Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc)
    }

    const gScore = new Map<number, number>()
    const fScore = new Map<number, number>()
    const cameFrom = new Map<number, number>()
    const closed = new Set<number>()

    gScore.set(from, 0)
    fScore.set(from, heuristic(from))

    const open = new MinHeap()
    open.push(from, fScore.get(from)!)

    // 8 方向：[dRow, dCol, cost]
    const DIRS: [number, number, number][] = [
      [-1, 0, 1],   // N
      [1, 0, 1],    // S
      [0, -1, 1],    // W
      [0, 1, 1],    // E
      [-1, -1, Math.SQRT2], // NW
      [-1, 1, Math.SQRT2],  // NE
      [1, -1, Math.SQRT2],  // SW
      [1, 1, Math.SQRT2],   // SE
    ]

    while (open.length > 0) {
      const entry = open.pop()!
      const current = entry.cell

      if (current === to) {
        // reconstruct path
        const path: number[] = []
        let cur: number | undefined = to
        while (cur !== undefined) {
          path.unshift(cur)
          cur = cameFrom.get(cur)
        }
        return { cells: Object.freeze(path) }
      }

      if (closed.has(current)) continue
      closed.add(current)

      const curRow = rowOf(current)
      const curCol = colOf(current)

      for (const [dr, dc, cost] of DIRS) {
        const nr = curRow + dr
        const nc = curCol + dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue

        const neighbor = nr * cols + nc
        if (closed.has(neighbor)) continue
        if (domain.blocked.has(neighbor)) continue

        // 对角移动防跨角：相邻两格必须可通行
        if (dr !== 0 && dc !== 0) {
          const nCell = (curRow) * cols + (curCol + dc)
          const eCell = (curRow + dr) * cols + (curCol)
          if (domain.blocked.has(nCell) || domain.blocked.has(eCell)) continue
        }

        const tentativeG = (gScore.get(current) ?? Infinity) + cost
        if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, current)
          gScore.set(neighbor, tentativeG)
          const f = tentativeG + heuristic(neighbor)
          fScore.set(neighbor, f)
          open.push(neighbor, f)
        }
      }
    }

    return null
  }
}
