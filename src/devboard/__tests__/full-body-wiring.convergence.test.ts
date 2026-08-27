import { describe, expect, it } from 'vitest'
import { pendingConvergence } from '../../ui/ports/convergence'
import type { PendingContractPorts } from '../../ui/ports/pending-contracts'
import { createConvergenceBridge } from '../wiring/convergence-bridge'

const pendingPorts: PendingContractPorts = {
  core: {
    projectedResources: () => pendingConvergence(['core'] ),
    phaseSemantics: () => pendingConvergence(['core']),
    legalActions: () => pendingConvergence(['core']),
    safeUnavailabilityReasonKey: () => pendingConvergence(['core']),
    visibleDecisions: () => pendingConvergence(['core']),
  },
  spaceItems: {
    visibleScenes: () => pendingConvergence(['spaceItems']),
    visibleContainers: () => pendingConvergence(['spaceItems']),
    legalInteractions: () => pendingConvergence(['spaceItems']),
  },
  ai: {
    visibleActionState: () => pendingConvergence(['ai']),
    publicIntents: () => pendingConvergence(['ai']),
    safeExplanationLabels: () => pendingConvergence(['ai']),
  },
}

describe('ConvergenceBridge', () => {
  it('keeps missing capabilities explicit', () => {
    const bridge = createConvergenceBridge(pendingPorts)
    const result = bridge.metaState<{ value: string }>()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(['meta-state'])
  })

  it('does not replace a converged projection', () => {
    const bridge = createConvergenceBridge(pendingPorts)
    const result = bridge.core(() => ({ ok: true, value: { id: 'entity:1' } }))

    expect(result).toEqual({ ok: true, value: { id: 'entity:1' } })
  })
})
