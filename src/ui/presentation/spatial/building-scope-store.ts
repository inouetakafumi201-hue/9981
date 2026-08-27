/**
 * BuildingScopeStore — P5：建筑视野状态机的运行时包装。
 *
 * 职责：
 * - 持有 `BuildingScopeState` 纯状态机的一份实例
 * - 把外部 action（hover、enter、changeFloor、exit）派发到 reducer
 * - 派生 `BuildingRenderMode` 给消费者直接读
 * - 暴露 React-friendly subscribe/unsubscribe，让 UI 层使用
 *
 * 不责任：
 * - 不发 render command（状态机仅派生展示意图，由 SpatialProjection 决定如何呈现）
 * - 不与 game event 桥接（bridge 是 mapId 维度的；本 store 是单 map 的会话级状态）
 */

import {
  INITIAL_BUILDING_SCOPE_STATE,
  reduceBuildingScope,
  resolveBuildingRenderMode,
  type BuildingRenderMode,
  type BuildingScopeAction,
  type BuildingScopeState,
} from './building-scope-state'
import { deepFreeze } from './stores/projection-store'

export type BuildingScopeListener = (
  state: BuildingScopeState,
  mode: BuildingRenderMode,
) => void

export class BuildingScopeStore {
  private state: BuildingScopeState = INITIAL_BUILDING_SCOPE_STATE
  private listeners = new Set<BuildingScopeListener>()

  readonly debugName: string = 'BuildingScopeStore'

  current(): { readonly state: BuildingScopeState; readonly mode: BuildingRenderMode } {
    return deepFreeze({ state: this.state, mode: resolveBuildingRenderMode(this.state) })
  }

  dispatch(action: BuildingScopeAction): BuildingRenderMode {
    this.state = reduceBuildingScope(this.state, action)
    const mode = resolveBuildingRenderMode(this.state)
    for (const l of this.listeners) l(this.state, mode)
    return mode
  }

  reset(): void {
    this.state = INITIAL_BUILDING_SCOPE_STATE
    const mode = resolveBuildingRenderMode(this.state)
    for (const l of this.listeners) l(this.state, mode)
  }

  subscribe(listener: BuildingScopeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  isDisposed(): boolean {
    return false
  }

  dispose(): void {
    this.listeners.clear()
  }
}
