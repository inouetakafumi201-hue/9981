import type { ActorBinding, ActorKind, RuntimeEntityRef } from './types'

export interface CharacterEntityBinding {
  readonly characterId: string
  readonly displayName: string
  readonly visualMaterialId?: string
  readonly runtimeProfileRef: string
  readonly runtimeEntityRef: RuntimeEntityRef
  readonly actorBinding: ActorBinding
}

export type ActorBindingError = 'EMPTY_PROFILE' | 'MISSING_CONTROLLER' | 'INVALID_COMBINATION'

export function validateActorBinding(binding: CharacterEntityBinding): readonly ActorBindingError[] {
  const errors: ActorBindingError[] = []
  if (!binding.runtimeProfileRef.trim()) errors.push('EMPTY_PROFILE')
  const needsController: ActorKind[] = ['ai-player', 'npc']
  if (needsController.includes(binding.actorBinding.kind) && !binding.actorBinding.controllerRef?.trim()) errors.push('MISSING_CONTROLLER')
  if (binding.actorBinding.kind === 'unbound' && binding.runtimeEntityRef.kind !== 'character') errors.push('INVALID_COMBINATION')
  return Object.freeze(errors)
}
