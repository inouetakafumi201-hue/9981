'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconSelect, IconPlace, IconEdge, IconSample, IconPlay } from './icons'
import { DustField } from './fx'
import { playSfx } from '@editor/lib/sound'
import {
  WORLD,
  SCALE_LABEL,
  DIRECTIONALITY_LABEL,
  nodeAnchor,
  boxesOfScene,
  sceneGroupBBox,
  computeHoleCells,
  type Mode,
  type MapDoc,
  type SceneNode,
  type SceneBox,
  type Edge,
  type Vec,
  type EdgePoint,
} from '@editor/lib/map-types'
import {
  catmullRomPath,
  catmullRomAt,
  rectFromDrag,
  rectsOverlap,
  pointInRect,
  pointInRotatedRect,
  rotatedRectAABB,
  pointToPolyline,
  rdp,
  dist,
  clamp,
  type Rect,
} from '@editor/lib/geometry'
import {
  useEditor,
  getState,
  setMode,
  setCamera,
  selectOne,
  setSelection,
  clearSelection,
  beginHistory,
  moveSceneGroup,
  rotateSceneGroup,
  commitSceneMove,
  updateSceneBox,
  updateEdge,
  moveWaypoint,
  insertWaypoint,
  deleteWaypoint,
  appendBendPoint,
  simplifyEdgeHiddenRuns,
  straightenEdgeSegment,
  addScene,
  addBuildingGroup,
  addEdge,
  updateObstruction,
  updateTerrain,
  updatePlacement,
  addPlacement,
  sampleElement,
  altSample,
  applySampleToScene,
  toast,
  flyTo,
  layerOpacity,
  type Camera,
} from '@editor/lib/editor-store'
import {
  registerCanvas,
  screenToWorld,
  sceneIdAtPoint,
  worldPerPixel,
} from '@editor/lib/canvas-coords'

/* ------------------------------------------------------------------ */
/*  Toolbar                                                            */
/* ------------------------------------------------------------------ */

const TOOLS: { id: Mode; key: string; label: string; icon: typeof IconSelect }[] =
  [
    { id: 'select', key: 'V', label: '选择', icon: IconSelect },
    { id: 'place', key: 'N', label: '放置场景', icon: IconPlace },
    { id: 'building', key: 'B', label: '建筑组', icon: IconPlace },
    { id: 'edge', key: 'E', label: '拉边', icon: IconEdge },
    { id: 'sample', key: 'I', label: '取样', icon: IconSample },
    { id: 'playtest', key: 'P', label: '测试运行', icon: IconPlay },
  ]

function Toolbar() {
  const mode = useEditor((s) => s.mode)
  return (
    <div className="hud-b chamfer pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1 bg-panel/90 p-1.5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md">
      {TOOLS.map((t) => {
        const Icon = t.icon
        const on = mode === t.id
        return (
          <button
            key={t.id}
            onClick={() => {
              playSfx(t.id === 'playtest' ? 'success' : 'click')
              setMode(t.id)
            }}
            onMouseEnter={() => playSfx('hover')}
            className={`chamfer-sm chamfer group relative flex items-center gap-2 px-3.5 py-2 text-[13px] font-semibold transition-all duration-150 ${
              on
                ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_var(--primary-dim)]'
                : 'text-foreground/70 hover:bg-card hover:text-foreground'
            }`}
          >
            <kbd
              className={`grid h-4 min-w-4 place-items-center rounded-[3px] px-1 font-mono text-[10px] ${
                on ? 'bg-primary/25 text-primary' : 'bg-white/5 text-muted-foreground'
              }`}
            >
              {t.key}
            </kbd>
            <Icon
              width={16}
              height={16}
              className={on ? 'drop-shadow-[0_0_6px_var(--primary)]' : ''}
            />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Legend                                                            */
/* ------------------------------------------------------------------ */

function Legend() {
  const items = [
    { label: '场景框', el: <span className="h-3.5 w-5 rounded-[2px] border border-dashed border-primary/80 bg-primary/10" /> },
    { label: '建筑组', el: <span className="h-3.5 w-5 border border-dashed border-primary/70 bg-primary/5" /> },
    { label: '高光点', el: <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" /> },
    { label: '连线', el: <span className="h-[2px] w-6 bg-edge" /> },
    { label: '选中', el: <span className="h-3.5 w-5 rounded-[2px] border border-edge-selected bg-edge-selected/15" /> },
    { label: '视觉遮挡', el: <span className="h-3.5 w-3.5 rounded-[2px] border border-box-mask bg-box-mask/20" /> },
    { label: '物理遮挡', el: <span className="h-3.5 w-3.5 rounded-[2px] border border-box-physics bg-box-physics/20" /> },
    { label: '过渡窗口', el: <span className="h-3 w-3 rotate-45 border border-transition bg-transition/25" /> },
  ]
  return (
    <div className="hud-b chamfer pointer-events-none absolute bottom-4 left-4 z-20 w-48 bg-panel/85 p-3 backdrop-blur-md">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        <span className="soft-blink h-1.5 w-1.5 rotate-45 bg-primary" />
        图例
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2.5">
            <span className="grid w-6 place-items-center">{it.el}</span>
            <span className="text-[11.5px] text-foreground/80">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Interaction types                                                 */
/* ------------------------------------------------------------------ */

type Drag =
  | { kind: 'pan'; last: Vec }
  | { kind: 'place'; start: Vec }
  | { kind: 'building'; start: Vec }
  | { kind: 'marquee'; start: Vec }
  | { kind: 'move'; last: Vec; moved: boolean }
  | { kind: 'waypoint'; edgeId: string; index: number; moved: boolean }
  | { kind: 'bend'; edgeId: string; index: number; last: Vec; moved: boolean }
  | { kind: 'transition'; edgeId: string; moved: boolean }
  | { kind: 'edge'; from: string; raw: Vec[] }
  | null

interface Preview {
  place?: Rect
  marquee?: Rect
  edge?: { pts: Vec[]; snap: string | null }
}

/* ---- hit radii in SCREEN pixels, converted to world units at call time
   via `px * worldPerPixel()`. Using screen-px constants (instead of the old
   fixed world-unit thresholds) keeps click/drag targets a constant size on
   screen regardless of zoom — the old fixed-world-unit radii shrank to
   almost nothing when zoomed out, which is why waypoint/edge grabbing felt
   unresponsive. ---- */
const WAYPOINT_HIT_PX = 13
const EDGE_HIT_PX = 11
const TRANSITION_HIT_PX = 14
const MERGE_DIST_PX = 16
const HIGHLIGHT_HIT_PX = 12
/** min screen-px pointer travel before another hidden bend point is appended */
const BEND_SAMPLE_PX = 9
/** RDP epsilon (screen px) used to simplify the hidden-point run on release */
const BEND_SIMPLIFY_EPS_PX = 4.5

/* ------------------------------------------------------------------ */
/*  Element renderers (pure SVG, world coordinates)                   */
/* ------------------------------------------------------------------ */

/** 单个显示矩形——不再携带名称/尺度（那些属于聚合场景节点，见
 *  SceneLabel），本身只是"这是场景占据的一块地"。同一场景的多个成员框
 *  共用同一份选中/悬停高亮语义。 */
function SceneBoxRect({
  b,
  selected,
  pulsing,
  dropTarget,
  opacity,
  interactive,
}: {
  b: SceneBox
  selected: boolean
  pulsing: boolean
  dropTarget: boolean
  opacity: number
  interactive: boolean
}) {
  const stroke = selected ? 'var(--edge-selected)' : 'var(--primary)'
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  return (
    <g
      className={pulsing ? 'diag-pulse' : ''}
      opacity={opacity}
      transform={b.rotation ? `rotate(${b.rotation} ${cx} ${cy})` : undefined}
      style={{
        pointerEvents: interactive ? 'auto' : 'none',
        filter: selected
          ? 'drop-shadow(0 6px 10px rgba(0,0,0,0.5)) drop-shadow(0 0 6px var(--edge-selected))'
          : dropTarget
            ? 'drop-shadow(0 0 8px var(--primary))'
            : undefined,
      }}
    >
      <rect
        x={b.x}
        y={b.y}
        width={b.width}
        height={b.height}
        rx={6}
        fill={
          selected
            ? 'color-mix(in srgb, var(--edge-selected) 12%, transparent)'
            : 'color-mix(in srgb, var(--primary) 8%, transparent)'
        }
        stroke={stroke}
        strokeWidth={selected ? 2.4 : 1.8}
        strokeDasharray="10 7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="cursor-pointer"
      />
      {(selected || dropTarget) && (
        <rect
          x={b.x + 4}
          y={b.y + 4}
          width={b.width - 8}
          height={b.height - 8}
          rx={7}
          fill="none"
          stroke={stroke}
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}

/** 场景名称/尺度徽标——每个场景节点只画一次，锚定在其成员框聚合外接矩形
 *  的左上角，不随框数量重复。 */
function SceneLabel({
  node,
  bbox,
  selected,
  opacity,
}: {
  node: SceneNode
  bbox: Rect
  selected: boolean
  opacity: number
}) {
  return (
    <g opacity={opacity} style={{ pointerEvents: 'none' }}>
      <rect
        x={bbox.x + 8}
        y={bbox.y + 8}
        width={Math.min(bbox.width - 16, node.name.length * 15 + 46)}
        height={26}
        rx={4}
        fill="var(--panel)"
        stroke="var(--border-strong)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={bbox.x + bbox.width / 2}
        y={bbox.y + bbox.height / 2 + 8}
        textAnchor="middle"
        fill={selected ? 'var(--edge-selected)' : 'var(--primary)'}
        fontSize={28}
        fontWeight={800}
        fontFamily="var(--font-mono)"
        className="select-none"
      >
        {node.scale.charAt(0).toUpperCase()}
      </text>
      <text
        x={bbox.x + bbox.width / 2}
        y={bbox.y + bbox.height + 20}
        textAnchor="middle"
        fill="var(--foreground)"
        fontSize={14}
        fontWeight={700}
        className="select-none"
      >
        {node.name}
      </text>
    </g>
  )
}

/** 高光点（B1）——场景节点的逻辑锚点，连线永远接这个点。青色发光小圆，
 *  悬停更亮，1 秒后弹出名称/尺度/图层/说明浮层。单击等价于点击成员框：
 *  选中整个场景节点；edge 模式下命中测试把它当作合法连线起点/终点。 */
function HighlightPoint({
  node,
  anchor,
  selected,
  edgeModeActive,
  opacity,
  interactive,
}: {
  node: SceneNode
  anchor: Vec
  selected: boolean
  edgeModeActive: boolean
  opacity: number
  interactive: boolean
}) {
  const [hover, setHover] = useState(false)
  const [showTip, setShowTip] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (hover) {
      timerRef.current = window.setTimeout(() => setShowTip(true), 1000)
    } else {
      setShowTip(false)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [hover])

  const active = hover || selected
  const r = active ? (edgeModeActive ? 8 : 7) : 6
  const color = selected ? 'var(--edge-selected)' : 'var(--primary)'

  return (
    <g opacity={opacity} style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
      <circle
        cx={anchor.x}
        cy={anchor.y}
        r={r + 5}
        fill="transparent"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        className="cursor-pointer"
      />
      <circle
        cx={anchor.x}
        cy={anchor.y}
        r={r}
        fill={color}
        style={{
          filter: `drop-shadow(0 0 ${active ? 10 : 6}px ${color})`,
          pointerEvents: 'none',
        }}
      />
      {showTip && (
        <g transform={`translate(${anchor.x + 14} ${anchor.y - 14})`} style={{ pointerEvents: 'none' }}>
          <rect
            x={0}
            y={-16}
            width={Math.max(120, node.name.length * 13 + 60)}
            height={54}
            rx={5}
            fill="var(--panel)"
            stroke="var(--border-strong)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text x={10} y={0} fill="var(--foreground)" fontSize={13} fontWeight={700}>
            {node.name}
          </text>
          <text x={10} y={18} fill="var(--muted-foreground)" fontSize={11} fontFamily="var(--font-mono)">
            尺度 {SCALE_LABEL[node.scale]}
            {node.def ? ` · ${node.def}` : ''}
          </text>
        </g>
      )}
    </g>
  )
}

function EdgePath({
  e,
  doc,
  selected,
  pulsing,
}: {
  e: Edge
  doc: MapDoc
  selected: boolean
  pulsing: boolean
}) {
  const fromExists = doc.sceneNodes.some((n) => n.id === e.from)
  const toExists = doc.sceneNodes.some((n) => n.id === e.to)
  if (!fromExists || !toExists) return null
  const from = nodeAnchor(e.from, doc)
  const to = nodeAnchor(e.to, doc)
  const pts = [from, ...e.points.slice(1, -1), to]
  const d = catmullRomPath(pts)
  const color = selected ? 'var(--edge-selected)' : 'var(--edge)'
  const tip = catmullRomAt(pts, 0.82)
  const before = catmullRomAt(pts, 0.78)
  const ang = (Math.atan2(tip.y - before.y, tip.x - before.x) * 180) / Math.PI
  const mid = catmullRomAt(pts, 0.5)
  const showBackArrow = e.directionality === 'bidirectional'

  const anchorColor =
    e.semanticAnchor === 'highland'
      ? '#1a7a3c'
      : e.semanticAnchor === 'lowland'
        ? '#74c28a'
        : null
  const anchorR = e.semanticAnchor === 'highland' ? 9 : e.semanticAnchor === 'lowland' ? 5 : 0

  return (
    <g
      className={pulsing ? 'diag-pulse' : ''}
      style={{ filter: `drop-shadow(0 0 4px ${color})` }}
    >
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        vectorEffect="non-scaling-stroke"
        className="cursor-pointer"
        data-edge-hit={e.id}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 3 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity={selected ? 1 : 0.85}
      />
      {!selected && (
        <path
          className="edge-flow"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <g transform={`translate(${tip.x} ${tip.y}) rotate(${ang})`}>
        <path d="M0 0 L-11 -6 L-11 6 Z" fill={color} vectorEffect="non-scaling-stroke" />
      </g>
      {showBackArrow &&
        (() => {
          const t2 = catmullRomAt(pts, 0.18)
          const b2 = catmullRomAt(pts, 0.22)
          const a2 = (Math.atan2(t2.y - b2.y, t2.x - b2.x) * 180) / Math.PI
          return (
            <g transform={`translate(${t2.x} ${t2.y}) rotate(${a2})`}>
              <path d="M0 0 L-11 -6 L-11 6 Z" fill={color} opacity={0.8} />
            </g>
          )
        })()}
      {/* 语义锚点装饰（B9）——仅表现层，不接入玩法逻辑 */}
      {anchorColor && (
        <circle
          cx={mid.x}
          cy={mid.y}
          r={anchorR}
          fill={anchorColor}
          opacity={0.55}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  )
}

function RotatableBox({
  x,
  y,
  width,
  height,
  rotation,
  color,
  selected,
  pulsing,
  dashed,
  hitAttr,
}: {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  color: string
  selected: boolean
  pulsing: boolean
  dashed?: boolean
  hitAttr: Record<string, string>
}) {
  const cx = x + width / 2
  const cy = y + height / 2
  return (
    <g
      className={pulsing ? 'diag-pulse' : ''}
      transform={`rotate(${rotation} ${cx} ${cy})`}
      style={{
        filter: selected ? `drop-shadow(0 0 7px ${color})` : undefined,
      }}
    >
      <rect
        {...hitAttr}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={`color-mix(in srgb, ${color} ${selected ? 32 : 22}%, transparent)`}
        stroke={color}
        strokeWidth={selected ? 2.4 : 1.8}
        strokeDasharray={dashed ? '8 5' : undefined}
        vectorEffect="non-scaling-stroke"
        className="cursor-pointer"
      />
      {selected && (
        <text
          x={cx}
          y={y - 8}
          textAnchor="middle"
          fill={color}
          fontSize={12}
          fontFamily="var(--font-mono)"
          className="pointer-events-none select-none"
        >
          {Math.round(rotation)}°
        </text>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Main canvas                                                       */
/* ------------------------------------------------------------------ */

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag>(null)
  const spaceRef = useRef(false)
  const altRef = useRef(false)
  const [preview, setPreview] = useState<Preview>({})

  const doc = useEditor((s) => s.doc)
  const mode = useEditor((s) => s.mode)
  const selection = useEditor((s) => s.selection)
  const camera = useEditor((s) => s.camera)
  const pulse = useEditor((s) => s.pulse)
  const dragMaterial = useEditor((s) => s.dragMaterial)
  const currentLayerId = useEditor((s) => s.currentLayerId)

  const selIds = new Set(selection.map((s) => s.id))
  const firstSelection = selection[0]
  const singleEdgeSel =
    selection.length === 1 && firstSelection?.type === 'edge'
      ? doc.edges.find((e) => e.id === firstSelection.id)
      : null

  useEffect(() => {
    registerCanvas(svgRef.current)
    return () => registerCanvas(null)
  }, [])

  // track spacebar for pan, alt for temporary sample gesture (B10)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) spaceRef.current = true
      if (e.key === 'Alt') altRef.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
      if (e.key === 'Alt') altRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const toW = useCallback((e: { clientX: number; clientY: number }): Vec => {
    return screenToWorld(e.clientX, e.clientY) ?? { x: 0, y: 0 }
  }, [])

  /* ---------- hit testing (top-most first) ---------- */
  const hitTest = useCallback(
    (w: Vec): { type: string; id: string } | null => {
      const d = getState().doc
      const wpp = worldPerPixel()
      // placements (top)
      for (let i = d.placements.length - 1; i >= 0; i--) {
        const p = d.placements[i]
        if (!p) continue
        if (pointInRect(w, { x: p.x - 18, y: p.y - 18, width: 36, height: 36 }))
          return { type: 'placement', id: p.id }
      }
      // transition windows
      for (const e of d.edges) {
        if (e.transitionWindow) {
          if (dist(w, e.transitionWindow) < TRANSITION_HIT_PX * wpp)
            return { type: 'transition', id: e.id }
        }
      }
      // building groups are presentation branches and have their own hit target
      for (let i = (d.buildingGroups ?? []).length - 1; i >= 0; i--) {
        const building = d.buildingGroups?.[i]
        if (building && pointInRect(w, building.frame)) return { type: 'building', id: building.id }
      }
      // highlight points (take priority over the box body they sit inside)
      for (let i = d.sceneNodes.length - 1; i >= 0; i--) {
        const n = d.sceneNodes[i]
        if (!n) continue
        const a = nodeAnchor(n.id, d)
        if (dist(w, a) < HIGHLIGHT_HIT_PX * wpp) return { type: 'scene', id: n.id }
      }
      // scene boxes
      for (let i = d.sceneBoxes.length - 1; i >= 0; i--) {
        const b = d.sceneBoxes[i]
        if (!b) continue
        if (pointInRotatedRect(w, b, b.rotation ?? 0))
          return { type: 'scene', id: b.sceneId }
      }
      // edges
      for (const e of d.edges) {
        if (!d.sceneNodes.some((n) => n.id === e.from) || !d.sceneNodes.some((n) => n.id === e.to))
          continue
        const from = nodeAnchor(e.from, d)
        const to = nodeAnchor(e.to, d)
        const pts = [from, ...e.points.slice(1, -1), to]
        if (pointToPolyline(w, pts).distance < EDGE_HIT_PX * wpp)
          return { type: 'edge', id: e.id }
      }
      // obstructions
      for (let i = d.obstructions.length - 1; i >= 0; i--) {
        const o = d.obstructions[i]
        if (!o) continue
        if (pointInRotatedRect(w, o, o.rotation))
          return { type: 'obstruction', id: o.id }
      }
      // terrains
      for (let i = d.terrains.length - 1; i >= 0; i--) {
        const t = d.terrains[i]
        if (!t) continue
        if (pointInRotatedRect(w, t, t.rotation))
          return { type: 'terrain', id: t.id }
      }
      return null
    },
    [],
  )

  /* ---------- waypoint hit (only when an edge is selected) ----------
     Only VISIBLE (non-hidden) points count — hidden bend points have no
     handle, so they're deliberately excluded here; grabbing near one just
     falls through to the edge-body bend gesture below. */
  const waypointHit = useCallback(
    (w: Vec): number => {
      if (!singleEdgeSel) return -1
      const d = getState().doc
      const e = d.edges.find((x) => x.id === singleEdgeSel.id)
      if (!e) return -1
      const r = WAYPOINT_HIT_PX * worldPerPixel()
      for (let i = 1; i < e.points.length - 1; i++) {
        const point = e.points[i]
        if (!point || point.hidden) continue
        if (dist(w, point) < r) return i
      }
      return -1
    },
    [singleEdgeSel],
  )

  /* ---------- edge-body hit for the currently selected edge ----------
     Used to start the freehand bend gesture: dragging directly on the
     line of an already-selected edge bends it (adds hidden points) rather
     than translating the whole edge. Returns the nearest segment index. */
  const selectedEdgeBodyHit = useCallback((w: Vec): number => {
    if (!singleEdgeSel) return -1
    const d = getState().doc
    const e = d.edges.find((x) => x.id === singleEdgeSel.id)
    if (!e) return -1
    if (!d.sceneNodes.some((n) => n.id === e.from) || !d.sceneNodes.some((n) => n.id === e.to))
      return -1
    const from = nodeAnchor(e.from, d)
    const to = nodeAnchor(e.to, d)
    const pts = [from, ...e.points.slice(1, -1), to]
    const { distance, segment } = pointToPolyline(w, pts)
    if (distance < EDGE_HIT_PX * worldPerPixel()) return segment
    return -1
  }, [singleEdgeSel])

  /* ---------- pointer down ---------- */
  const onPointerDown = useCallback(
    (ev: React.PointerEvent) => {
      if (ev.button === 2) return // right-click handled by context menu
      const w = toW(ev)
      svgRef.current?.setPointerCapture(ev.pointerId)

      // pan: space or middle button
      if (spaceRef.current || ev.button === 1) {
        dragRef.current = { kind: 'pan', last: { x: ev.clientX, y: ev.clientY } }
        return
      }

      // Alt+click anywhere = temporary sample gesture (B10), regardless of
      // current tool mode; releases back to whatever mode was active.
      if (altRef.current) {
        const hit = hitTest(w)
        if (hit) altSample({ type: hit.type as never, id: hit.id })
        return
      }

      if (mode === 'place') {
        dragRef.current = { kind: 'place', start: w }
        setPreview({ place: { x: w.x, y: w.y, width: 0, height: 0 } })
        return
      }

      if (mode === 'building') {
        dragRef.current = { kind: 'building', start: w }
        setPreview({ place: { x: w.x, y: w.y, width: 0, height: 0 } })
        return
      }

      if (mode === 'edge') {
        const sceneId = sceneIdAtPoint(w)
        if (sceneId) {
          const anchor = nodeAnchor(sceneId, getState().doc)
          dragRef.current = { kind: 'edge', from: sceneId, raw: [anchor, w] }
          setPreview({ edge: { pts: [anchor, w], snap: null } })
          playSfx('click')
        }
        return
      }

      if (mode === 'sample') {
        const hit = hitTest(w)
        if (hit) {
          const slot = getState().sampleSlot
          if (slot && hit.type === 'scene') applySampleToScene(hit.id)
          else sampleElement({ type: hit.type as never, id: hit.id })
        }
        return
      }

      if (mode === 'playtest') return

      /* ---- select mode ---- */
      // waypoint drag first — grabbing an existing visible handle always
      // wins over starting a new bend.
      const wp = waypointHit(w)
      if (wp >= 0 && singleEdgeSel) {
        beginHistory()
        dragRef.current = {
          kind: 'waypoint',
          edgeId: singleEdgeSel.id,
          index: wp,
          moved: false,
        }
        return
      }

      // freehand bend: dragging directly on the body of the CURRENTLY
      // SELECTED edge re-shapes the curve (appends hidden points) instead
      // of translating the whole edge. An unselected edge still falls
      // through to the generic hit-test below (click selects + can drag
      // the whole shape), matching the old "select first, then bend" flow.
      const bendSeg = selectedEdgeBodyHit(w)
      if (bendSeg >= 0 && singleEdgeSel) {
        beginHistory()
        const idx = appendBendPoint(singleEdgeSel.id, bendSeg, w)
        dragRef.current = {
          kind: 'bend',
          edgeId: singleEdgeSel.id,
          index: idx,
          last: w,
          moved: false,
        }
        return
      }

      const hit = hitTest(w)
      if (hit) {
        if (hit.type === 'transition') {
          beginHistory()
          dragRef.current = { kind: 'transition', edgeId: hit.id, moved: false }
          return
        }
        const already = selIds.has(hit.id)
        if (!already) {
          if (ev.shiftKey) {
            setSelection([
              ...selection,
              { type: hit.type as never, id: hit.id },
            ])
          } else {
            selectOne(hit.type as never, hit.id)
          }
          playSfx('select')
        }
        // start move (scenes / boxes / placements / edges)
        beginHistory()
        dragRef.current = { kind: 'move', last: w, moved: false }
        return
      }

      // empty: marquee select
      if (!ev.shiftKey) clearSelection()
      dragRef.current = { kind: 'marquee', start: w }
      setPreview({ marquee: { x: w.x, y: w.y, width: 0, height: 0 } })
    },
    [mode, toW, hitTest, waypointHit, singleEdgeSel, selection, selIds],
  )

  /* ---------- pointer move ---------- */
  const onPointerMove = useCallback(
    (ev: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const w = toW(ev)

      switch (drag.kind) {
        case 'pan': {
          const prev = screenToWorld(drag.last.x, drag.last.y)!
          const cur = screenToWorld(ev.clientX, ev.clientY)!
          const cam = getState().camera
          setCamera({
            ...cam,
            x: cam.x - (cur.x - prev.x),
            y: cam.y - (cur.y - prev.y),
          })
          drag.last = { x: ev.clientX, y: ev.clientY }
          break
        }
        case 'place':
        case 'building':
          setPreview({ place: rectFromDrag(drag.start, w) })
          break
        case 'marquee': {
          const rect = rectFromDrag(drag.start, w)
          setPreview({ marquee: rect })
          break
        }
        case 'move': {
          const dx = w.x - drag.last.x
          const dy = w.y - drag.last.y
          if (dx || dy) {
            drag.moved = true
            moveSelection(dx, dy)
            drag.last = w
          }
          break
        }
        case 'waypoint': {
          drag.moved = true
          moveWaypoint(drag.edgeId, drag.index, w, true)
          break
        }
        case 'bend': {
          // append another hidden point only once the pointer has actually
          // travelled a constant SCREEN distance — this is what makes the
          // curve feel like it's continuously following the cursor instead
          // of only reacting to a single click.
          const minStep = BEND_SAMPLE_PX * worldPerPixel()
          if (dist(w, drag.last) >= minStep) {
            drag.moved = true
            drag.index = appendBendPoint(drag.edgeId, drag.index, w)
            drag.last = w
          }
          break
        }
        case 'transition': {
          drag.moved = true
          updateEdge(drag.edgeId, { transitionWindow: w }, false)
          break
        }
        case 'edge': {
          drag.raw.push(w)
          const sceneId = sceneIdAtPoint(w)
          const snap = sceneId && sceneId !== drag.from ? sceneId : null
          setPreview({
            edge: {
              pts: [...drag.raw],
              snap,
            },
          })
          break
        }
      }
    },
    [toW],
  )

  /* ---------- pointer up ---------- */
  const onPointerUp = useCallback(
    (ev: React.PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      try {
        svgRef.current?.releasePointerCapture(ev.pointerId)
      } catch {}
      if (!drag) return
      const w = toW(ev)

      switch (drag.kind) {
        case 'place': {
          const rect = rectFromDrag(drag.start, w)
          if (rect.width > 20 && rect.height > 20) {
            // B3：粘连/嵌套洞检查在 addScene 内部完成，被拒绝时返回 null
            const id = addScene(rect)
            if (id) {
              selectOne('scene', id)
              playSfx('success')
            } else {
              playSfx('error')
              flashDiscard()
            }
          }
          setPreview({})
          setMode('select')
          break
        }
        case 'building': {
          const rect = rectFromDrag(drag.start, w)
          if (rect.width > 20 && rect.height > 20) {
            const id = addBuildingGroup(rect)
            if (id) {
              selectOne('building', id)
              playSfx('success')
            }
          }
          setPreview({})
          setMode('select')
          break
        }
        case 'marquee': {
          const rect = rectFromDrag(drag.start, w)
          if (rect.width > 5 || rect.height > 5) {
            const next: { type: 'scene' | 'obstruction' | 'terrain' | 'placement'; id: string }[] = []
            for (const node of getState().doc.sceneNodes) {
              const boxes = boxesOfScene(node.id, getState().doc)
              if (boxes.some((box) => rectsOverlap(rect, rotatedRectAABB(box, box.rotation ?? 0)))) {
                next.push({ type: 'scene', id: node.id })
              }
            }
            for (const item of getState().doc.obstructions) {
              if (rectsOverlap(rect, rotatedRectAABB(item, item.rotation))) next.push({ type: 'obstruction', id: item.id })
            }
            for (const item of getState().doc.terrains) {
              if (rectsOverlap(rect, rotatedRectAABB(item, item.rotation))) next.push({ type: 'terrain', id: item.id })
            }
            for (const item of getState().doc.placements) {
              if (pointInRect({ x: item.x, y: item.y }, rect, 18)) next.push({ type: 'placement', id: item.id })
            }
            if (ev.shiftKey) setSelection([...selection, ...next])
            else setSelection(next)
          }
          setPreview({})
          break
        }
        case 'edge': {
          const sceneId = sceneIdAtPoint(w)
          if (sceneId && sceneId !== drag.from) {
            // RDP simplify raw trace, keep endpoints as centers
            const simplified = rdp(drag.raw, 22)
            const id = addEdge(drag.from, sceneId, simplified)
            selectOne('edge', id)
            playSfx('success')
          } else {
            // discard + red flash
            playSfx('warning')
            flashDiscard()
          }
          setPreview({})
          break
        }
        case 'waypoint': {
          if (drag.moved) {
            // merge-delete if dropped near a neighbor
            const e = getState().doc.edges.find((x) => x.id === drag.edgeId)
            if (e) {
              const mergeR = MERGE_DIST_PX * worldPerPixel()
              const p = e.points[drag.index]
              const prev = e.points[drag.index - 1]
              const next = e.points[drag.index + 1]
              if (!p) break
              if (
                (prev && dist(p, prev) < mergeR) ||
                (next && dist(p, next) < mergeR)
              ) {
                deleteWaypoint(drag.edgeId, drag.index)
                toast('已融合折点', 'info')
              }
            }
          }
          break
        }
        case 'bend': {
          // simplify the hidden-point run just laid down so a long, slow
          // drag doesn't leave hundreds of near-collinear hidden points —
          // this keeps undo history and export payloads clean.
          simplifyEdgeHiddenRuns(drag.edgeId, BEND_SIMPLIFY_EPS_PX * worldPerPixel())
          if (drag.moved) toast('已调整连线弯曲', 'info')
          break
        }
        case 'move': {
          // B3：整组拖拽落定时判定��连——若移动后的场景同时压到两个不同
          // sceneId 的框，`commitSceneMove` 会自动把这次拖拽还原到松手前的
          // 位置并返回 false，这里只需要给出错误反馈。
          if (drag.moved) {
            const sceneIds = getState()
              .selection.filter((s) => s.type === 'scene')
              .map((s) => s.id)
            if (sceneIds.length && !commitSceneMove(sceneIds)) {
              playSfx('error')
              toast('不能跨场景连接', 'error')
              flashDiscard()
            }
          }
          break
        }
      }
    },
    [toW],
  )

  /* ---------- double click ---------- */
  const onDoubleClick = useCallback(
    (ev: React.MouseEvent) => {
      if (mode !== 'select') return
      const w = toW(ev)
      const hit = hitTest(w)
      if (!hit) return // 双击空白不创建
      if (hit.type === 'scene') {
        const d = getState().doc
        const bbox = sceneGroupBBox(boxesOfScene(hit.id, d))
        if (bbox) focusOnBBox(bbox)
        playSfx('click')
      } else if (hit.type === 'edge') {
        const d = getState().doc
        const e = d.edges.find((x) => x.id === hit.id)
        if (!e) return
        selectOne('edge', e.id)
        const from = nodeAnchor(e.from, d)
        const to = nodeAnchor(e.to, d)
        const pts = [from, ...e.points.slice(1, -1), to]
        const seg = pointToPolyline(w, pts).segment
        beginHistory()
        // segment-scoped: if the clicked segment is part of a freehand
        // bend (has hidden points), instantly straighten just that run.
        // Otherwise fall back to inserting a new explicit waypoint there —
        // this is the one reshape entry point the spec calls for, now
        // correctly scoped to "this segment" instead of the whole edge.
        if (straightenEdgeSegment(e.id, seg)) {
          toast('已拍直该段连线', 'info')
        } else {
          insertWaypoint(e.id, seg, w)
          toast('已插入折点', 'info')
        }
      }
    },
    [mode, toW, hitTest],
  )

  /* ---------- wheel: zoom, or rotate selected box ---------- */
  const onWheel = useCallback(
    (ev: React.WheelEvent) => {
      const sel = getState().selection
      // rotate obstruction/terrain if single selected
      const selected = sel[0]
      if (
        selected &&
        sel.length === 1 &&
        (selected.type === 'obstruction' || selected.type === 'terrain')
      ) {
        const step = ev.deltaY > 0 ? 10 : -10
        if (selected.type === 'obstruction') {
          const o = getState().doc.obstructions.find((x) => x.id === selected.id)
          if (o) updateObstruction(o.id, { rotation: o.rotation + step })
        } else {
          const t = getState().doc.terrains.find((x) => x.id === selected.id)
          if (t) updateTerrain(t.id, { rotation: t.rotation + step })
        }
        return
      }
      // B2：绕组外接矩形中心整体旋转 10°/格——旋转所有成员框的几何，非仅
      // 当前框；多选场景时逐个各自绕自己的组中心转，互不影响。
      if (sel.length > 0 && sel.every((s) => s.type === 'scene')) {
        const step = ev.deltaY > 0 ? 10 : -10
        sel.forEach((s) => rotateSceneGroup(s.id, step, false))
        playSfx('click')
        return
      }
      // zoom at cursor
      const cam = getState().camera
      const w = toW(ev)
      const factor = ev.deltaY > 0 ? 1.12 : 1 / 1.12
      const newW = clamp(cam.w * factor, 200, WORLD.w * 3)
      const newH = newW * (cam.h / cam.w)
      // keep world point under cursor stationary
      const rx = (w.x - cam.x) / cam.w
      const ry = (w.y - cam.y) / cam.h
      setCamera({
        x: w.x - rx * newW,
        y: w.y - ry * newH,
        w: newW,
        h: newH,
      })
    },
    [toW],
  )

  /* ---------- helpers bound to store ---------- */
  function moveSelection(dx: number, dy: number) {
    const st = getState()
    const d = st.doc
    st.selection.forEach((sel) => {
      if (sel.type === 'scene') {
        // whole group moves together (B2) — every member box + placements
        // that belong to this scene id
        moveSceneGroup(sel.id, dx, dy, true)
        d.placements
          .filter((p) => p.sceneId === sel.id)
          .forEach((p) =>
            updatePlacement(p.id, { x: p.x + dx, y: p.y + dy }, false),
          )
      } else if (sel.type === 'obstruction') {
        const o = d.obstructions.find((x) => x.id === sel.id)
        if (o) updateObstruction(sel.id, { x: o.x + dx, y: o.y + dy }, false)
      } else if (sel.type === 'terrain') {
        const t = d.terrains.find((x) => x.id === sel.id)
        if (t) updateTerrain(sel.id, { x: t.x + dx, y: t.y + dy }, false)
      } else if (sel.type === 'placement') {
        const p = d.placements.find((x) => x.id === sel.id)
        if (p) updatePlacement(sel.id, { x: p.x + dx, y: p.y + dy }, false)
      } else if (sel.type === 'edge') {
        // move all middle waypoints (endpoints stay pinned to scenes)
        const e = d.edges.find((x) => x.id === sel.id)
        if (e && e.points.length > 2) {
          const pts = e.points.map((pt, i) =>
            i === 0 || i === e.points.length - 1
              ? pt
              : { x: pt.x + dx, y: pt.y + dy },
          )
          updateEdge(sel.id, { points: pts }, false)
        }
      }
    })
  }

  const [discard, setDiscard] = useState(false)
  function flashDiscard() {
    setDiscard(true)
    window.setTimeout(() => setDiscard(false), 260)
  }

  function focusOnBBox(bbox: Rect) {
    const cx = bbox.x + bbox.width / 2
    const cy = bbox.y + bbox.height / 2
    const w = Math.max(bbox.width * 3, 700)
    const h = w * (camera.h / camera.w)
    flyTo({ x: cx - w / 2, y: cy - h / 2, w, h })
  }

  // cursor per mode
  const cursor =
    mode === 'place'
      ? 'crosshair'
      : mode === 'edge'
        ? 'crosshair'
        : mode === 'sample'
          ? 'copy'
          : spaceRef.current
            ? 'grab'
            : 'default'

  const nodeById = new Map(doc.sceneNodes.map((n) => [n.id, n]))
  const opacityForLayer = (layerId: string) =>
    layerId === currentLayerId ? 1 : layerOpacity(layerId)

  // B3：空洞全填——按 sceneId 分组的洞格子，仅在成员框集合变化时重算
  const holeCells = useMemo(() => computeHoleCells(doc), [doc.sceneBoxes])

  return (
    <div className="relative flex-1 overflow-hidden bg-panel-inset" data-ctx="canvas">
      {/* ambient projection backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src="/editor/canvas-bg.png"
          alt=""
          aria-hidden
          className="pixelated h-full w-full scale-105 object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-panel-inset/50 via-transparent to-panel-inset/80" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_38%,rgba(4,10,18,0.7)_100%)]" />
      </div>
      <DustField count={12} />

      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full touch-none"
        viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(ev) => {
          // select element under cursor so the HUD context menu targets it
          const w = toW(ev)
          const hit = hitTest(w)
          if (hit && hit.type !== 'transition') {
            selectOne(hit.type as never, hit.id)
          } else {
            clearSelection()
          }
        }}
      >
        <defs>
          <pattern
            id="grid"
            width={80}
            height={80}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M80 0 H0 V80"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              opacity={0.18}
            />
          </pattern>
        </defs>

        {/* grid across a generous world region */}
        <rect
          x={-WORLD.w}
          y={-WORLD.h}
          width={WORLD.w * 3}
          height={WORLD.h * 3}
          fill="url(#grid)"
        />
        {/* world bounds */}
        <rect
          x={0}
          y={0}
          width={WORLD.w}
          height={WORLD.h}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="4 6"
          vectorEffect="non-scaling-stroke"
          opacity={0.4}
        />

        {/* terrains (bottom) */}
        {doc.terrains.map((t) => (
          <RotatableBox
            key={t.id}
            x={t.x}
            y={t.y}
            width={t.width}
            height={t.height}
            rotation={t.rotation}
            color={t.type === 'highland' ? '#1a7a3c' : '#74c28a'}
            selected={selIds.has(t.id)}
            pulsing={pulse?.id === t.id}
            hitAttr={{}}
          />
        ))}

        {/* obstructions */}
        {doc.obstructions.map((o) => (
          <RotatableBox
            key={o.id}
            x={o.x}
            y={o.y}
            width={o.width}
            height={o.height}
            rotation={o.rotation}
            color={o.type === 'visual' ? 'var(--box-mask)' : 'var(--box-physics)'}
            selected={selIds.has(o.id)}
            pulsing={pulse?.id === o.id}
            hitAttr={{}}
          />
        ))}

        {/* building group frames: independent branch bounds, never merged into scene boxes */}
        {(doc.buildingGroups ?? []).map((building) => {
          const selected = selIds.has(building.id)
          const previewFloor = [...building.floors].sort((a, b) => a.ordinal - b.ordinal)[0]
          return (
            <g key={`building-${building.id}`} data-building-group={building.id} pointerEvents="none">
              {previewFloor?.image ? (
                <image
                  href={previewFloor.image}
                  x={building.frame.x}
                  y={building.frame.y}
                  width={building.frame.width}
                  height={building.frame.height}
                  preserveAspectRatio="xMidYMid meet"
                  opacity={selected ? 0.72 : 0.42}
                />
              ) : null}
              <rect
                x={building.frame.x}
                y={building.frame.y}
                width={building.frame.width}
                height={building.frame.height}
                fill={previewFloor?.image ? 'none' : 'color-mix(in srgb, var(--primary) 6%, transparent)'}
                stroke={selected ? 'var(--accent)' : 'var(--primary)'}
                strokeDasharray="8 5"
                strokeWidth={selected ? 3 : 2}
                opacity={selected ? 0.95 : 0.62}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={building.frame.x + 8}
                y={building.frame.y + 18}
                fill={selected ? 'var(--accent)' : 'var(--primary)'}
                fontSize={12}
                fontWeight={700}
              >
                {`${building.id} · ${building.floors.length}/3 层`}
              </text>
            </g>
          )
        })}

        {/* edges */}
        {doc.edges.map((e) => (
          <EdgePath
            key={e.id}
            e={e}
            doc={doc}
            selected={selIds.has(e.id)}
            pulsing={pulse?.id === e.id}
          />
        ))}

        {/* scene boxes */}
        {doc.sceneBoxes.map((b) => {
          const node = nodeById.get(b.sceneId)
          const isCurrent = node ? node.layerId === currentLayerId : true
          return (
            <SceneBoxRect
              key={b.id}
              b={b}
              selected={selIds.has(b.sceneId)}
              pulsing={pulse?.id === b.sceneId}
              dropTarget={dragMaterial?.overScene === b.sceneId}
              opacity={node ? opacityForLayer(node.layerId) : 1}
              interactive={isCurrent}
            />
          )
        })}

        {/* B3：空洞全填——多矩形拼接场景中被完全围住的天井，纯视觉油漆桶
            填充，不参与命中测试（仅提示"这里不能再嵌套放置"） */}
        <g className="pointer-events-none">
          {Array.from(holeCells.entries()).flatMap(([sceneId, cells]) => {
            const node = nodeById.get(sceneId)
            const op = node ? opacityForLayer(node.layerId) : 1
            return cells.map((cell, i) => (
              <rect
                key={`${sceneId}-${i}`}
                x={cell.x}
                y={cell.y}
                width={cell.size}
                height={cell.size}
                fill="var(--primary)"
                fillOpacity={0.14 * op}
                stroke="var(--primary)"
                strokeOpacity={0.22 * op}
                strokeWidth={1}
              />
            ))
          })}
        </g>

        {/* scene labels + highlight points, once per node */}
        {doc.sceneNodes.map((n) => {
          const boxes = boxesOfScene(n.id, doc)
          const bbox = sceneGroupBBox(boxes)
          const anchor = nodeAnchor(n.id, doc)
          const isCurrent = n.layerId === currentLayerId
          const op = opacityForLayer(n.layerId)
          return (
            <g key={n.id}>
              {bbox && (
                <SceneLabel
                  node={n}
                  bbox={bbox}
                  selected={selIds.has(n.id)}
                  opacity={op}
                />
              )}
              <HighlightPoint
                node={n}
                anchor={anchor}
                selected={selIds.has(n.id)}
                edgeModeActive={mode === 'edge'}
                opacity={op}
                interactive={isCurrent}
              />
            </g>
          )
        })}

        {/* transition windows */}
        {doc.edges.map((e) =>
          e.transitionWindow ? (
            <g
              key={`tw-${e.id}`}
              transform={`translate(${e.transitionWindow.x} ${e.transitionWindow.y}) rotate(45)`}
              style={{ filter: 'drop-shadow(0 0 6px var(--transition))' }}
            >
              <rect
                x={-11}
                y={-11}
                width={22}
                height={22}
                rx={3}
                fill="color-mix(in srgb, var(--transition) 25%, transparent)"
                stroke="var(--transition)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className={selIds.has(e.id) ? '' : 'cursor-pointer'}
              />
            </g>
          ) : null,
        )}

        {/* waypoints for the selected edge */}
        {singleEdgeSel &&
          doc.sceneNodes.some((n) => n.id === singleEdgeSel.from) &&
          doc.sceneNodes.some((n) => n.id === singleEdgeSel.to) &&
          (() => {
            const from = nodeAnchor(singleEdgeSel.from, doc)
            const to = nodeAnchor(singleEdgeSel.to, doc)
            const pts = [from, ...singleEdgeSel.points.slice(1, -1), to]
            return pts.map((p, i) => {
              const endpoint = i === 0 || i === pts.length - 1
              // hidden bend points (freehand curve samples) get no handle —
              // only the two anchors and explicit (double-click-inserted)
              // waypoints are drag targets. This is what keeps a long
              // freehand bend from covering the curve in dozens of dots.
              if (!endpoint && (p as EdgePoint).hidden) return null
              return (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={endpoint ? 6 : 7}
                  fill={endpoint ? 'var(--edge-selected)' : '#fff'}
                  stroke="var(--transition)"
                  strokeWidth={endpoint ? 1.5 : 2.5}
                  vectorEffect="non-scaling-stroke"
                  className={endpoint ? '' : 'cursor-grab'}
                  style={{ filter: 'drop-shadow(0 0 3px var(--transition))' }}
                />
              )
            })
          })()}

        {/* placements */}
        {doc.placements.map((p) => {
          const label = getMaterialChar(p.materialId)
          return (
            <g
              key={p.id}
              transform={`translate(${p.x} ${p.y})`}
              style={{ filter: 'drop-shadow(0 0 5px var(--box-mask))' }}
              className="cursor-pointer"
            >
              <rect
                x={-16}
                y={-16}
                width={32}
                height={32}
                rx={5}
                fill="var(--panel)"
                stroke="var(--box-mask)"
                strokeWidth={selIds.has(p.id) ? 2.4 : 1.6}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={0}
                y={6}
                textAnchor="middle"
                fill="var(--box-mask)"
                fontSize={16}
                fontWeight={800}
                className="pointer-events-none select-none"
              >
                {label}
              </text>
            </g>
          )
        })}

        {/* material drag ghost */}
        {dragMaterial &&
          (() => {
            const gw = screenToWorld(dragMaterial.x, dragMaterial.y)
            if (!gw) return null
            return (
              <g
                transform={`translate(${gw.x} ${gw.y})`}
                opacity={0.85}
                style={{ filter: 'drop-shadow(0 0 8px var(--box-mask))' }}
              >
                <rect
                  x={-18}
                  y={-18}
                  width={36}
                  height={36}
                  rx={6}
                  fill="var(--panel)"
                  stroke="var(--box-mask)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={0}
                  y={6}
                  textAnchor="middle"
                  fill="var(--box-mask)"
                  fontSize={16}
                  fontWeight={800}
                >
                  {getMaterialChar(dragMaterial.materialId)}
                </text>
              </g>
            )
          })()}

        {/* place preview */}
        {preview.place && (
          <rect
            x={preview.place.x}
            y={preview.place.y}
            width={preview.place.width}
            height={preview.place.height}
            rx={8}
            fill="color-mix(in srgb, var(--primary) 10%, transparent)"
            stroke="var(--primary)"
            strokeWidth={1.8}
            strokeDasharray="8 5"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* marquee preview */}
        {preview.marquee && (
          <rect
            x={preview.marquee.x}
            y={preview.marquee.y}
            width={preview.marquee.width}
            height={preview.marquee.height}
            fill="color-mix(in srgb, var(--edge) 8%, transparent)"
            stroke="var(--edge)"
            strokeWidth={1.4}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* edge draft preview */}
        {preview.edge && (
          <>
            <polyline
              points={preview.edge.pts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={discard ? 'var(--box-physics)' : '#3182ce'}
              strokeWidth={2.4}
              strokeDasharray="9 6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {preview.edge.snap &&
              (() => {
                const bbox = sceneGroupBBox(boxesOfScene(preview.edge!.snap!, doc))
                if (!bbox) return null
                return (
                  <rect
                    x={bbox.x - 3}
                    y={bbox.y - 3}
                    width={bbox.width + 6}
                    height={bbox.height + 6}
        rx={6}

                    fill="none"
                    stroke="#3182ce"
                    strokeWidth={3}
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: 'drop-shadow(0 0 8px #3182ce)' }}
                  />
                )
              })()}
          </>
        )}
      </svg>

      <Toolbar />
      <Legend />
      {mode === 'playtest' && <PlaytestOverlay />}
      {discard && (
        <div className="pointer-events-none absolute inset-0 z-30 animate-pulse bg-box-physics/10" />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Playtest overlay banner                                           */
/* ------------------------------------------------------------------ */

function PlaytestOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute inset-0 bg-primary/[0.03]" />
      <div className="hud-b chamfer absolute left-1/2 top-20 flex -translate-x-1/2 items-center gap-2.5 bg-panel/90 px-4 py-2 backdrop-blur-md">
        <span className="soft-blink h-2 w-2 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
        <span className="text-[13px] font-bold text-success">试玩模式</span>
        <span className="h-4 w-px bg-border-strong" />
        <span className="text-[12px] text-muted-foreground">
          预览可通行域与连接 · 按 Esc 退出
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  utils                                                             */
/* ------------------------------------------------------------------ */

function isTyping(): boolean {
  const el = document.activeElement
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      (el as HTMLElement).isContentEditable)
  )
}

function getMaterialChar(materialId: string): string {
  // materialId like "装置-0-储物柜" -> take the last segment first char
  const name = materialId.split('-').pop() ?? '?'
  return name.charAt(0)
}
