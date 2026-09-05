/**
 * MovementActionAdapter 单元测试 (D-090)。
 *
 * 验证：
 * 1. AuthoritativePlacement 正确转化为标准 InteractionIntent。
 * 2. 绑定参数完整（包含 entityId、targetNaturalSceneId、坐标、截停标记及可选 targetMicroSceneId）。
 * 3. 通过 ActionPort 提交并返回权威结果。
 */

import { describe, expect, it } from 'vitest'
import {
  createMovementPlacementIntent,
  MovementActionAdapter,
} from '../choreography/movement-action-adapter'
import type { AuthoritativePlacement } from '../choreography/movement-session'
import type { ActionPort, SubmissionOutcome } from '../../../ports/action-port'
import type { InteractionIntent } from '../../../model/intent'

describe('MovementActionAdapter (D-090)', () => {
  const placement: AuthoritativePlacement = {
    entityId: 'hero',
    naturalSceneId: 'scene_main',
    microSceneId: 'ms_safehouse',
    position: { x: 0.35, y: 0.65 },
    isTruncated: false,
    orcaElapsedMs: 2500,
  }

  it('createMovementPlacementIntent 构造出合法的 InteractionIntent', () => {
    const intent = createMovementPlacementIntent(placement, {
      agentId: 'agent_player',
      observedRevision: { sequence: 3, fingerprint: 'rev:3' },
    })

    expect(intent.agentId).toBe('agent_player')
    expect(intent.target.kind).toBe('action')
    expect(intent.target.actionId).toBe('action:entity.place')
    expect(intent.bindings['entityId']).toBe('hero')
    expect(intent.bindings['targetNaturalSceneId']).toBe('scene_main')
    expect(intent.bindings['targetMicroSceneId']).toBe('ms_safehouse')
    expect(intent.bindings['posX']).toBe(0.35)
    expect(intent.bindings['posY']).toBe(0.65)
    expect(intent.bindings['isTruncated']).toBe(false)
    expect(intent.observedRevision.sequence).toBe(3)
  })

  it('截停时的 AuthoritativePlacement 构造出标记 isTruncated: true 的意图', () => {
    const truncatedPlacement: AuthoritativePlacement = {
      entityId: 'hero',
      naturalSceneId: 'scene_corridor',
      position: { x: 0.12, y: 0.34 },
      isTruncated: true,
      orcaElapsedMs: 5000,
    }

    const intent = createMovementPlacementIntent(truncatedPlacement, {
      agentId: 'agent_player',
    })

    expect(intent.bindings['isTruncated']).toBe(true)
    expect(intent.bindings['targetMicroSceneId']).toBeUndefined()
  })

  it('MovementActionAdapter 成功通过 ActionPort 提交 intent', () => {
    let capturedIntent: InteractionIntent | undefined
    const mockActionPort: ActionPort = {
      submit: (intent) => {
        capturedIntent = intent
        return {
          kind: 'accepted',
          committedRevision: { sequence: 4, fingerprint: 'rev:4' },
        } as SubmissionOutcome
      },
    }

    const adapter = new MovementActionAdapter(mockActionPort)
    const result = adapter.submitPlacement(placement, { agentId: 'player_1' })

    expect(result?.kind).toBe('accepted')
    expect(capturedIntent?.agentId).toBe('player_1')
    expect(capturedIntent?.bindings['entityId']).toBe('hero')
  })
})
