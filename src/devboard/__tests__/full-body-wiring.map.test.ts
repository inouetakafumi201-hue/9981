import { describe, expect, it } from 'vitest'
import { mapDocAdapter } from '../wiring/map-doc-adapter'
import type { MapDoc } from '../editor-shell/lib/map-types'

describe('MapDocAdapter', () => {
  it('preserves topology and semantic fields through canonical conversion', () => {
    const doc: MapDoc = {
      id: 'map:test',
      name: '接线测试地图',
      layers: [{ id: 'layer:0', name: '地面', height: 0 }],
      sceneNodes: [
        { id: 'node:a', name: '入口', scale: 'large', layerId: 'layer:0', at: { x: 320, y: 420 }, def: 'd:scene/large' },
        { id: 'node:b', name: '终点', scale: 'small', layerId: 'layer:0', at: { x: 1000, y: 420 }, def: 'd:scene/small' },
      ],
      sceneBoxes: [],
      edges: [{
        id: 'edge:ab',
        from: 'node:a',
        to: 'node:b',
        directionality: 'bidirectional',
        points: [{ x: 320, y: 420 }, { x: 1000, y: 420 }],
        semanticAnchor: 'highland',
        def: 'd:link/path',
      }],
      obstructions: [],
      terrains: [],
      placements: [{ id: 'placement:one', materialId: 'material:test', sceneId: 'node:a', x: 320, y: 420 }],
    }

    const canonical = mapDocAdapter.docToCanonical(doc)
    const roundTrip = mapDocAdapter.canonicalToDoc(canonical)

    expect(canonical.schemaVersion).toBe('2.0')
    expect(canonical.nodes.map((node) => node.id)).toEqual(['node:a', 'node:b'])
    expect(canonical.edges[0]?.a).toBe('node:a')
    expect(canonical.edges[0]?.b).toBe('node:b')
    expect(canonical.edges[0]?.semanticAnchor).toBe('high')
    expect(canonical.placements[0]?.at).toBe('node:a')
    expect(roundTrip.sceneNodes.map((node) => node.id)).toEqual(['node:a', 'node:b'])
    expect(roundTrip.edges[0]?.from).toBe('node:a')
    expect(roundTrip.edges[0]?.to).toBe('node:b')
    expect(roundTrip.edges[0]?.semanticAnchor).toBe('highland')
  })
})
