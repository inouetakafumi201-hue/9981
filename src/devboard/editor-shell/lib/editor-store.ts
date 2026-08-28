'use client'

/* =========================================================================
   WakeUp 地图编辑器 — 中央状态引擎
   模块级外部 store + useSyncExternalStore 风格订阅。
   - doc / mode / selection / camera / currentLayerId / sampleSlot 为稳定切片引用
   - 历史记录仅追踪 doc（撤销/重做）
   - diagnostics 随 doc 变化重新计算并缓存

   v2 模型（B0）：场景不再是"一个矩形=一个节点"。`doc.sceneNodes` 是逻辑
   节点（连线端点、检查器主体），`doc.sceneBoxes` 是纯显示矩形，多个框可
   属于同一个 sceneId 并在几何重叠时自动聚合（`recomputeAggregation`）。
   任何对外的 "scene" selection id 指的都是 SceneNode.id，绝不是某个框的
   id——这是贯穿 canvas/left-panel/right-panel/diagnostics 的统一约定。
   ========================================================================= */

import { useSyncExternalStore, useRef } from 'react'
import {
  WORLD,
  SCALE_LIMIT,
  nodeAnchor,
  boxesOfScene,
  sceneGroupBBox,
  recomputeAggregation,
  overlayOpacity,
  foreignSceneIdsTouchedByRect,
  foreignSceneIdsTouchedByGroup,
  computeHoleCells,
  rectIntersectsHoles,
  type MapDoc,
  type Mode,
  type Selectable,
  type SceneNode,
  type SceneBox,
  type Edge,
  type EdgeDirectionality,
  type Layer,
  type Obstruction,
  type Terrain,
  type Placement,
  type Vec,
  type EdgePoint,
  type Scale,
  type MapData,
  type BuildingGroup,
  type BuildingFloor,
  type BuildingFrame,
} from './map-types'
import { rdp } from './geometry'
import { canonicalToEditorDoc, editorDocToCanonical } from './map-bridge'
import type { CanonicalMapData } from '../../ports/map-contracts'
import { parseMapData } from '../../ports/map-contracts'

export interface Camera {
  x: number
  y: number
  w: number
  h: number
}

export interface Diagnostic {
  id: string
  level: 'error' | 'warning' | 'info'
  message: string
  path: string
  /** 面向创作者的具体改法文案（B6），诊断条目 hover 时以 tooltip 展示 */
  correction: string
  target?: Selectable
}

/** 取样槽——按 kind 判别，`data` 只携带该类元素真正适用的字段（不同元素类
 *  型间同名字段可能有互斥的字面量类型，如 Obstruction.type 与 Terrain.type，
 *  用一个交叉类型描述会把该字段坍缩成 `never`，因此按 kind 拆成联合体）。 */
export type SampleSlot =
  | {
      kind: 'scene'
      label: string
      data: Partial<Pick<SceneNode, 'scale' | 'layerId'>> &
        Partial<Pick<SceneBox, 'width' | 'height'>>
    }
  | {
      kind: 'obstruction'
      label: string
      data: Partial<Pick<Obstruction, 'type' | 'width' | 'height' | 'rotation'>>
    }
  | {
      kind: 'terrain'
      label: string
      data: Partial<Pick<Terrain, 'type' | 'width' | 'height' | 'rotation'>>
    }
  | {
      kind: 'placement'
      label: string
      data: Partial<Pick<Placement, 'materialId'>>
    }

interface State {
  doc: MapDoc
  mode: Mode
  selection: Selectable[]
  camera: Camera
  /** 当前正在编辑的图层——编辑器视图状态，不进入 doc/历史记录 */
  currentLayerId: string
  sampleSlot: SampleSlot | null
  diagnostics: Diagnostic[]
  pulse: { id: string; n: number; level?: 'error' | 'warning' } | null
  panelOpen: boolean
  toast: { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error' } | null
  dragMaterial: { materialId: string; x: number; y: number; overScene: string | null } | null
}

/* ---------------- id helper ---------------- */
let counter = 0
export function uid(prefix = 'e'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36).slice(-4)}${counter.toString(36)}`
}

/* ---------------- seed document ---------------- */
function seedDoc(): MapDoc {
  const groundLayerId = 'ly_ground'
  const roofLayerId = 'ly_roof'
  const layers: Layer[] = [
    { id: groundLayerId, name: '地面层', height: 0 },
    { id: roofLayerId, name: '车顶层', height: 1 },
  ]

  const platformBox: SceneBox = {
    id: uid('bx'),
    sceneId: 'sc_platform',
    x: 120,
    y: 200,
    width: 300,
    height: 260,
  }
  const corridorBox: SceneBox = {
    id: uid('bx'),
    sceneId: 'sc_corridor',
    x: 640,
    y: 150,
    width: 230,
    height: 200,
  }
  const sleeperBox: SceneBox = {
    id: uid('bx'),
    sceneId: 'sc_sleeper',
    x: 520,
    y: 560,
    width: 320,
    height: 250,
  }
  const rooftopBox: SceneBox = {
    id: uid('bx'),
    sceneId: 'sc_rooftop',
    x: 1040,
    y: 640,
    width: 250,
    height: 200,
  }

  const sceneBoxes = [platformBox, corridorBox, sleeperBox, rooftopBox]
  const sceneNodes: SceneNode[] = [
    {
      id: 'sc_platform',
      name: '夜班月台',
      scale: 'large',
      layerId: groundLayerId,
      at: { x: platformBox.x + platformBox.width / 2, y: platformBox.y + platformBox.height / 2 },
    },
    {
      id: 'sc_corridor',
      name: '连接廊',
      scale: 'medium',
      layerId: groundLayerId,
      at: { x: corridorBox.x + corridorBox.width / 2, y: corridorBox.y + corridorBox.height / 2 },
    },
    {
      id: 'sc_sleeper',
      name: '卧铺车厢',
      scale: 'medium',
      layerId: groundLayerId,
      at: { x: sleeperBox.x + sleeperBox.width / 2, y: sleeperBox.y + sleeperBox.height / 2 },
    },
    {
      id: 'sc_rooftop',
      name: '车顶通道',
      scale: 'small',
      layerId: roofLayerId,
      at: { x: rooftopBox.x + rooftopBox.width / 2, y: rooftopBox.y + rooftopBox.height / 2 },
    },
  ]

  const doc0: MapDoc = {
    id: '7f3a',
    name: '夜班月台',
    layers,
    sceneNodes,
    sceneBoxes,
    edges: [],
    obstructions: [],
    terrains: [],
    placements: [],
    buildingGroups: [],
  }

  const edges: Edge[] = [
    {
      id: 'ed_1',
      from: 'sc_platform',
      to: 'sc_corridor',
      directionality: 'bidirectional',
      points: [nodeAnchor('sc_platform', doc0), nodeAnchor('sc_corridor', doc0)],
    },
    {
      id: 'ed_2',
      from: 'sc_corridor',
      to: 'sc_sleeper',
      directionality: 'bidirectional',
      points: [nodeAnchor('sc_corridor', doc0), nodeAnchor('sc_sleeper', doc0)],
      semanticAnchor: 'neutral',
    },
    {
      id: 'ed_3',
      from: 'sc_sleeper',
      to: 'sc_rooftop',
      directionality: 'unidirectional',
      points: [nodeAnchor('sc_sleeper', doc0), nodeAnchor('sc_rooftop', doc0)],
      transitionWindow: { x: 960, y: 700 },
    },
  ]

  return {
    ...doc0,
    edges,
    obstructions: [
      {
        id: 'ob_1',
        type: 'visual',
        x: 700,
        y: 420,
        width: 150,
        height: 90,
        rotation: 0,
        affectsEdges: ['ed_2'],
      },
    ],
  }
}

/* ---------------- initial state ---------------- */
const initialDoc = seedDoc()
let state: State = {
  doc: initialDoc,
  mode: 'select',
  selection: [],
  camera: { x: 0, y: 0, w: WORLD.w, h: WORLD.h },
  currentLayerId: initialDoc.layers[0]?.id ?? '',
  sampleSlot: null,
  diagnostics: validate(initialDoc),
  pulse: null,
  panelOpen: true,
  toast: null,
  dragMaterial: null,
}

/* ---------------- material drag (right panel -> canvas) ---------------- */
export function startMaterialDrag(materialId: string, x: number, y: number) {
  setState({ dragMaterial: { materialId, x, y, overScene: null } })
}
export function moveMaterialDrag(x: number, y: number, overScene: string | null) {
  if (!state.dragMaterial) return
  setState({ dragMaterial: { ...state.dragMaterial, x, y, overScene } })
}
export function endMaterialDrag() {
  setState({ dragMaterial: null })
}

/* ---------------- history ---------------- */
const past: MapDoc[] = []
const future: MapDoc[] = []

/* ---------------- pub/sub ---------------- */
const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  emit()
}
export function getState(): State {
  return state
}

/** Test-only helper: replace the entire document. Production code should
 *  use the per-operation mutators above so history/diagnostics stay consistent. */
export function __test_setDoc(next: MapDoc) {
  setDoc(next)
}

/** Test-only helper: read the current document snapshot. */
export function __test_getDoc(): MapDoc {
  return state.doc
}

/* ---------------- doc mutation ---------------- */
function setDoc(next: MapDoc, history = true) {
  if (history) {
    past.push(state.doc)
    if (past.length > 100) past.shift()
    future.length = 0
  }
  setState({ doc: next, diagnostics: validate(next) })
}

/** 拖拽开始：把当前 doc 压入历史，之后的移动用 setDocLive 不再入栈 */
export function beginHistory() {
  past.push(state.doc)
  if (past.length > 100) past.shift()
  future.length = 0
}
function setDocLive(next: MapDoc) {
  setState({ doc: next, diagnostics: validate(next) })
}

export function undo() {
  const prev = past.pop()
  if (!prev) return
  future.push(state.doc)
  setState({ doc: prev, diagnostics: validate(prev), selection: [] })
}
export function redo() {
  const next = future.pop()
  if (!next) return
  past.push(state.doc)
  setState({ doc: next, diagnostics: validate(next), selection: [] })
}
export function canUndo() {
  return past.length > 0
}
export function canRedo() {
  return future.length > 0
}

/* ---------------- toast ---------------- */
let toastId = 0
export function toast(
  text: string,
  tone: 'info' | 'ok' | 'warn' | 'error' = 'info',
) {
  toastId += 1
  const id = toastId
  setState({ toast: { id, text, tone } })
  window.setTimeout(() => {
    if (state.toast?.id === id) setState({ toast: null })
  }, 2400)
}

/* ---------------- mode / selection ---------------- */
export function setMode(mode: Mode) {
  setState({ mode, selection: mode === 'select' ? state.selection : [] })
}
export function setSelection(sel: Selectable[]) {
  setState({ selection: sel })
}
export function selectOne(type: Selectable['type'], id: string) {
  setState({ selection: [{ type, id }] })
}
export function clearSelection() {
  if (state.selection.length) setState({ selection: [] })
}
export function isSelected(id: string) {
  return state.selection.some((s) => s.id === id)
}

/* ---------------- camera ---------------- */
export function setCamera(cam: Camera) {
  setState({ camera: cam })
}
let camAnim = 0
export function flyTo(cam: Camera, ms = 420) {
  cancelAnimationFrame(camAnim)
  const start = state.camera
  const t0 = performance.now()
  const ease = (t: number) => 1 - Math.pow(1 - t, 3)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const k = ease(t)
    setState({
      camera: {
        x: start.x + (cam.x - start.x) * k,
        y: start.y + (cam.y - start.y) * k,
        w: start.w + (cam.w - start.w) * k,
        h: start.h + (cam.h - start.h) * k,
      },
    })
    if (t < 1) camAnim = requestAnimationFrame(step)
  }
  camAnim = requestAnimationFrame(step)
}

/** 切到某图层（按 id）。传入的 index 落在图层数组范围之外时钉在最后一个
 *  图层——供数字键 1/2/3 快捷键调用。 */
export function setCurrentLayer(layerId: string) {
  setState({ currentLayerId: layerId })
}
export function setCurrentLayerByIndex(index: number) {
  const layers = state.doc.layers
  if (layers.length === 0) return
  const clamped = Math.max(0, Math.min(index, layers.length - 1))
  const layer = layers[clamped]
  if (!layer) return
  setState({ currentLayerId: layer.id })
}
export function togglePanel() {
  setState({ panelOpen: !state.panelOpen })
}

/* ---------------- layer CRUD (B4) ---------------- */
export function addLayer(name: string) {
  const layer: Layer = { id: uid('ly'), name }
  setDoc({ ...state.doc, layers: [...state.doc.layers, layer] })
  setState({ currentLayerId: layer.id })
}
export function updateLayer(id: string, patch: Partial<Layer>) {
  // 高度冲突：另一层已经填了相同数值时拒绝写入
  if (patch.height != null) {
    const conflict = state.doc.layers.some(
      (l) => l.id !== id && l.height === patch.height,
    )
    if (conflict) {
      toast('该高度已被其它图层占用，请换一个数值', 'error')
      return false
    }
  }
  setDoc({
    ...state.doc,
    layers: state.doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  })
  return true
}
export function removeLayer(id: string) {
  const layers = state.doc.layers.filter((l) => l.id !== id)
  if (layers.length === 0) return // 至少保留一层
  const fallback = layers[0]
  if (!fallback) return
  const fallbackId = fallback.id
  const sceneNodes = state.doc.sceneNodes.map((n) =>
    n.layerId === id ? { ...n, layerId: fallbackId } : n,
  )
  setDoc({ ...state.doc, layers, sceneNodes })
  if (state.currentLayerId === id) setState({ currentLayerId: fallbackId })
}
/** 两个图层间的跨层透明度（供 canvas 渲染用），只是 overlayOpacity 的便捷包装 */
export function layerOpacity(layerId: string): number {
  const cur = state.doc.layers.find((l) => l.id === state.currentLayerId)
  const target = state.doc.layers.find((l) => l.id === layerId)
  if (!cur || !target) return 1
  if (target.id === cur.id) return 1
  return overlayOpacity(cur, target)
}

/* ---------------- pulse (diagnostic focus) ---------------- */
export function pulseElement(id: string, level?: 'error' | 'warning') {
  setState({ pulse: { id, n: Date.now(), level } })
  window.setTimeout(() => {
    if (state.pulse?.id === id) setState({ pulse: null })
  }, 1600)
}

/* ---------------- scene ops (B0 / B2) ---------------- */

/** 新建一个场景框；若与已有框几何重叠，聚合会在随后的
 *  `recomputeAggregation` 中把它们并入同一个场景节点——调用方不需要关心
 *  合并细节，直接拿到的返回值永远是"这次新建后，鼠标落点所在的 sceneId"。
 *  B3：落在其它场景的洞内、或同时压到两个不同场景 → 拒绝创建（返回
 *  `null`），并弹出对应 toast——调用方只需在收到 `null` 时播放错误反馈，
 *  不需要重复这套校验逻辑。 */
function validBuildingFrame(frame: BuildingFrame): boolean {
  return [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
    && frame.width > 0
    && frame.height > 0
}

export function addBuildingGroup(rect: BuildingFrame, shell = 'shell:default'): string | null {
  if (!validBuildingFrame(rect)) {
    toast('建筑组范围必须是有效的正尺寸矩形', 'error')
    return null
  }
  const group: BuildingGroup = { id: uid('bg'), frame: { ...rect }, shell, floors: [], portals: [] }
  setDoc({ ...state.doc, buildingGroups: [...(state.doc.buildingGroups ?? []), group] })
  return group.id
}

export function addBuildingFloor(groupId: string, floor: Omit<BuildingFloor, 'id'> & { id?: string }): string | null {
  const groups = state.doc.buildingGroups ?? []
  const group = groups.find((item) => item.id === groupId)
  if (!group || group.floors.length >= 3) return null
  const id = floor.id ?? uid('bf')
  if (groups.some((item) => item.floors.some((candidate) => candidate.id === id))) return null
  const nextFloor: BuildingFloor = { ...floor, id, nodes: [...floor.nodes], frame: { ...group.frame } }
  setDoc({ ...state.doc, buildingGroups: groups.map((item) => item.id === groupId ? { ...item, floors: [...item.floors, nextFloor] } : item) })
  return id
}

export function updateBuildingGroupFrame(groupId: string, frame: BuildingFrame) {
  if (!validBuildingFrame(frame)) return
  setDoc({
    ...state.doc,
    buildingGroups: (state.doc.buildingGroups ?? []).map((group) => group.id === groupId
      ? { ...group, frame: { ...frame }, floors: group.floors.map((floor) => ({ ...floor, frame: { ...frame } })) }
      : group),
  })
}

export function setBuildingGroupShell(groupId: string, shell: string) {
  setDoc({ ...state.doc, buildingGroups: (state.doc.buildingGroups ?? []).map((group) => group.id === groupId ? { ...group, shell } : group) })
}

export function setBuildingFloorFrame(groupId: string, floorId: string, frame: BuildingFrame) {
  setDoc({ ...state.doc, buildingGroups: (state.doc.buildingGroups ?? []).map((group) => group.id === groupId ? { ...group, floors: group.floors.map((floor) => floor.id === floorId ? { ...floor, frame: { ...frame } } : floor) } : group) })
}

export function setBuildingFloorImage(groupId: string, floorId: string, image: string) {
  setDoc({
    ...state.doc,
    buildingGroups: (state.doc.buildingGroups ?? []).map((group) =>
      group.id === groupId
        ? { ...group, floors: group.floors.map((floor) => floor.id === floorId ? { ...floor, image } : floor) }
        : group,
    ),
  })
}

export function setBuildingFloorOrdinal(groupId: string, floorId: string, ordinal: number) {
  setDoc({
    ...state.doc,
    buildingGroups: (state.doc.buildingGroups ?? []).map((group) =>
      group.id === groupId
        ? { ...group, floors: group.floors.map((floor) => floor.id === floorId ? { ...floor, ordinal } : floor) }
        : group,
    ),
  })
}

export function bindBuildingPortal(
  groupId: string,
  portal: { id?: string; from: string; to: string; def: string },
): string | null {
  const groups = state.doc.buildingGroups ?? []
  const group = groups.find((item) => item.id === groupId)
  if (!group || portal.from === portal.to) return null
  const allFloorIds = new Set(groups.flatMap((item) => item.floors.map((floor) => floor.id)))
  if (!group.floors.some((floor) => floor.id === portal.from) || !allFloorIds.has(portal.to)) return null
  const id = portal.id ?? uid('bp')
  if (groups.some((item) => item.portals.some((candidate) => candidate.id === id))) return null
  const next = { id, from: portal.from, to: portal.to, def: portal.def }
  setDoc({
    ...state.doc,
    buildingGroups: (state.doc.buildingGroups ?? []).map((item) =>
      item.id === groupId ? { ...item, portals: [...item.portals, next] } : item,
    ),
  })
  return id
}

export function removeBuildingFloor(groupId: string, floorId: string) {
  setDoc({
    ...state.doc,
    buildingGroups: (state.doc.buildingGroups ?? []).map((group) =>
      group.id === groupId
        ? {
            ...group,
            floors: group.floors.filter((floor) => floor.id !== floorId),
            portals: group.portals.filter((portal) => portal.from !== floorId && portal.to !== floorId),
          }
        : group,
    ),
  })
}

export function addScene(rect: {
  x: number
  y: number
  width: number
  height: number
}): string | null {
  const holes = computeHoleCells(state.doc)
  if (rectIntersectsHoles(rect, holes)) {
    toast('此处已属于其他场景内部，不能嵌套放置', 'error')
    return null
  }
  if (foreignSceneIdsTouchedByRect(rect, state.doc).size > 1) {
    toast('不能跨场景连接', 'error')
    return null
  }
  const boxId = uid('bx')
  const sceneId = uid('sc')
  const area = rect.width * rect.height
  const scale: Scale = area > 90000 ? 'large' : area > 40000 ? 'medium' : 'small'
  const box: SceneBox = {
    id: boxId,
    sceneId,
    x: rect.x,
    y: rect.y,
    width: Math.max(60, rect.width),
    height: Math.max(50, rect.height),
  }
  const node: SceneNode = {
    id: sceneId,
    name: `场景 ${state.doc.sceneNodes.length + 1}`,
    scale,
    layerId: state.currentLayerId || state.doc.layers[0]?.id || '',
    at: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  }
  const merged = recomputeAggregation({
    ...state.doc,
    sceneBoxes: [...state.doc.sceneBoxes, box],
    sceneNodes: [...state.doc.sceneNodes, node],
  })
  setDoc(merged)
  // 找出落点所在的最终 sceneId（可能因聚合已经变成别的节点的成员）
  const finalBox = merged.sceneBoxes.find((b) => b.id === boxId)
  return finalBox?.sceneId ?? sceneId
}

/** 更新场景节点的逻辑属性（名称/尺度/图层/上级/说明），不涉及几何 */
export function updateSceneNode(
  id: string,
  patch: Partial<SceneNode>,
  history = true,
) {
  const next = {
    ...state.doc,
    sceneNodes: state.doc.sceneNodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  }
  if (history) setDoc(next)
  else setDocLive(next)
}

/** 更新单个显示矩形的几何；几何变化后立即重新聚合 */
export function updateSceneBox(
  id: string,
  patch: Partial<SceneBox>,
  history = true,
) {
  const next = recomputeAggregation({
    ...state.doc,
    sceneBoxes: state.doc.sceneBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  })
  if (history) setDoc(next)
  else setDocLive(next)
}

/** 整组平移：拖任一成员框 = 该场景节点下全部框一起移动（B2） */
export function moveSceneGroup(sceneId: string, dx: number, dy: number, live = true) {
  const next = {
    ...state.doc,
    sceneBoxes: state.doc.sceneBoxes.map((b) =>
      b.sceneId === sceneId ? { ...b, x: b.x + dx, y: b.y + dy } : b,
    ),
  }
  if (live) setDocLive(next)
  else setDoc(next)
}

/** 整组旋转：滚轮 = 绕组的外接矩形中心整体旋转 `deltaDeg`（默认 10°/格，
 *  B2）——每个成员框绕公共轴心公转位移，同时自身也自转同样角度，两者叠加
 *  让整组看起来像一个刚体旋转，而不是各框各自绕自己中心转导致散架。 */
export function rotateSceneGroup(sceneId: string, deltaDeg: number, live = true) {
  const boxes = boxesOfScene(sceneId, state.doc)
  const bbox = sceneGroupBBox(boxes)
  if (!bbox) return
  const cx = bbox.x + bbox.width / 2
  const cy = bbox.y + bbox.height / 2
  const rad = (deltaDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const next = {
    ...state.doc,
    sceneBoxes: state.doc.sceneBoxes.map((b) => {
      if (b.sceneId !== sceneId) return b
      // 公转：绕组中心把框自身中心转过 deltaDeg
      const bcx = b.x + b.width / 2
      const bcy = b.y + b.height / 2
      const dx = bcx - cx
      const dy = bcy - cy
      const nbcx = cx + dx * cos - dy * sin
      const nbcy = cy + dx * sin + dy * cos
      return {
        ...b,
        x: nbcx - b.width / 2,
        y: nbcy - b.height / 2,
        rotation: ((b.rotation ?? 0) + deltaDeg) % 360,
      }
    }),
  }
  if (live) setDocLive(next)
  else setDoc(next)
}

/** 拖拽被判定为非法（粘连）时的即时还原：弹出 `beginHistory()` 拖拽开始时
 *  压入的快照并原样恢复，不进入 redo 栈、不清空选中态——用户只看到框"弹回
 *  原位"，其余 UI 状态不受影响。 */
function revertLiveDrag() {
  const prev = past.pop()
  if (prev) setState({ doc: prev, diagnostics: validate(prev) })
}

/** 粘连判定（B3）：整组拖拽松手时调用。若任一被移动场景的最终位置同时压
 *  到两个不同 sceneId 的框上，判定为非法——撤销整次拖拽并返回 `false`；
 *  调用方只需在收到 `false` 时播放错误反馈 + toast，不需要自己实现还原。
 *  合法（每个场景至多触碰 1 个外部 sceneId）则落定聚合。 */
export function commitSceneMove(sceneIds: string[]): boolean {
  const doc = state.doc
  for (const id of sceneIds) {
    if (foreignSceneIdsTouchedByGroup(id, doc).size > 1) {
      revertLiveDrag()
      return false
    }
  }
  if (sceneIds.length) setDocLive(recomputeAggregation(doc))
  return true
}

/** @deprecated 兼容旧调用点的浅层包装：多数旧代码调用 `updateScene(id, {x,y,...})`
 *  实为几何操作，语义上等价于 `updateSceneBox`，此处按"该 sceneId 唯一成员
 *  框"路径转发，供尚未升级的���用点使用。新代码请直接用
 *  `updateSceneNode`/`updateSceneBox`/`moveSceneGroup`。 */
export function updateScene(
  id: string,
  patch: Partial<SceneNode & SceneBox>,
  history = true,
) {
  const { name, scale, layerId, parent, def, ...geo } = patch as Partial<SceneNode> &
    Partial<SceneBox>
  const nodePatch: Partial<SceneNode> = {}
  if (name !== undefined) nodePatch.name = name
  if (scale !== undefined) nodePatch.scale = scale
  if (layerId !== undefined) nodePatch.layerId = layerId
  if (parent !== undefined) nodePatch.parent = parent
  if (def !== undefined) nodePatch.def = def
  if (Object.keys(nodePatch).length) updateSceneNode(id, nodePatch, history)
  if (Object.keys(geo).length) {
    const boxes = boxesOfScene(id, state.doc)
    if (boxes[0]) updateSceneBox(boxes[0].id, geo, history)
  }
}

/* ---------------- edge ops ---------------- */
export function addEdge(fromId: string, toId: string, points: Vec[]): string {
  const id = uid('ed')
  const fromAnchor = nodeAnchor(fromId, state.doc)
  const toAnchor = nodeAnchor(toId, state.doc)
  const pts = [fromAnchor, ...points.slice(1, -1), toAnchor]
  const edge: Edge = {
    id,
    from: fromId,
    to: toId,
    directionality: 'bidirectional',
    points: pts.length >= 2 ? pts : [fromAnchor, toAnchor],
    semanticAnchor: 'neutral',
  }
  setDoc({ ...state.doc, edges: [...state.doc.edges, edge] })
  return id
}

export function updateEdge(id: string, patch: Partial<Edge>, history = true) {
  const next = {
    ...state.doc,
    edges: state.doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }
  if (history) setDoc(next)
  else setDocLive(next)
}

/** 移动边上某个折点（index），live=true 不入历史 */
export function moveWaypoint(
  edgeId: string,
  index: number,
  pos: Vec,
  live = true,
) {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge) return
  const points = edge.points.map((p, i) => (i === index ? pos : p))
  updateEdge(edgeId, { points }, !live)
}

/** 双击边：在最近段插入折点（默认可见——显式折点，带独立拖拽手柄） */
export function insertWaypoint(
  edgeId: string,
  segment: number,
  pos: Vec,
  hidden = false,
) {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge) return -1
  const points = [...edge.points]
  const point: EdgePoint = hidden ? { ...pos, hidden: true } : { ...pos }
  points.splice(segment + 1, 0, point)
  updateEdge(edgeId, { points })
  return segment + 1
}

/** 删除折点（不能删端点） */
export function deleteWaypoint(edgeId: string, index: number) {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge) return
  if (index <= 0 || index >= edge.points.length - 1) return
  const points = edge.points.filter((_, i) => i !== index)
  updateEdge(edgeId, { points })
}

/** 拉弯手势：拖动线体时连续追加隐藏点，让曲线跟手自由弯曲，而不产生一堆
 *  可见折点手柄。live（不入历史）——调用方需已在手势开始时 beginHistory()
 *  一次。返回新插入点在 e.points 中的索引，供下一次追加时作为锚点。 */
export function appendBendPoint(
  edgeId: string,
  afterIndex: number,
  pos: Vec,
): number {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge) return afterIndex
  const points = [...edge.points]
  const clamped = Math.max(0, Math.min(afterIndex, points.length - 1))
  points.splice(clamped + 1, 0, { ...pos, hidden: true })
  updateEdge(edgeId, { points }, false)
  return clamped + 1
}

/** 拉弯手势结束：把刚才连续追加的隐藏点run做 RDP 简化，去掉冗余采样点，
 *  只保留能表达形状所需的最少隐藏点；显式折点（非 hidden）与两端锚点
 *  始终保留、不参与简化。live（沿用同一条历史记录，不新增撤销步）。 */
export function simplifyEdgeHiddenRuns(edgeId: string, epsilon: number) {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge) return
  const pts = edge.points
  if (pts.length <= 2) return
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (!first || !last) return
  const result: EdgePoint[] = [first]
  let i = 1
  while (i < pts.length - 1) {
    const point = pts[i]
    if (!point) {
      i++
      continue
    }
    if (point.hidden) {
      let j = i
      while (j < pts.length - 1) {
        const candidate = pts[j]
        if (!candidate?.hidden) break
        j++
      }
      const anchorPrev = result[result.length - 1]
      const anchorNext = pts[j]
      if (!anchorPrev || !anchorNext) break
      const run: EdgePoint[] = [anchorPrev, ...pts.slice(i, j).filter((p): p is EdgePoint => p !== undefined), anchorNext]
      const simplified = rdp(run, epsilon)
        .slice(1, -1)
        .map((p) => ({ x: p.x, y: p.y, hidden: true }))
      result.push(...simplified)
      i = j
    } else {
      result.push(point)
      i++
    }
  }
  result.push(last)
  updateEdge(edgeId, { points: result }, false)
}

/** 拍直整条边（清空全部中间点，只留两端锚点） */
export function straightenEdge(edgeId: string) {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge || edge.points.length < 2) return
  const first = edge.points[0]
  const last = edge.points[edge.points.length - 1]
  if (!first || !last) return
  updateEdge(edgeId, {
    points: [first, last],
  })
}

/** 双击某一段：只清空该段范围内的隐藏拉弯点，瞬间绷直"这一段"，两端锚点/
 *  其它线段上的显式折点与隐藏点完全不受影响——这是规范要求的"唯一重塑
 *  入口"的段级语义，取代粗暴的整边拍直。
 *  `seg` 是 e.points 中的段索引（点 seg 与 seg+1 之间）。若该段两端都不是
 *  隐藏点（说明这一段本来就是直的，没有弯），返回 false，交由调用方走
 *  "插入新折点"的默认路径。 */
export function straightenEdgeSegment(edgeId: string, seg: number): boolean {
  const edge = state.doc.edges.find((e) => e.id === edgeId)
  if (!edge) return false
  const pts = edge.points
  const a = seg
  const b = seg + 1
  if (a < 0 || b >= pts.length) return false
  const aHidden = pts[a]?.hidden ?? false
  const bHidden = pts[b]?.hidden ?? false
  if (!aHidden && !bHidden) return false
  let lo = a
  while (lo > 0 && (pts[lo]?.hidden ?? false)) lo--
  let hi = b
  while (hi < pts.length - 1 && (pts[hi]?.hidden ?? false)) hi++
  const points = [...pts.slice(0, lo + 1), ...pts.slice(hi)]
  updateEdge(edgeId, { points })
  return true
}

/** 遮挡框旋转矩形与折线相交时批量登记 affectsEdges（B7）；在遮挡框几何
 *  变更时调用。用折线上每一段与旋转矩形四条边做线段-线段相交检测的近似：
 *  这里复用 pointToPolyline 的采样距离阈值做保守近似——遮挡框中心落在
 *  折线附近，或折线任一点落入旋转矩形内，即认为相交。 */
export function recomputeObstructionEdgeLinks(obstructionId: string) {
  const doc = state.doc
  const ob = doc.obstructions.find((o) => o.id === obstructionId)
  if (!ob) return
  const cos = Math.cos((-ob.rotation * Math.PI) / 180)
  const sin = Math.sin((-ob.rotation * Math.PI) / 180)
  const cx = ob.x + ob.width / 2
  const cy = ob.y + ob.height / 2
  const inside = (p: Vec) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos
    return Math.abs(lx) <= ob.width / 2 && Math.abs(ly) <= ob.height / 2
  }
  const affected: string[] = []
  doc.edges.forEach((e) => {
    const from = nodeAnchor(e.from, doc)
    const to = nodeAnchor(e.to, doc)
    const pts = [from, ...e.points.slice(1, -1), to]
    // 采样折线上每段的若干点做粗略相交检测
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (!a || !b) continue
      let hit = false
      for (let t = 0; t <= 1; t += 0.1) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        if (inside(p)) {
          hit = true
          break
        }
      }
      if (hit) {
        affected.push(e.id)
        break
      }
    }
  })
  updateObstruction(obstructionId, { affectsEdges: affected }, false)
}

/* ---------------- obstruction / terrain ---------------- */
export function addObstruction(
  type: 'visual' | 'physical',
  at: Vec,
): string {
  const id = uid('ob')
  const ob: Obstruction = {
    id,
    type,
    x: at.x - 80,
    y: at.y - 50,
    width: 160,
    height: 100,
    rotation: 0,
    affectsEdges: [],
  }
  setDoc({ ...state.doc, obstructions: [...state.doc.obstructions, ob] })
  recomputeObstructionEdgeLinks(id)
  return id
}
export function updateObstruction(
  id: string,
  patch: Partial<Obstruction>,
  history = true,
) {
  const next = {
    ...state.doc,
    obstructions: state.doc.obstructions.map((o) =>
      o.id === id ? { ...o, ...patch } : o,
    ),
  }
  if (history) setDoc(next)
  else setDocLive(next)
}
export function addTerrain(type: 'highland' | 'lowland', at: Vec): string {
  const id = uid('tr')
  const tr: Terrain = {
    id,
    type,
    x: at.x - 90,
    y: at.y - 60,
    width: 180,
    height: 120,
    rotation: 0,
  }
  setDoc({ ...state.doc, terrains: [...state.doc.terrains, tr] })
  return id
}
export function updateTerrain(
  id: string,
  patch: Partial<Terrain>,
  history = true,
) {
  const next = {
    ...state.doc,
    terrains: state.doc.terrains.map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    ),
  }
  if (history) setDoc(next)
  else setDocLive(next)
}

/* ---------------- placement ---------------- */
export function addPlacement(materialId: string, sceneId: string, at: Vec) {
  const id = uid('pl')
  const pl: Placement = { id, materialId, sceneId, x: at.x, y: at.y }
  setDoc({ ...state.doc, placements: [...state.doc.placements, pl] })
  return id
}
export function updatePlacement(
  id: string,
  patch: Partial<Placement>,
  history = true,
) {
  const next = {
    ...state.doc,
    placements: state.doc.placements.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    ),
  }
  if (history) setDoc(next)
  else setDocLive(next)
}

/* ---------------- generic delete / duplicate ---------------- */
export function deleteSelection() {
  const sel = state.selection
  if (!sel.length) return
  const ids = new Set(sel.map((s) => s.id))
  const doc = state.doc
  const next: MapDoc = {
    ...doc,
    // 场景选中 id 是 SceneNode.id：删除该节点自身 + 它的全部成员框
    sceneNodes: doc.sceneNodes.filter((n) => !ids.has(n.id)),
    sceneBoxes: doc.sceneBoxes.filter((b) => !ids.has(b.sceneId)),
    edges: doc.edges.filter(
      (e) => !ids.has(e.id) && !ids.has(e.from) && !ids.has(e.to),
    ),
    obstructions: doc.obstructions.filter((o) => !ids.has(o.id)),
    terrains: doc.terrains.filter((t) => !ids.has(t.id)),
    placements: doc.placements.filter(
      (p) => !ids.has(p.id) && !ids.has(p.sceneId),
    ),
  }
  setDoc(next)
  setState({ selection: [] })
}

export function duplicateSelection() {
  const sel = state.selection[0]
  if (!sel) return
  const doc = state.doc
  if (sel.type === 'scene') {
    const node = doc.sceneNodes.find((n) => n.id === sel.id)
    if (!node) return
    const boxes = boxesOfScene(sel.id, doc)
    const newId = uid('sc')
    const newNode: SceneNode = {
      ...node,
      id: newId,
      name: node.name + ' 副本',
      at: { x: node.at.x + 40, y: node.at.y + 40 },
    }
    const newBoxes: SceneBox[] = boxes.map((b) => ({
      ...b,
      id: uid('bx'),
      sceneId: newId,
      x: b.x + 40,
      y: b.y + 40,
    }))
    setDoc({
      ...doc,
      sceneNodes: [...doc.sceneNodes, newNode],
      sceneBoxes: [...doc.sceneBoxes, ...newBoxes],
    })
    selectOne('scene', newId)
  } else if (sel.type === 'obstruction') {
    const o = doc.obstructions.find((x) => x.id === sel.id)
    if (!o) return
    const id = uid('ob')
    setDoc({ ...doc, obstructions: [...doc.obstructions, { ...o, id, x: o.x + 40, y: o.y + 40, affectsEdges: [] }] })
    selectOne('obstruction', id)
    recomputeObstructionEdgeLinks(id)
  } else if (sel.type === 'terrain') {
    const t = doc.terrains.find((x) => x.id === sel.id)
    if (!t) return
    const id = uid('tr')
    setDoc({ ...doc, terrains: [...doc.terrains, { ...t, id, x: t.x + 40, y: t.y + 40 }] })
    selectOne('terrain', id)
  } else if (sel.type === 'placement') {
    const p = doc.placements.find((x) => x.id === sel.id)
    if (!p) return
    const id = uid('pl')
    setDoc({ ...doc, placements: [...doc.placements, { ...p, id, x: p.x + 20, y: p.y + 20 }] })
    selectOne('placement', id)
  }
}

/* ---------------- sampling ---------------- */
export function sampleElement(sel: Selectable) {
  const doc = state.doc
  if (sel.type === 'scene') {
    const n = doc.sceneNodes.find((x) => x.id === sel.id)
    if (!n) return
    const boxes = boxesOfScene(sel.id, doc)
    setState({
      sampleSlot: {
        kind: 'scene',
        label: `场景 ${n.name}`,
        data: {
          scale: n.scale,
          layerId: n.layerId,
          width: boxes[0]?.width,
          height: boxes[0]?.height,
        },
      },
    })
    toast(`已取样：${n.name}`, 'ok')
  } else if (sel.type === 'obstruction') {
    const o = doc.obstructions.find((x) => x.id === sel.id)
    if (!o) return
    setState({
      sampleSlot: {
        kind: 'obstruction',
        label: `遮挡框 ${o.type === 'visual' ? '视觉' : '物理'}`,
        data: { type: o.type, width: o.width, height: o.height, rotation: o.rotation },
      },
    })
    toast('已取样：遮挡框', 'ok')
  } else if (sel.type === 'placement') {
    const p = doc.placements.find((x) => x.id === sel.id)
    if (!p) return
    setState({
      sampleSlot: { kind: 'placement', label: '素材', data: { materialId: p.materialId } },
    })
    toast('已取样：素材', 'ok')
  }
}

/** 把样本套用到目标场景 */
export function applySampleToScene(sceneId: string) {
  const slot = state.sampleSlot
  if (!slot) return
  if (slot.kind === 'scene') {
    updateSceneNode(sceneId, {
      scale: slot.data.scale,
      layerId: slot.data.layerId,
    })
    toast('已套用场景样本', 'ok')
  } else if (slot.kind === 'placement' && slot.data.materialId) {
    const anchor = nodeAnchor(sceneId, state.doc)
    if (state.doc.sceneNodes.some((n) => n.id === sceneId)) {
      addPlacement(slot.data.materialId, sceneId, anchor)
      toast('已放置取样素材', 'ok')
    }
  }
}

/** Alt+单击临时取样手势（B10）：取样后立即恢复原模式，不改变当前工具 */
export function altSample(sel: Selectable) {
  sampleElement(sel)
}

/* ---------------- map meta ---------------- */
export function setMapName(name: string) {
  setDoc({ ...state.doc, name }, false)
}

/* ---------------- import / 上传图层（Bridge + 契约） ---------------- */

/**
 * 用 canonical MapData（来自 parseMapData 或游戏侧)桥回编辑器 MapDoc 并载入。
 * 覆盖当前文档：清空历史、重置选区与摄像机。空图层（无任何节点）也按"第一个
 * 全屏图层"处理——若有多个图层则整体作为一份新文档载入。
 */
export function importMapData(data: CanonicalMapData) {
  const doc = canonicalToEditorDoc(data)
  past.length = 0
  future.length = 0
  setState({
    doc,
    selection: [],
    diagnostics: validate(doc),
    camera: { x: 0, y: 0, w: WORLD.w, h: WORLD.h },
    currentLayerId: doc.layers[0]?.id ?? '',
  })
  toast(`已载入地图「${data.name}」（${data.nodes.length} 节点）`, 'ok')
}

/** 以 canonical v2 导出当前文档（喂给 createLoadedMatch / compileMap / 落盘）。 */
export function getCanonicalMap(): CanonicalMapData {
  return editorDocToCanonical(state.doc)
}

/** 从 JSON 文本解析并载入地图（顶栏「导入」用）。 */
export function importMapJson(json: string): boolean {
  try {
    const canonical = parseMapData(json)
    importMapData(canonical)
    return true
  } catch (err) {
    toast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    return false
  }
}

/**
 * 从上传的 PNG 新建一个图层。
 * - 全屏：整张地图被该图铺满（backdrop 拉伸），仍可叠加别的局部图层。
 * - 局部：等比放入，可移动/缩放（backdrop + transform），作为一个独立图层。
 * 无论当前文档是否空图层都追加为新图层；若文档尚无任何图层则作为第一个全屏图层。
 */
export function addLayerFromImage(opts: {
  dataUrl: string
  pixelWidth: number
  pixelHeight: number
  name?: string
  category: '全屏' | '局部'
}) {
  const layerId = uid('ly')
  const name = opts.name || '图层'
  const existing = state.doc.layers

  const layer: Layer = {
    id: layerId,
    name,
    // 全屏底图默认放在 height 0 参与透视；局部贴纸做成独立层(height 空)
    height: opts.category === '全屏' ? 0 : undefined,
    backdrop: {
      image: opts.dataUrl,
      pixelWidth: opts.pixelWidth,
      pixelHeight: opts.pixelHeight,
    },
  }
  if (opts.category === '局部') {
    // 局部贴纸等比放入：以原始宽高比在世界里铺一张（1/4 宽），可后续移动缩放。
    const W = WORLD.w * 0.5
    const H = (W * opts.pixelHeight) / Math.max(1, opts.pixelWidth)
    layer.transform = { scaleX: W / WORLD.w, scaleY: H / WORLD.h, tx: 0, ty: 0 }
  }

  const next = { ...state.doc, layers: [...existing, layer] }
  past.length = 0
  future.length = 0
  setState({
    doc: next,
    diagnostics: validate(next),
    currentLayerId: layerId,
  })
  toast(opts.category === '全屏' ? `已添加全屏底图图层「${name}」` : `已添加局部贴纸图层「${name}」`, 'ok')
}

export function newBlankMap() {
  const layer: Layer = { id: uid('ly'), name: '默认图层' }
  const doc: MapDoc = {
    id: uid('map').slice(-4),
    name: '未命名地图',
    layers: [layer],
    sceneNodes: [],
    sceneBoxes: [],
    edges: [],
    obstructions: [],
    terrains: [],
    placements: [],
    buildingGroups: [],
  }
  past.length = 0
  future.length = 0
  setState({
    doc,
    selection: [],
    diagnostics: validate(doc),
    camera: { x: 0, y: 0, w: WORLD.w, h: WORLD.h },
    currentLayerId: layer.id,
  })
  toast('已新建空白地图', 'info')
}

/* ---------------- validation ---------------- */
export function validate(doc: MapDoc): Diagnostic[] {
  const out: Diagnostic[] = []

  // 场景名不能为空
  doc.sceneNodes.forEach((n) => {
    if (!n.name.trim()) {
      out.push({
        id: `name-${n.id}`,
        level: 'error',
        message: '场景名不能为空',
        correction: '在检查器里给这个场景填一个名称',
        path: `scene/${n.id}`,
        target: { type: 'scene', id: n.id },
      })
    }
  })

  // 连接数不能超过尺度上限
  const degree = new Map<string, number>()
  doc.edges.forEach((e) => {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  })
  doc.sceneNodes.forEach((n) => {
    const d = degree.get(n.id) ?? 0
    if (d > SCALE_LIMIT[n.scale]) {
      out.push({
        id: `deg-${n.id}`,
        level: 'error',
        message: `「${n.name}」连接数 ${d} 超过${n.scale === 'large' ? '大' : n.scale === 'medium' ? '中' : '小'}型上限 ${SCALE_LIMIT[n.scale]}`,
        correction: `把连接数降到 ${SCALE_LIMIT[n.scale]} 以内，或把该场景尺度调大一档`,
        path: `scene/${n.id}`,
        target: { type: 'scene', id: n.id },
      })
    }
  })

  // 孤立场景（无任何连接）
  if (doc.sceneNodes.length > 1) {
    doc.sceneNodes.forEach((n) => {
      if (!degree.get(n.id)) {
        out.push({
          id: `iso-${n.id}`,
          level: 'error',
          message: `「${n.name}」没有任何连接`,
          correction: '用连接工具把这个场景至少接到一条边上',
          path: `scene/${n.id}`,
          target: { type: 'scene', id: n.id },
        })
      }
    })
  }

  // 可达性：从第一个场景 BFS（方向��：双向两边可走，其余仅 from→to）
  if (doc.sceneNodes.length > 1 && doc.edges.length > 0) {
    const adj = new Map<string, string[]>()
    doc.edges.forEach((e) => {
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
      if (e.directionality === 'bidirectional') {
        adj.set(e.to, [...(adj.get(e.to) ?? []), e.from])
      }
    })
    const start = doc.sceneNodes[0]
    if (!start) return out
    const seen = new Set<string>([start.id])
    const q: string[] = [start.id]
    while (q.length) {
      const cur = q.shift()
      if (cur === undefined) continue
      ;(adj.get(cur) ?? []).forEach((n) => {
        if (!seen.has(n)) {
          seen.add(n)
          q.push(n)
        }
      })
    }
    doc.sceneNodes.forEach((n) => {
      if (!seen.has(n.id) && degree.get(n.id)) {
        out.push({
          id: `reach-${n.id}`,
          level: 'warning',
          message: `「${n.name}」无法从出生点到达`,
          correction: '检查连线方向性是否设反了，或补一条双向连接',
          path: `scene/${n.id}`,
          target: { type: 'scene', id: n.id },
        })
      }
    })
  }

  // 过渡窗口只对双向连接有意义
  doc.edges.forEach((e) => {
    if (e.transitionWindow && e.directionality !== 'bidirectional') {
      out.push({
        id: `tw-${e.id}`,
        level: 'warning',
        message: '过渡窗口仅对双向连接有效，当前连接不是双向',
        correction: '把该连接的方向性改为双向，或移除过渡窗口',
        path: `edge/${e.id}`,
        target: { type: 'edge', id: e.id },
      })
    }
  })

  // 遮挡框未覆盖任何连线
  doc.obstructions.forEach((o) => {
    if (o.affectsEdges.length === 0) {
      out.push({
        id: `ob-${o.id}`,
        level: 'warning',
        message: `${o.type === 'visual' ? '视觉' : '物理'}遮挡框未覆盖任何连线`,
        correction: '把遮挡框移动/放大到与某条连线相交的位置',
        path: `obstruction/${o.id}`,
        target: { type: 'obstruction', id: o.id },
      })
    }
  })

  return out
}

/* ---------------- export (B11 — canonical v2) ---------------- */
export function buildMapData(doc: MapDoc): MapData {
  const nx = (v: number) => +(v / WORLD.w).toFixed(4)
  const ny = (v: number) => +(v / WORLD.h).toFixed(4)
  const now = new Date().toISOString()

  const visualByEdge = new Map<string, string[]>()
  const physicalByEdge = new Map<string, string[]>()
  doc.obstructions.forEach((o) => {
    o.affectsEdges.forEach((edgeId) => {
      const map = o.type === 'visual' ? visualByEdge : physicalByEdge
      map.set(edgeId, [...(map.get(edgeId) ?? []), o.id])
    })
  })

  return {
    schemaVersion: '2.0',
    id: doc.id,
    name: doc.name,
    layers: doc.layers.map((l) => ({ id: l.id, name: l.name, height: l.height, backdrop: l.backdrop, transform: l.transform })),
    buildingGroups: doc.buildingGroups?.map((group) => ({
      id: group.id,
      frame: { x: nx(group.frame.x), y: ny(group.frame.y), width: nx(group.frame.width), height: ny(group.frame.height) },
      shell: group.shell,
      floors: group.floors.map((floor) => ({
        id: floor.id,
        ordinal: floor.ordinal,
        height: floor.height,
        nodes: [...floor.nodes],
        ...(floor.image !== undefined ? { image: floor.image } : {}),
        ...(floor.frame !== undefined ? { frame: { x: nx(floor.frame.x), y: ny(floor.frame.y), width: nx(floor.frame.width), height: ny(floor.frame.height) } } : {}),
      })),
      portals: group.portals.map((portal) => ({ ...portal })),
    })),
    nodes: doc.sceneNodes.map((n) => {
      const anchor = nodeAnchor(n.id, doc)
      return {
        id: n.id,
        name: n.name,
        scale: n.scale,
        layerId: n.layerId,
        parent: n.parent,
        def: n.def,
        at: { x: nx(anchor.x), y: ny(anchor.y) },
      }
    }),
    edges: doc.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      directionality: e.directionality,
      path: e.points.map((p) => ({ x: nx(p.x), y: ny(p.y) })),
      transitionWindow: e.transitionWindow
        ? { x: nx(e.transitionWindow.x), y: ny(e.transitionWindow.y) }
        : undefined,
      visualObstruction: visualByEdge.get(e.id),
      physicalObstruction: physicalByEdge.get(e.id),
      semanticAnchor: e.semanticAnchor,
      def: e.def,
    })),
    obstructions: doc.obstructions.map((o) => ({
      id: o.id,
      type: o.type,
      x: nx(o.x),
      y: ny(o.y),
      width: nx(o.width),
      height: ny(o.height),
      rotation: o.rotation,
      affectsEdges: o.affectsEdges,
    })),
    terrains: doc.terrains.map((t) => ({
      id: t.id,
      type: t.type,
      x: nx(t.x),
      y: ny(t.y),
      width: nx(t.width),
      height: ny(t.height),
      rotation: t.rotation,
    })),
    placements: doc.placements.map((p) => ({
      id: p.id,
      materialId: p.materialId,
      sceneId: p.sceneId,
      x: nx(p.x),
      y: ny(p.y),
    })),
    metadata: { created: now, modified: now, author: 'WakeUp Editor' },
  }
}

export function exportMap() {
  const errors = state.diagnostics.filter((d) => d.level === 'error')
  const data = buildMapData(state.doc)
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.doc.name || 'map'}.json`
  a.click()
  URL.revokeObjectURL(url)
  if (errors.length) {
    toast(`已保存，但有 ${errors.length} 处错误未修复`, 'warn')
  } else {
    toast('导出成功', 'ok')
  }
}

/* ---------------- react hook ----------------
   useSyncExternalStore 是订阅外部可变 store 的正确原语：它在每次 emit 后
   重新读取快照并与上一次对比，避免手写 ref 比较时因渲染期改写 ref 而漏掉更新。
   getSnapshot 用 selector 记忆化，保证返回稳定引用（否则 tearing/无限循环）。 */
export function useEditor<T>(selector: (s: State) => T): T {
  const selRef = useRef(selector)
  selRef.current = selector
  const lastRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: undefined as T })

  const getSnapshot = () => {
    const next = selRef.current(state)
    if (lastRef.current.hasValue && Object.is(next, lastRef.current.value)) {
      return lastRef.current.value
    }
    lastRef.current = { hasValue: true, value: next }
    return next
  }

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
