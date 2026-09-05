import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  CATEGORY_CONTRACT,
  MATERIALS,
  categoryPlacementMode,
  isDecorationCategory,
  isTransitionCategory,
} from './materials'

describe('素材逻辑分类契约', () => {
  it('暴露八个逻辑顶级分类', () => {
    expect(CATEGORIES).toHaveLength(8)
    expect(CATEGORIES).toEqual([
      'ai-unit', 'npc', 'vehicle', 'container', 'item', 'mechanism', 'decoration', 'transition-scene',
    ])
  })

  it('把框外普通素材降级为装饰态而不改写分类', () => {
    expect(categoryPlacementMode('npc', false)).toBe('free-decoration')
    expect(categoryPlacementMode('npc', true)).toBe('scene-bound')
    expect(CATEGORY_CONTRACT.npc.adapterId).toBe('runtime.npc')
  })

  it('把原生装饰和过渡场景分流到特殊挂载目标', () => {
    expect(isDecorationCategory('decoration')).toBe(true)
    expect(CATEGORY_CONTRACT.decoration.adapterId).toBeNull()
    expect(isTransitionCategory('transition-scene')).toBe(true)
    expect(categoryPlacementMode('transition-scene', true)).toBe('edge-bound-transition')
  })

  it('批量目录中的每个素材都有稳定分类和渲染资源', () => {
    expect(MATERIALS.length).toBeGreaterThan(0)
    expect(MATERIALS.every((material) => CATEGORIES.includes(material.category) && material.id && material.name)).toBe(true)
  })
})
