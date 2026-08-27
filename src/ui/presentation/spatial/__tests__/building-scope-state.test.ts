import { describe, expect, it } from 'vitest'
import {
  INITIAL_BUILDING_SCOPE_STATE,
  reduceBuildingScope,
  resolveBuildingRenderMode,
} from '../building-scope-state'

describe('building presentation scope state machine', () => {
  it('resolves occupied > transition > hover > exterior', () => {
    const hovered = reduceBuildingScope(INITIAL_BUILDING_SCOPE_STATE, { type: 'hoverBuilding', buildingId: 'b-hover' })
    expect(resolveBuildingRenderMode(hovered)).toEqual({ kind: 'hover', buildingId: 'b-hover', floorId: null })

    const transitioning = reduceBuildingScope(hovered, { type: 'beginTransition', buildingId: 'b-locked', floorId: 'f-1' })
    expect(resolveBuildingRenderMode(transitioning)).toEqual({ kind: 'transition', buildingId: 'b-locked', floorId: 'f-1' })

    const occupied = reduceBuildingScope(transitioning, { type: 'enterBuilding', buildingId: 'b-locked', floorId: 'f-2' })
    expect(resolveBuildingRenderMode(occupied)).toEqual({ kind: 'occupied', buildingId: 'b-locked', floorId: 'f-2' })
  })

  it('keeps the entered building profile after pointer leaves', () => {
    let state = reduceBuildingScope(INITIAL_BUILDING_SCOPE_STATE, { type: 'enterBuilding', buildingId: 'b1', floorId: 'f1' })
    state = reduceBuildingScope(state, { type: 'hoverBuilding', buildingId: null })
    expect(resolveBuildingRenderMode(state)).toEqual({ kind: 'occupied', buildingId: 'b1', floorId: 'f1' })
  })

  it('floor changes only affect the locked building and exit restores exterior shell', () => {
    let state = reduceBuildingScope(INITIAL_BUILDING_SCOPE_STATE, { type: 'enterBuilding', buildingId: 'b1', floorId: 'f1' })
    state = reduceBuildingScope(state, { type: 'changeFloor', floorId: 'f2' })
    expect(resolveBuildingRenderMode(state)).toEqual({ kind: 'occupied', buildingId: 'b1', floorId: 'f2' })
    state = reduceBuildingScope(state, { type: 'exitBuilding' })
    expect(state).toEqual(INITIAL_BUILDING_SCOPE_STATE)
    expect(resolveBuildingRenderMode(state)).toEqual({ kind: 'exterior' })
  })
})
