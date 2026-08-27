import {
  pendingConvergence,
  type ConvergenceResult,
} from '../../ui/ports/convergence'
import type { PendingContractPorts } from '../../ui/ports/pending-contracts'

export type WiringCapability = 'core' | 'spaceItems' | 'ai' | 'meta-state'

export interface PendingSnapshot {
  readonly status: 'pending-convergence'
  readonly capability: WiringCapability
  readonly missing: readonly string[]
  readonly retryable: boolean
}

export function pendingSnapshot(capability: WiringCapability, missing: readonly string[]): PendingSnapshot {
  return Object.freeze({
    status: 'pending-convergence' as const,
    capability,
    missing: Object.freeze([...missing].sort()),
    retryable: true,
  })
}

export function requireCapability<T>(
  result: ConvergenceResult<T>,
  capability: WiringCapability,
): ConvergenceResult<T | PendingSnapshot> {
  if (result.ok) return result
  return {
    ok: false,
    code: result.code,
    missing: Object.freeze([capability, ...result.missing].sort()),
  }
}

export interface ConvergenceBridge {
  readonly ports: PendingContractPorts
  core<T>(read: () => ConvergenceResult<T>): ConvergenceResult<T | PendingSnapshot>
  spaceItems<T>(read: () => ConvergenceResult<T>): ConvergenceResult<T | PendingSnapshot>
  ai<T>(read: () => ConvergenceResult<T>): ConvergenceResult<T | PendingSnapshot>
  metaState<T>(): ConvergenceResult<T | PendingSnapshot>
}

export function createConvergenceBridge(ports: PendingContractPorts): ConvergenceBridge {
  return Object.freeze({
    ports,
    core: <T>(read: () => ConvergenceResult<T>) => requireCapability(read(), 'core'),
    spaceItems: <T>(read: () => ConvergenceResult<T>) => requireCapability(read(), 'spaceItems'),
    ai: <T>(read: () => ConvergenceResult<T>) => requireCapability(read(), 'ai'),
    metaState: <T>() => pendingConvergence<T>(['meta-state']),
  })
}
