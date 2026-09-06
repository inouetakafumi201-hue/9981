/** Content taxonomy and manifest boundary. Carrier format is deliberately out of scope. */
export type ContentKind =
  | 'play-layer'
  | 'play-file'
  | 'map-data'
  | 'map-visual-asset'
  | 'map-play-file'
  | 'presentation-profile'
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
  readonly code: 'INVALID_MANIFEST' | 'DUPLICATE_ENTRY' | 'INVALID_PATH' | 'INVALID_CHECKSUM' | 'EXECUTABLE_ENTRY' | 'MISSING_DEPENDENCY' | 'INCOMPATIBLE_VERSION'
  readonly message: string
  readonly correction: string
  readonly entryId?: string
}

const ALLOWED_KINDS = new Set<ContentKind>([
  'play-layer', 'play-file', 'map-data', 'map-visual-asset', 'map-play-file',
  'presentation-profile', 'map-bundle', 'map-bound-playpack', 'content-manifest',
])
const ALLOWED_FORMATS = new Set<ContentFormat>(['json', 'image', 'audio', 'animation', 'binary'])
const EXECUTABLE_SUFFIX = /\.(?:js|mjs|cjs|ts|wasm|dll|exe)$/i

export function validateContentManifest(manifest: ContentManifest): readonly ContentDiagnostic[] {
  const diagnostics: ContentDiagnostic[] = []
  if (!manifest.schemaVersion || !manifest.contentId || !manifest.version || !ALLOWED_KINDS.has(manifest.contentKind)) {
    diagnostics.push({ code: 'INVALID_MANIFEST', message: '内容清单缺少必填字段或 contentKind 无效。', correction: '补齐版本、内容身份与受支持的 contentKind。' })
  }
  const seen = new Set<string>()
  for (const entry of manifest.entries) {
    if (seen.has(entry.entryId)) diagnostics.push({ code: 'DUPLICATE_ENTRY', entryId: entry.entryId, message: `重复内容条目：${entry.entryId}`, correction: '为每个条目分配唯一 entryId。' })
    seen.add(entry.entryId)
    const segments = entry.path.split('/')
    const invalidPath = entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.includes('://') || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    if (invalidPath) diagnostics.push({ code: 'INVALID_PATH', entryId: entry.entryId, message: `内容路径必须是包根内的规范相对路径：${entry.path}`, correction: '使用不含协议、反斜杠、空段、. 或 .. 的包内相对路径。' })
    if (!/^[a-f0-9]{64}$/i.test(entry.checksum.value)) {
      diagnostics.push({ code: 'INVALID_CHECKSUM', entryId: entry.entryId, message: `sha256 格式无效：${entry.entryId}`, correction: '写入 64 位十六进制 sha256。' })
    }
    if (!ALLOWED_FORMATS.has(entry.format) || entry.format === 'binary' || EXECUTABLE_SUFFIX.test(entry.path)) {
      diagnostics.push({ code: 'EXECUTABLE_ENTRY', entryId: entry.entryId, message: `内容条目不是允许的非执行资源：${entry.path}`, correction: '移除可执行文件，只保留声明式数据与媒体资源。' })
    }
  }
  return Object.freeze(diagnostics)
}
