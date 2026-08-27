import type { SpatialProjection } from '../spatial-view'
import type { Disposable } from '../disposable'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function deepFreeze<T>(value: T): T {
  if (!isObject(value)) return value
  for (const key of Object.keys(value)) {
    const v = value[key]
    if (isObject(v)) deepFreeze(v)
  }
  return Object.freeze(value) as T
}

export class SpatialProjectionStore implements Disposable {
  private snapshot: SpatialProjection | null = null
  private pending: { error: string; revision: number } | null = null
  private listeners = new Set<(snap: SpatialProjection | null) => void>()
  private _disposed = false

  readonly debugName = 'SpatialProjectionStore'

  commit(projection: SpatialProjection): void {
    if (this._disposed) return
    if (this.snapshot && projection.revision < this.snapshot.revision) return
    this.pending = null
    this.snapshot = deepFreeze(projection)
    this.emit()
  }

  reject(error: { error: string; revision: number }): void {
    if (this._disposed) return
    this.pending = error
    this.snapshot = null
    this.emit()
  }

  current(): SpatialProjection | null {
    return this.snapshot
  }

  isPending(): boolean {
    return this.snapshot === null
  }

  subscribe(handler: (snap: SpatialProjection | null) => void): () => void {
    this.listeners.add(handler)
    handler(this.snapshot)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private emit(): void {
    if (this._disposed) return
    for (const listener of this.listeners) listener(this.snapshot)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.snapshot = null
    this.pending = null
    this.listeners.clear()
  }

  get isDisposed(): boolean {
    return this._disposed
  }
}
