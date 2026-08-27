/** Pure building/floor presentation state machine for the runtime presentation layer. */

export type PlayerScope = 'exterior' | 'transition' | 'occupied'

export interface BuildingScopeState {
  readonly playerScope: PlayerScope
  readonly hoveredBuildingId: string | null
  readonly previewFloorId: string | null
  readonly lockedBuildingId: string | null
  readonly lockedFloorId: string | null
}

export type BuildingScopeAction =
  | { readonly type: 'hoverBuilding'; readonly buildingId: string | null }
  | { readonly type: 'previewFloor'; readonly floorId: string | null }
  | { readonly type: 'enterBuilding'; readonly buildingId: string; readonly floorId?: string | null }
  | { readonly type: 'changeFloor'; readonly floorId: string }
  | { readonly type: 'beginTransition'; readonly buildingId: string; readonly floorId?: string | null }
  | { readonly type: 'exitBuilding' }
  | { readonly type: 'clearTransition' }

export const INITIAL_BUILDING_SCOPE_STATE: BuildingScopeState = Object.freeze({
  playerScope: 'exterior',
  hoveredBuildingId: null,
  previewFloorId: null,
  lockedBuildingId: null,
  lockedFloorId: null,
})

/** The render mode is deliberately derived by priority, never by caller ordering. */
export type BuildingRenderMode =
  | { readonly kind: 'occupied'; readonly buildingId: string; readonly floorId: string | null }
  | { readonly kind: 'transition'; readonly buildingId: string; readonly floorId: string | null }
  | { readonly kind: 'hover'; readonly buildingId: string; readonly floorId: string | null }
  | { readonly kind: 'exterior' }

export function resolveBuildingRenderMode(state: BuildingScopeState): BuildingRenderMode {
  if (state.playerScope === 'occupied' && state.lockedBuildingId) {
    return { kind: 'occupied', buildingId: state.lockedBuildingId, floorId: state.lockedFloorId }
  }
  if (state.playerScope === 'transition' && state.lockedBuildingId) {
    return { kind: 'transition', buildingId: state.lockedBuildingId, floorId: state.lockedFloorId }
  }
  if (state.hoveredBuildingId) {
    return { kind: 'hover', buildingId: state.hoveredBuildingId, floorId: state.previewFloorId }
  }
  return { kind: 'exterior' }
}

export function reduceBuildingScope(
  state: BuildingScopeState,
  action: BuildingScopeAction,
): BuildingScopeState {
  switch (action.type) {
    case 'hoverBuilding':
      return { ...state, hoveredBuildingId: action.buildingId }
    case 'previewFloor':
      return { ...state, previewFloorId: action.floorId }
    case 'enterBuilding':
      return {
        ...state,
        playerScope: 'occupied',
        lockedBuildingId: action.buildingId,
        lockedFloorId: action.floorId ?? state.lockedFloorId,
      }
    case 'changeFloor':
      return { ...state, lockedFloorId: action.floorId }
    case 'beginTransition':
      return {
        ...state,
        playerScope: 'transition',
        lockedBuildingId: action.buildingId,
        lockedFloorId: action.floorId ?? state.lockedFloorId,
      }
    case 'clearTransition':
      return { ...state, playerScope: state.lockedBuildingId ? 'occupied' : 'exterior' }
    case 'exitBuilding':
      return {
        ...state,
        playerScope: 'exterior',
        lockedBuildingId: null,
        lockedFloorId: null,
        hoveredBuildingId: null,
        previewFloorId: null,
      }
  }
}
