/**
 * 涂鸦式交互的纯几何函数（`01` §八「图元穷举」「涂鸦式交互」「场景框聚合」「空洞全填」「粘连判定」）。
 *
 * 这些是编辑器行为规则，不是 `MapData` 契约本身。涂鸦合并 / 空洞全填是「视觉 + 校验上的假合并」
 * （阴影绘制 + 区域判定），存储不写虚假矩形——空洞全填只影响"能否在此放新场景节点"的判定。
 */
import type { Vec2 } from '../ports/map-contracts.js';

/** 归一化轴对齐矩形（可带旋转角，度）。 */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rotation: number; // 度，绕中心
}

/** 把矩形四角（含旋转）展开为顶点列表。 */
export function boxCorners(box: Box): readonly Vec2[] {
  const rad = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const hw = box.w / 2;
  const hh = box.h / 2;
  const local: readonly Vec2[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return local.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

/** 两个轴对齐矩形是否相交（含边接触）。 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 同类型框重叠 = 合并（涂鸦式交互）：多拖几个矩形，同类型重叠不报错、效果一致；
 * 重叠后合并为一个图形、边界消失。返回合并后的单个外接矩形（旋转归零）。
 */
export function mergeSameType(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0, rotation: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    for (const c of boxCorners(box)) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0 };
}

/**
 * 场景框聚合 = 场景：连在一起的多个框视为一个场景。
 * 返回该场景的全部成员框（与 `sceneId` 相连的框集合，含自身）。
 */
export function sceneMemberBoxes(sceneBoxes: readonly Box[], sceneId: number): readonly Box[] {
  const box = sceneBoxes[sceneId];
  if (!box) return [];
  const members: Box[] = [box];
  const visited = new Set<number>([sceneId]);
  // 广度优先：与任一成员相交的框并入同一场景
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sceneBoxes.length; i++) {
      if (visited.has(i)) continue;
      if (members.some((m) => boxesOverlap(m, sceneBoxes[i]!))) {
        members.push(sceneBoxes[i]!);
        visited.add(i);
        changed = true;
      }
    }
  }
  return members;
}

/**
 * 高光点：一个场景（多个场景框聚合）的「最大距离矩形中心」。
 * 取所有成员框外接矩形的中心，作为连线拖出锚点。
 */
export function highlightPoint(members: readonly Box[]): Vec2 {
  if (members.length === 0) return { x: 0.5, y: 0.5 };
  const merged = mergeSameType(members);
  return { x: merged.x + merged.w / 2, y: merged.y + merged.h / 2 };
}

/** 点是否在矩形内（含旋转）。框顺时针转 `rotation` 度 → 把世界点反向转回框局部坐标系再判轴对齐包含。 */
export function pointInBox(point: Vec2, box: Box): boolean {
  // 框绕中心转了 +θ，世界点要转回局部需乘逆旋转 [-θ]，即矩阵 [cosθ, sinθ; -sinθ, cosθ]。
  const rad = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= box.w / 2 + 1e-9 && Math.abs(ly) <= box.h / 2 + 1e-9;
}

/**
 * 空洞全填（仅对场景框生效）：若场景框形成内部封闭空洞，视觉上像油漆桶般被填充、
 * 逻辑上该区域是场景的一部分、不可在其中放置其他场景节点。
 *
 * 判定：点落在"被场景框包围但不在任何场景框内部"的区域 → 视为空洞（场景一部分）。
 * 用射线法：从点向右发射，与场景框边界相交次数为奇数 → 在封闭区域内。
 */
export function isInsideHole(sceneBoxes: readonly Box[], point: Vec2): boolean {
  // 若点本身落在某个场景框内，不是空洞（是场景实体区域）。
  if (sceneBoxes.some((b) => pointInBox(point, b))) return false;
  // 射线法：统计与所有场景框边界的交点（奇数次 = 在封闭区域内）。
  let crossings = 0;
  for (const box of sceneBoxes) {
    const corners = boxCorners(box);
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % corners.length]!;
      if ((a.y > point.y) !== (b.y > point.y)) {
        const xAtY = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (point.x < xAtY) crossings++;
      }
    }
  }
  return crossings % 2 === 1;
}

/**
 * 粘连判定：若一次场景框拖拽 / 创建把两个已创建的节点（场景）连接了起来，
 * 则此次操作被拒绝（拖了没效果），并给淡出提示。
 *
 * 判定：新框与两个不同既有场景的成员框都相交 → 把两个场景连起来了 → 拒绝。
 */
export function connectsTwoScenes(
  sceneGroups: readonly (readonly Box[])[],
  newBox: Box,
): boolean {
  let touched = 0;
  for (const group of sceneGroups) {
    if (group.some((b) => boxesOverlap(b, newBox))) touched++;
  }
  return touched >= 2;
}