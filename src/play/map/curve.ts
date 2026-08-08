/**
 * 手绘行动曲线的纯几何函数。
 *
 * 这些函数同时被两侧消费：编辑器在拉边时用 `simplifyPath` 压掉采样噪声，运行期用
 * `resamplePath`/`pathLength` 沿曲线做移动动画。放在 `src/play/map/` 而不是 `src/editor/`，
 * 是因为运行期确实需要它们——若放进编辑器目录，`src/play/** 禁止 import src/editor/**`
 * 这条约束会立刻被违反，而那条约束是"删掉编辑器游戏照常跑"的机械保证。
 *
 * 全部函数对归一化坐标（[0,1]）工作，不含任何像素假设。
 */
import type { Vec2 } from './types.js';

/** 两点距离。 */
export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 折线总长。少于两点时为 0。 */
export function pathLength(path: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distance(path[i - 1] as Vec2, path[i] as Vec2);
  }
  return total;
}

/** 点到线段的垂直距离。线段退化为一点时取点距。 */
export function perpendicularDistance(point: Vec2, lineStart: Vec2, lineEnd: Vec2): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, lineStart);

  // 投影参数夹紧到 [0,1]，使距离在端点外侧也取到端点距而非无限延长线距离。
  const raw = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const projected: Vec2 = { x: lineStart.x + t * dx, y: lineStart.y + t * dy };
  return distance(point, projected);
}

/**
 * Ramer–Douglas–Peucker 折线简化。
 *
 * 迭代实现而非递归：创作者一次拖拽可能产出数千个原始采样点，递归版在长直线段上会退化成
 * 深度等于点数的调用链而爆栈。首尾两点永远保留——它们已经精确吸附到节点中心，任何简化都
 * 不得移动它们，否则校验器会判出"边端点不存在"。
 *
 * epsilon 不暴露给创作者（见 06_创作系统与产权 第九节）：固定值即可，不满意用控制点手调。
 */
export function simplifyPath(path: readonly Vec2[], epsilon: number): readonly Vec2[] {
  if (path.length <= 2 || epsilon <= 0) return [...path];

  const keep = new Array<boolean>(path.length).fill(false);
  keep[0] = true;
  keep[path.length - 1] = true;

  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length > 0) {
    const segment = stack.pop() as [number, number];
    const [first, last] = segment;
    if (last <= first + 1) continue;

    let farthest = -1;
    let maxDistance = 0;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(path[i] as Vec2, path[first] as Vec2, path[last] as Vec2);
      if (d > maxDistance) {
        maxDistance = d;
        farthest = i;
      }
    }

    if (maxDistance > epsilon && farthest !== -1) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return path.filter((_, index) => keep[index] === true);
}

/**
 * 等距重采样为恰好 count 个点，用于把不等距的手绘点变成匀速动画帧。
 *
 * count < 2 或路径退化时返回原路径的拷贝，不抛异常——运行期动画不该因为一条畸形边而崩掉
 * 整局游戏（这与"玩法包级错误只警告"的报错分级一致）。
 */
export function resamplePath(path: readonly Vec2[], count: number): readonly Vec2[] {
  if (path.length < 2 || count < 2) return [...path];
  const total = pathLength(path);
  if (total === 0) return [...path];

  const step = total / (count - 1);
  const result: Vec2[] = [path[0] as Vec2];
  let segmentIndex = 1;
  let walked = 0;

  for (let i = 1; i < count - 1; i++) {
    const target = i * step;
    // 前进到包含 target 的线段。
    while (segmentIndex < path.length - 1) {
      const segLength = distance(path[segmentIndex - 1] as Vec2, path[segmentIndex] as Vec2);
      if (walked + segLength >= target) break;
      walked += segLength;
      segmentIndex++;
    }
    const from = path[segmentIndex - 1] as Vec2;
    const to = path[segmentIndex] as Vec2;
    const segLength = distance(from, to);
    const t = segLength === 0 ? 0 : (target - walked) / segLength;
    result.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }

  result.push(path[path.length - 1] as Vec2);
  return result;
}

/**
 * 在折线上插入一个控制点：找到离 point 最近的线段，在其后插入。
 * 返回新数组；原数组不变。用于编辑器"双击曲线插入控制点"。
 */
export function insertControlPoint(path: readonly Vec2[], point: Vec2): readonly Vec2[] {
  if (path.length < 2) return [...path, point];

  let bestIndex = 1;
  let bestDistance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = perpendicularDistance(point, path[i - 1] as Vec2, path[i] as Vec2);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return [...path.slice(0, bestIndex), point, ...path.slice(bestIndex)];
}

/**
 * 找出吸附半径内离 point 最近的节点。
 *
 * 只在松手时调用，中间采样点永不吸附——否则一条曲线绕过某个节点旁边时会被它抢走
 * （见 06_创作系统与产权 第九节拉边流程第 6 条）。
 */
export function findSnapTarget<T extends { readonly id: string; readonly at: Vec2 }>(
  candidates: readonly T[],
  point: Vec2,
  radius: number,
): T | null {
  let best: T | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    const d = distance(point, candidate.at);
    if (d <= bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}
