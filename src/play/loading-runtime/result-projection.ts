import type { MatchShell } from './types'

export interface MatchResultProjection {
  readonly status: 'running' | 'ended'
  readonly outcome: { readonly name: string; readonly scope: string; readonly rank: number | null } | null
  readonly rewardProjection: { readonly available: boolean; readonly source: 'playpack-outcome' | 'pending' }
}

export function readMatchResultProjection(shell: MatchShell): MatchResultProjection {
  if (!shell.ended) return { status: 'running', outcome: null, rewardProjection: { available: false, source: 'pending' } }
  const outcome = shell.outcome
  return {
    status: 'ended',
    outcome,
    rewardProjection: { available: outcome !== null, source: outcome === null ? 'pending' : 'playpack-outcome' },
  }
}
