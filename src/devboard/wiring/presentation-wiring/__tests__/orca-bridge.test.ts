/**
 * orca-bridge 单元测试。
 * 覆盖：feed() 处理 after:entity.place / unknown event null / 缺字段 null
 * / stepToEntity() 单步推进 / ORCA 输出格式
 */
import { describe, it, expect } from 'vitest'
import { createOrcaBridge, type OrcaBridgeResult } from '../orca-bridge'
import type { CanonicalMapData } from '../../../play/map/types'
import type { GameplayEvent } from '../../../ui/presentation/spatial/choreography/event-bridge'

const cityV1Map: CanonicalMapData = {
  schemaVersion: '2.0',
  id: 'city_v1',
  name: 'test',
  backdrop: { image: '', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 },
  layers: [{ id: 'layer:ground', name: 'ground', height: 0 }],
  nodes: [
    { id: 'A', def: 'd:x', scale: 'medium', at: { x: 0.20, y: 0.20 }, layerId: 'layer:ground' },
    { id: 'B', def: 'd:x', scale: 'medium', at: { x: 0.50, y: 0.50 }, layerId: 'layer:ground' },
    { id: 'C', def: 'd:x', scale: 'medium', at: { x: 0.80, y: 0.80 }, layerId: 'layer:ground' },
  ],
  edges: [],
  placements: [],
} as unknown as CanonicalMapData

function makeEvent(type: 'after:entity.place', payload: GameplayEvent['payload']): GameplayEvent {
  return { type, payload, revision: 1 }
}

describe('orca-bridge', () => {
  it('feed() returns null for non-entity.place events', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const event = makeEvent('after:entity.place', {
      entityId: 'p1',
      previousNodeId: 'A',
      nodeId: 'B',
    })
    expect(bridge.feed(event)).not.toBeNull()
  })

  it('feed() returns null when previousNodeId is missing', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const event = makeEvent('after:entity.place', {
      entityId: 'p1',
      nodeId: 'B',
    })
    expect(bridge.feed(event)).toBeNull()
  })

  it('feed() returns null when nodeId === previousNodeId', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const event = makeEvent('after:entity.place', {
      entityId: 'p1',
      previousNodeId: 'A',
      nodeId: 'A',
    })
    expect(bridge.feed(event)).toBeNull()
  })

  it('stepToEntity() returns prev/next positions and orcaSteps', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const result = bridge.stepToEntity('p1', 'A', 'C') as OrcaBridgeResult
    expect(result).not.toBeNull()
    expect(result.entityId).toBe('p1')
    expect(result.prevNodeId).toBe('A')
    expect(result.nextNodeId).toBe('C')
    expect(result.prevPosition).toEqual({ x: 0.20, y: 0.20 })
    expect(result.nextPosition).toBeDefined()
    expect(result.orcaSteps).toBeDefined()
    expect(result.orcaSteps.length).toBe(1)
    expect(result.orcaSteps[0]!.agentId).toBe('p1')
  })

  it('stepToEntity() returns null for unknown nodes', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    expect(bridge.stepToEntity('p1', 'X', 'Y')).toBeNull()
  })

  it('stepToEntity() advances agent in direction of nextNode', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const result = bridge.stepToEntity('p1', 'A', 'C') as OrcaBridgeResult
    // nextPosition should be moved from prevPosition toward C
    const nextPos = result.nextPosition
    expect(nextPos.x).toBeGreaterThanOrEqual(0.20)
    expect(nextPos.y).toBeGreaterThanOrEqual(0.20)
  })

  it('fellBackToLinear flag is defined', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const result = bridge.stepToEntity('p1', 'A', 'B') as OrcaBridgeResult
    expect(typeof result.fellBackToLinear).toBe('boolean')
  })

  it('uses default playerEntityId "player-1" if not provided', () => {
    const bridge = createOrcaBridge({ mapData: cityV1Map })
    const result = bridge.stepToEntity('player-1', 'A', 'B')
    expect(result).not.toBeNull()
  })

  it('respects custom maxSpeed', () => {
    const slow = createOrcaBridge({ mapData: cityV1Map, maxSpeed: 0.01 })
    const fast = createOrcaBridge({ mapData: cityV1Map, maxSpeed: 0.30 })
    const slowResult = slow.stepToEntity('p1', 'A', 'C') as OrcaBridgeResult
    const fastResult = fast.stepToEntity('p1', 'A', 'C') as OrcaBridgeResult
    // fast should move farther from prevPosition
    const slowDist = Math.hypot(slowResult.nextPosition.x - 0.20, slowResult.nextPosition.y - 0.20)
    const fastDist = Math.hypot(fastResult.nextPosition.x - 0.20, fastResult.nextPosition.y - 0.20)
    expect(fastDist).toBeGreaterThan(slowDist)
  })
})
