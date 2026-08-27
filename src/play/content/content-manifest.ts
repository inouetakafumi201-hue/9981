/** Content taxonomy and manifest boundary. Carrier format is deliberately out of scope. */
export type ContentKind =
  | 'play-layer'
  | 'play-file'
  | 'map-data'
  | 'map-visual-asset'
  | 'map-play-file'
  | 'map-bundle'
  | 'map-bound-playpack'
  | 'content-manifest'

export type LoadPolicy = 'eager' | 'deferred' | 'index-only'
export type ContentFormat = 'json' | 'image' | 'audio' | 'animation' | 'binary'
export type ContentSource = 'official' | 'ugc' | 'llm-generated' | 'player-uploaded'

export interface ContentDependency {
  readonly contentId: string
  readonly versionRange: string
  readonly required: boolean
  readonly loadPolicy: LoadPolicy
}

export interface ContentEntry {
  readonly entryId: string
  readonly kind: ContentKind
  readonly path: string
  readonly format: ContentFormat
  readonly loadPolicy: LoadPolicy
  readonly checksum: { readonly algorithm: 'sha256'; readonly value: string }
}

export interface ContentManifest {
  readonly schemaVersion: string
  readonly contentId: string
  readonly contentKind: ContentKind
  readonly version: string
  readonly compatibility: { readonly engine: string; readonly ui?: string }
  readonly dependencies: readonly ContentDependency[]
  readonly entries: readonly ContentEntry[]
  readonly security: { readonly source: ContentSource; readonly executableCode: false }
}

export interface ContentDiagnostic {
  readonly code: 'INVALID_MANIFEST' | 'DUPLICATE_ENTRY' | 'INVALID_PATH' | 'EXECUTABLE_ENTRY' | 'MISSING_DEPENDENCY' | 'INCOMPATIBLE_VERSION'
  readonly message: string
  readonly entryId?: string
}

const ALLOWED_KINDS = new Set<ContentKind>([
  'play-layer', 'play-file', 'map-data', 'map-visual-asset', 'map-play-file',
  'map-bundle', 'map-bound-playpack', 'content-manifest',
])
const ALLOWED_FORMATS = new Set<ContentFormat>(['json', 'image', 'audio', 'animation', 'binary'])
const EXECUTABLE_SUFFIX = /\.(?:js|mjs|cjs|ts|wasm|dll|exe)$/i

export function validateContentManifest(manifest: ContentManifest): readonly ContentDiagnostic[] {
  const diagnostics: ContentDiagnostic[] = []
  if (!manifest.schemaVersion || !manifest.contentId || !manifest.version || !ALLOWED_KINDS.has(manifest.contentKind)) {
    diagnostics.push({ code: 'INVALID_MANIFEST', message: '内容清单缺少必填字段或 contentKind 无效。' })
  }
  const seen = new Set<string>()
  for (const entry of manifest.entries) {
    if (seen.has(entry.entryId)) diagnostics.push({ code: 'DUPLICATE_ENTRY', entryId: entry.entryId, message: `重复内容条目：${entry.entryId}` })
    seen.add(entry.entryId)
    if (entry.path.startsWith('/') || entry.path.includes('..')) diagnostics.push({ code: 'INVALID_PATH', entryId: entry.entryId, message: `内容路径必须限制在包根内：${entry.path}` })
    if (!ALLOWED_FORMATS.has(entry.format) || EXECUTABLE_SUFFIX.test(entry.path)) {
      diagnostics.push({ code: 'EXECUTABLE_ENTRY', entryId: entry.entryId, message: `内容条目不是允许的非执行资源：${entry.path}` })
    }
  }
  return Object.freeze(diagnostics)
}
