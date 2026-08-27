import type { ActorKind, RuntimeEntityKind } from './types'

export interface RuntimeProfileRef {
  readonly kind: RuntimeEntityKind
  readonly id: string
}

export interface ControllerRef {
  readonly actorKind: Exclude<ActorKind, 'player' | 'unbound'>
  readonly controllerRef: string
  readonly policyRef?: string
  readonly difficultyRef?: string
}

export type ProfileRefError = 'EMPTY_ID' | 'UNSUPPORTED_KIND' | 'MISSING_CONTROLLER'

export function validateRuntimeProfileRef(ref: RuntimeProfileRef): readonly ProfileRefError[] {
  const errors: ProfileRefError[] = []
  if (!ref.id.trim()) errors.push('EMPTY_ID')
  if (!['item', 'weapon', 'vehicle', 'npc', 'character', 'interactive', 'environment'].includes(ref.kind)) errors.push('UNSUPPORTED_KIND')
  return Object.freeze(errors)
}

export function validateControllerRef(ref: ControllerRef): readonly ProfileRefError[] {
  const errors: ProfileRefError[] = []
  if (!ref.controllerRef.trim()) errors.push('MISSING_CONTROLLER')
  if (ref.actorKind === 'ai-player' && (!ref.policyRef || !ref.difficultyRef)) errors.push('MISSING_CONTROLLER')
  return Object.freeze(errors)
}
