/**
 * 空间投影版显著状态视图（从 L2 projection 提取）。
 *
 * 这是一个适配器类型，把 UI 只读视图中的显著状态映射到空间渲染需要的形式。
 */

import type { SalienceTier } from '../../model/profile';

/** 空间投影版显著状态 */
export interface SpatialSalienceView {
  readonly stateSemanticId: string;
  readonly ownerEntityId: string;
  readonly tier: 'critical' | 'warning' | 'info' | 'ambient';
  readonly renderer: string | null;
  readonly accessibleLabel: string;
}