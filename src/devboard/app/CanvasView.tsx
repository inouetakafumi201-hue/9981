import type { DragEvent, MouseEvent, PointerEvent } from 'react';
import type { EditorMode } from './editor-state.js';
import type { MapData } from '../ports/map-contracts.js';
import type { SceneScale } from '../ports/map-contracts.js';

interface CanvasViewProps {
  map: MapData;
  mode: EditorMode;
  selection: string | null;
  edgeStart: string | null;
  onSelect: (selection: string | null) => void;
  onCanvasPoint: (point: { x: number; y: number }) => void;
  onNodePointerDown: (nodeId: string, event: PointerEvent<SVGCircleElement>) => void;
  onNodePointerMove: (nodeId: string, event: PointerEvent<SVGCircleElement>) => void;
  onNodePointerUp: () => void;
  onMaterialDrop: (materialId: string, point: { x: number; y: number }) => void;
}

function svgPoint(event: MouseEvent<SVGSVGElement> | DragEvent<SVGSVGElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function nodeRadius(scale: SceneScale): number {
  const sizes: Record<SceneScale, number> = { large: 27, medium: 21, small: 16 };
  return sizes[scale] ?? 21;
}

export function CanvasView({ map, mode, selection, edgeStart, onSelect, onCanvasPoint, onNodePointerDown, onNodePointerMove, onNodePointerUp, onMaterialDrop }: CanvasViewProps): JSX.Element {
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  return (
    <div className="canvas-shell">
      <div className="canvas-ruler"><span>几何视图</span><span>{mode === 'edge' && edgeStart ? `从 ${edgeStart} 拉出连接` : '归一化坐标 0..1'}</span></div>
      <svg
        className={`map-canvas mode-${mode}`}
        viewBox="0 0 1000 700"
        role="application"
        aria-label="地图编辑画布"
        data-depth-test="canvas"
        onClick={(event) => onCanvasPoint(svgPoint(event))}
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
        <rect width="1000" height="700" fill="url(#grid)" />
        <rect x="38" y="40" width="924" height="620" rx="2" fill="#eaf1f3" stroke="#9eb5c0" />
        {map.edges.map((edge) => {
          const points = edge.path.length > 0 ? edge.path : [nodeById.get(edge.a)?.at, nodeById.get(edge.b)?.at].filter(Boolean);
          const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point!.x * 1000} ${point!.y * 700}`).join(' ');
          const selected = selection === `edge:${edge.id}`;
          return <g key={edge.id} onClick={(event) => { event.stopPropagation(); onSelect(`edge:${edge.id}`); }}>
            <path d={path} className={`map-edge ${selected ? 'selected' : ''}`} markerEnd={edge.directionality === 'bidirectional' ? undefined : 'url(#arrow)'} />
            <path d={path} className="map-edge-hit" />
          </g>;
        })}
        {map.placements.map((placement) => {
          const node = nodeById.get(placement.at);
          if (!node) return null;
          return <g key={placement.id} transform={`translate(${node.at.x * 1000 + 24} ${node.at.y * 700 - 24})`}><rect width="26" height="26" fill="#d69e2e" /><path d="M5 20 L13 5 L21 20" stroke="#fff" strokeWidth="2" fill="none" /></g>;
        })}
        {map.nodes.map((node) => {
          const selected = selection === `node:${node.id}`;
          const isSource = edgeStart === node.id;
          return <g key={node.id} transform={`translate(${node.at.x * 1000} ${node.at.y * 700})`} className="map-node-group">
            <circle
              r={nodeRadius(node.scale)}
              className={`map-node ${selected ? 'selected' : ''} ${isSource ? 'edge-source' : ''}`}
              onPointerDown={(event) => onNodePointerDown(node.id, event)}
              onPointerMove={(event) => onNodePointerMove(node.id, event)}
              onPointerUp={onNodePointerUp}
              onClick={(event) => { event.stopPropagation(); onSelect(`node:${node.id}`); }}
            />
            <text y="5" textAnchor="middle" className="node-scale">{node.scale[0]!.toUpperCase()}</text>
            <text y={nodeRadius(node.scale) + 20} textAnchor="middle" className="node-label">{node.name ?? node.id}</text>
          </g>;
        })}
      </svg>
      <div className="canvas-legend"><span><i className="swatch node" />场景</span><span><i className="swatch edge" />连接</span><span><i className="swatch material" />素材放置</span></div>
    </div>
  );
}
