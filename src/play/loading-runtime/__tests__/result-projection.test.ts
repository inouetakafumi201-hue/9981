import { describe, expect, it } from 'vitest'
import { readMatchResultProjection } from '../result-projection'
import type { MatchShell } from '../types'

function shell(ended: boolean): MatchShell {
  return {
    round: 1, phase: 'cleanup', ended,
    outcome: ended ? { name: 'victory', scope: 'game', rank: 1 } : null,
    events: { subscribe: () => ({ unsubscribe: () => undefined }) },
    submitGuard: () => ({ ok: true, value: undefined }), check: () => [], getState: () => ({}) as never,
  }
}

describe('match result projection', () => {
  it('does not invent reward before terminal fact', () => {
    expect(readMatchResultProjection(shell(false)).rewardProjection.available).toBe(false)
  })
  it('projects reward availability only after terminal fact', () => {
    const projection = readMatchResultProjection(shell(true))
    expect(projection.outcome?.name).toBe('victory')
    expect(projection.rewardProjection.available).toBe(true)
  })
})
