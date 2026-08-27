import type { RenderCommand, RenderCommandOutcome } from '../render-command-api'
import type { SpatialProjectionStore } from '../stores/projection-store'
import type { Disposable } from '../disposable'

/**
 * RenderCommandExecutor — P5/R9
 * - R5: revision 守卫、重复 submit 接受、二次 resolve 幂等
 * - R9: dispose() 后所有操作是 no-op
 */
export class RenderCommandExecutor implements Disposable {
  private readonly active = new Map<string, { command: RenderCommand; cancelled: boolean }>()
  private readonly projection: SpatialProjectionStore
  private _disposed = false

  readonly debugName = 'RenderCommandExecutor'

  constructor(projection: SpatialProjectionStore) {
    this.projection = projection
  }

  submit(command: RenderCommand): RenderCommandOutcome {
    if (this._disposed) return 'cancelled'
    const snap = this.projection.current()
    if (!snap || command.sourceRevision < snap.revision) {
      this.active.delete(command.commandId)
      return 'stale'
    }
    if (this.active.has(command.commandId)) {
      return 'accepted'
    }
    this.active.set(command.commandId, { command, cancelled: false })
    return 'accepted'
  }

  resolve(commandId: string, outcome: Exclude<RenderCommandOutcome, 'stale' | 'accepted'>): void {
    if (this._disposed) return
    const entry = this.active.get(commandId)
    if (!entry) return
    if (entry.cancelled) return
    this.active.delete(commandId)
    void outcome
  }

  cancel(commandId: string): void {
    if (this._disposed) return
    const entry = this.active.get(commandId)
    if (!entry) return
    entry.cancelled = true
    this.active.delete(commandId)
  }

  cancelAll(): void {
    if (this._disposed) return
    this.active.clear()
  }

  activeSize(): number {
    return this.active.size
  }

  getActive(commandId: string): RenderCommand | undefined {
    return this.active.get(commandId)?.command
  }

  isDisposed(): boolean {
    return this._disposed
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.active.clear()
  }
}
