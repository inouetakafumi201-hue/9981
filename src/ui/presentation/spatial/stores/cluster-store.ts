import type { Vec2 } from '../../../../play/map/types'
import type { Disposable } from '../disposable'

export type ClusterVisibility = 'active' | 'fading'

export interface ClusterRecord {
  readonly clusterId: string
  readonly center: Vec2
  readonly entityIds: readonly string[]
  readonly visibility: ClusterVisibility
  readonly revision: number
}

export type MicroSceneEvent =
  | { type: 'created'; microSceneId: string; center: Vec2; entityIds: readonly string[]; revision: number }
  | { type: 'occupants-changed'; microSceneId: string; entityIds: readonly string[]; revision: number }
  | { type: 'destroyed'; microSceneId: string; revision: number }

export interface ClusterSnapshot {
  readonly revision: number
  readonly clusters: readonly ClusterRecord[]
}

const FADE_MS = 300

/**
 * 微型场景簇管理。
 * R9: 实现 Disposable，dispose() 清除所有定时器并清空状态。
 */
export class ClusterStore implements Disposable {
  private readonly records = new Map<string, ClusterRecord>()
  private readonly listeners = new Set<(snapshot: ClusterSnapshot) => void>()
  private pendingFades = new Map<string, ReturnType<typeof setTimeout>>()
  private internalRevision = 0
  private readonly fadeMs: number
  private _disposed = false

  readonly debugName = 'ClusterStore'

  constructor(opts?: { fadeMs?: number }) {
    this.fadeMs = opts?.fadeMs ?? FADE_MS
  }

  apply(event: MicroSceneEvent): void {
    if (this._disposed || event.revision < this.internalRevision) return
    this.internalRevision = event.revision

    if (event.type === 'created') {
      if (event.entityIds.length < 1) return
      this.records.set(event.microSceneId, {
        clusterId: event.microSceneId,
        center: event.center,
        entityIds: [...event.entityIds],
        visibility: 'active',
        revision: event.revision,
      })
    } else if (event.type === 'occupants-changed') {
      const existing = this.records.get(event.microSceneId)
      if (!existing) return
      if (event.entityIds.length === 0) {
        this.transitionToFading(event.microSceneId, 'destroyed', event.revision)
      } else {
        this.records.set(event.microSceneId, {
          ...existing,
          center: existing.center,
          entityIds: [...event.entityIds],
          revision: event.revision,
        })
      }
    } else if (event.type === 'destroyed') {
      if (this.records.has(event.microSceneId)) {
        this.transitionToFading(event.microSceneId, 'destroyed', event.revision)
      }
    }
    this.emit()
  }

  private transitionToFading(microSceneId: string, reason: 'destroyed', revision: number): void {
    if (this._disposed) return
    const existing = this.records.get(microSceneId)
    if (existing?.visibility === 'fading') {
      if (this.pendingFades.has(microSceneId)) clearTimeout(this.pendingFades.get(microSceneId)!)
      this.pendingFades.set(microSceneId, setTimeout(() => this.finalRemove(microSceneId), this.fadeMs))
      this.records.set(microSceneId, { ...existing, visibility: 'fading', revision })
      return
    }
    this.records.set(microSceneId, {
      clusterId: microSceneId,
      center: existing?.center ?? { x: 0, y: 0 },
      entityIds: existing?.entityIds ?? [],
      visibility: 'fading',
      revision,
    })
    this.pendingFades.set(microSceneId, setTimeout(() => this.finalRemove(microSceneId), this.fadeMs))
  }

  private finalRemove(microSceneId: string): void {
    this.records.delete(microSceneId)
    this.pendingFades.delete(microSceneId)
    this.emit()
  }

  get(microSceneId: string): ClusterRecord | undefined {
    return this.records.get(microSceneId)
  }

  active(): readonly ClusterRecord[] {
    return [...this.records.values()].filter((c) => c.visibility === 'active')
  }

  fading(): readonly ClusterRecord[] {
    return [...this.records.values()].filter((c) => c.visibility === 'fading')
  }

  all(): readonly ClusterRecord[] {
    return [...this.records.values()]
  }

  get revision(): number {
    return this.internalRevision
  }

  subscribe(handler: (snapshot: ClusterSnapshot) => void): () => void {
    this.listeners.add(handler)
    handler(this.snapshot())
    return () => {
      this.listeners.delete(handler)
    }
  }

  snapshot(): ClusterSnapshot {
    return { revision: this.internalRevision, clusters: this.all() }
  }

  removeById(clusterId: string): void {
    if (this.pendingFades.has(clusterId)) {
      clearTimeout(this.pendingFades.get(clusterId)!)
      this.pendingFades.delete(clusterId)
    }
    this.records.delete(clusterId)
  }

  clear(): void {
    for (const id of this.pendingFades.keys()) clearTimeout(this.pendingFades.get(id)!)
    this.pendingFades.clear()
    this.records.clear()
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    for (const id of this.pendingFades.keys()) clearTimeout(this.pendingFades.get(id)!)
    this.pendingFades.clear()
    this.records.clear()
    this.listeners.clear()
    this.internalRevision = 0
  }

  get isDisposed(): boolean {
    return this._disposed
  }

  private emit(): void {
    if (this._disposed) return
    const snap = this.snapshot()
    for (const listener of this.listeners) listener(snap)
  }
}
