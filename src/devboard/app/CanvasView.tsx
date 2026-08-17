import type { DragEvent, MouseEvent, PointerEvent } from 'react';
import type { EditorMode } from './editor-state.js';
import type { Camera } from './camera.js';
import type { MapData, Vec2 } from '../ports/map-contracts.js';
import type { SceneScale } from '../ports/map-contracts.js';

export interface EdgeDraft {
  readonly from: string;
  readonly points: readonly Vec2[];
}

interface CanvasViewProps {
  map: MapData;
  mode: EditorMode;
  selection: string | null;
  edgeStart: string | null;
  edgeDraft: EdgeDraft | null;
  edgeSnapTarget: string | null;
  camera: Camera;
  currentLayerId: string | null;
  nodeLayerOf: (nodeId: string) => string | undefined;
  /** 框选起点（Select 态左键拖空白）；非空时渲染选区矩形。 */
  boxSelect: { x: number; y: number } | null;
  /** 框选当前角（跟随指针）。 */
  boxSelectCurrent: { x: number; y: number } | null;
  /** 红色一闪（拉边空白丢弃 / 校验脉冲配合）。 */
  flash: string | null;
  /** 校验错误脉冲的选中图元（红色 pulse）。 */
  pulseSubject: string | null;
  /** 取样模式：场景框可被点选为样本。 */
  sampleable: boolean;
  onSelect: (selection: string | null) => void;
  onCanvasPoint: (point: { x: number; y: number }) => void;
  onCanvasPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  onCanvasPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onCanvasPointerUp: () => void;
  onCanvasWheel: (event: React.WheelEvent<SVGSVGElement>) => void;
  onNodePointerDown: (nodeId: string, event: PointerEvent<SVGElement>) => void;
  onNodePointerMove: (nodeId: string, event: PointerEvent<SVGElement>) => void;
  onNodePointerUp: (nodeId: string) => void;
  onMaterialDrop: (materialId: string, point: { x: number; y: number }) => void;
  onEdgePointerDown: (edgeId: string, event: PointerEvent<SVGGElement>) => void;
  onEdgePointerMove: (edgeId: string, event: PointerEvent<SVGGElement>) => void;
  onEdgeDoubleClick: (edgeId: string) => void;
  onKnotPointerDown: (edgeId: string, pathIndex: number, event: PointerEvent<SVGElement>) => void;
  onKnotPointerMove: (edgeId: string, pathIndex: number, event: PointerEvent<SVGElement>) => void;
  onKnotPointerUp: (edgeId: string, pathIndex: number) => void;
  onEdgePointerUp: () => void;
  /** 过渡窗口图形：按下开始独立拖（不吸附节点，成为所在线窗口）。 */
  onWindowPointerDown: (edgeId: string, event: PointerEvent<SVGGElement>) => void;
  onWindowPointerMove: (edgeId: string, event: PointerEvent<SVGGElement>) => void;
  onWindowPointerUp: () => void;
  /** 遮挡框图形：按下可整体拖移（涂鸦交互：无四角控制点，框整体拖动/旋转）。 */
  onObstructionPointerDown: (edgeId: string, which: 'visual' | 'physical', event: PointerEvent<SVGGElement>) => void;
  onObstructionPointerMove: (edgeId: string, which: 'visual' | 'physical', event: PointerEvent<SVGGElement>) => void;
  onObstructionPointerUp: () => void;
  /** 画布右键：画布上下文菜单（在空地处弹出造节点等入口）。 */
  onCanvasContextMenu: (point: { x: number; y: number }) => void;
}

function svgPoint(event: MouseEvent<SVGSVGElement> | DragEvent<SVGSVGElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function nodeSize(scale: SceneScale): { w: number; h: number } {
  const map = { large: { w: 96, h: 64 }, medium: { w: 76, h: 52 }, small: { w: 60, h: 42 } };
  return map[scale] ?? map.medium;
}

/**
 * 折线 → Catmull-Rom 样条采样。§九：边是平滑样条线（穿过全部样本点），不是贝塞尔。
 * 曲线绝对穿过每个必经点（指哪打哪）。d 输出 SVG path。
 */
function catmullRomPath(points: readonly Vec2[], sx: number, sy: number): string {
  const list = points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  if (list.length === 0) return '';
  if (list.length === 1) return `M ${list[0]?.x} ${list[0]?.y}`;
  let d = `M ${list[0]?.x} ${list[0]?.y}`;
  for (let i = 0; i < list.length - 1; i++) {
    const p0 = list[i - 1] ?? list[i]!;
    const p1 = list[i]!;
    const p2 = list[i + 1]!;
    const p3 = list[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function linePath(points: readonly Vec2[], sx: number, sy: number): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * sx} ${point.y * sy}`)
    .join(' ');
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  const {
    map, mode, selection, edgeStart, edgeDraft, edgeSnapTarget, camera, currentLayerId, nodeLayerOf,
    boxSelect, boxSelectCurrent, flash, pulseSubject, sampleable, onSelect, onCanvasPoint, onCanvasPointerDown, onCanvasPointerMove,
    onCanvasPointerUp, onCanvasWheel, onNodePointerDown, onNodePointerMove, onNodePointerUp, onMaterialDrop,
    onEdgePointerDown, onEdgePointerMove, onEdgeDoubleClick, onKnotPointerDown, onKnotPointerMove, onKnotPointerUp, onEdgePointerUp,
    onWindowPointerDown, onWindowPointerMove, onWindowPointerUp,
    onObstructionPointerDown, onObstructionPointerMove, onObstructionPointerUp,
    onCanvasContextMenu,
  } = props;
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const isClipped = (nodeId: string): boolean => {
    if (!currentLayerId) return false;
    const layer = nodeLayerOf(nodeId);
    return layer !== undefined && layer !== currentLayerId;
  };
  // 把归一化坐标 [0,1] 映射到 viewBox 用户空间，坐标以 camera 视野为基准。
  const SX = camera.width;
  const SY = camera.height;
  const sx = (v: number) => v * SX;
  const sy = (v: number) => v * SY;
  const splinePoints = (points: readonly Vec2[]) => (points.length > 2 ? catmullRomPath(points, SX, SY) : linePath(points, SX, SY));
  const boxPoints = (bounds: readonly Vec2[] | undefined): string => {
    if (!bounds || bounds.length < 4) return '';
    const closed = [...bounds, bounds[0]!];
    return closed.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.y)}`).join(' ') + ' Z';
  };
  const boxSelectionPath = boxSelect && boxSelectCurrent
    ? `M ${sx(boxSelect.x)} ${sy(boxSelect.y)} L ${sx(boxSelectCurrent.x)} ${sy(boxSelect.y)} L ${sx(boxSelectCurrent.x)} ${sy(boxSelectCurrent.y)} L ${sx(boxSelect.x)} ${sy(boxSelectCurrent.y)} Z`
    : '';
  return (
    <div className="relative flex-1 min-h-[390px] flex flex-col p-2.5 bg-canvas">
      <div className="flex justify-between text-muted text-xs px-0.5 pb-2">
        <span>{mode === 'sample' ? '取样中：点已有场景取样，或点空白放置；按 I 退出' : '几何视图'}</span>
        <span>{mode === 'edge' && edgeDraft ? `从 ${nodeById.get(edgeDraft.from)?.name ?? edgeDraft.from} 描线` : `缩放 ${camera.scale.toFixed(1)}×`}</span>
      </div>
      <svg
        className={`editor-canvas mode-${mode}${flash ? ' canvas-flash' : ''}`}
        viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
        role="application"
        aria-label="地图编辑画布"
        data-depth-test="canvas"
        onClick={(event) => onCanvasPoint(svgPoint(event))}
        onContextMenu={(event) => { event.preventDefault(); onCanvasContextMenu(svgPoint(event)); }}
        onPointerDown={(event) => onCanvasPointerDown(event)}
        onPointerMove={(event) => onCanvasPointerMove(event)}
        onPointerUp={onCanvasPointerUp}
        onWheel={onCanvasWheel}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const materialId = event.dataTransfer.getData('text/plain');
          if (materialId) onMaterialDrop(materialId, svgPoint(event));
        }}
      >
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#c9d7dd" strokeWidth="1" /></pattern>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#027f92" /></marker>
        </defs>
        <rect width={SX} height={SY} fill="url(#grid)" />
        <rect x={camera.x} y={camera.y} width={SX} height={SY} rx="2" fill="#eaf1f3" stroke="#9eb5c0" />
        {/* 边 */}
        {map.edges.map((edge) => {
          const points = edge.path.length > 0 ? edge.path : [nodeById.get(edge.a)?.at, nodeById.get(edge.b)?.at].filter(Boolean) as Vec2[];
          const selected = selection === `edge:${edge.id}` || pulseSubject === `edge:${edge.id}`;
          const clipped = isClipped(edge.a) || isClipped(edge.b);
          return <g key={edge.id} onClick={(event) => { event.stopPropagation(); onSelect(`edge:${edge.id}`); }} onPointerDown={(event) => onEdgePointerDown(edge.id, event)} onPointerMove={(event) => onEdgePointerMove(edge.id, event)} onPointerUp={() => onEdgePointerUp()} onDoubleClick={(event) => { event.stopPropagation(); onEdgeDoubleClick(edge.id); }}>
            <path d={splinePoints(points)} className={`map-edge ${selected ? 'selected' : ''} ${clipped ? 'dim' : ''} ${pulseSubject === `edge:${edge.id}` ? 'error-pulse' : ''}`} markerEnd={edge.directionality === 'bidirectional' ? undefined : 'url(#arrow)'} />
            <path d={splinePoints(points)} className="map-edge-hit" />
            {/* 折点（中间可拖，[B]/[D]；单击只高亮不改变逻辑） */}
            {selected && points.map((p, i) => (i > 0 && i < points.length - 1) ? (
              <circle key={`k${i}`} cx={sx(p.x)} cy={sy(p.y)} r={6} className="map-knot"
                onPointerDown={(e) => onKnotPointerDown(edge.id, i, e as unknown as PointerEvent<SVGElement>)}
                onPointerMove={(e) => onKnotPointerMove(edge.id, i, e as unknown as PointerEvent<SVGElement>)}
                onPointerUp={() => onKnotPointerUp(edge.id, i)} />
            ) : null)}
            {/* 遮挡框（可整体拖移 + 滚轮旋转；阴影选中体现"整体"，不逐控制点变形） */}
            {edge.visualObstruction?.bounds ? <path d={boxPoints(edge.visualObstruction.bounds)} className={`obstruction visual${pulseSubject === `obstruction:${edge.id}:visual` ? ' selected' : ''}`} onPointerDown={(event) => onObstructionPointerDown(edge.id, 'visual', event)} onPointerMove={(event) => onObstructionPointerMove(edge.id, 'visual', event)} onPointerUp={onObstructionPointerUp} /> : null}
            {edge.physicalObstruction?.bounds ? <path d={boxPoints(edge.physicalObstruction.bounds)} className={`obstruction physical${pulseSubject === `obstruction:${edge.id}:physical` ? ' selected' : ''}`} onPointerDown={(event) => onObstructionPointerDown(edge.id, 'physical', event)} onPointerMove={(event) => onObstructionPointerMove(edge.id, 'physical', event)} onPointerUp={onObstructionPointerUp} /> : null}
            {/* 语义锚点框 */}
            {edge.semanticAnchor === 'high' ? <circle cx={sx((points[0]!.x + points[points.length - 1]!.x) / 2)} cy={sy((points[0]!.y + points[points.length - 1]!.y) / 2)} r={16} className="anchor high" /> : null}
            {edge.semanticAnchor === 'low' ? <circle cx={sx((points[0]!.x + points[points.length - 1]!.x) / 2)} cy={sy((points[0]!.y + points[points.length - 1]!.y) / 2)} r={16} className="anchor low" /> : null}
            {/* 过渡窗口（独立拖拽，不吸附节点） */}
            {edge.transitionWindow?.control[0] ? <g transform={`translate(${sx(edge.transitionWindow.control[0].x)} ${sy(edge.transitionWindow.control[0].y)})`} className="transition-window-g" onPointerDown={(event) => onWindowPointerDown(edge.id, event)} onPointerMove={(event) => onWindowPointerMove(edge.id, event)} onPointerUp={onWindowPointerUp}><rect x="-12" y="-12" width="24" height="24" className="transition-window" /><text y="3" textAnchor="middle" className="transition-window-label">⬡</text></g> : null}
          </g>;
        })}
        {/* 素材放置 */}
        {map.placements.map((placement) => {
          const node = nodeById.get(placement.at);
          if (!node) return null;
          return <g key={placement.id} transform={`translate(${sx(node.at.x) + 24} ${sy(node.at.y) - 24})`}><rect width="26" height="26" fill="#d69e2e" /><path d="M5 20 L13 5 L21 20" stroke="#fff" strokeWidth="2" fill="none" /></g>;
        })}
        {/* 正在描线：实时预览折线 + 终点吸附高亮 */}
        {mode === 'edge' && edgeDraft && edgeDraft.points.length > 1 && (
          <polyline points={edgeDraft.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} className="edge-draft" />
        )}
        {/* 框选矩形（Select 态拖空白） */}
        {boxSelect && boxSelectionPath ? <path d={boxSelectionPath} className="box-select-rect" /> : null}
        {/* 场景（框） */}
        {map.nodes.map((node) => {
          const selected = selection === `node:${node.id}` || pulseSubject === `node:${node.id}`;
          const isSource = edgeStart === node.id;
          const snapTarget = edgeSnapTarget === node.id;
          const clipped = isClipped(node.id);
          const size = nodeSize(node.scale);
          const isPulse = pulseSubject === `node:${node.id}`;
          return <g key={node.id} transform={`translate(${sx(node.at.x)} ${sy(node.at.y)})`} className="map-node-group">
            <g className={clipped ? 'clipped' : ''}>
              <rect x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h} rx={6} className={`scene-box ${selected ? 'selected' : ''} ${isSource ? 'edge-source' : ''} ${snapTarget ? 'snap-target' : ''} ${sampleable ? 'sampleable' : ''} ${isPulse ? 'error-pulse' : ''}`} onPointerDown={(event) => onNodePointerDown(node.id, event as unknown as PointerEvent<SVGElement>)} onPointerMove={(event) => onNodePointerMove(node.id, event as unknown as PointerEvent<SVGElement>)} onPointerUp={() => onNodePointerUp(node.id)} />
              <text y="4" textAnchor="middle" className="node-scale">{node.scale[0]!.toUpperCase()}</text>
              <text y={size.h / 2 + 18} textAnchor="middle" className="node-label">{node.name ?? node.id}</text>
            </g>
          </g>;
        })}
      </svg>
      <div className="flex gap-4 pt-2 text-muted text-xs">
        <span><i className="inline-block w-2.5 h-2.5 mr-1 rounded bg-panel border-2 border-social" />场景框</span>
        <span><i className="inline-block w-2.5 h-0.5 mr-1 bg-social" />连接</span>
        <span><i className="inline-block w-2.5 h-2.5 mr-1 bg-alert" />素材放置</span>
      </div>
    </div>
  );
}