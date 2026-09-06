import { createHash } from 'node:crypto'

import { loadMapBundle, type MapBundle, type MapBundleResourcePort, type MapSessionKind, type VerifiedMapBundle } from '../../../src/play/content/map-bundle.js'
import { normalizeMapDocument } from '../../../src/play/map/types.js'
import type { PresentationProfile } from '../../../src/ui/model/profile.js'
import { makeInternalMetric } from '../../../src/ui/presentation/gameplay-value.js'
import { testMap } from './fixtures.js'

const encoder = new TextEncoder()

const profile: PresentationProfile = {
  version: '1.1.0',
  visualDirection: { interactionComponents: 'pixel-art', mapBackground: 'svg-sketch', compositing: 'separated', authoritativeSource: 'D-024' },
  ceremonialActionSemantics: [], salienceTiers: [],
  turnOrderBar: { edge: 'left', persistent: true, entryFields: ['name'], spentEntryTreatment: 'desaturate', rollAnimationAnchor: 'entry', authoritativeSource: 'D-035,D-036' },
  endTurnCountdown: { seconds: makeInternalMetric(3, 's'), cancellable: true, authoritativeSource: 'D-042' },
  safeFieldWhitelist: [], safeUnavailabilityReasons: {}, eventBufferTimeout: makeInternalMetric(1000, 'ms'),
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function realMapBundleFixture(sessionKind: MapSessionKind): {
  readonly bundle: MapBundle
  readonly resources: MapBundleResourcePort
} {
  const bundleId = `bundle:${sessionKind}`
  const backdropPath = `visual/${sessionKind}.svg`
  const mapData = normalizeMapDocument({
    ...testMap(),
    name: sessionKind === 'residence' ? '出租屋验收图' : '局内验收图',
    backdrop: { ...testMap().backdrop, image: backdropPath },
  })
  const mapPlay = {
    schemaVersion: '2.0' as const,
    playFileId: `play:${sessionKind}`,
    requires: [],
    mapBinding: { mapBundleId: bundleId, entryNodeId: 'n:map-a' },
    scheduleId: sessionKind === 'residence' ? 'schedule:residence' : 'schedule:play.core',
    phaseBindings: [], triggers: [], presentations: [], outcomes: [], lifecycle: [],
  }
  const resourceBytes = new Map<string, Uint8Array>([
    ['data/map.json', encoder.encode(JSON.stringify(mapData))],
    ['play/map-play.json', encoder.encode(JSON.stringify(mapPlay))],
    ['presentation/profile.json', encoder.encode(JSON.stringify(profile))],
    [backdropPath, encoder.encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="#111827"/></svg>`) ],
  ])
  const entry = (entryId: string, kind: 'map-data' | 'map-play-file' | 'presentation-profile' | 'map-visual-asset', path: string, format: 'json' | 'image') => ({
    entryId, kind, path, format, loadPolicy: 'eager' as const,
    checksum: { algorithm: 'sha256' as const, value: sha256(resourceBytes.get(path)!) },
  })
  const bundle: MapBundle = {
    schemaVersion: '1.0', bundleId, mapId: mapData.id, sessionKind,
    manifest: {
      schemaVersion: '1.0', contentId: bundleId, contentKind: 'map-bundle', version: '1.0.0',
      compatibility: { engine: '0.1.x', ui: '1.x' }, dependencies: [],
      entries: [
        entry('map', 'map-data', 'data/map.json', 'json'),
        entry('play', 'map-play-file', 'play/map-play.json', 'json'),
        entry('profile', 'presentation-profile', 'presentation/profile.json', 'json'),
        entry('backdrop', 'map-visual-asset', backdropPath, 'image'),
      ],
      security: { source: 'official', executableCode: false },
    },
    mapDataEntryId: 'map', mapPlayEntryId: 'play', presentationProfileEntryId: 'profile',
    visualAssetEntryIds: ['backdrop'], entryNodeId: 'n:map-a', mapData, mapPlay, presentationProfile: profile,
  }
  return {
    bundle,
    resources: {
      read: async (path) => resourceBytes.get(path) ?? null,
      sha256: async (bytes) => sha256(bytes),
    },
  }
}

export async function verifiedMapBundle(sessionKind: MapSessionKind): Promise<VerifiedMapBundle> {
  const fixture = realMapBundleFixture(sessionKind)
  const loaded = await loadMapBundle(fixture.bundle, fixture.resources)
  if (!loaded.ok) throw new Error(loaded.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'))
  return loaded.bundle
}
