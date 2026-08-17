import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CanvasView } from './CanvasView.js';
import {
  addEdge, addNode, blankMap, deleteSelection, directions, type EditorMode, floorOf, makeLayerFloors,
  mergeDeleteKnot, moveKnot, moveNode, moveTransitionWindow, nextId, nodeScales, pushKnot, rotateObstruction,
  samples, setNodeFloor, setPhysicalObstruction, setSemanticAnchor, setTransitionWindow, setVisualObstruction,
  simplifyEdgePath, snapEdgeEndpoint, straightenKnots, translateObstruction, updateEdge, updateNode,
} from './editor-state.js';
import { cssVars } from './tokens.js';
import { blueprintCopy, serializeMapPublish } from '../editor/map-io.js';
import { emptyLayer } from '../editor/workspace-state.js';
import { canSetHeight, visibleLayers } from '../layers/layer-rules.js';
import type { MapLayer } from '../layers/layer-shapes.js';
import { overlayOpacity } from '../layers/layer-shapes.js';
import { createDeveloperHook } from '../ports/material-availability.js';
import type { MapData, MapDiagnostic, MapEdge, MapNode, SceneScale, Vec2 } from '../ports/map-contracts.js';
import { adjacencyOf, connectedGroups } from '../ports/map-contracts.js';
import { pan, zoomAt, flyTo, defaultCamera, type Camera } from './camera.js';
import { commitHistory, emptyHistory, redoHistory, undoHistory, type EditorHistory } from './editor-history.js';
import { playtestSmoke, structureDiagnostics } from '../verify/playtest.js';
import { Undo2, Redo2 } from 'lucide-react';
import './editor.css';

const maps = samples();
const materials = [
  ['inst_locker', '储物柜', '装置'], ['inst_lamp', '感应灯', '照明'], ['inst_bench', '长椅', '陈设'], ['inst_signal', '信号灯', '交互'],
  ['inst_case', '档案箱', '线索'], ['inst_screen', '终端屏', '交互'], ['inst_barrier', '隔离带', '遮挡'], ['inst_bed', '铺位', '陈设'],
] as const;

function initialLayers(): readonly MapLayer[] {
  return [{ id: 'layer:ground', name: '地面层', height: 0 }, { id: 'layer:roof', name: '高架层', height: 1 }];
}

function selectionId(selection: string | null): string | null {
  return selection?.slice(selection.indexOf(':') + 1) ?? null;
}

function selectionKind(selection: string | null): 'node' | 'edge' | null {
  return selection?.startsWith('node:') ? 'node' : selection?.startsWith('edge:') ? 'edge' : null;
}

const NODE_DIAGNOSTICS = new Set(['MAP_DUPLICATE_NODE_ID', 'MAP_COORD_OUT_OF_RANGE', 'MAP_UNDECLARED_FLOOR', 'MAP_PARENT_NOT_FOUND', 'MAP_ILLEGAL_SCENE_NESTING', 'MAP_PARENT_CYCLE', 'MAP_CONNECTION_LIMIT_EXCEEDED', 'MAP_UNKNOWN_SCENE_DEF', 'MAP_SCALE_MISMATCH']);

/** 点击诊断时高亮对应图元；edge/placement 诊断也要能落到正确的选择前缀。 */
function focusDiagnostic(item: MapDiagnostic, map: MapData): string | null {
  const subject = item.subject;
  if (!subject) return null;
  if (NODE_DIAGNOSTICS.has(item.code)) return `node:${subject}`;
  if (map.edges.some((edge) => edge.id === subject)) return `edge:${subject}`;
  if (map.nodes.some((node) => node.id === subject)) return `node:${subject}`;
  return null;
}

function download(content: string, filename: string): void {
  const href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

const LAYER_FLOORS = makeLayerFloors(['layer:ground', 'layer:roof']);
const EDGE_SNAP_RADIUS = 0.06;
const KNOT_MERGE_TOLERANCE = 0.02; // 折点融合删除阈值（约 10px 归一化，不暴露给创作者）

/** 从 SVG 指针事件取归一化坐标（画布拖拽 / 描线 / 框选共用）。 */
function svgPointFromEvent(event: { clientX: number; clientY: number; currentTarget: { getBoundingClientRect: () => DOMRect } }): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function clamp01Point(x: number, y: number): Vec2 { return { x: clamp01(x), y: clamp01(y) }; }

/** 节点拖拽 / 描线的最小位移阈值（避免点击即误触发）。 */
const DRAG_THRESHOLD = 0.006;

export function EditorApp(): JSX.Element {
  const [map, setMap] = useState<MapData>(maps[0]!);
  const [layers, setLayers] = useState<readonly MapLayer[]>(initialLayers);
  const [currentLayerId, setCurrentLayerId] = useState('layer:ground');
  const [selection, setSelection] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('select');
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<{ from: string; points: Vec2[] } | null>(null);
  const [edgeSnapTarget, setEdgeSnapTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; down: Vec2; moved: boolean } | null>(null);
  const [knotDrag, setKnotDrag] = useState<{ edgeId: string; pathIndex: number } | null>(null);
  const [windowDrag, setWindowDrag] = useState<{ edgeId: string } | null>(null);
  const [obsDrag, setObsDrag] = useState<{ edgeId: string; which: 'visual' | 'physical'; last: Vec2 } | null>(null);
  const [bendingPoint, setBendingPoint] = useState<Vec2 | null>(null);
  const [boxSelect, setBoxSelect] = useState<Vec2 | null>(null);
  const [boxSelectCurrent, setBoxSelectCurrent] = useState<Vec2 | null>(null);
  const [sampleSlot, setSampleSlot] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>(defaultCamera);
  const [history, setHistory] = useState<EditorHistory>(emptyHistory);
  const [flash, setFlash] = useState<string | null>(null);
  const [pulseSubject, setPulseSubject] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [materialQuery, setMaterialQuery] = useState('');
  const [altHeld, setAltHeld] = useState(false);
  const [playtestResult, setPlaytestResult] = useState<string>('尚未运行');
  const [notice, setNotice] = useState('工作区已就绪。');
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const hook = useMemo(() => createDeveloperHook(materials.map(([id]) => id)), []);
  const diagnostics = useMemo(() => structureDiagnostics(map), [map]);
  const errors = diagnostics.filter((item) => item.severity === 'error');
  const selectedKind = selectionKind(selection);
  const selectedId = selectionId(selection);
  const selectedNode = selectedKind === 'node' ? map.nodes.find((node) => node.id === selectedId) : undefined;
  const selectedEdge = selectedKind === 'edge' ? map.edges.find((edge) => edge.id === selectedId) : undefined;
  const currentLayer = layers.find((layer) => layer.id === currentLayerId);
  const visible = visibleLayers(layers, currentLayerId);
  const shownMaterials = materials.filter(([id, name, category]) => hook.isAvailable(id) && `${name} ${category}`.toLowerCase().includes(materialQuery.toLowerCase()));
  /** 图层的节点归属通过 `MapNode.layerId`（未落契约的扩展位）——开发板用 node.floor 近似分组。 */
  const nodeLayerOf = useMemo(() => {
    const byId = new Map<string, string>();
    const order = layers.map((layer) => layer.id);
    for (const node of map.nodes) {
      // floor 与图层未建立硬映射；按 height 就近归类，仅用于画布裁剪效果（非权威）。
      const idx = Math.min(order.length - 1, node.floor);
      if (idx >= 0) byId.set(node.id, order[idx] ?? 'layer:ground');
    }
    return (nodeId: string): string | undefined => byId.get(nodeId);
  }, [layers, map.nodes]);

  const enterMode = (nextMode: EditorMode) => { setMode(nextMode); setEdgeStart(null); setEdgeDraft(null); setEdgeSnapTarget(null); setDragging(null); setKnotDrag(null); setWindowDrag(null); setObsDrag(null); setBendingPoint(null); setBoxSelect(null); setBoxSelectCurrent(null); setSelection(null); };
  /**
   * 唯一的写地图通道：把「旧值 → 新值」的变换提交进历史栈（redo 清空），再落到 state。
   * §九 撤销 / 重做必要列：每个破坏性修改都入栈。message 可带不可带。
   */
  const changeMap = (mutate: (current: MapData) => MapData, message?: string) => {
    setMap((current) => {
      const after = mutate(current);
      if (after === current) return current;
      setHistory((hist) => commitHistory(hist, message ?? '修改', current, after));
      if (message) setNotice(message);
      return after;
    });
  };
  const doUndo = () => {
    setMap((current) => {
      const r = undoHistory(history, current);
      if (r.history === history) { setNotice('没有可撤销的操作。'); return current; }
      setHistory(r.history);
      setNotice('已撤销。');
      return r.map;
    });
  };
  const doRedo = () => {
    setMap((current) => {
      const r = redoHistory(history, current);
      if (r.history === history) { setNotice('没有可重做的操作。'); return current; }
      setHistory(r.history);
      setNotice('已重做。');
      return r.map;
    });
  };
  const select = (next: string | null) => {
    if (mode === 'edge' && next?.startsWith('node:')) {
      const nodeId = selectionId(next)!;
      if (!edgeStart) { setEdgeStart(nodeId); setSelection(next); return; }
      if (edgeStart !== nodeId) changeMap((m) => addEdge(m, edgeStart, nodeId), '已创建连接。');
      setEdgeStart(null); setSelection(next); return;
    }
    setSelection(next);
  };

  const onCanvasPoint = (point: Vec2) => {
    if (mode === 'node') {
      changeMap((m) => addNode(m, point, floorOf(LAYER_FLOORS, currentLayerId, m.floors)), '已放置场景。');
      return;
    }
    if ((mode === 'sample' || altHeld) && sampleSlot) {
      // 取样（§九：I 或按住 Alt）：把样本槽应用到点出的空白位置（新建同类场景）
      const base = map.nodes.find((n) => n.id === sampleSlot);
      if (base) changeMap((m) => addNode(m, point, base.floor, base.scale), `已按 ${base.name ?? base.id} 放置同类场景。`);
      setSampleSlot(null);
      return;
    }
    setSelection(null);
    setEdgeStart(null);
  };

  const onMaterialDrop = (materialId: string, point: Vec2) => {
    const nearest = [...map.nodes].sort((a, b) => Math.hypot(a.at.x - point.x, a.at.y - point.y) - Math.hypot(b.at.x - point.x, b.at.y - point.y))[0];
    if (!nearest) { setNotice('先放置一个场景，再将素材拖入其周围。'); return; }
    changeMap((m) => ({ ...m, placements: [...m.placements, { id: nextId('placement', m.placements), at: nearest.id, def: materialId }] }), `已将素材放到 ${nearest.name ?? nearest.id}。`);
  };

  const onNodePointerDown = (nodeId: string, event: PointerEvent<SVGElement>) => {
    if (mode === 'select') {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragging({ id: nodeId, down: map.nodes.find((n) => n.id === nodeId)?.at ?? { x: 0, y: 0 }, moved: false });
      setSelection(`node:${nodeId}`);
      return;
    }
    if ((mode === 'sample' || event.altKey) && mode !== 'edge') {
      // 取样（§九：I 或按住 Alt，松开即退）：点已有场景 = 说"再来一个这样的"
      event.stopPropagation();
      setSampleSlot(nodeId);
      setSelection(`node:${nodeId}`);
      setNotice('已取样。点其他空白放置同类场景，或按 I 退出取样。');
      return;
    }
    if (mode === 'edge') {
      // 拉边：在节点上按下 → 开始描线草稿（§九 拉边流程第 3 步）
      event.stopPropagation();
      const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
      const point = clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
      setEdgeDraft({ from: nodeId, points: [point] });
      setEdgeStart(nodeId);
      setEdgeSnapTarget(null);
      setSelection(`node:${nodeId}`);
      return;
    }
  };
  const onNodePointerMove = (nodeId: string, event: PointerEvent<SVGElement>) => {
    const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const point = clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    if (dragging?.id === nodeId) {
      // 位移超过阈值才算真正的拖动（否则只算点击，交给 pointerUp 决定是否清选择）
      const dist = Math.hypot(point.x - dragging.down.x, point.y - dragging.down.y);
      setDragging((d) => d?.id === nodeId ? { ...d, moved: d.moved || dist > DRAG_THRESHOLD } : d);
      if (dist > DRAG_THRESHOLD) changeMap((m) => moveNode(m, nodeId, point));
      return;
    }
    if (edgeDraft?.from === nodeId) {
      // 拉边中：实时采集采样点（永不中途吸附，§九 只有松手吸附）+ 终点吸附预览
      setEdgeDraft((draft) => draft ? { ...draft, points: [...draft.points, point] } : draft);
      const target = snapEdgeEndpoint(map.nodes.filter((n) => n.id !== edgeDraft.from), point, EDGE_SNAP_RADIUS);
      setEdgeSnapTarget(target ? target.id : null);
    }
  };
  /** 松手：若确实拖动了节点，收尾；若只是点击，清选择。拉边判定放画布松手统一处理。 */
  const onNodePointerUp = (draggedId: string) => {
    if (dragging?.id === draggedId) {
      if (!dragging.moved) setSelection(null); // 单击场景框 = 清选择（Select 态裸输入）
      setDragging(null);
    }
  };

  const onEdgePointerDown = (edgeId: string, event: PointerEvent<SVGGElement>) => {
    if (mode !== 'select') return;
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const bounds = svg.getBoundingClientRect();
    setBendingPoint(clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height));
    setSelection(`edge:${edgeId}`);
  };
  const onEdgePointerMove = (edgeId: string, event: PointerEvent<SVGGElement>) => {
    // [C] 拉弯即追加（Fire-and-Forget）：按住线段主体外拖，落点追加隐藏样条点。
    if (mode !== 'select' || !bendingPoint || selection !== `edge:${edgeId}`) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const point = clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    setBendingPoint(point);
    changeMap((m) => pushKnot(m, edgeId, point));
  };
  const onEdgePointerUp = () => {
    // §九 [C] 拉弯：move 阶段已 Fire-and-Forget 追加；纯单击无 move 从不触发 pushKnot，松手只复位。
    setBendingPoint(null);
  };
  const onEdgeDoubleClick = (edgeId: string) => {
    if (mode !== 'select') return;
    changeMap((m) => straightenKnots(m, edgeId), '双击线段：已拉直。'); // §九 唯一重塑入口
    setSelection(`edge:${edgeId}`);
  };

  const onKnotPointerDown = (edgeId: string, pathIndex: number, event: PointerEvent<SVGElement>) => {
    if (mode !== 'select') return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setKnotDrag({ edgeId, pathIndex });
    setSelection(`edge:${edgeId}`);
  };
  const onKnotPointerMove = (edgeId: string, pathIndex: number, event: PointerEvent<SVGElement>) => {
    if (!knotDrag || knotDrag.edgeId !== edgeId || knotDrag.pathIndex !== pathIndex) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const point = clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    changeMap((m) => moveKnot(m, edgeId, pathIndex, point)); // [B] 折点调整
  };
  const onKnotPointerUp = (edgeId: string, pathIndex: number) => {
    if (!knotDrag) return;
    // [D] 折点拖至邻折点 → 融合删除（拍直两侧）
    const edge = map.edges.find((e) => e.id === edgeId);
    if (edge && edge.path[pathIndex]) {
      const prev = edge.path[pathIndex - 1];
      const next = edge.path[pathIndex + 1];
      const p = edge.path[pathIndex]!;
      const prevDist = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : Infinity;
      const nextDist = next ? Math.hypot(p.x - next.x, p.y - next.y) : Infinity;
      if (Math.min(prevDist, nextDist) < KNOT_MERGE_TOLERANCE) {
        changeMap((m) => mergeDeleteKnot(m, edgeId, pathIndex), '折点已融合删除，左右拍直。');
      }
    }
    setKnotDrag(null);
  };

  /** 过渡窗口图形：按下开始独立拖（不吸附节点，§八：一旦经过一条线即成为该线过渡窗口）。 */
  const onWindowPointerDown = (edgeId: string, event: PointerEvent<SVGGElement>) => {
    if (mode !== 'select') return;
    event.stopPropagation();
    setWindowDrag({ edgeId });
    setSelection(`edge:${edgeId}`);
  };
  const onWindowPointerMove = (edgeId: string, event: PointerEvent<SVGGElement>) => {
    if (!windowDrag || windowDrag.edgeId !== edgeId) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const point = clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    changeMap((m) => moveTransitionWindow(m, edgeId, point), '过渡窗口已移动。');
  };
  const onWindowPointerUp = () => { setWindowDrag(null); };

  /** 遮挡框拖移（§八 涂鸦交互：整体拖，无四角控制点）。 */
  const onObstructionPointerDown = (edgeId: string, which: 'visual' | 'physical', event: PointerEvent<SVGGElement>) => {
    if (mode !== 'select') return;
    event.stopPropagation();
    setObsDrag({ edgeId, which, last: svgPointFromEvent(event) });
    setSelection(`edge:${edgeId}`);
  };
  const onObstructionPointerMove = (edgeId: string, which: 'visual' | 'physical', event: PointerEvent<SVGGElement>) => {
    if (!obsDrag || obsDrag.edgeId !== edgeId || obsDrag.which !== which) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const point = clamp01Point((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    const dx = point.x - obsDrag.last.x;
    const dy = point.y - obsDrag.last.y;
    if (dx !== 0 || dy !== 0) {
      changeMap((m) => translateObstruction(m, edgeId, which, dx, dy), '遮挡框已移动。');
      setObsDrag({ edgeId, which, last: point });
    }
  };
  const onObstructionPointerUp = () => { setObsDrag(null); };

  /** 画布右键菜单（§九 Select 态裸输入：空白 → 画布菜单）。点造节点。 */
  const onCanvasContextMenu = (point: Vec2) => {
    if (mode !== 'select') return;
    changeMap((m) => addNode(m, point, floorOf(LAYER_FLOORS, currentLayerId, m.floors)), '已放置场景。');
    setNotice('右键已放置场景（造节点走 N 或右键）。');
  };

  const onCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (mode !== 'select') return;
    if (event.button === 1 || event.button === 2) return; // 中键平移走 pointerMove
    // Select 态左键拖空白 = 框选（§九 Select 态裸输入：平移有空格 + 中键两路，框选无替代）
    const point = svgPointFromEvent(event);
    setBoxSelect(point);
    setBoxSelectCurrent(point);
    setSelection(null);
  };
  const onCanvasPointerMoveBox = (event: PointerEvent<SVGSVGElement>) => {
    if (boxSelect) { setBoxSelectCurrent(svgPointFromEvent(event)); return; }
    // 空格（shift）/ 中键拖 = 平移（§九 全局输入：走 viewBox，不走浏览器滚动）
    if ((event.buttons & 1 || event.buttons & 4) && (event.shiftKey || event.buttons & 4)) {
      const dx = event.movementX ?? 0;
      const dy = event.movementY ?? 0;
      if (dx !== 0 || dy !== 0) setCamera((c) => pan(c, dx, dy));
    }
  };
  const onCanvasPointerUpBox = () => {
    // 拉边松手：判定终点吸附或空白丢弃（§九 拉边流程第 6/7 步）
    if (edgeDraft) {
      if (edgeSnapTarget && edgeSnapTarget !== edgeDraft.from) {
        const from = edgeDraft.from;
        const end = map.nodes.find((n) => n.id === edgeSnapTarget);
        if (end) {
          const simplified = simplifyEdgePath(edgeDraft.points.length > 1 ? edgeDraft.points : [edgeDraft.points[0] ?? { x: 0.5, y: 0.5 }, end.at], 0.01);
          const endPt = end.at;
          const path = [...simplified.slice(0, simplified.length - 1), endPt];
          changeMap((m) => {
            const withEdge = addEdge(m, from, end.id);
            const seg = withEdge.edges[withEdge.edges.length - 1];
            if (!seg) return withEdge;
            const base = from === seg.a ? path : [...path].reverse();
            return { ...withEdge, edges: withEdge.edges.map((e) => e.id === seg.id ? { ...e, path: base } : e) };
          }, `已从 ${map.nodes.find((n) => n.id === from)?.name ?? from} 描线到 ${end.name ?? end.id}。`);
        }
      } else {
        setNotice('在空白处松手：描线已丢弃。');
        triggerFlash('red'); // §九 拉边流程第 7 步：空白松手 → 红色一闪
      }
      setEdgeDraft(null);
      setEdgeSnapTarget(null);
      setEdgeStart(null);
      setBoxSelect(null);
      setBoxSelectCurrent(null);
      return;
    }
    if (!boxSelect || !boxSelectCurrent) { setBoxSelect(null); setBoxSelectCurrent(null); return; }
    const minX = Math.min(boxSelect.x, boxSelectCurrent.x);
    const maxX = Math.max(boxSelect.x, boxSelectCurrent.x);
    const minY = Math.min(boxSelect.y, boxSelectCurrent.y);
    const maxY = Math.max(boxSelect.y, boxSelectCurrent.y);
    if (maxX - minX < 0.008 && maxY - minY < 0.008) {
      setSelection(null); // 单击空白 = 清选择
    } else {
      const hit = map.nodes.find((n) => n.at.x >= minX && n.at.x <= maxX && n.at.y >= minY && n.at.y <= maxY);
      if (hit) setSelection(`node:${hit.id}`); else setSelection(null);
    }
    setBoxSelect(null);
    setBoxSelectCurrent(null);
  };
  /** 画布滚轮：未选中遮挡边的遮挡框时缩放；选中边且带遮挡框 → 滚轮 10°/格旋转。 */
  const onCanvasWheelRotate = (event: React.WheelEvent<SVGSVGElement>, selectedEdge: MapEdge | undefined) => {
    const step = event.deltaY > 0 ? 10 : -10;
    if (selectedEdge?.visualObstruction) { changeMap((m) => rotateObstruction(m, selectedEdge.id, 'visual', step), '旋转视觉遮挡框。'); return; }
    if (selectedEdge?.physicalObstruction) { changeMap((m) => rotateObstruction(m, selectedEdge.id, 'physical', step), '旋转物理遮挡框。'); return; }
    const point = svgPointFromEvent(event);
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    setCamera((c) => zoomAt(c, point, factor));
  };
  const triggerFlash = (why: string) => { setFlash(why); window.setTimeout(() => setFlash(null), 260); };
  /** 点击诊断：摄像机飞到问题元素 + 红色脉冲。 */
  const focusAndPulse = (item: MapDiagnostic) => {
    const target = focusDiagnostic(item, map);
    if (!target) return;
    setSelection(target);
    const id = selectionId(target)!;
    if (target.startsWith('node:')) {
      const node = map.nodes.find((n) => n.id === id);
      if (node) setCamera((c) => flyTo(c, node.at, 480).to);
    } else if (target.startsWith('edge:')) {
      const edge = map.edges.find((e) => e.id === id);
      if (edge?.path[0]) setCamera((c) => flyTo(c, edge.path[0]!, 480).to);
    }
    if (item.severity === 'error') { setPulseSubject(target); window.setTimeout(() => setPulseSubject(null), 700); }
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Alt') { setAltHeld(true); if (mode === 'select') { setMode('sample'); } return; }
    if (event.key === 'Escape') { setEdgeStart(null); setEdgeDraft(null); setEdgeSnapTarget(null); setKnotDrag(null); setWindowDrag(null); setObsDrag(null); setBendingPoint(null); setBoxSelect(null); setBoxSelectCurrent(null); setSampleSlot(null); setPulseSubject(null); if (mode !== 'select') setMode('select'); else setSelection(null); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? doRedo() : doUndo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); doRedo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportMap(); return; }
    if (event.key === 'Tab') { event.preventDefault(); setRightPanelOpen((open) => !open); return; }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const next = deleteSelection(map, selection);
      if (next !== map) { changeMap(() => next, '已删除选中图元。'); setSelection(null); }
      return;
    }
    if (event.key.toLowerCase() === 'n') enterMode('node');
    if (event.key.toLowerCase() === 'e') enterMode('edge');
    if (event.key.toLowerCase() === 'i') enterMode('sample');
    if (event.key === '1') setCurrentLayerId(layers[0]?.id ?? 'layer:ground');
    if (event.key === '2') setCurrentLayerId(layers[1]?.id ?? layers[0]?.id ?? 'layer:ground');
    if (event.key === '3') setCurrentLayerId(layers[2]?.id ?? layers[1]?.id ?? layers[0]?.id ?? 'layer:ground');
  };
  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Alt') { setAltHeld(false); if (mode === 'sample') { setSampleSlot(null); setMode('select'); } }
  };
  const changeMode = (nextMode: EditorMode) => {
    if (nextMode === 'playtest') { playtest(); return; }
    enterMode(nextMode);
  };
  const playtest = () => {
    const result = playtestSmoke(map, undefined);
    if (!result.ok) { setPlaytestResult(result.reason ?? '测试运行失败'); return; }
    const prefab = result.prefab && result.prefab.ok ? result.prefab.prefab : null;
    setPlaytestResult(prefab ? `通过：${prefab.nodes.length} 节点 / ${prefab.links.length} 连接 / ${(prefab.entities?.length ?? 0)} 实体。` : '编译未通过');
  };
  const exportMap = () => {
    // §九 校验反馈：保存不阻断（照常导出），发布校验逻辑由编译入口拦截 error。
    download(serializeMapPublish({ map, layers }), `${map.id}.json`);
    setNotice(errors.length > 0 ? `已导出（含 ${errors.length} 个结构错误标注；发布前需修复）。` : '已导出地图 JSON。');
  };
  const newLayer = () => { const id = `layer:${layers.length}`; setLayers([...layers, emptyLayer(id, `新图层 ${layers.length + 1}`)]); setCurrentLayerId(id); };

  useEffect(() => {
    if (!dragging) return undefined;
    const up = (event: PointerEvent) => {
      event.preventDefault();
      setDragging(null);
    };
    window.addEventListener('pointerup', up as unknown as EventListener);
    return () => { window.removeEventListener('pointerup', up as unknown as EventListener); };
  }, [dragging]);

  return <div className="editor-app" style={cssVars} tabIndex={0} onKeyDown={handleKey} onKeyUp={handleKeyUp}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark">W</span><div><strong>WakeUp 开发板</strong><small>地图工作台</small></div></div>
      <div className="map-title"><input aria-label="地图名称" value={map.name} onChange={(event) => changeMap(() => ({ ...map, name: event.target.value }))} /><span>{map.id}</span></div>
      <div className="top-actions">
        <button className="icon-button" title="撤销 (Ctrl+Z)" onClick={doUndo}><Undo2 size={16} /></button>
        <button className="icon-button" title="重做 (Ctrl+Shift+Z / Ctrl+Y)" onClick={doRedo}><Redo2 size={16} /></button>
        <button className="icon-button" title="新建空地图" onClick={() => { changeMap(() => blankMap(), '已清空新建。'); setSelection(null); }}>＋</button>
        <button onClick={() => { const name = `${map.name} 副本`; changeMap(() => blueprintCopy(map, name), '已从当前地图创建蓝本副本。'); }}>蓝本新建</button>
        <button className="primary" onClick={exportMap}>校验并导出</button>
      </div>
    </header>
    <div className="workspace">
      <aside className="left-panel">
        <section><div className="panel-heading"><h2>已加载地图</h2><span>{maps.length}</span></div>{maps.map((item) => <button className={`map-list-item ${item.id === map.id ? 'active' : ''}`} key={item.id} onClick={() => { changeMap(() => item, `已加载 ${item.name}。`); setSelection(null); }}><span>{item.name}</span><small>{item.nodes.length} 场景</small></button>)}</section>
        <section><div className="panel-heading"><h2>图层</h2><button className="icon-button" title="新建图层" onClick={newLayer}>＋</button></div>{layers.map((layer) => <div className={`layer-row ${layer.id === currentLayerId ? 'active' : ''}`} key={layer.id}><button onClick={() => setCurrentLayerId(layer.id)}><span className="layer-dot" />{layer.name ?? layer.id}</button><input aria-label={`${layer.id} 高度`} type="number" value={layer.height ?? ''} placeholder="独立" onChange={(event) => { const height = event.target.value === '' ? undefined : Number(event.target.value); if (!canSetHeight(layers, layer.id, height)) { setNotice('参与透视的图层高度不可重复。'); return; } setLayers(layers.map((item) => item.id === layer.id ? { ...item, height } : item)); }} /></div>)}</section>
        <section className="layer-note"><strong>当前：{currentLayer?.name ?? currentLayerId}</strong><span>可见 {visible.length}/{layers.length} 层</span><span>相邻透明度 {overlayOpacity(currentLayer?.height, 0) ?? '独立'}</span></section>
        <section className="shortcut-note">
          <span className="text-muted text-xs font-semibold">快捷键</span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted text-[11px]">
            <span>V/N/E/I/P 工具</span><span>空格/中键 平移</span>
            <span>滚轮 缩放</span><span>Ctrl+Z 撤销</span>
            <span>Ctrl+Shift+Z 重做</span><span>Ctrl+S 导出</span>
            <span>Delete 删除选中</span><span>Tab 右栏开合</span>
            <span>1/2/3 楼层</span><span>Esc 退出/清选</span>
          </div>
        </section>
      </aside>
      <main className="main-area">
        <nav className="toolbar" aria-label="编辑工具">{([['select', '选择', 'V'], ['node', '放置场景', 'N'], ['edge', '拉边', 'E'], ['sample', '取样', 'I'], ['playtest', '测试运行', 'P']] as const).map(([id, label, shortcut]) => <button key={id} className={mode === id ? 'active' : ''} title={`${label} (${shortcut})`} onClick={() => changeMode(id)}><b>{shortcut}</b><span>{label}</span></button>)}</nav>
        <CanvasView map={map} mode={mode} selection={selection} edgeStart={edgeStart} edgeDraft={edgeDraft} edgeSnapTarget={edgeSnapTarget} camera={camera} currentLayerId={currentLayerId} nodeLayerOf={nodeLayerOf} boxSelect={boxSelect} boxSelectCurrent={boxSelectCurrent} flash={flash} pulseSubject={pulseSubject} sampleable={Boolean(mode === 'sample')}
          onSelect={select} onCanvasPoint={onCanvasPoint} onCanvasPointerDown={onCanvasPointerDown} onCanvasPointerMove={onCanvasPointerMoveBox} onCanvasPointerUp={onCanvasPointerUpBox} onCanvasWheel={(event) => onCanvasWheelRotate(event, selectedEdge)} onNodePointerDown={onNodePointerDown} onNodePointerMove={onNodePointerMove} onNodePointerUp={onNodePointerUp} onMaterialDrop={onMaterialDrop} onEdgePointerDown={onEdgePointerDown} onEdgePointerMove={onEdgePointerMove} onEdgePointerUp={onEdgePointerUp} onEdgeDoubleClick={onEdgeDoubleClick} onKnotPointerDown={onKnotPointerDown} onKnotPointerMove={onKnotPointerMove} onKnotPointerUp={onKnotPointerUp} onWindowPointerDown={onWindowPointerDown} onWindowPointerMove={onWindowPointerMove} onWindowPointerUp={onWindowPointerUp} onObstructionPointerDown={onObstructionPointerDown} onObstructionPointerMove={onObstructionPointerMove} onObstructionPointerUp={onObstructionPointerUp} onCanvasContextMenu={onCanvasContextMenu} />
        <section className="bottom-panel"><div className="status-line"><span className={errors.length ? 'status-error' : 'status-ok'}>{errors.length ? `${errors.length} 个结构错误` : '结构校验通过'}</span><span>{notice}</span></div><div className="diagnostics">{diagnostics.length === 0 ? <span className="empty-state">没有诊断。将场景拖出画布或超过连接上限可查看即时反馈。</span> : diagnostics.map((item) => <button className={`diagnostic ${item.severity}`} key={`${item.code}:${item.path}`} onClick={() => focusAndPulse(item)}><b>{item.severity === 'error' ? '错误' : '提示'}</b><span>{item.message}</span><small>{item.path}</small></button>)}</div></section>
      </main>
      {rightPanelOpen ? <aside className="right-panel">
        <section className="inspector"><div className="panel-heading"><h2>检查器</h2><span>{selection ?? '未选择'}</span></div>{selectedNode ? <NodeInspector node={selectedNode} setFloor={(floor) => changeMap((m) => setNodeFloor(m, selectedNode.id, floor), `移动到楼层 ${floor}。`)} update={(patch) => changeMap((m) => updateNode(m, selectedNode.id, patch), '已更新场景。')} /> : selectedEdge ? <EdgeInspector edge={selectedEdge} update={(patch) => changeMap((m) => updateEdge(m, selectedEdge.id, patch), '已更新连接。')} setVisual={() => changeMap((m) => setVisualObstruction(m, selectedEdge.id), '已放视觉遮挡框。')} setPhysical={() => changeMap((m) => setPhysicalObstruction(m, selectedEdge.id), '已放物理遮挡框。')} rotateVisual={(deg) => changeMap((m) => rotateObstruction(m, selectedEdge.id, 'visual', deg), '旋转视觉遮挡框。')} rotatePhysical={(deg) => changeMap((m) => rotateObstruction(m, selectedEdge.id, 'physical', deg), '旋转物理遮挡框。')} clearVisual={() => changeMap((m) => updateEdge(m, selectedEdge.id, { visualObstruction: undefined }), '已清视觉遮挡框。')} clearPhysical={() => changeMap((m) => updateEdge(m, selectedEdge.id, { physicalObstruction: undefined }), '已清物理遮挡框。')} setAnchor={(anchor) => changeMap((m) => setSemanticAnchor(m, selectedEdge.id, anchor), anchor === 'neutral' ? '已清语义锚点。' : `已标为${anchor === 'high' ? '高地' : '洼地'}。`)} setWindow={(enabled) => changeMap((m) => setTransitionWindow(m, selectedEdge.id, enabled), enabled ? '已加过渡窗口。' : '已清过渡窗口。')} moveWindow={(to) => changeMap((m) => moveTransitionWindow(m, selectedEdge.id, to), '过渡窗口已移动。')} /> : <p className="empty-state">选择场景或连接以编辑其 MapData 字段。</p>}</section>
        <section className="materials"><div className="panel-heading"><h2>素材</h2><button onClick={() => setPaletteOpen(!paletteOpen)}>{paletteOpen ? '收起' : '展开 70 格'}</button></div>{paletteOpen && <input className="search" placeholder="搜索素材" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} />}<div className={`material-grid ${paletteOpen ? 'expanded' : ''}`}>{shownMaterials.slice(0, paletteOpen ? 70 : 7).map(([id, name, category], index) => <button key={id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', id)} title={`拖入画布放置 ${name}`} className={`material-card variant-${index % 5}`}><i>{name[0]}</i><span>{name}</span><small>{category}</small></button>)}</div><p className="material-hint">开发者权限：全部已注册素材可用。拖入画布会挂接到最近场景。</p></section>
        <section className="playtest"><div className="panel-heading"><h2>Playtest</h2><button className="primary" onClick={playtest}>运行</button></div><p>{playtestResult}</p><div className="topology"><span>连通组 {connectedGroups(map).length}</span><span>邻接节点 {adjacencyOf(map).size}</span></div><small>编译验证 MapData 结构与拓扑；几何和开发板图层不会进入 PrefabDef。</small></section>
      </aside> : null}
    </div>
  </div>;
}

function NodeInspector({ node, setFloor, update }: { node: MapNode; setFloor: (floor: number) => void; update: (patch: Partial<MapNode>) => void }): JSX.Element {
  return <div className="field-grid"><label>名称<input value={node.name ?? ''} onChange={(event) => update({ name: event.target.value })} /></label><label>尺度<select value={node.scale} onChange={(event) => update({ scale: event.target.value as SceneScale })}>{nodeScales.map((scale) => <option key={scale}>{scale}</option>)}</select></label><label>X<input type="number" min="0" max="1" step="0.01" value={node.at.x} onChange={(event) => update({ at: { ...node.at, x: Number(event.target.value) } })} /></label><label>Y<input type="number" min="0" max="1" step="0.01" value={node.at.y} onChange={(event) => update({ at: { ...node.at, y: Number(event.target.value) } })} /></label><label>楼层<input type="number" value={node.floor} onChange={(event) => setFloor(Number(event.target.value))} /></label><label>Def<input value={node.def} onChange={(event) => update({ def: event.target.value })} /></label></div>;
}

function EdgeInspector({ edge, update, setVisual, setPhysical, rotateVisual, rotatePhysical, clearVisual, clearPhysical, setAnchor, setWindow, moveWindow }: { edge: MapEdge; update: (patch: Partial<MapEdge>) => void; setVisual: () => void; setPhysical: () => void; rotateVisual: (deg: number) => void; rotatePhysical: (deg: number) => void; clearVisual: () => void; clearPhysical: () => void; setAnchor: (anchor: 'high' | 'low' | 'neutral') => void; setWindow: (enabled: boolean) => void; moveWindow: (to: { x: number; y: number }) => void }): JSX.Element {
  const hasBox = Boolean(edge.visualObstruction || edge.physicalObstruction);
  return <div className="field-grid">
    <label>方向<select value={edge.directionality} onChange={(event) => update({ directionality: event.target.value as MapEdge['directionality'] })}>{directions.map((direction) => <option key={direction}>{direction}</option>)}</select></label>
    <label>Def<input value={edge.def} onChange={(event) => update({ def: event.target.value })} /></label>
    <label>语义锚点<select value={edge.semanticAnchor ?? 'neutral'} onChange={(event) => setAnchor(event.target.value as 'high' | 'low' | 'neutral')}><option value="high">高地</option><option value="low">洼地</option><option value="neutral">中性</option></select></label>
    <label>过渡窗口<input type="checkbox" checked={Boolean(edge.transitionWindow)} onChange={(event) => setWindow(event.target.checked)} /></label>
    {edge.transitionWindow?.control[0] ? (() => { const w = edge.transitionWindow!.control[0]!; return (
      <div className="transition-window-fields"><span className="small-title">过渡窗口位置（画布上拖图形亦可）</span>
        <label>X<input type="number" min="0" max="1" step="0.01" value={Number(w.x.toFixed(3))} onChange={(event) => moveWindow({ x: Math.max(0, Math.min(1, Number(event.target.value))), y: w.y })} /></label>
        <label>Y<input type="number" min="0" max="1" step="0.01" value={Number(w.y.toFixed(3))} onChange={(event) => moveWindow({ x: w.x, y: Math.max(0, Math.min(1, Number(event.target.value))) })} /></label>
      </div>
    ); })() : null}
    <div className={`obstruction-fields${hasBox ? '' : ' empty'}`}><span className="small-title">遮挡框（半透明，滚轮旋转 10°/格）</span>
      <label><button onClick={setVisual}>视觉 +框</button>{edge.visualObstruction ? <span className="two-btn"><button onClick={() => rotateVisual(10)}>旋转</button><button onClick={clearVisual}>清除</button></span> : null}</label>
      <label><button onClick={setPhysical}>物理 +框</button>{edge.physicalObstruction ? <span className="two-btn"><button onClick={() => rotatePhysical(10)}>旋转</button><button onClick={clearPhysical}>清除</button></span> : null}</label>
    </div>
  </div>;
}
