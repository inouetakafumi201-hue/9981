'use client'

import { WORLD, type MapDoc, type Layer, type SceneNode, type Edge } from './map-types'
import { uid } from './editor-store'
import type { CanonicalMapData, CanonicalMapNode, MapLayer, MapEdge, MapPlacement, SceneScale, Directionality } from '../../ports/map-contracts'

const nx = (value: number) => +(value / WORLD.w).toFixed(4)
const ny = (value: number) => +(value / WORLD.h).toFixed(4)
const wx = (value: number) => Math.round(value * WORLD.w)
const wy = (value: number) => Math.round(value * WORLD.h)
const nodeDefOf = (scale: SceneScale) => `d:scene/${scale}`
const DEFAULT_EDGE_DEF = 'd:transition/door'

export const TRANSPARENT_BACKDROP = {
  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  pixelWidth: 1, pixelHeight: 1, tileRows: 1, tileCols: 1,
}

function layerToCanonical(layer: Layer): MapLayer {
  return {
    id: layer.id,
    ...(layer.name !== undefined ? { name: layer.name } : {}),
    ...(layer.backdrop !== undefined ? { backdrop: { ...layer.backdrop } } : {}),
    ...(layer.transform !== undefined ? { transform: { ...layer.transform } } : {}),
  }
}

function backdropOf(doc: MapDoc): typeof TRANSPARENT_BACKDROP {
  const backdrop = doc.layers.find((layer) => layer.backdrop)?.backdrop
  return backdrop ? { ...backdrop, tileRows: 1, tileCols: 1 } : TRANSPARENT_BACKDROP
}

export function editorDocToCanonical(doc: MapDoc): CanonicalMapData {
  const nodes: CanonicalMapNode[] = doc.sceneNodes.map((node) => ({
    id: node.id, def: node.def ?? nodeDefOf(node.scale), scale: node.scale,
    at: { x: nx(node.at.x), y: ny(node.at.y) }, layerId: node.layerId,
    floor: Number.isFinite(node.floor) ? node.floor : null,
    ...(node.name !== undefined ? { name: node.name } : {}),
  }))
  const edges: MapEdge[] = doc.edges.map((edge) => ({
    id: edge.id, def: edge.def ?? DEFAULT_EDGE_DEF, a: edge.from, b: edge.to,
    directionality: edge.directionality as Directionality,
    path: edge.points.map((point) => ({ x: nx(point.x), y: ny(point.y) })),
    ...(edge.semanticAnchor !== undefined ? { semanticAnchor: edge.semanticAnchor === 'highland' ? 'high' : edge.semanticAnchor === 'lowland' ? 'low' : 'neutral' } : {}),
  }))
  const placements: MapPlacement[] = doc.placements.map((placement) => ({ id: placement.id, at: placement.sceneId, def: placement.materialId }))
  return { schemaVersion: '3.0', id: doc.id, name: doc.name, backdrop: backdropOf(doc), layers: doc.layers.map(layerToCanonical), nodes, edges, placements }
}

function layerToEditor(layer: MapLayer): Layer {
  return { id: layer.id, name: layer.name ?? '独立区域', ...(layer.backdrop ? { backdrop: layer.backdrop } : {}), ...(layer.transform ? { transform: layer.transform } : {}) }
}

export function canonicalToEditorDoc(map: CanonicalMapData): MapDoc {
  const layers = map.layers.map(layerToEditor)
  const fallbackLayer = layers[0]?.id ?? 'zone:default'
  const sceneNodes: SceneNode[] = map.nodes.map((node, index) => ({
    id: node.id, name: node.name ?? `场景 ${index + 1}`, scale: node.scale,
    layerId: layers.some((layer) => layer.id === node.layerId) ? node.layerId : fallbackLayer,
    floor: node.floor ?? 0, at: { x: wx(node.at.x), y: wy(node.at.y) }, def: node.def,
  }))
  const ids = new Set(sceneNodes.map((node) => node.id))
  const edges: Edge[] = map.edges.flatMap((edge) => ids.has(edge.a) && ids.has(edge.b) ? [{
    id: edge.id, from: edge.a, to: edge.b, def: edge.def,
    directionality: edge.directionality as Edge['directionality'],
    points: edge.path.map((point) => ({ x: wx(point.x), y: wy(point.y) })),
    ...(edge.semanticAnchor ? { semanticAnchor: edge.semanticAnchor === 'high' ? 'highland' : edge.semanticAnchor === 'low' ? 'lowland' : 'neutral' } : {}),
  }] : [])
  const sceneBoxes = sceneNodes.map((node, index) => {
    const width = node.scale === 'large' ? 200 : node.scale === 'medium' ? 140 : 90
    const height = node.scale === 'large' ? 120 : node.scale === 'medium' ? 84 : 56
    return { id: `bx_${index}_${uid('edge').slice(-4)}`, sceneId: node.id, x: Math.round(node.at.x - width / 2), y: Math.round(node.at.y - height / 2), width, height }
  })
  const placements = map.placements.flatMap((placement) => {
    const host = sceneNodes.find((node) => node.id === placement.at)
    return host ? [{ id: placement.id, materialId: placement.def, sceneId: host.id, x: host.at.x, y: host.at.y }] : []
  })
  return { id: map.id, name: map.name, layers, sceneNodes, sceneBoxes, edges, obstructions: [], terrains: [], placements }
}
