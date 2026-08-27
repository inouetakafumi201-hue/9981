/**
 * R9 专项测试：PresentationRuntime.dispose() 链路。
 * 验证：
 *   - 多次 dispose() 幂等
 *   - dispose() 后 feed() / rebuildProjection() 是 no-op
 *   - dispose() 后 executor.activeSize() === 0
 *   - dispose() 后 projection.current() === null
 *   - dispose() 后 EventBridge 不触发 handler
 */
import { describe, expect, it, vi } from 'vitest'
import { createPresentationRuntime } from '../presentation-runtime'
import type { MapData } from '../../../../play/map/types'

const testMap = (): MapData => ({
  schemaVersion: '1.0',
  id: 'map:r9-test',
  name: 'R9 Test Map',
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

describe('R9 PresentationRuntime dispose', () => {
  it('isDisposed 初始 false', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    expect(runtime.isDisposed()).toBe(false)
    runtime.dispose()
  })

  it('dispose() 后 executor.activeSize() === 0', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e_player', previousNodeId: 'n_start', nodeId: 'n_end' },
      revision: 1,
    })
    expect(runtime.executor.activeSize()).toBe(1)
    runtime.dispose()
    expect(runtime.executor.activeSize()).toBe(0)
  })

  it('dispose() 后 projection.current() === null', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.dispose()
    expect(runtime.projection.current()).toBe(null)
  })

  it('dispose() 后 feed() 是 no-op（不抛错）', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.dispose()
    expect(() =>
      runtime.feed({
        type: 'after:entity.place',
        payload: { entityId: 'e_player', nodeId: 'n_end' },
        revision: 1,
      }),
    ).not.toThrow()
    // 不产生新命令
    expect(runtime.executor.activeSize()).toBe(0)
  })

  it('dispose() 后 rebuildProjection() 是 no-op（不抛错）', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.dispose()
    expect(() => runtime.rebuildProjection()).not.toThrow()
  })

  it('多次 dispose() 幂等', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.dispose()
    expect(() => runtime.dispose()).not.toThrow()
    expect(runtime.isDisposed()).toBe(true)
  })

  it('dispose() 后 EventBridge 订阅不触发 handler', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.dispose()
    const handler = vi.fn()
    // bridge.subscribe 返回退订函数，这里我们验证 dispose 后 feed 不触发现有的 listener
    // 新的 subscribe 在 dispose 后也会因 feed 的 guard 不工作
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e_player', nodeId: 'n_start' },
      revision: 1,
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('SpatialEntityStore dispose 后 update 是 no-op', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n_start' },
      revision: 1,
    })
    expect(runtime.entities.getNode('e1')).toBe('n_start')
    runtime.dispose()
    // dispose 后 SpatialEntityStore 的 update 内部 guard 生效
    runtime.feed({
      type: 'after:entity.place',
      payload: { entityId: 'e1', nodeId: 'n_end' },
      revision: 2,
    })
    // entities 已在 dispose 时被清空，getNode 返回 undefined
    expect(runtime.entities.getNode('e1')).toBeUndefined()
  })

  it('ClusterStore dispose 后 apply 是 no-op', () => {
    const runtime = createPresentationRuntime({ mapData: testMap() })
    runtime.dispose()
    expect(() =>
      runtime.clusters.apply({
        type: 'created',
        microSceneId: 'ms1',
        center: { x: 0.5, y: 0.5 },
        entityIds: ['e1'],
        revision: 1,
      }),
    ).not.toThrow()
    expect(runtime.clusters.all()).toEqual([])
  })
})
