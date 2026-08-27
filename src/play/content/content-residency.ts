import type { ContentEntry, ContentKind, ContentManifest, LoadPolicy } from './content-manifest'

export type ResidencyState = 'indexed' | 'loading' | 'resident' | 'failed' | 'released'
export type ResidencyDomain = 'logical' | 'visual' | 'runtimeObject'

export interface ResidencyEntry {
  readonly entryId: string
  readonly kind: ContentKind
  readonly policy: LoadPolicy
  readonly state: ResidencyState
  readonly refCount: number
  readonly revision: number
  readonly failureCode?: string
}

export interface ContentResidencySnapshot {
  readonly logical: readonly ResidencyEntry[]
  readonly visual: readonly ResidencyEntry[]
  readonly runtimeObject: readonly ResidencyEntry[]
}

function domainOf(kind: ContentKind): ResidencyDomain {
  return kind === 'map-visual-asset' ? 'visual' : kind === 'map-data' || kind === 'play-layer' || kind === 'play-file' || kind === 'map-play-file' ? 'logical' : 'runtimeObject'
}

export interface ContentResidencyManager {
  index(manifest: ContentManifest): void
  request(entryId: string): { readonly ok: true } | { readonly ok: false; readonly code: 'UNKNOWN_ENTRY' | 'INDEX_ONLY' }
  retain(entryId: string, owner: string): boolean
  release(entryId: string, owner: string): boolean
  markResident(entryId: string): boolean
  markFailed(entryId: string, failureCode: string): boolean
  snapshot(): ContentResidencySnapshot
}

export function createContentResidencyManager(): ContentResidencyManager {
  const entries = new Map<string, { entry: ContentEntry; state: ResidencyState; owners: Set<string>; revision: number; failureCode?: string }>()
  const owners = new Map<string, Set<string>>()
  let revision = 0
  const bump = () => { revision += 1; return revision }

  return {
    index(manifest) {
      for (const entry of manifest.entries) {
        entries.set(entry.entryId, { entry, state: 'indexed', owners: new Set(), revision: bump() })
      }
    },
    request(entryId) {
      const record = entries.get(entryId)
      if (!record) return { ok: false as const, code: 'UNKNOWN_ENTRY' as const }
      if (record.entry.loadPolicy === 'index-only') return { ok: false as const, code: 'INDEX_ONLY' as const }
      record.state = 'loading'
      record.revision = bump()
      return { ok: true as const }
    },
    retain(entryId, owner) {
      const record = entries.get(entryId)
      if (!record) return false
      record.owners.add(owner)
      owners.set(owner, new Set([...(owners.get(owner) ?? []), entryId]))
      record.revision = bump()
      return true
    },
    release(entryId, owner) {
      const record = entries.get(entryId)
      if (!record || !record.owners.delete(owner)) return false
      const owned = owners.get(owner)
      owned?.delete(entryId)
      if (owned?.size === 0) owners.delete(owner)
      if (record.owners.size === 0 && record.state === 'resident') {
        record.state = 'released'
      }
      record.revision = bump()
      return true
    },
    markResident(entryId) {
      const record = entries.get(entryId)
      if (!record || record.state === 'released') return false
      record.state = 'resident'
      record.failureCode = undefined
      record.revision = bump()
      return true
    },
    markFailed(entryId, failureCode) {
      const record = entries.get(entryId)
      if (!record) return false
      record.state = 'failed'
      record.failureCode = failureCode
      record.revision = bump()
      return true
    },
    snapshot() {
      const snapshot: Record<ResidencyDomain, ResidencyEntry[]> = { logical: [], visual: [], runtimeObject: [] }
      for (const record of entries.values()) {
        const item: ResidencyEntry = {
          entryId: record.entry.entryId,
          kind: record.entry.kind,
          policy: record.entry.loadPolicy,
          state: record.state,
          refCount: record.owners.size,
          revision: record.revision,
          ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }),
        }
        snapshot[domainOf(record.entry.kind)].push(item)
      }
      return Object.freeze({ logical: Object.freeze(snapshot.logical), visual: Object.freeze(snapshot.visual), runtimeObject: Object.freeze(snapshot.runtimeObject) })
    },
  }
}
