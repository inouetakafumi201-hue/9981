/**
 * R12: 焦点遍历 + ARIA 元数据。
 *
 * 设计决策：
 * - FocusTraversal 是纯领域类，不持有 DOM 监听器
 * - keyboard / gamepad 事件由外壳（React/HTML shell）在 DOM 层监听，
 *   调用 FocusTraversal 的方法，更新 runtime.focusIndex
 * - 外壳负责把 runtime.ariaMetadata 渲染到 ARIA live region
 *
 * 焦点顺序规则：
 *   (微场景 occupants 顺序) → (跨天然场景可走节点)
 *   在同一微场景内：先 scene，再 occupants
 */

import type { SpatialProjection } from './spatial-view'

/** 可被聚焦的目标 */
export interface FocusTarget {
  readonly itemId: string
  readonly role: 'scene' | 'entity' | 'edge'
  readonly label: string
}

/** FocusTraversal — 从 SpatialProjection 派生焦点顺序和 ARIA 元数据 */
export class FocusTraversal {
  private _selectedIndex = 0

  /** 从投影派生焦点列表 */
  compute(projection: SpatialProjection): readonly FocusTarget[] {
    const targets: FocusTarget[] = []
    const added = new Set<string>()

    // 微场景内的 occupants
    for (const cluster of projection.clusters) {
      const microScene = projection.nodes.find((n: { id: string }) => n.id === cluster.id)
      if (microScene && !added.has(microScene.id)) {
        added.add(microScene.id)
        targets.push({
          itemId: microScene.id,
          role: 'scene',
          label: (microScene as { name?: string }).name ?? microScene.id,
        })
      }
          for (const entityId of cluster.entityIds) {
            const entity = projection.entities.find((e: { entityId: string }) => e.entityId === entityId)
        if (entity) {
          targets.push({
            itemId: entity.entityId,
            role: 'entity',
            label: (entity as { name?: string }).name ?? entity.entityId,
          })
        }
      }
    }

    // 跨微场景：不在 clusters 中的活跃节点
    for (const node of projection.nodes) {
      if (!added.has(node.id)) {
        targets.push({
          itemId: node.id,
          role: 'scene',
          label: (node as { name?: string }).name ?? node.id,
        })
      }
    }

    return Object.freeze(targets)
  }

  get selectedIndex(): number {
    return this._selectedIndex
  }

  /** 向后向前移动焦点索引 */
  moveFocus(direction: 'next' | 'prev', count: number): number {
    if (count === 0) return this._selectedIndex
    if (direction === 'next') {
      this._selectedIndex = (this._selectedIndex + 1) % count
    } else {
      this._selectedIndex = (this._selectedIndex - 1 + count) % count
    }
    return this._selectedIndex
  }

  /** 直接设置焦点索引 */
  setFocus(index: number): void {
    this._selectedIndex = index
  }

  /** 获取当前焦点目标 */
  currentTarget(targets: readonly FocusTarget[]): FocusTarget | undefined {
    return targets[this._selectedIndex]
  }
}

/** 从 SpatialProjection 生成 ARIA 元数据 */
export function buildAriaMetadata(projection: SpatialProjection | null): readonly FocusTarget[] {
  if (!projection) return []
  return new FocusTraversal().compute(projection)
}
