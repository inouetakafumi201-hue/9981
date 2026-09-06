import { describe, expect, it } from 'vitest'
import type { PresentationProfile } from '../../ui/model/profile'
import { validateMapBundle, type MapBundle } from '../content/map-bundle'
import type { ContentEntry, ContentManifest } from '../content/content-manifest'

const checksum = 'a'.repeat(64)
const entries: ContentEntry[] = [
  { entryId: 'map', kind: 'map-data', path: 'data/map.json', format: 'json', loadPolicy: 'eager', checksum: { algorithm: 'sha256', value: checksum } },
  { entryId: 'play', kind: 'map-play-file', path: 'play/map-play.json', format: 'json', loadPolicy: 'eager', checksum: { algorithm: 'sha256', value: checksum } },
  { entryId: 'profile', kind: 'presentation-profile', path: 'presentation/profile.json', format: 'json', loadPolicy: 'eager', checksum: { algorithm: 'sha256', value: checksum } },
  { entryId: 'backdrop', kind: 'map-visual-asset', path: 'visual/residence.svg', format: 'image', loadPolicy: 'eager', checksum: { algorithm: 'sha256', value: checksum } },
]
const manifest: ContentManifest = {
  schemaVersion: '1.0', contentId: 'bundle:residence', contentKind: 'map-bundle', version: '1.0.0',
  compatibility: { engine: '0.1.x', ui: '1.x' }, dependencies: [], entries,
  security: { source: 'official', executableCode: false },
}
const mapData = {
  schemaVersion: '2.0' as const, id: 'map:residence', name: '出租屋',
  backdrop: { image: 'visual/residence.svg', pixelWidth: 1024, pixelHeight: 768, tileRows: 1, tileCols: 1 },
  layers: [{ id: 'main', name: '主层' }],
  nodes: [{ id: 'bedroom', def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.5, y: 0.5 }, layerId: 'main' }],
  edges: [], placements: [],
}
const mapPlay = {
  schemaVersion: '2.0' as const, playFileId: 'play:residence', requires: [],
  mapBinding: { mapBundleId: 'bundle:residence', entryNodeId: 'bedroom' }, scheduleId: 'schedule:residence',
  phaseBindings: [], triggers: [], presentations: [], outcomes: [], lifecycle: [],
}
const bundle: MapBundle = {
  schemaVersion: '1.0', bundleId: 'bundle:residence', mapId: 'map:residence', sessionKind: 'residence',
  manifest, mapDataEntryId: 'map', mapPlayEntryId: 'play', presentationProfileEntryId: 'profile',
  visualAssetEntryIds: ['backdrop'], entryNodeId: 'bedroom', mapData, mapPlay,
  presentationProfile: {} as PresentationProfile,
}

describe('MapBundle contract', () => {
  it('accepts one self-contained bundle for a residence session', async () => {
    expect(await validateMapBundle(bundle)).toEqual([])
  })

  it('rejects traversal, undeclared visuals, missing resources and checksum drift', async () => {
    const unsafe = { ...bundle, mapData: { ...mapData, backdrop: { ...mapData.backdrop, image: '../outside.svg' } } }
    const diagnostics = await validateMapBundle(unsafe, {
      read: async (path) => path === 'visual/residence.svg' ? null : new Uint8Array([1]),
      sha256: async () => 'b'.repeat(64),
    })
    expect(diagnostics.map((item) => item.code)).toContain('VISUAL_ASSET_UNDECLARED')
    expect(diagnostics.map((item) => item.code)).toContain('RESOURCE_MISSING')
    expect(diagnostics.map((item) => item.code)).toContain('CHECKSUM_MISMATCH')
  })
})
