import { normalizeMapDocument } from '../../../src/play/map/types.js'
import type { VerifiedMapBundle, MapSessionKind } from '../../../src/play/content/map-bundle.js'
import { makeInternalMetric } from '../../../src/ui/presentation/gameplay-value.js'
import type { PresentationProfile } from '../../../src/ui/model/profile.js'
import { testMap } from './fixtures.js'

const checksum = 'a'.repeat(64)

const profile: PresentationProfile = {
  version: '1.1.0',
  visualDirection: { interactionComponents: 'pixel-art', mapBackground: 'svg-sketch', compositing: 'separated', authoritativeSource: 'D-024' },
  ceremonialActionSemantics: [], salienceTiers: [],
  turnOrderBar: { edge: 'left', persistent: true, entryFields: ['name'], spentEntryTreatment: 'desaturate', rollAnimationAnchor: 'entry', authoritativeSource: 'D-035,D-036' },
  endTurnCountdown: { seconds: makeInternalMetric(3, 's'), cancellable: true, authoritativeSource: 'D-042' },
  safeFieldWhitelist: [], safeUnavailabilityReasons: {}, eventBufferTimeout: makeInternalMetric(1000, 'ms'),
}

export function verifiedMapBundle(sessionKind: MapSessionKind): VerifiedMapBundle {
  const bundleId = `bundle:${sessionKind}`
  const mapData = normalizeMapDocument({ ...testMap(), name: sessionKind === 'residence' ? '出租屋验收图' : '局内验收图' })
  const entries = [
    { entryId: 'map', kind: 'map-data' as const, path: 'data/map.json', format: 'json' as const, loadPolicy: 'eager' as const, checksum: { algorithm: 'sha256' as const, value: checksum } },
    { entryId: 'play', kind: 'map-play-file' as const, path: 'play/map-play.json', format: 'json' as const, loadPolicy: 'eager' as const, checksum: { algorithm: 'sha256' as const, value: checksum } },
    { entryId: 'profile', kind: 'presentation-profile' as const, path: 'presentation/profile.json', format: 'json' as const, loadPolicy: 'eager' as const, checksum: { algorithm: 'sha256' as const, value: checksum } },
    { entryId: 'backdrop', kind: 'map-visual-asset' as const, path: 'backdrop.png', format: 'image' as const, loadPolicy: 'eager' as const, checksum: { algorithm: 'sha256' as const, value: checksum } },
  ]
  return Object.freeze({
    verified: true as const, schemaVersion: '1.0' as const, bundleId, mapId: mapData.id, sessionKind,
    manifest: { schemaVersion: '1.0', contentId: bundleId, contentKind: 'map-bundle' as const, version: '1.0.0', compatibility: { engine: '0.1.x', ui: '1.x' }, dependencies: [], entries, security: { source: 'official' as const, executableCode: false as const } },
    mapDataEntryId: 'map', mapPlayEntryId: 'play', presentationProfileEntryId: 'profile', visualAssetEntryIds: ['backdrop'], entryNodeId: 'n:map-a', mapData,
    mapPlay: { schemaVersion: '2.0' as const, playFileId: `play:${sessionKind}`, requires: [], mapBinding: { mapBundleId: bundleId, entryNodeId: 'n:map-a' }, scheduleId: sessionKind === 'residence' ? 'schedule:residence' : 'schedule:play.core', phaseBindings: [], triggers: [], presentations: [], outcomes: [], lifecycle: [] },
    presentationProfile: profile,
  })
}
