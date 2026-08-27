/**
 * V0 — 真实地图场景（in-match-map · devboard 演示用）
 *
 * 目的：从已装载的 `UiSystem` 读取 SemanticProjection，结合 office-v1 fixture 作为
 * MapData，调用表现层 `createSpatialProjection` 生成 SpatialProjection，SVG 渲染
 * 真实节点/边/实体。接在 `hud-main` 内部，与 BattleHud 共存。
 *
 * 数据流（阶段 8 交接点）：
 *  UiSystem.ui.query.projection({ agentId, scopeId })
 *    → ReadOnlySemanticProjection
 *  + office-v1.json (MapData)
 *    → createSpatialProjection(mapData, semanticProjection)
 *    → SpatialProjection (layers / nodes / edges / entities)
 *    → SVG 渲染
 *
 * 未实现部分（明确标注）：
 * - PathfindingService：点击节点后只把目标写本地 state，没接 pathfinder
 * - OrcaEngine：未接
 * - RenderCommandApi：未接，本组件直接读 SpatialProjection 渲染
 */

'use client'

import { useEffect, useState } from 'react'
import { createSpatialProjection } from '../../../ui/presentation/spatial/render-projection-port'
import type { SpatialProjection } from '../../../ui/presentation/spatial/spatial-view'
import type { UiSystem } from '../../../ui/index'
import type { MapData } from '../../../play/map/types'
import { useUiBackend } from '../lib/ui-backend'
import officeV1Json from '../lib/fixtures/office-v1.json'

const AGENT_ID = 'e:hero'
const SCOPE_ID = 'loaded-match:all'

const VIEWPORT_W = 800
const VIEWPORT_H = 450
const PADDING = 40
const INNER_W = VIEWPORT_W - PADDING * 2
const INNER_H = VIEWPORT_H - PADDING * 2

/**
 * 将归一化坐标 (0..1) 映射到视口像素。
 */
function toPixel(at: { x: number; y: number }): { px: number; py: number } {
  return {
    px: PADDING + at.x * INNER_W,
    py: PADDING + at.y * INNER_H,
  }
}

interface NodeMarkerProps {
  nodeId: string
  name: string | undefined
  def: string
  at: { x: number; y: number }
  scale: 'small' | 'medium' | 'large'
  entityHere: boolean
  isSelected: boolean
  onClick?: (nodeId: string) => void
}

const SCALE_RADIUS: Record<'small' | 'medium' | 'large', number> = {
  small: 6,
  medium: 9,
  large: 12,
}

function NodeMarker({ nodeId, name, def, at, scale, entityHere, isSelected, onClick }: NodeMarkerProps) {
  const { px, py } = toPixel(at)
  const isScene = def.startsWith('d:scene/')
  const radius = SCALE_RADIUS[scale]
  const fill = entityHere ? '#4ade80' : isScene ? '#60a5fa' : '#94a3b8'
  const stroke = isSelected ? '#fbbf24' : '#0f172a'

  return (
    <g
      onClick={() => onClick?.(nodeId)}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      role="button"
      aria-label={name ?? nodeId}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(nodeId) }}
    >
      <circle
        cx={px} cy={py}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={isSelected ? 3 : 1.5}
      />
      {name && (
        <text
          x={px}
          y={py - radius - 4}
          textAnchor="middle"
          fontSize={10}
          fill="#e2e8f0"
          fontFamily="monospace"
        >
          {name}
        </text>
      )}
      <text
        x={px}
        y={py + radius + 10}
        textAnchor="middle"
        fontSize={8}
        fill="#64748b"
        fontFamily="monospace"
      >
        {nodeId}
      </text>
    </g>
  )
}

interface MapSceneProps {
  ui: UiSystem | null
}

function MapSceneInner({ ui }: MapSceneProps) {
  const [projection, setProjection] = useState<SpatialProjection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // office-v1.json 缺少 MapData.floors（canonical MapData 才有）；
  // 从 floors[0] 推导（office-v1 只有 0 楼），避免类型断言逃逸。
  const mapData: MapData = { ...officeV1Json, floors: officeV1Json.floors ?? [0] } as MapData

  useEffect(() => {
    if (ui === null) {
      setProjection(null)
      setError('UiSystem 未就绪（match-boot 失败？）')
      return
    }

    const result = ui.query.projection({ agentId: AGENT_ID, scopeId: SCOPE_ID })
    if (!result.ok) {
      setError(`fetchProjection rejected: ${result.diagnostics.map((d: { code: string }) => d.code).join(',') || 'unknown'}`)
      return
    }
    try {
      const spatial = createSpatialProjection(mapData, result.value.projection)
      setProjection(spatial)
      setError(null)
    } catch (err) {
      setError(`createSpatialProjection 失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [ui, mapData])

  if (error) {
    return (
      <div style={{
        width: VIEWPORT_W, height: VIEWPORT_H,
        background: '#0f172a', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#f87171', fontFamily: 'monospace', fontSize: 12,
        flexDirection: 'column', gap: 4,
      }}>
        <span>🗺️ MapScene error</span>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>{error}</span>
      </div>
    )
  }

  if (!projection) {
    return (
      <div style={{
        width: VIEWPORT_W, height: VIEWPORT_H,
        background: '#0f172a', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#64748b', fontFamily: 'monospace', fontSize: 12,
      }}>
        载入空间投影…
      </div>
    )
  }

  const nodeMap = new Map(projection.nodes.map((n) => [n.id, n.at]))
  const entityNodeIds = new Set(
    projection.entities
      .map((e) => e.locationNodeId)
      .filter((id): id is string => typeof id === 'string')
  )

  function handleNodeClick(nodeId: string) {
    setSelectedNode((prev) => (prev === nodeId ? null : nodeId))
    // NOTE: 寻路/ORCA/RenderCommandApi 未实现，暂不提交 intent。
    // TODO(表现层): 节点点击 → move intent → pathfinding → RenderCommandApi
    // void ui?.interaction.sendIntent(...)
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        marginBottom: 6, fontFamily: 'monospace', fontSize: 11,
        color: '#94a3b8',
      }}>
        <span style={{ color: '#60a5fa' }}>🗺️</span>
        <span style={{ color: '#cbd5e1' }}>IN-MATCH MAP</span>
        <span style={{ color: '#475569' }}>|</span>
        <span>{projection.nodes.length} nodes · {projection.edges.length} edges · {projection.entities.length} entities</span>
        <span style={{ color: '#475569' }}>|</span>
        <span>rev {projection.revision}</span>
        {selectedNode && (
          <>
            <span style={{ color: '#475569' }}>|</span>
            <span style={{ color: '#fbbf24' }}>▶ {selectedNode}</span>
          </>
        )}
      </div>

      <svg
        width={VIEWPORT_W}
        height={VIEWPORT_H}
        viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
        style={{ background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b' }}
        aria-label="In-match spatial projection"
      >
        <defs>
          <pattern id="grid-im" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={VIEWPORT_W} height={VIEWPORT_H} fill="url(#grid-im)" />

        {/* 边 */}
        {projection.edges.map((edge) => {
          const aAt = nodeMap.get(edge.a)
          const bAt = nodeMap.get(edge.b)
          if (!aAt || !bAt) return null
          const aPx = toPixel(aAt)
          const bPx = toPixel(bAt)
          const isSelected = selectedNode === edge.a || selectedNode === edge.b
          const isBidirectional = edge.directionality === 'bidirectional'
          return (
            <line
              key={edge.id}
              x1={aPx.px} y1={aPx.py}
              x2={bPx.px} y2={bPx.py}
              stroke={isSelected ? '#60a5fa' : isBidirectional ? '#475569' : '#1e293b'}
              strokeWidth={isSelected ? 2 : 1}
              strokeDasharray={isBidirectional ? '4,2' : 'none'}
            />
          )
        })}

        {/* 节点 */}
        {projection.nodes.map((node) => (
          <NodeMarker
            key={node.id}
            nodeId={node.id}
            name={node.name}
            def={node.def}
            at={node.at}
            scale={node.scale}
            entityHere={entityNodeIds.has(node.id)}
            isSelected={selectedNode === node.id}
            onClick={handleNodeClick}
          />
        ))}

        {/* 实体 ID 标签（位于节点下方） */}
        {projection.entities.map((entity) => {
          if (!entity.locationNodeId) return null
          const nodeAt = nodeMap.get(entity.locationNodeId)
          if (!nodeAt) return null
          const { px, py } = toPixel(nodeAt)
          return (
            <text
              key={entity.entityId}
              x={px}
              y={py + 32}
              textAnchor="middle"
              fontSize={7}
              fill="#4ade80"
              fontFamily="monospace"
            >
              {entity.entityId}
            </text>
          )
        })}

        {/* 选中节点脉冲 */}
        {selectedNode && (() => {
          const at = nodeMap.get(selectedNode)
          if (!at) return null
          const { px, py } = toPixel(at)
          return (
            <circle
              cx={px} cy={py} r={18}
              fill="none" stroke="#fbbf24"
              strokeWidth={1.5} strokeDasharray="3,2"
            >
              <animate attributeName="r" values="14;22;14" dur="1.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
            </circle>
          )
        })()}
      </svg>

      {/* 底部图例 */}
      <div style={{
        display: 'flex', gap: 16, marginTop: 4,
        fontFamily: 'monospace', fontSize: 9, color: '#475569', flexWrap: 'wrap',
      }}>
        <span>● 蓝/灰 = 场景节点（按 scale 大小）</span>
        <span>● 绿 = 实体位置</span>
        <span>● 黄边 = 选中</span>
        <span>● 点击 = 提交 move intent（寻路待实现）</span>
      </div>
    </div>
  )
}

export function InMatchMapDemo() {
  const { ui } = useUiBackend()
  return <MapSceneInner ui={ui} />
}
