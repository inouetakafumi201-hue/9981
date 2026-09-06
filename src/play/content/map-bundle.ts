import type { CanonicalMapData } from '../map/types'
import type { PresentationProfile } from '../../ui/model/profile'
import {
  validateContentManifest,
  type ContentDiagnostic,
  type ContentEntry,
  type ContentManifest,
} from './content-manifest'
import { validatePlayFile, type PlayFile } from './play-file'

export const MAP_BUNDLE_SCHEMA_VERSION = '1.0' as const

export type MapSessionKind = 'residence' | 'match'

export interface MapBundle {
  readonly schemaVersion: typeof MAP_BUNDLE_SCHEMA_VERSION
  readonly bundleId: string
  readonly mapId: string
  readonly sessionKind: MapSessionKind
  readonly manifest: ContentManifest
  readonly mapDataEntryId: string
  readonly mapPlayEntryId: string
  readonly presentationProfileEntryId: string
  readonly visualAssetEntryIds: readonly string[]
  readonly entryNodeId: string
  readonly mapData: CanonicalMapData
  readonly mapPlay: PlayFile
  readonly presentationProfile: PresentationProfile
}

export type MapBundleDiagnosticCode =
  | ContentDiagnostic['code']
  | 'INVALID_BUNDLE'
  | 'MISSING_ENTRY'
  | 'ENTRY_KIND_MISMATCH'
  | 'MAP_ID_MISMATCH'
  | 'ENTRY_NODE_MISSING'
  | 'VISUAL_ASSET_UNDECLARED'
  | 'CHECKSUM_MISMATCH'
  | 'RESOURCE_MISSING'
  | 'INVALID_MAP_PLAY'

export interface MapBundleDiagnostic {
  readonly code: MapBundleDiagnosticCode
  readonly message: string
  readonly correction: string
  readonly entryId?: string
}

export interface MapBundleResourcePort {
  /** Read from the bundle root. Paths have already passed traversal validation. */
  read(path: string): Promise<Uint8Array | null>
  sha256(bytes: Uint8Array): Promise<string>
}

export interface VerifiedMapBundle extends MapBundle {
  readonly verified: true
}

export type MapBundleLoadResult =
  | { readonly ok: true; readonly bundle: VerifiedMapBundle }
  | { readonly ok: false; readonly diagnostics: readonly MapBundleDiagnostic[] }

function diagnostic(
  code: MapBundleDiagnosticCode,
  message: string,
  correction: string,
  entryId?: string,
): MapBundleDiagnostic {
  return Object.freeze({ code, message, correction, ...(entryId === undefined ? {} : { entryId }) })
}

function entryById(manifest: ContentManifest, entryId: string): ContentEntry | undefined {
  return manifest.entries.find((entry) => entry.entryId === entryId)
}

function requireEntry(
  diagnostics: MapBundleDiagnostic[],
  manifest: ContentManifest,
  entryId: string,
  expectedKind: ContentEntry['kind'],
): ContentEntry | undefined {
  const entry = entryById(manifest, entryId)
  if (entry === undefined) {
    diagnostics.push(diagnostic('MISSING_ENTRY', `地图包缺少条目：${entryId}`, '在 manifest.entries 中声明该条目。', entryId))
    return undefined
  }
  if (entry.kind !== expectedKind) {
    diagnostics.push(diagnostic('ENTRY_KIND_MISMATCH', `条目 ${entryId} 的 kind 应为 ${expectedKind}，实际为 ${entry.kind}`, '修正条目 kind，禁止按文件扩展名猜测。', entryId))
  }
  return entry
}

export async function validateMapBundle(
  bundle: MapBundle,
  resources?: MapBundleResourcePort,
): Promise<readonly MapBundleDiagnostic[]> {
  const diagnostics: MapBundleDiagnostic[] = validateContentManifest(bundle.manifest).map((item) =>
    diagnostic(item.code, item.message, item.correction, item.entryId),
  )

  if (bundle.schemaVersion !== MAP_BUNDLE_SCHEMA_VERSION || bundle.manifest.contentKind !== 'map-bundle' || bundle.bundleId !== bundle.manifest.contentId) {
    diagnostics.push(diagnostic('INVALID_BUNDLE', '地图包版本、bundleId 或 manifest.contentKind 不一致。', '使用受支持的 1.0 版本，并令 bundleId 等于 manifest.contentId、contentKind 等于 map-bundle。'))
  }
  if (bundle.mapId !== bundle.mapData.id) {
    diagnostics.push(diagnostic('MAP_ID_MISMATCH', `地图包 mapId ${bundle.mapId} 与 MapData.id ${bundle.mapData.id} 不一致。`, '统一 bundle.mapId 与 MapData.id。'))
  }
  if (!bundle.mapData.nodes.some((node) => node.id === bundle.entryNodeId)) {
    diagnostics.push(diagnostic('ENTRY_NODE_MISSING', `入口节点不存在：${bundle.entryNodeId}`, '将 entryNodeId 指向 MapData.nodes 中存在的节点。'))
  }

  requireEntry(diagnostics, bundle.manifest, bundle.mapDataEntryId, 'map-data')
  requireEntry(diagnostics, bundle.manifest, bundle.mapPlayEntryId, 'map-play-file')
  requireEntry(diagnostics, bundle.manifest, bundle.presentationProfileEntryId, 'presentation-profile')

  const declaredVisualPaths = new Set<string>()
  for (const entryId of bundle.visualAssetEntryIds) {
    const entry = requireEntry(diagnostics, bundle.manifest, entryId, 'map-visual-asset')
    if (entry !== undefined) declaredVisualPaths.add(entry.path)
  }
  const backdropPaths = [bundle.mapData.backdrop.image, ...bundle.mapData.layers.flatMap((layer) => layer.backdrop === undefined ? [] : [layer.backdrop.image])]
  for (const path of backdropPaths) {
    if (!declaredVisualPaths.has(path)) {
      diagnostics.push(diagnostic('VISUAL_ASSET_UNDECLARED', `MapData 引用的底图未在 visualAssetEntryIds 声明：${path}`, '把该包内相对路径登记为 map-visual-asset 条目并加入 visualAssetEntryIds。'))
    }
  }

  const playDiagnostics = validatePlayFile(bundle.mapPlay)
  for (const item of playDiagnostics) {
    diagnostics.push(diagnostic('INVALID_MAP_PLAY', `${item.code}: ${item.message}`, '修复 MapPlay 2.0 后重新装载。', item.reference))
  }
  if (bundle.mapPlay.schemaVersion !== '2.0' || bundle.mapPlay.mapBinding?.mapBundleId !== bundle.bundleId || bundle.mapPlay.mapBinding.entryNodeId !== bundle.entryNodeId) {
    diagnostics.push(diagnostic('INVALID_MAP_PLAY', 'MapPlay 必须为 2.0，且 mapBinding 必须指向当前 bundle 与入口节点。', '更新 MapPlay.schemaVersion 和 mapBinding。'))
  }

  if (resources !== undefined) {
    for (const entry of bundle.manifest.entries) {
      const bytes = await resources.read(entry.path)
      if (bytes === null) {
        diagnostics.push(diagnostic('RESOURCE_MISSING', `包内资源不存在：${entry.path}`, '补齐资源文件，禁止回退到包外 URL。', entry.entryId))
        continue
      }
      const actual = (await resources.sha256(bytes)).toLowerCase()
      if (actual !== entry.checksum.value.toLowerCase()) {
        diagnostics.push(diagnostic('CHECKSUM_MISMATCH', `资源校验和不一致：${entry.path}`, '重新生成 sha256 清单或恢复被修改的资源。', entry.entryId))
      }
    }
  }

  return Object.freeze(diagnostics)
}

/** 唯一地图包装载门禁。只有结构、引用、资源存在性与 checksum 全部通过才返回可装载真身。 */
export async function loadMapBundle(
  bundle: MapBundle,
  resources: MapBundleResourcePort,
): Promise<MapBundleLoadResult> {
  const diagnostics = await validateMapBundle(bundle, resources)
  if (diagnostics.length > 0) return Object.freeze({ ok: false as const, diagnostics })
  return Object.freeze({ ok: true as const, bundle: Object.freeze({ ...bundle, verified: true as const }) })
}
