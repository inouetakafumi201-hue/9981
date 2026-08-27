/**
 * BuildingScopeStore × PresentationRuntime integration:
 * dispatches update the projection.buildingRenderMode.
 */
import { describe, expect, it } from 'vitest'
import { BuildingScopeStore } from '../building-scope-store'
import { reduceBuildingScope, resolveBuildingRenderMode, type BuildingScopeState } from '../building-scope-state'

describe('building-scope integration with projection', () => {
  it('transition + reset cycles through every render mode', () => {
    const store = new BuildingScopeStore()
    const modes: string[] = []
    store.subscribe((_s, m) => modes.push(m.kind))

    store.dispatch({ type: 'hoverBuilding', buildingId: 'a' })
    store.dispatch({ type: 'enterBuilding', buildingId: 'a' })
    store.dispatch({ type: 'changeFloor', floorId: 'a:2' })
    store.dispatch({ type: 'beginTransition', buildingId: 'a' })
    store.dispatch({ type: 'clearTransition' })
    store.dispatch({ type: 'exitBuilding' })

    expect(modes).toEqual([
      'hover',
      'occupied',
      'occupied',
      'transition',
      'occupied',
      'exterior',
    ])
  })

  it('reset() returns the store to the initial state and notifies listeners', () => {
    const store = new BuildingScopeStore()
    store.dispatch({ type: 'enterBuilding', buildingId: 'a', floorId: 'a:1' })
    expect(store.current().mode.kind).toBe('occupied')
    let observedMode: string | null = null
    store.subscribe((_s, m) => { observedMode = m.kind })
    store.reset()
    expect(store.current().mode.kind).toBe('exterior')
    expect(observedMode).toBe('exterior')
  })

  it('reducer never mutates the input state object (pure)', () => {
    const initial: BuildingScopeState = {
      playerScope: 'exterior',
      hoveredBuildingId: null,
      previewFloorId: null,
      lockedBuildingId: null,
      lockedFloorId: null,
    }
    const frozen = Object.freeze({ ...initial })
    const next = reduceBuildingScope(frozen, { type: 'hoverBuilding', buildingId: 'b' })
    expect(next).not.toBe(frozen)
    expect(frozen.hoveredBuildingId).toBeNull()
    expect(next.hoveredBuildingId).toBe('b')
  })

  it('render-mode priority: occupied > transition > hover > exterior', () => {
    const occupied: BuildingScopeState = { playerScope: 'occupied', hoveredBuildingId: 'h', lockedBuildingId: 'l', previewFloorId: null, lockedFloorId: 'l:1' }
    expect(resolveBuildingRenderMode(occupied).kind).toBe('occupied')

    const transition: BuildingScopeState = { playerScope: 'transition', hoveredBuildingId: 'h', lockedBuildingId: 'l', previewFloorId: null, lockedFloorId: 'l:1' }
    expect(resolveBuildingRenderMode(transition).kind).toBe('transition')

    const hover: BuildingScopeState = { playerScope: 'exterior', hoveredBuildingId: 'h', lockedBuildingId: null, previewFloorId: 'h:1', lockedFloorId: null }
    expect(resolveBuildingRenderMode(hover).kind).toBe('hover')

    const exterior: BuildingScopeState = { playerScope: 'exterior', hoveredBuildingId: null, lockedBuildingId: null, previewFloorId: null, lockedFloorId: null }
    expect(resolveBuildingRenderMode(exterior).kind).toBe('exterior')
  })
})
