import { describe, expect, it } from 'vitest'
import { TURN_HANDOFF_HARD_LIMIT_MS, TurnHandoffGate } from '../choreography/turn-handoff-gate'

describe('TurnHandoffGate (R8)', () => {
  it('calls forceRelease after the hard limit', async () => {
    const gate = new TurnHandoffGate()
    let fired = false
    gate.arm(() => { fired = true })
    expect(gate.isArmed).toBe(true)
    await new Promise((r) => setTimeout(r, TURN_HANDOFF_HARD_LIMIT_MS + 20))
    expect(fired).toBe(true)
  })

  it('release before the hard limit does not mark the gate as timed out', () => {
    const gate = new TurnHandoffGate()
    gate.arm(() => {})
    const timedOut = gate.release()
    expect(timedOut).toBe(false)
    expect(gate.isArmed).toBe(false)
  })

  it('release after the hard limit reports timeout', async () => {
    const gate = new TurnHandoffGate()
    let fired = false
    gate.arm(() => { fired = true })
    await new Promise((r) => setTimeout(r, TURN_HANDOFF_HARD_LIMIT_MS + 20))
    const timedOut = gate.release()
    expect(fired).toBe(true)
    expect(timedOut).toBe(true)
  })

  it('clear cancels the armed timer', async () => {
    const gate = new TurnHandoffGate()
    let fired = false
    gate.arm(() => { fired = true })
    gate.clear()
    await new Promise((r) => setTimeout(r, TURN_HANDOFF_HARD_LIMIT_MS + 20))
    expect(fired).toBe(false)
    expect(gate.isArmed).toBe(false)
  })

  it('is idempotent under multiple arm-clear cycles', () => {
    const gate = new TurnHandoffGate()
    gate.arm(() => {})
    gate.clear()
    gate.arm(() => {})
    gate.clear()
    expect(gate.isArmed).toBe(false)
  })
})
