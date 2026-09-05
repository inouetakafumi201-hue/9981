/**
 * MovementActionAdapter — D-090 权威移动动作适配器。
 *
 * 职责：
 * 将 MovementSessionController 产生的 AuthoritativePlacement 转换为标准 UI InteractionIntent，
 * 并通过 ActionPort 提交权威 entity.place 操作。
 */

import type { AuthoritativePlacement } from './movement-session'
import type { ActionPort, SubmissionOutcome } from '../../../ports/action-port'
import type { InteractionIntent } from '../../../model/intent'
import { deriveIntentId } from '../../../model/intent'
import type { StateRevision } from '../../../model/revision'

export interface MovementActionIntentOptions {
  readonly agentId: string
  readonly observedRevision?: StateRevision
  readonly actionId?: string
}

export function createMovementPlacementIntent(
  placement: AuthoritativePlacement,
  opts: MovementActionIntentOptions,
): InteractionIntent {
  const revision: StateRevision = opts.observedRevision ?? { sequence: 1, fingerprint: 'rev:init' }
  const actionId = opts.actionId ?? 'action:entity.place'

  const bindings: Record<string, string | number | boolean> = {
    entityId: placement.entityId,
    targetNaturalSceneId: placement.naturalSceneId,
    posX: placement.position.x,
    posY: placement.position.y,
    isTruncated: placement.isTruncated,
  }

  if (placement.microSceneId) {
    bindings['targetMicroSceneId'] = placement.microSceneId
  }

  const target = { kind: 'action' as const, actionId }
  const intentId = deriveIntentId(opts.agentId, target, bindings, revision)

  return {
    intentId,
    agentId: opts.agentId,
    target,
    bindings: Object.freeze(bindings),
    observedRevision: revision,
    inputSource: 'pointer',
  }
}

export class MovementActionAdapter {
  constructor(private readonly actionPort?: ActionPort) {}

  submitPlacement(
    placement: AuthoritativePlacement,
    opts: MovementActionIntentOptions,
  ): SubmissionOutcome | undefined {
    if (!this.actionPort) return undefined
    const intent = createMovementPlacementIntent(placement, opts)
    return this.actionPort.submit(intent)
  }
}
