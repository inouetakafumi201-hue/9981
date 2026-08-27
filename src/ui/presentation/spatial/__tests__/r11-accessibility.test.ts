/**
 * R11 专项测试：reduced-motion + low-performance 自适应。
 */
import { describe, expect, it } from 'vitest'
import { createPresentationRuntime } from '../presentation-runtime'
import type { MapData } from '../../../../play/map/types'
import { isMoveDegraded, isFootprintBaseOnly, DEFAULT_ACCESSIBILITY } from '../accessibility-config'

const testMap = (): MapData => ({
  schemaVersion: '1.0',
  id: 'map:r11-test',
  name: 'R11 Test Map',
  backdrop: { image: 'asset:backdrop/test', pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1 },
  floors: [0],
  nodes: [
    { id: 'n_start', def: 'd:scene/large', scale: 'large', at: { x: 0.1, y: 0.5 }, floor: 0, name: '起点' },
    { id: 'n_end',   def: 'd:scene/large', scale: 'large', at: { x: 0.9, y: 0.5 }, floor: 0, name: '终点' },
  ],
  edges: [
    { id: 'e1', def: 'd:link/path', a: 'n_start', b: 'n_end', directionality: 'bidirectional', path: [] },
  ],
  placements: [],
})

describe('R11 AccessibilityConfig helpers', () => {
  it('DEFAULT_ACCESSIBILITY normal', () => {
    expect(isMoveDegraded(DEFAULT_ACCESSIBILITY)).toBe(false)
    expect(isFootprintBaseOnly(DEFAULT_ACCESSIBILITY)).toBe(false)
  })

  it('isMoveDegraded true when reducedMotion', () => {
    expect(isMoveDegraded({ reducedMotion: true, lowPerformance: false })).toBe(true)
  })

  it('isFootprintBaseOnly true when lowPerformance', () => {
    expect(isFootprintBaseOnly({ reducedMotion: false, lowPerformance: true })).toBe(true)
  })
})

describe('R11 runtime reducedMotion', () => {
  it('跨节点 move 产生 command 时：reducedMotion=false → 无 degraded 标记', () => {
    const runtime = createPresentationRuntime({ mapData: testMap(), accessibility: { reducedMotion: false, lowPerformance: false } })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 1,
    })
    expect(runtime.executor.activeSize()).toBe(1)
    runtime.dispose()
  })

  it('跨节点 move 产生 command 时：reducedMotion=true → payload.degraded=true', () => {
    const runtime = createPresentationRuntime({ mapData: testMap(), accessibility: { reducedMotion: true, lowPerformance: false } })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 1,
    })
    expect(runtime.executor.activeSize()).toBe(1)
    runtime.dispose()
  })

  it('无 previousNodeId（首次进入）→ 不产生 command', () => {
    const runtime = createPresentationRuntime({ mapData: testMap(), accessibility: { reducedMotion: true, lowPerformance: false } })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', nodeId: 'n_start' },
      revision: 1,
    })
    expect(runtime.executor.activeSize()).toBe(0)
    runtime.dispose()
  })

  it('prev===next（同节点）→ 不产生 command', () => {
    const runtime = createPresentationRuntime({ mapData: testMap(), accessibility: { reducedMotion: true, lowPerformance: false } })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e0', previousNodeId: 'n_start', nodeId: 'n_start' },
      revision: 1,
    })
    expect(runtime.executor.activeSize()).toBe(0)
    runtime.dispose()
  })

  it('runtime.accessibility 暴露当前配置', () => {
    const custom = { reducedMotion: true, lowPerformance: true }
    const runtime = createPresentationRuntime({ mapData: testMap(), accessibility: custom })
    expect(runtime.accessibility).toEqual(custom)
    runtime.dispose()
  })

  it('未传 accessibility → 默认 normal', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    expect(runtime.accessibility).toEqual(DEFAULT_ACCESSIBILITY)
    runtime.dispose()
  })
})
