import { describe, expect, it } from 'vitest'
import { createShellJourneyHost } from '../wiring/shell-journey-host'
import { mockTransportAdapter } from '../../devboard/game-ui-shell-15/lib/shell-adapters'

describe('ShellJourneyHost', () => {
  it('moves only after an accepted transport result', async () => {
    const host = createShellJourneyHost(mockTransportAdapter)
    expect(host.snapshot().nodeId).toBe('boot.startup')

    const result = await host.request('boot.enter-title')

    expect(result.state).toBe('accepted')
    expect(result.projectionCommitted).toBe(true)
    expect(host.snapshot().nodeId).toBe('menu.title')
  })

  it('keeps the source node on a rejected request', async () => {
    const host = createShellJourneyHost(mockTransportAdapter)
    const result = await host.request('boot.enter-title', { demoOutcome: 'rejected' })

    expect(result.state).toBe('rejected')
    expect(result.projectionCommitted).toBe(false)
    expect(host.snapshot().nodeId).toBe('boot.startup')
  })

  it('cancels a pending request without changing the node', async () => {
    const host = createShellJourneyHost(mockTransportAdapter)
    const pending = host.request('boot.enter-title')
    host.cancel()
    const result = await pending

    expect(result.state).toBe('cancelled')
    expect(host.snapshot().nodeId).toBe('boot.startup')
  })

  it('uses the declared safe-return node', async () => {
    const host = createShellJourneyHost(mockTransportAdapter)
    await host.request('boot.enter-title')
    host.safeReturn('test safe return')

    expect(host.snapshot().nodeId).toBe('menu.title')
    expect(host.snapshot().transition.message).toBe('test safe return')
  })
})
