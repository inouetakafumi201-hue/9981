import { describe, expect, it } from 'vitest'
import { createPresentationSurface } from '../wiring/presentation-surface'
import type { RenderCommandApi } from '../../ui/presentation/spatial/render-command-api'
import type { SpatialProjection } from '../../ui/presentation/spatial/spatial-view'

const projection: SpatialProjection = {
  revision: 2,
  layers: [],
  nodes: [],
  edges: [],
  entities: [],
  clusters: [],
  tiles: [],
  buildingGroups: [{ id: 'bg:1', frame: { x: 0, y: 0, width: 1, height: 1 }, shell: 'shell:test', floors: [{ id: 'bf:1', ordinal: 1, height: 2, image: undefined, nodeIds: [] }] }],
  buildingRenderMode: { kind: 'exterior' as const },
}

const commands = {} as RenderCommandApi

describe('PresentationSurface', () => {
  it('freezes the projection boundary without exposing writes', () => {
    const surface = createPresentationSurface(() => ({ ok: true, value: projection, diagnostics: [] }), commands)
    const result = surface.projection()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true)
      expect(Object.isFrozen(result.value.nodes)).toBe(true)
    }
    expect(surface.commands).toBe(commands)
  })
})
