import type { InteractionIntent } from '../../ui/model/intent'
import type { RuleEventProjection } from '../../ui/model/event-projection'
import type { SubmissionOutcome } from '../../ui/ports/action-port'
import type { ConvergenceResult } from '../../ui/ports/convergence'
import type { UiSystemPorts } from '../../ui/index'

export type ShellIntentOutcome =
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'timeout'
  | 'cancelled'
  | 'disconnected'
  | 'reconnecting'

export interface ShellIntentRequest {
  readonly intentId: string
  readonly requestId: string
  readonly sourcePageId: string
  readonly targetPageId?: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly revision: number
  readonly mock: boolean
  readonly safeReturnTarget: string
}

export interface ShellIntentResult {
  readonly requestId: string
  readonly outcome: ShellIntentOutcome
  readonly accepted: boolean
  readonly projectionCommitted: boolean
  readonly projectionRevision?: number
  readonly diagnostic?: string
}

export interface ShellRevisionClock {
  current(): number
  next(): number
  accepts(revision: number): boolean
}

export function createShellRevisionClock(initial = 0): ShellRevisionClock {
  let current = initial
  return {
    current: () => current,
    next: () => {
      current += 1
      return current
    },
    accepts: (revision) => revision >= current,
  }
}

export interface ShellWiringBridge {
  readonly ports: UiSystemPorts
  readonly revision: ShellRevisionClock
  submit(intent: InteractionIntent): SubmissionOutcome
  subscribe(listener: (event: RuleEventProjection) => void): { readonly unsubscribe: () => void }
  projection<T>(read: () => ConvergenceResult<T>): ConvergenceResult<T>
}

export function createShellWiringBridge(
  ports: UiSystemPorts,
  revision = createShellRevisionClock(),
): ShellWiringBridge {
  return Object.freeze({
    ports,
    revision,
    submit: (intent: InteractionIntent): SubmissionOutcome => ports.actions.submit(intent),
    subscribe: (listener: (event: RuleEventProjection) => void) => ports.events.subscribe(listener),
    projection: <T>(read: () => ConvergenceResult<T>): ConvergenceResult<T> => read(),
  })
}
