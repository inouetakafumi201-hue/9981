/* =========================================================================
   WakeUp 地图编辑器 — 数据模型 v2
   世界坐标以「地图单位」表示 (WORLD.w × WORLD.h)。导出时归一化为 0..1。

   核心模型（B0 重写）：场景不再是"一个矩形=一个节点"，而是拆成两层：
   - SceneNode：逻辑节点，只有一个"高光点"锚点坐标 `at`，连线永远接这个点。
   - SceneBox：纯显示矩形，多个框可属于同一个 sceneId（自动聚合），
     `at` 由聚合外接矩形中心自动重算，不再随一个框的几何字面存储。
   ========================================================================= */

export const WORLD = { w: 1600, h: 1000 }

export type Mode = 'select' | 'place' | 'edge' | 'sample' | 'playtest'

export type Scale = 'large' | 'medium' | 'small'

export type ElementType =
  | 'scene'
  | 'building'
  | 'edge'
  | 'obstruction'
  | 'terrain'
  | 'placement'

export interface Vec {
  x: number
  y: number
}

/** 边上的一个控制点。`hidden` 为 true 表示这是拉弯手势自动追加的隐藏点——
 *  仍参与样条形状计算，但不渲染可拖拽的圆形手柄，也不计入折点数量。
 *  双击插入的折点、拉边时的初始轨迹点均为显式点（hidden 省略/false）。 */
export type EdgePoint = Vec & { hidden?: boolean }

/** 每种尺度允许的最大连接数（大5/中4/小3） */
export const SCALE_LIMIT: Record<Scale, number> = {
  large: 5,
  medium: 4,
  small: 3,
}

export const SCALE_LABEL: Record<Scale, string> = {
  large: '大',
  medium: '中',
  small: '小',
}

/** 图层背景图（全屏铺底 / 局部贴纸），渲染与导出用。image 为 dataURL 或资源路径。 */
export interface LayerBackdrop {
  image: string
  pixelWidth: number
  pixelHeight: number
}

/** 图层变换（缩放 + 平移），用于局部贴纸的对齐与再定位。 */
export interface LayerTransform {
  scaleX: number
  scaleY: number
  tx: number
  ty: number
}

/** 图层。`height` 留空表示独立层——不参与跨层透明度叠加公式，恒不透明。 */
export interface Layer {
  id: string
  name: string
  height?: number
  /** 全屏底图：拉伸铺满整张图。局部贴纸用 backdrop + transform 承载。 */
  backdrop?: LayerBackdrop
  transform?: LayerTransform
}

/** 逻辑场景节点。`at` 是"高光点"——连线永远接这个点，而不是某个矩形的几何
 *  中心。当该节点至少有一个成员 SceneBox 时，`at` 由
 *  `recomputeAggregation` 自动重算为所有成员框聚合外接矩形的中心；只有在
 *  "无成员框"的极端情况下才允许把 `at` 当手动值直接使用。 */
export interface SceneNode {
  id: string
  name: string
  scale: Scale
  layerId: string
  /** 上级场景节点 id（用于 large→medium→small 的软约束嵌套） */
  parent?: string
  def?: string
  at: Vec
}

/** 纯显示矩形，不携带任何"是什么场景"的语义——那些字段全部搬到
 *  SceneNode 上。多个 box 可以指向同一个 sceneId，几何重叠时自动合并。
 *  `rotation`（度，绕自身中心）默认 0——整组旋转（B2）时，每个成员框会
 *  绕"组的外接矩形中心"公转位移 + 自身也同角度自转，两者叠加才能让整组看
 *  起来像绕一个公共轴心刚体旋转。 */
export interface SceneBox {
  id: string
  sceneId: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export type EdgeDirectionality =
  | 'bidirectional'
  | 'unidirectional'
  | 'one-way-up'
  | 'one-way-down'

export const DIRECTIONALITY_LABEL: Record<EdgeDirectionality, string> = {
  bidirectional: '双向',
  unidirectional: '单向',
  'one-way-up': '单向·低到高',
  'one-way-down': '单向·高到低',
}

export interface Edge {
  id: string
  /** 引用 SceneNode.id（不再是矩形 id） */
  from: string
  to: string
  directionality: EdgeDirectionality
  /** 必经点，世界坐标，含首尾端点（渲染时端点会被 nodeAnchor 覆盖，此处
   *  仅作初值/回退）；中间为折点。Catmull-Rom 穿过全部点。
   *  中间点可能带 hidden 标记（见 EdgePoint） */
  points: EdgePoint[]
  /** 过渡窗口——仅双向连接有意义，其它方向性下诊断会报 warning */
  transitionWindow?: Vec
  /** 过渡场景素材直接成为该边的窗口，不进入 placements。 */
  transitionSceneMaterialId?: string
  /** 语义锚点：高地/洼地/中性，仅影响边中点的可视化装饰，不接入玩法逻辑 */
  semanticAnchor?: 'highland' | 'lowland' | 'neutral'
  def?: string
}

export interface Obstruction {
  id: string
  type: 'visual' | 'physical'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  affectsEdges: string[]
}

export interface Terrain {
  id: string
  type: 'highland' | 'lowland'
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export type PlacementEffectiveMode = 'scene-bound' | 'free-decoration'

export interface Placement {
  id: string
  materialId: string
  sceneId: string
  x: number
  y: number
  logicCategory?: string
  effectiveMode?: PlacementEffectiveMode
  runtimeAdapterId?: string | null
  tags?: string[]
}

/** Editor-local building branch. Frames use world coordinates; the bridge normalizes them. */
export interface BuildingFrame {
  x: number
  y: number
  width: number
  height: number
}
export interface BuildingFloor {
  id: string
  ordinal: number
  height: number
  nodes: string[]
  image?: string
  frame?: BuildingFrame
}
export interface BuildingPortal {
  id: string
  from: string
  to: string
  def: string
}
export interface BuildingGroup {
  id: string
  frame: BuildingFrame
  shell: string
  floors: BuildingFloor[]
  portals: BuildingPortal[]
}

export interface MapDoc {
  id: string
  name: string
  /** 图层数据本身（名称/高度）是文档数据；"当前正在编辑哪一层"是编辑器视图
   *  状态，不放在这里——否则切换图层会污染撤销历史，见 editor-store 的
   *  `State.currentLayerId`。 */
  layers: Layer[]
  sceneNodes: SceneNode[]
  sceneBoxes: SceneBox[]
  edges: Edge[]
  obstructions: Obstruction[]
  terrains: Terrain[]
  placements: Placement[]
  /** Presentation-only building branches, independent from main map layers. */
  buildingGroups?: BuildingGroup[]
}

export interface Selectable {
  type: ElementType
  id: string
}

/** 导出用的归一化 JSON 结构 — canonical v2（B11） */
export interface MapData {
  schemaVersion: '2.0'
  id: string
  name: string
  layers: Array<{
    id: string
    name: string
    height?: number
    backdrop?: LayerBackdrop
    transform?: LayerTransform
  }>
  buildingGroups?: BuildingGroup[]
  nodes: Array<{
    id: string
    name: string
    scale: Scale
    layerId: string
    parent?: string
    def?: string
    at: Vec
  }>
  edges: Array<{
    id: string
    from: string
    to: string
    directionality: EdgeDirectionality
    path: Vec[]
    transitionWindow?: Vec
    transitionSceneMaterialId?: string
    visualObstruction?: string[]
    physicalObstruction?: string[]
    semanticAnchor?: 'highland' | 'lowland' | 'neutral'
    def?: string
  }>
  obstructions: Array<{
    id: string
    type: 'visual' | 'physical'
    x: number
    y: number
    width: number
    height: number
    rotation: number
    affectsEdges: string[]
  }>
  terrains: Array<{
    id: string
    type: 'highland' | 'lowland'
    x: number
    y: number
    width: number
    height: number
    rotation: number
  }>
  placements: Array<{
    id: string
    materialId: string
    sceneId: string
    x: number
    y: number
    overrides?: Record<string, unknown>
    temporaryFree?: boolean
    logicCategory?: string
    effectiveMode?: PlacementEffectiveMode
    runtimeAdapterId?: string | null
    tags?: string[]
  }>
  metadata: {
    created: string
    modified: string
    author: string
  }
}

/* ---------------- 聚合几何辅助函数 ---------------- */

/** 属于某场景节点的全部显示矩形 */
export function boxesOfScene(sceneId: string, doc: MapDoc): SceneBox[] {
  return doc.sceneBoxes.filter((b) => b.sceneId === sceneId)
}

/** 一组矩形的外接矩形（聚合 bbox）。按各自旋转后的 AABB 取包围，这样带
 *  旋转的成员框也能被完整框住（标签定位、拖拽整组时的参照框都依赖这
 *  个）。 */
export function sceneGroupBBox(boxes: SceneBox[]): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    const box = boxAABB(b)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 高光点：优先用聚合外接矩形中心；若该节点没有任何成员框（极端情况），
 *  回退到节点上手动存的 `at`。这是全部连线端点、悬停/选中锚点的唯一权威
 *  来源——不要在别处再手写"取矩形中心"的逻辑。 */
export function nodeAnchor(nodeId: string, doc: MapDoc): Vec {
  const node = doc.sceneNodes.find((n) => n.id === nodeId)
  if (!node) return { x: 0, y: 0 }
  const boxes = boxesOfScene(nodeId, doc)
  const bbox = sceneGroupBBox(boxes)
  if (bbox) return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }
  return node.at
}

/** 图层系统的跨层透明度公式（B4）：两侧都填了 `height` 时，高度差每差 1
 *  透明度降 10%（`clamp(1 - |Δheight| * 0.1, 0, 1)`）；只要有一侧是"独立层"
 *  （`height` 留空），就不参与这套叠加换算，恒不透明——独立层���间互不透视。 */
export function overlayOpacity(a: Layer, b: Layer): number {
  if (a.height == null || b.height == null) return 1
  const delta = Math.abs(a.height - b.height)
  return Math.min(1, Math.max(0, 1 - delta * 0.1))
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

/** 场景框允许整组旋转（B2），聚合/粘连/空洞判定统一走旋转后的 AABB 近似
 *  （见 geometry.ts `rotatedRectAABB` 的说明）而不是精确旋转矩形碰撞，避
 *  免在数据层引入 SAT 之类的重量级几何代码。 */
function boxAABB(b: { x: number; y: number; width: number; height: number; rotation?: number }) {
  if (!b.rotation) return b
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const rad = (b.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const hw = (b.width * cos + b.height * sin) / 2
  const hh = (b.width * sin + b.height * cos) / 2
  return { x: cx - hw, y: cy - hh, width: hw * 2, height: hh * 2 }
}

/** 场景框聚合（B2）：任意两个几何重叠的框，无论当前 sceneId 是否相同，都
 *  会被并查集归并为同一个场景。只做合并，不做"分开后自动拆散"——移开一个
 *  框不会把已合并的场景重新拆开，这样更安全，不会因为一次误拖拽就打散一
 *  个精心搭建的多矩形场景。合并后：
 *  - 幸存 sceneId = 该组中"字典序最小"的原 sceneId（稳定、可预测）。
 *  - 其余成员节点被移除，引用过它们的 Edge.from/to、Placement.sceneId
 *    全部重定向到幸存 id。
 *  纯函数：不产生副作用，doc 不变时原样返回同一引用（便于调用方判断是否
 *  真的发生了变化）。 */
export function recomputeAggregation(doc: MapDoc): MapDoc {
  const boxes = doc.sceneBoxes
  if (boxes.length === 0) return doc

  const parent = new Map<string, string>()
  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    if (root !== id) parent.set(id, root)
    return root
  }
  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // deterministic: smaller id string wins as root
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }

  const sceneIds = new Set(boxes.map((b) => b.sceneId))
  sceneIds.forEach((id) => parent.set(id, id))
    for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    if (!a) continue
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]
      if (!b) continue
      if (a.sceneId === b.sceneId) continue
      if (rectsOverlap(boxAABB(a), boxAABB(b))) union(a.sceneId, b.sceneId)
    }
  }

  const survivorOf = new Map<string, string>()
  let changed = false
  sceneIds.forEach((id) => {
    const root = find(id)
    survivorOf.set(id, root)
    if (root !== id) changed = true
  })
  if (!changed) return doc

  const nextBoxes = boxes.map((b) => {
    const survivor = survivorOf.get(b.sceneId)!
    return survivor === b.sceneId ? b : { ...b, sceneId: survivor }
  })
  const removedNodeIds = new Set<string>()
  sceneIds.forEach((id) => {
    if (survivorOf.get(id) !== id) removedNodeIds.add(id)
  })
  const nextNodes = doc.sceneNodes.filter((n) => !removedNodeIds.has(n.id))
  const remap = (id: string) => survivorOf.get(id) ?? id
  const nextEdges = doc.edges.map((e) =>
    removedNodeIds.has(e.from) || removedNodeIds.has(e.to)
      ? { ...e, from: remap(e.from), to: remap(e.to) }
      : e,
  )
  const nextPlacements = doc.placements.map((p) =>
    removedNodeIds.has(p.sceneId) ? { ...p, sceneId: remap(p.sceneId) } : p,
  )

  return {
    ...doc,
    sceneBoxes: nextBoxes,
    sceneNodes: nextNodes,
    edges: nextEdges,
    placements: nextPlacements,
  }
}

type RectLike = { x: number; y: number; width: number; height: number }

/** 粘连判定（B3）：一个候选矩形同时压到几个「不同」sceneId 的框上。返回值
 *  是这些外部 sceneId 的集合——调用方按"集合大小 > 1"判定为非法粘连并拒绝
 *  整个操作，大小 ≤ 1（0 个或恰好 1 个）都是合法的（0 个=空地新建，1 个=
 *  正常并入已有场景，交给 `recomputeAggregation` 处理）。 */
export function foreignSceneIdsTouchedByRect(
  rect: RectLike,
  doc: MapDoc,
  excludeSceneId?: string,
): Set<string> {
  const ids = new Set<string>()
  for (const b of doc.sceneBoxes) {
    if (excludeSceneId && b.sceneId === excludeSceneId) continue
    if (rectsOverlap(rect, boxAABB(b))) ids.add(b.sceneId)
  }
  return ids
}

/** 同上，但检查对象是"某个场景节点的全部成员框在新位置"（整组拖拽场景），
 *  而不是单个矩形——逐一检查每个成员框，外部 sceneId 集合是所有框结果的并
 *  集。 */
export function foreignSceneIdsTouchedByGroup(sceneId: string, doc: MapDoc): Set<string> {
  const own = boxesOfScene(sceneId, doc)
  const ids = new Set<string>()
  for (const ownBox of own) {
    for (const id of foreignSceneIdsTouchedByRect(ownBox, doc, sceneId)) ids.add(id)
  }
  return ids
}

export interface HoleCell {
  x: number
  y: number
  size: number
}

/** 空洞全填（B3）：对每个由 ≥2 个矩形拼成的场景聚合，在其外接矩形内按
 *  `gridSize` 世界单位光栅化，再从网格边界向内 flood-fill 未被任何成员框
 *  覆盖的格子——凡是flood-fill 无法从边界到达的未覆盖格，就是被完全包围
 *  在场景内部的"洞"（例如口字形拼接围出的天井）。只用于视觉高亮 + 阻止在
 *  洞内新建场景，不改动任何真实矩形数据。按 sceneId 分组返回，便于渲染时
 *  分别上色/命中测试时统一遍历。 */
export function computeHoleCells(doc: MapDoc, gridSize = 20): Map<string, HoleCell[]> {
  const result = new Map<string, HoleCell[]>()
  const sceneIds = new Set(doc.sceneBoxes.map((b) => b.sceneId))
  sceneIds.forEach((sceneId) => {
    const boxes = boxesOfScene(sceneId, doc)
    if (boxes.length < 2) return // 单矩形场景不可能围出洞
    const bbox = sceneGroupBBox(boxes)
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return
    const cols = Math.max(1, Math.ceil(bbox.width / gridSize))
    const rows = Math.max(1, Math.ceil(bbox.height / gridSize))
    // 网格总量护栏：极端细长或巨大的聚合不做洞检测，避免卡顿
    if (cols * rows > 4000) return

    const covered: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = { x: bbox.x + c * gridSize, y: bbox.y + r * gridSize, width: gridSize, height: gridSize }
        const row = covered[r]
        if (!row) continue
        row[c] = boxes.some((candidate) => rectsOverlap(cell, boxAABB(candidate)))
      }
    }

    const exterior: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    const stack: Array<[number, number]> = []
    for (let r = 0; r < rows; r++) {
      const row = covered[r]
      if (!row) continue
      for (let c = 0; c < cols; c++) {
        if ((r === 0 || r === rows - 1 || c === 0 || c === cols - 1) && row[c] === false) {
          stack.push([r, c])
        }
      }
    }
    while (stack.length) {
      const cell = stack.pop()
      if (!cell) continue
      const [r, c] = cell
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue
      const coveredRow = covered[r]
      const exteriorRow = exterior[r]
      if (!coveredRow || !exteriorRow) continue
      if (coveredRow[c] || exteriorRow[c]) continue
      exteriorRow[c] = true
      stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1])
    }

    const holes: HoleCell[] = []
    for (let r = 0; r < rows; r++) {
      const coveredRow = covered[r]
      const exteriorRow = exterior[r]
      if (!coveredRow || !exteriorRow) continue
      for (let c = 0; c < cols; c++) {
        if (coveredRow[c] === false && exteriorRow[c] === false) {
          holes.push({ x: bbox.x + c * gridSize, y: bbox.y + r * gridSize, size: gridSize })
        }
      }
    }
    if (holes.length) result.set(sceneId, holes)
  })
  return result
}

/** 候选矩形是否落进了任意场景的洞内——放置新场景（N 工具）前的合法性检查。 */
export function rectIntersectsHoles(rect: RectLike, holes: Map<string, HoleCell[]>): boolean {
  for (const cells of holes.values()) {
    for (const cell of cells) {
      if (rectsOverlap(rect, { x: cell.x, y: cell.y, width: cell.size, height: cell.size })) {
        return true
      }
    }
  }
  return false
}
