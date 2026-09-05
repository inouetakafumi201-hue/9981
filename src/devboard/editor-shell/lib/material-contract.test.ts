// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { parseMapData, serializeMapData, type CanonicalMapData } from '../../ports/map-contracts'
import { canonicalToEditorDoc, editorDocToCanonical } from './map-bridge'
import { getState, importMapData, placeMaterialAtPoint } from './editor-store'
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

  it('过渡场景直绑边且不创建 placement', () => {
    placeMaterialAtPoint(materialId('过渡场景'), { x: 800, y: 500 })
    expect(getState().doc.placements).toHaveLength(0)
    expect(getState().doc.edges[0]?.transitionWindow).toMatchObject({ logicCategory: '过渡场景' })
  })

  it('普通素材落在边上不会误绑过渡窗口', () => {
    placeMaterialAtPoint(materialId('物品'), { x: 800, y: 500 })
    expect(getState().doc.edges[0]?.transitionWindow).toBeUndefined()
    expect(getState().doc.placements[0]).toMatchObject({ placementMode: 'presentation-only', logicCategory: '物品' })
  })

  it('canonical round-trip 不丢失分类、放置模式和过渡素材引用', () => {
    placeMaterialAtPoint(materialId('物品'), { x: 800, y: 100 })
    placeMaterialAtPoint(materialId('过渡场景'), { x: 800, y: 500 })
    const canonical = editorDocToCanonical(getState().doc)
    const restored = canonicalToEditorDoc(parseMapData(serializeMapData(canonical)))
    expect(restored.placements[0]).toMatchObject({ logicCategory: '物品', placementMode: 'presentation-only' })
    expect(restored.edges[0]?.transitionWindow).toMatchObject({ logicCategory: '过渡场景' })
  })
})
