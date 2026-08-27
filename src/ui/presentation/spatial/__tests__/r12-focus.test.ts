/**
 * R12 专项测试：FocusTraversal + ARIA 元数据。
 */
import { describe, expect, it } from 'vitest'
import { FocusTraversal, buildAriaMetadata } from '../focus-traversal'
import type { SpatialProjection } from '../spatial-view'

const buildProjection = (): SpatialProjection => ({
  revision: 1,
  layers: [],
  nodes: [
    {
      id: 'ms1',           // ms1 作为微场景节点（clusterId 匹配）
      def: 'd:scene/large',
      at: { x: 0, y: 0 },
      scale: 'large',
      name: 'Room1',
      floor: 0,
      layerId: undefined,
    },
    {
      id: 'n_corridor',
      def: 'd:scene/large',
      at: { x: 1, y: 0 },
      scale: 'large',
      name: 'Corridor',
      floor: 0,
      layerId: undefined,
    },
  ],
  edges: [],
  entities: [
    { entityId: 'e1', viewToken: 'v1', definitionId: 'd:npc', locationNodeId: 'ms1', posture: 'standing', statusIds: [], resources: [], salientStates: [], remembered: false },
    { entityId: 'e2', viewToken: 'v2', definitionId: 'd:npc', locationNodeId: 'ms1', posture: 'standing', statusIds: [], resources: [], salientStates: [], remembered: false },
  ],
  clusters: [
    {
      id: 'ms1',    // ← clusterId === node id，说明 cluster 是有节点承载的微场景
      center: { x: 0, y: 0 },
      entityIds: ['e1', 'e2'],
      glowRadius: 32,
    },
  ],
  tiles: [],
  buildingRenderMode: { kind: 'exterior' as const },
})

describe('R12 FocusTraversal', () => {
  it('compute() 返回的场景优先于实体', () => {
    const t = new FocusTraversal()
    const targets = t.compute(buildProjection())
    // ms1 (cluster scene) + e1 + e2 + n_corridor = 4
    expect(targets.length).toBe(4)
    expect(targets[0]?.itemId).toBe('ms1')
    expect(targets[0]?.role).toBe('scene')
    expect(targets[1]?.itemId).toBe('e1')
    expect(targets[1]?.role).toBe('entity')
    expect(targets[2]?.itemId).toBe('e2')
    expect(targets[2]?.role).toBe('entity')
  })

  it('selectedIndex 初始 0', () => {
    const t = new FocusTraversal()
    expect(t.selectedIndex).toBe(0)
  })

  it('moveFocus next 循环到 0', () => {
    const t = new FocusTraversal()
    const targets = t.compute(buildProjection())
    expect(t.moveFocus('next', targets.length)).toBe(1)
    expect(t.moveFocus('next', targets.length)).toBe(2)
    expect(t.moveFocus('next', targets.length)).toBe(3)
    expect(t.moveFocus('next', targets.length)).toBe(0) // wrap
  })

  it('moveFocus prev 从 0 回到末尾', () => {
    const t = new FocusTraversal()
    const targets = t.compute(buildProjection())
    expect(t.moveFocus('prev', targets.length)).toBe(3)
  })

  it('setFocus 直接跳转', () => {
    const t = new FocusTraversal()
    t.setFocus(2)
    expect(t.selectedIndex).toBe(2)
  })

  it('currentTarget 返回当前焦点', () => {
    const t = new FocusTraversal()
    const targets = t.compute(buildProjection())
    t.setFocus(1)
    expect(t.currentTarget(targets)?.itemId).toBe('e1')
  })

  it('label 缺省时退化为 id', () => {
    const t = new FocusTraversal()
    const projection: SpatialProjection = {
      revision: 1, layers: [], nodes: [
        { id: 'no_name', def: 'd', at: { x: 0, y: 0 }, scale: 'small', name: undefined, floor: 0, layerId: undefined },
      ], edges: [], entities: [], clusters: [], tiles: [],
      buildingRenderMode: { kind: 'exterior' as const },
    }
    const targets = t.compute(projection)
    expect(targets[0]?.label).toBe('no_name')
  })
})

describe('R12 buildAriaMetadata', () => {
  it('projection 为 null 返回空数组', () => {
    expect(buildAriaMetadata(null)).toEqual([])
  })

  it('projection 非空返回与 FocusTraversal.compute 一致', () => {
    const projection = buildProjection()
    expect(buildAriaMetadata(projection).length).toBe(4)
  })
})
