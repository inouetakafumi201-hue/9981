/**
 * city-v1.json schema 合规性测试。
 * 覆盖：节点数 / micro-scene 数 / 床位 / 驻地区域 / 边数 下限。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { CanonicalMapData } from '../../../play/map/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cityV1Path = join(__dirname, '..', '..', '..', '..', '..', 'run', 'v0-assets', 'maps', 'city-v1.json')

describe('city-v1.json schema compliance', () => {
  const city = JSON.parse(readFileSync(cityV1Path, 'utf-8')) as CanonicalMapData

  it('uses schemaVersion 2.0 (canonical)', () => {
    expect(city.schemaVersion).toBe('2.0')
  })

  it('id is city_v1', () => {
    expect(city.id).toBe('city_v1')
  })

  it('has at least 12 nodes', () => {
    expect(city.nodes.length).toBeGreaterThanOrEqual(12)
  })

  it('has at least 3 micro-scenes', () => {
    const microScenes = (city as CanonicalMapData & { microScenes?: unknown[] }).microScenes
    expect(microScenes).toBeDefined()
    expect(Array.isArray(microScenes)).toBe(true)
    expect((microScenes as unknown[]).length).toBeGreaterThanOrEqual(3)
  })

  it('has at least 1 bed (residence_bed)', () => {
    const bed = city.nodes.find((n) => n.id === 'residence_bed')
    expect(bed).toBeDefined()
  })

  it('has at least 1 residence area (residence_root)', () => {
    const residence = city.nodes.find((n) => n.id === 'residence_root')
    expect(residence).toBeDefined()
  })

  it('has at least 14 edges', () => {
    expect(city.edges.length).toBeGreaterThanOrEqual(14)
  })

  it('all edges are bidirectional and traversable', () => {
    for (const edge of city.edges) {
      expect(edge.directionality).toBe('bidirectional')
      expect(edge.traversable).toBe(true)
    }
  })

  it('all nodes reference an existing layerId', () => {
    const layerIds = new Set(city.layers.map((l) => l.id))
    for (const node of city.nodes) {
      expect(layerIds.has(node.layerId)).toBe(true)
    }
  })

  it('every edge endpoint exists in nodes', () => {
    const nodeIds = new Set(city.nodes.map((n) => n.id))
    for (const edge of city.edges) {
      expect(nodeIds.has(edge.a)).toBe(true)
      expect(nodeIds.has(edge.b)).toBe(true)
    }
  })

  it('player_start placement is at residence_root', () => {
    const placement = city.placements.find((p) => p.id === 'player_start')
    expect(placement).toBeDefined()
    expect(placement!.at).toBe('residence_root')
  })
})
