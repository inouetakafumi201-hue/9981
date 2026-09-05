import { describe, expect, it } from 'vitest'
import { compileMap } from '../compile'
import { validateMapStructure } from '../validate'
import type { CanonicalMapData } from '../types'

function mapWithTransitions(): CanonicalMapData {
  return {
    schemaVersion: '2.0',
    id: 'transition-instances',
    name: '过渡实例管线',
    backdrop: { image: 'data:,', pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1 },
    layers: [{ id: 'ground', name: '地面', height: 0 }],
    nodes: [
      { id: 'a', def: 'd:scene/medium', scale: 'medium', at: { x: 0.2, y: 0.5 }, layerId: 'ground' },
      { id: 'b', def: 'd:scene/medium', scale: 'medium', at: { x: 0.8, y: 0.5 }, layerId: 'ground' },
      { id: 'micro-a', def: 'd:scene/micro-transition', scale: 'small', at: { x: 0.2, y: 0.5 }, layerId: 'ground', parent: 'a' },
      { id: 'micro-b', def: 'd:scene/micro-transition', scale: 'small', at: { x: 0.8, y: 0.5 }, layerId: 'ground', parent: 'b' },
    ],
    edges: [{
      id: 'edge',
      def: 'd:link/path',
      a: 'a',
      b: 'b',
      directionality: 'bidirectional',
      path: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
      transitionParams: { mode: 'shared' },
      transitionInstances: [
        { id: 'transition-a', edgeId: 'edge', endpoint: 'from', materialId: 'material:楼梯:过渡场景', microSceneId: 'micro-a', position: { x: 0.2, y: 0.5 }, effect: { fade: 'in' } },
        { id: 'transition-b', edgeId: 'edge', endpoint: 'to', materialId: 'material:安全门:过渡场景', microSceneId: 'micro-b', position: { x: 0.8, y: 0.5 }, effect: { fade: 'out' } },
      ],
    }],
    placements: [],
  }
}

describe('过渡场景端点实例管线', () => {
  it('校验并编译双端实例，保留共享参数与独立效果', () => {
    const map = mapWithTransitions()
    expect(validateMapStructure(map).filter((finding) => finding.severity === 'error')).toHaveLength(0)
    const result = compileMap(map)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prefab.nodes.find((node) => node.key === 'micro-a')?.props).toMatchObject({
      transitionEdgeId: 'edge',
      transitionEndpoint: 'from',
      transitionMaterialId: 'material:楼梯:过渡场景',
      transitionSharedParams: { mode: 'shared' },
      transitionEffect: { fade: 'in' },
    })
    expect(result.prefab.nodes.find((node) => node.key === 'micro-b')?.props).toMatchObject({ transitionEffect: { fade: 'out' } })
  })

  it('拒绝同一端点重复绑定或缺失微型场景', () => {
    const map = mapWithTransitions()
    const edge = map.edges[0]
    if (!edge) throw new Error('测试地图缺少边')
    const invalid = {
      ...map,
      nodes: map.nodes.filter((node) => node.id !== 'micro-b'),
      edges: [{
        ...edge,
        transitionInstances: [
          ...(edge.transitionInstances ?? []),
          { id: 'duplicate', edgeId: edge.id, endpoint: 'from' as const, materialId: 'material:楼梯:过渡场景', microSceneId: 'missing', position: { x: 0.2, y: 0.5 } },
        ],
      }],
    }
    const findings = validateMapStructure(invalid)
    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['MAP_TRANSITION_ENDPOINT_DUPLICATE', 'MAP_TRANSITION_MICRO_SCENE_MISSING']))
    expect(compileMap(invalid).ok).toBe(false)
  })

  it('旧窗口无法确定端点时给出诊断并阻止编译', () => {
    const map = mapWithTransitions()
    const edge = map.edges[0]
    if (!edge) throw new Error('测试地图缺少边')
    const ambiguous = {
      ...map,
      edges: [{
        ...edge,
        transitionInstances: undefined,
        transitionWindow: {
          control: [{ x: 0.5, y: 0.5 }],
          materialId: 'material:楼梯:过渡场景',
          logicCategory: '过渡场景' as const,
        },
      }],
    }
    const findings = validateMapStructure(ambiguous)
    expect(findings.map((finding) => finding.code)).toContain('MAP_TRANSITION_LEGACY_AMBIGUOUS')
    expect(findings.find((finding) => finding.code === 'MAP_TRANSITION_LEGACY_AMBIGUOUS')?.severity).toBe('warning')
    expect(compileMap(ambiguous).ok).toBe(true)
  })

  it('只编译 native placement，透传宿主与词条实例字段', () => {
    const map = {
      ...mapWithTransitions(),
      placements: [
        {
          id: 'native-placement',
          at: 'a',
          hostSceneId: 'a',
          def: 'material:npc:host',
          logicCategory: 'NPC' as const,
          placementMode: 'native' as const,
          activation: 'native' as const,
          hostCapabilities: ['NPC' as const],
          tokenIds: ['token:npc:steady'],
          position: { x: 0.2, y: 0.5 },
        },
        {
          id: 'free-decoration',
          at: '',
          def: 'material:prop:lamp',
          logicCategory: '装饰' as const,
          placementMode: 'presentation-only' as const,
          activation: 'free-decoration' as const,
          hostCapabilities: ['装饰' as const],
          tokenIds: [],
          position: { x: 0.5, y: 0.2 },
        },
      ],
    }
    const result = compileMap(map)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prefab.entities).toHaveLength(1)
    expect(result.prefab.entities?.[0]).toMatchObject({
      at: 'a',
      def: 'material:npc:host',
      overrides: {
        activation: 'native',
        hostSceneId: 'a',
        tokenIds: ['token:npc:steady'],
      },
    })
  })
})
