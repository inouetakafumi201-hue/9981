/* =========================================================================
   纯函数几何工具 — 无第三方依赖
   ========================================================================= */

import type { Vec } from './map-types'

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** 由两个拖拽角点生成正规化矩形（始终正宽高） */
export function rectFromDrag(
  a: Vec,
  b: Vec,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function pointInRect(p: Vec, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.width + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.height + pad
  )
}

/** 命中检测：点是否在（可旋转）矩形内。rotation 单位为度，绕矩形中心 */
export function pointInRotatedRect(p: Vec, r: Rect, rotationDeg = 0): boolean {
  if (!rotationDeg) return pointInRect(p, r)
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const rad = (-rotationDeg * Math.PI) / 180
  const dx = p.x - cx
  const dy = p.y - cy
  const local = {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  }
  return pointInRect(local, r)
}

/** 旋转矩形的轴对齐外接框（AABB）。场景框允许整组旋转（B2）但聚合/空洞
 *  检测仍按轴对齐矩形做重叠判定——用旋转后的 AABB 代入现有
 *  `rectsOverlap`，是常见的粗粒度近似：旋转角度小或矩形接近正方形时几乎
 *  精确，极端瘦长矩形在大角度旋转下会偏保守（判定"重叠"的范围略大于实际
 *  旋转形状），但不会漏判真实重叠，足够满足编辑器场景。 */
export function rotatedRectAABB(r: Rect, rotationDeg = 0): Rect {
  if (!rotationDeg) return r
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const hw = (r.width * cos + r.height * sin) / 2
  const hh = (r.width * sin + r.height * cos) / 2
  return { x: cx - hw, y: cy - hh, width: hw * 2, height: hh * 2 }
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/** 矩形是否完全被另一矩形包含 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** 点到线段的最短距离 */
export function pointToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** 点到折线的最短距离，并返回最近段索引 */
export function pointToPolyline(
  p: Vec,
  pts: Vec[],
): { distance: number; segment: number } {
  let best = Infinity
  let seg = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (!a || !b) continue
    const d = pointToSegment(p, a, b)
    if (d < best) {
      best = d
      seg = i
    }
  }
  return { distance: best, segment: seg }
}

/* ---------------- Catmull-Rom 样条 ----------------
   生成穿过所有控制点的平滑 SVG path（centripetal 变体避免打结）。
   点数 < 3 时退化为直线。 */
export function catmullRomPath(points: Vec[]): string {
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M ${first.x} ${first.y}`
  const second = points[1]
  if (!second) return `M ${first.x} ${first.y}`
  if (points.length === 2) {
    return `M ${first.x} ${first.y} L ${second.x} ${second.y}`
  }

  const p = points
  let d = `M ${first.x} ${first.y}`
  for (let i = 0; i < p.length - 1; i++) {
    const p1 = p[i]
    const p2 = p[i + 1]
    if (!p1 || !p2) continue
    const p0 = p[i - 1] ?? p1
    const p3 = p[i + 2] ?? p2

    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6

    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** 在 t∈[0,1] 处采样 Catmull-Rom 样条上的点（用于放置箭头/过渡窗默认位置） */
export function catmullRomAt(points: Vec[], t: number): Vec {
  const first = points[0]
  if (!first) return { x: 0, y: 0 }
  if (points.length === 1) return first
  const segCount = points.length - 1
  const scaled = t * segCount
  const i = Math.min(Math.floor(scaled), segCount - 1)
  const p1 = points[i]
  const p2 = points[i + 1]
  if (!p1 || !p2) return first
  const p0 = points[i - 1] ?? p1
  const p3 = points[i + 2] ?? p2
  const lt = scaled - i
  const t2 = lt * lt
  const t3 = t2 * lt
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * lt +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * lt +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

/* ---------------- Ramer–Douglas–Peucker 折线简化 ----------------
   泛型化以保留调用方附加在 Vec 上的额外字段（如 EdgePoint.hidden）——
   简化只丢弃点，不复制/剥离对象，引用透传即可保留额外属性。 */
export function rdp<T extends Vec>(points: T[], epsilon: number): T[] {
  if (points.length < 3) return points.slice()
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return points.filter((point): point is T => point !== undefined)
  let maxDist = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]
    if (!point) continue
    const d = pointToSegment(point, first, last)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon)
    const right = rdp(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [first, last]
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
