import { describe, expect, it } from 'vitest'
import { validateControllerRef, validateRuntimeProfileRef } from '../profile-refs'

describe('runtime profile references', () => {
  it('validates entity profile references without copying profiles', () => {
    expect(validateRuntimeProfileRef({ kind: 'npc', id: 'npc:guard-standard' })).toEqual([])
    expect(validateRuntimeProfileRef({ kind: 'npc', id: '' })).toContain('EMPTY_ID')
  })

  it('requires policy and difficulty for AI players', () => {
    expect(validateControllerRef({ actorKind: 'ai-player', controllerRef: 'controller:player-ai' })).toContain('MISSING_CONTROLLER')
    expect(validateControllerRef({ actorKind: 'ai-player', controllerRef: 'controller:player-ai', policyRef: 'policy:default', difficultyRef: 'difficulty:2' })).toEqual([])
    expect(validateControllerRef({ actorKind: 'npc', controllerRef: 'behavior:guard' })).toEqual([])
  })
})
