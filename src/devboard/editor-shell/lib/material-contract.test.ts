// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { parseMapData, serializeMapData, type CanonicalMapData } from '../../ports/map-contracts'
import { canonicalToEditorDoc, editorDocToCanonical } from './map-bridge'
import { attachTokenToPlacement, getState, importMapData, placeMaterialAtPoint } from './editor-store'
import { CATEGORIES, LEGACY_CATEGORY_MIGRATION, MATERIALS } from './materials'

const BASE_MAP: CanonicalMapData = {
  schemaVersion: '2.0',
  id: 'material-contract',
  name: '素材契约测试',
  backdrop: { image: 'data:image/png;base64,', pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1 },
  layers: [{ id: 'ground', name: '地面', height: 0 }],
  nodes: [
    { id: 'a', def: 'd:scene/small', scale: 'small', at: { x: 0.25, y: 0.5 }, layerId: 'ground' },
    { id: 'b', def: 'd:scene/small', scale: 'small', at: { x: 0.75, y: 0.5 }, layerId: 'ground' },
  ],
  edges: [{ id: 'edge', def: 'd:link/path', a: 'a', b: 'b', directionality: 'bidirectional', path: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }] }],
  placements: [],
}

function materialId(category: (typeof CATEGORIES)[number]): string {
  const material = MATERIALS.find((candidate) => candidate.category === category)
  if (!material) throw new Error(`缺少 ${category} 测试素材`)
  return material.id
}

describe('八类逻辑素材契约', () => {
  beforeEach(() => importMapData(BASE_MAP))

  it('逻辑分类集合精确等于八类', () => {
    expect(CATEGORIES).toEqual(['AI 单位', 'NPC', '载具', '容器', '物品', '机关装置', '装饰', '过渡场景'])
  })

  it('旧六类使用确定性迁移规则', () => {
    expect(LEGACY_CATEGORY_MIGRATION).toEqual({ 装置: '机关装置', 照明: '装饰', 陈设: '装饰', 交互: '机关装置', 线索: '物品', 遮挡: '容器' })
  })

  it('装饰与场景外素材自动成为仅表现 placement', () => {
    placeMaterialAtPoint(materialId('装饰'), { x: 400, y: 500 })
    placeMaterialAtPoint(materialId('物品'), { x: 800, y: 100 })
    expect(getState().doc.placements.map((placement) => placement.placementMode)).toEqual(['presentation-only', 'presentation-only'])
  })

  it('普通素材在天然场景内保留原生逻辑', () => {
    placeMaterialAtPoint(materialId('NPC'), { x: 400, y: 500 })
    expect(getState().doc.placements[0]).toMatchObject({ sceneId: 'a', logicCategory: 'NPC', placementMode: 'native' })
  })

  it('过渡场景绑定连线端点且不创建 placement', () => {
    const result = placeMaterialAtPoint(materialId('过渡场景'), { x: 400, y: 500 })
    expect(result.kind).toBe('transition')
    expect(getState().doc.placements).toHaveLength(0)
    expect(getState().doc.edges[0]?.transitionInstances).toMatchObject([{ endpoint: 'from', materialId: expect.any(String) }])
    expect(getState().doc.sceneNodes.some((node) => node.parent === 'a' && node.def === 'd:scene/micro-transition')).toBe(true)
  })

  it('每条连线每端最多一个过渡实例', () => {
    placeMaterialAtPoint(materialId('过渡场景'), { x: 400, y: 500 })
    placeMaterialAtPoint(materialId('过渡场景'), { x: 1200, y: 500 })
    const rejected = placeMaterialAtPoint(materialId('过渡场景'), { x: 400, y: 500 })
    expect(rejected.kind).toBe('rejected')
    expect(getState().doc.edges[0]?.transitionInstances).toHaveLength(2)
  })

  it('普通素材落在边上不会误绑过渡实例', () => {
    placeMaterialAtPoint(materialId('物品'), { x: 800, y: 500 })
    expect(getState().doc.edges[0]?.transitionInstances).toBeUndefined()
    expect(getState().doc.placements[0]).toMatchObject({ placementMode: 'presentation-only', activation: 'free-decoration', logicCategory: '物品' })
  })

  it('非法词条在写入前拒绝且不污染实例', () => {
    const result = placeMaterialAtPoint(materialId('容器'), { x: 400, y: 500 })
    expect(result.id).toBeDefined()
    const before = getState().doc.placements[0]?.tokenIds
    expect(attachTokenToPlacement(result.id ?? '', 'tk_attr_0', '属性')).toBe(false)
    expect(getState().doc.placements[0]?.tokenIds).toEqual(before)
  })

  it('canonical round-trip 不丢失分类、激活状态和过渡实例', () => {
    placeMaterialAtPoint(materialId('物品'), { x: 800, y: 100 })
    placeMaterialAtPoint(materialId('过渡场景'), { x: 400, y: 500 })
    const canonical = editorDocToCanonical(getState().doc)
    const restored = canonicalToEditorDoc(parseMapData(serializeMapData(canonical)))
    expect(restored.placements[0]).toMatchObject({ logicCategory: '物品', placementMode: 'presentation-only', activation: 'free-decoration' })
    expect(restored.edges[0]?.transitionInstances).toMatchObject([{ endpoint: 'from', materialId: expect.any(String) }])
  })

  it('旧单窗口能按最近端点迁移为微型场景实例', () => {
    const edge = BASE_MAP.edges[0]
    if (!edge) throw new Error('测试地图缺少边')
    const restored = canonicalToEditorDoc({
      ...BASE_MAP,
      edges: [{
        ...edge,
        transitionWindow: {
          control: [{ x: 0.25, y: 0.5 }],
          materialId: materialId('过渡场景'),
          logicCategory: '过渡场景',
        },
      }],
    })
    expect(restored.edges[0]?.transitionInstances).toMatchObject([{ endpoint: 'from', microSceneId: 'ms_transition_edge_from' }])
    expect(restored.sceneNodes).toContainEqual(expect.objectContaining({ id: 'ms_transition_edge_from', parent: 'a', def: 'd:scene/micro-transition' }))
  })

  it('旧单窗口落在两端正中时不静默伪造端点', () => {
    const edge = BASE_MAP.edges[0]
    if (!edge) throw new Error('测试地图缺少边')
    const restored = canonicalToEditorDoc({
      ...BASE_MAP,
      edges: [{
        ...edge,
        transitionWindow: {
          control: [{ x: 0.5, y: 0.5 }],
          materialId: materialId('过渡场景'),
          logicCategory: '过渡场景',
        },
      }],
    })
    expect(restored.edges[0]?.transitionInstances).toBeUndefined()
    expect(restored.edges[0]?.transitionWindow).toMatchObject({ materialId: expect.any(String) })
  })
})
