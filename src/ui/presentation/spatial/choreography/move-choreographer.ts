import type { SpatialProjectionStore } from '../stores/projection-store'

export type MoveChoreographerMode = 'single' | 'multi'

export interface MoveRequest {
  readonly entityId: string
  readonly toRevision: number
  readonly path: readonly { x: number; y: number }[]
}

export interface MoveResult {
  readonly accepted: boolean
  readonly stale: boolean
}

/**
 * MoveChoreographer skeleton. Does not yet run animations; its responsibility is
 * the non-blocking contract:
 *  - Single-player: never block the next input; submit moves even if earlier
 *    moves are still animating.
 *  - Multi-player: queue moves so the turn-handoff gate can wait for them
 *    up to the 3000ms hard limit.
 *
 * The actual move animation will be implemented by a render command emitted
 * against RenderCommandExecutor in a later phase.
 */
export class MoveChoreographer {
  private pending: MoveRequest[] = []
  private readonly projection: SpatialProjectionStore
  private readonly mode: MoveChoreographerMode

  constructor(opts: { projection: SpatialProjectionStore; mode: MoveChoreographerMode }) {
    this.projection = opts.projection
    this.mode = opts.mode
  }

  submit(request: MoveRequest): MoveResult {
    const current = this.projection.current()
    if (current && request.toRevision < current.revision) return { accepted: false, stale: true }
    this.pending.push(request)
    return { accepted: true, stale: false }
  }

  drainPending(): readonly MoveRequest[] {
    const result = this.pending.slice()
    this.pending = []
    return result
  }

  get queueSize(): number {
    return this.pending.length
  }

  getMode(): MoveChoreographerMode {
    return this.mode
  }
}
