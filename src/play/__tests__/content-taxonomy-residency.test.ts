import { describe, expect, it } from 'vitest'
import { validateContentManifest, type ContentManifest } from '../content/content-manifest'
import { createContentResidencyManager } from '../content/content-residency'

const manifest: ContentManifest = {
  schemaVersion: '1.0', contentId: 'map:test', contentKind: 'map-bundle', version: '1.0.0',
  compatibility: { engine: '1.x' }, dependencies: [], security: { source: 'official', executableCode: false },
  entries: [
    { entryId: 'map:data', kind: 'map-data', path: 'map.json', format: 'json', loadPolicy: 'eager', checksum: { algorithm: 'sha256', value: 'a'.repeat(64) } },
    { entryId: 'map:backdrop', kind: 'map-visual-asset', path: 'backdrop.png', format: 'image', loadPolicy: 'deferred', checksum: { algorithm: 'sha256', value: 'b'.repeat(64) } },
    { entryId: 'map:index', kind: 'map-play-file', path: 'play.json', format: 'json', loadPolicy: 'index-only', checksum: { algorithm: 'sha256', value: 'c'.repeat(64) } },
  ],
}

describe('content taxonomy and residency', () => {
  it('rejects executable and unsafe paths', () => {
    const diagnostics = validateContentManifest({ ...manifest, entries: [{ ...manifest.entries[0]!, path: '../run', format: 'binary' }] })
    expect(diagnostics.map((item) => item.code)).toEqual(['INVALID_PATH', 'EXECUTABLE_ENTRY'])
  })

  it('keeps index-only separate from resident content', () => {
    const manager = createContentResidencyManager()
    manager.index(manifest)
    expect(manager.request('map:index')).toEqual({ ok: false, code: 'INDEX_ONLY' })
    expect(manager.request('map:backdrop')).toEqual({ ok: true })
    manager.markResident('map:backdrop')
    manager.retain('map:backdrop', 'presentation-window')
    expect(manager.snapshot().visual[0]?.state).toBe('resident')
    manager.release('map:backdrop', 'presentation-window')
    expect(manager.snapshot().visual[0]?.state).toBe('released')
  })
})
