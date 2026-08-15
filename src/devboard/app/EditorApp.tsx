import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CanvasView } from './CanvasView.js';
import { addEdge, addNode, blankMap, deleteSelection, directions, type EditorMode, floorOf, makeLayerFloors, moveNode, nextId, nodeScales, samples, setNodeFloor, updateEdge, updateNode } from './editor-state.js';
import { cssVars } from './tokens.js';
import { blueprintCopy, serializeMapPublish } from '../editor/map-io.js';
import { emptyLayer } from '../editor/workspace-state.js';
import { canSetHeight, visibleLayers } from '../layers/layer-rules.js';
import type { MapLayer } from '../layers/layer-shapes.js';
import { overlayOpacity } from '../layers/layer-shapes.js';
import { createDeveloperHook } from '../ports/material-availability.js';
import type { MapData, MapDiagnostic, MapEdge, MapNode, SceneScale } from '../ports/map-contracts.js';
import { adjacencyOf, connectedGroups } from '../ports/map-contracts.js';
import { compileIntoPrefab, playtestSmoke, structureDiagnostics } from '../verify/playtest.js';
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
  if (selection?.startsWith('node:')) return 'node';
  if (selection?.startsWith('edge:')) return 'edge';
  return null;
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

export function EditorApp(): JSX.Element {
  const [map, setMap] = useState<MapData>(maps[0]!);
  const [layers, setLayers] = useState<readonly MapLayer[]>(initialLayers);
  const [currentLayerId, setCurrentLayerId] = useState('layer:ground');
  const [selection, setSelection] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('select');
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [materialQuery, setMaterialQuery] = useState('');
  const [playtestResult, setPlaytestResult] = useState<string>('尚未运行');
  const [notice, setNotice] = useState('工作区已就绪。');
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

  const enterMode = (nextMode: EditorMode) => { setMode(nextMode); setEdgeStart(null); setDragging(null); setSelection(null); };
  const changeMap = (mutate: (current: MapData) => MapData, message?: string) => {
    setMap((current) => mutate(current));
    if (message) setNotice(message);
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

  const onCanvasPoint = (point: { x: number; y: number }) => {
    if (mode === 'node') {
      changeMap((m) => addNode(m, point, floorOf(LAYER_FLOORS, currentLayerId, m.floors)), '已放置场景。');
      return;
    }
    setSelection(null);
    setEdgeStart(null);
  };
  const onNodePointerDown = (nodeId: string, event: PointerEvent<SVGCircleElement>) => {
    if (mode !== 'select') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(nodeId);
    setSelection(`node:${nodeId}`);
  };
  const onNodePointerMove = (nodeId: string, event: PointerEvent<SVGCircleElement>) => {
    if (dragging !== nodeId) return;
    const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    changeMap((m) => moveNode(m, nodeId, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }));
  };
  const onNodePointerUp = () => setDragging(null);
  const onMaterialDrop = (materialId: string, point: { x: number; y: number }) => {
    const nearest = [...map.nodes].sort((a, b) => Math.hypot(a.at.x - point.x, a.at.y - point.y) - Math.hypot(b.at.x - point.x, b.at.y - point.y))[0];
    if (!nearest) { setNotice('先放置一个场景，再将素材拖入其周围。'); return; }
    changeMap((m) => ({ ...m, placements: [...m.placements, { id: nextId('placement', m.placements), at: nearest.id, def: materialId }] }), `已将素材放到 ${nearest.name ?? nearest.id}。`);
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { setEdgeStart(null); setSelection(null); setMode('select'); return; }
    const target = event.target as HTMLElement | null;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      const next = deleteSelection(map, selection);
      if (next !== map) { changeMap(() => next, '已删除选中图元。'); setSelection(null); }
      return;
    }
    if (event.key.toLowerCase() === 'n') enterMode('node');
    if (event.key.toLowerCase() === 'e') enterMode('edge');
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
  const exportMap = () => { if (errors.length > 0) { setNotice(`有 ${errors.length} 个结构错误，已阻止导出。`); return; } download(serializeMapPublish({ map, layers }), `${map.id}.json`); setNotice('已导出地图 JSON。图层字段等待 MapData 契约专项接管。'); };
  const newLayer = () => { const id = `layer:${layers.length}`; setLayers([...layers, emptyLayer(id, `新图层 ${layers.length + 1}`)]); setCurrentLayerId(id); };

  return <div className="editor-app" style={cssVars} tabIndex={0} onKeyDown={handleKey}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark">W</span><div><strong>WakeUp 开发板</strong><small>地图工作台</small></div></div>
      <div className="map-title"><input aria-label="地图名称" value={map.name} onChange={(event) => changeMap(() => ({ ...map, name: event.target.value }))} /><span>{map.id}</span></div>
      <div className="top-actions"><button className="icon-button" title="新建空地图" onClick={() => { changeMap(() => blankMap()); setSelection(null); }}>＋</button><button onClick={() => { const name = `${map.name} 副本`; changeMap(() => blueprintCopy(map, name), '已从当前地图创建蓝本副本。'); }}>蓝本新建</button><button className="primary" onClick={exportMap}>校验并导出</button></div>
    </header>
    <div className="workspace">
      <aside className="left-panel">
        <section><div className="panel-heading"><h2>已加载地图</h2><span>{maps.length}</span></div>{maps.map((item) => <button className={`map-list-item ${item.id === map.id ? 'active' : ''}`} key={item.id} onClick={() => { changeMap(() => item, `已加载 ${item.name}。`); setSelection(null); }}><span>{item.name}</span><small>{item.nodes.length} 场景</small></button>)}</section>
        <section><div className="panel-heading"><h2>图层</h2><button className="icon-button" title="新建图层" onClick={newLayer}>＋</button></div>{layers.map((layer) => <div className={`layer-row ${layer.id === currentLayerId ? 'active' : ''}`} key={layer.id}><button onClick={() => setCurrentLayerId(layer.id)}><span className="layer-dot" />{layer.name ?? layer.id}</button><input aria-label={`${layer.id} 高度`} type="number" value={layer.height ?? ''} placeholder="独立" onChange={(event) => { const height = event.target.value === '' ? undefined : Number(event.target.value); if (!canSetHeight(layers, layer.id, height)) { setNotice('参与透视的图层高度不可重复。'); return; } setLayers(layers.map((item) => item.id === layer.id ? { ...item, height } : item)); }} /></div>)}</section>
        <section className="layer-note"><strong>当前：{currentLayer?.name ?? currentLayerId}</strong><span>可见 {visible.length}/{layers.length} 层</span><span>相邻透明度 {overlayOpacity(currentLayer?.height, 0) ?? '独立'}</span></section>
      </aside>
      <main className="main-area">
        <nav className="toolbar" aria-label="编辑工具">{([['select', '选择', 'V'], ['node', '放置场景', 'N'], ['edge', '拉边', 'E'], ['sample', '取样', 'I'], ['playtest', '测试运行', 'P']] as const).map(([id, label, shortcut]) => <button key={id} className={mode === id ? 'active' : ''} title={`${label} (${shortcut})`} onClick={() => changeMode(id)}><b>{shortcut}</b><span>{label}</span></button>)}</nav>
        <CanvasView map={map} mode={mode} selection={selection} edgeStart={edgeStart} onSelect={select} onCanvasPoint={onCanvasPoint} onNodePointerDown={onNodePointerDown} onNodePointerMove={onNodePointerMove} onNodePointerUp={onNodePointerUp} onMaterialDrop={onMaterialDrop} />
        <section className="bottom-panel"><div className="status-line"><span className={errors.length ? 'status-error' : 'status-ok'}>{errors.length ? `${errors.length} 个结构错误` : '结构校验通过'}</span><span>{notice}</span></div><div className="diagnostics">{diagnostics.length === 0 ? <span className="empty-state">没有诊断。将场景拖出画布或超过连接上限可查看即时反馈。</span> : diagnostics.map((item) => <button className={`diagnostic ${item.severity}`} key={`${item.code}:${item.path}`} onClick={() => setSelection(focusDiagnostic(item, map))}><b>{item.severity === 'error' ? '错误' : '提示'}</b><span>{item.message}</span><small>{item.path}</small></button>)}</div></section>
      </main>
      <aside className="right-panel">
        <section className="inspector"><div className="panel-heading"><h2>检查器</h2><span>{selection ?? '未选择'}</span></div>{selectedNode ? <NodeInspector node={selectedNode} setFloor={(floor) => changeMap((m) => setNodeFloor(m, selectedNode.id, floor))} update={(patch) => changeMap((m) => updateNode(m, selectedNode.id, patch))} /> : selectedEdge ? <EdgeInspector edge={selectedEdge} update={(patch) => changeMap((m) => updateEdge(m, selectedEdge.id, patch))} /> : <p className="empty-state">选择场景或连接以编辑其 MapData 字段。</p>}</section>
        <section className="materials"><div className="panel-heading"><h2>素材</h2><button onClick={() => setPaletteOpen(!paletteOpen)}>{paletteOpen ? '收起' : '展开 70 格'}</button></div>{paletteOpen && <input className="search" placeholder="搜索素材" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} />}<div className={`material-grid ${paletteOpen ? 'expanded' : ''}`}>{shownMaterials.slice(0, paletteOpen ? 70 : 7).map(([id, name, category], index) => <button key={id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', id)} title={`拖入画布放置 ${name}`} className={`material-card variant-${index % 5}`}><i>{name[0]}</i><span>{name}</span><small>{category}</small></button>)}</div><p className="material-hint">开发者权限：全部已注册素材可用。拖入画布会挂接到最近场景。</p></section>
        <section className="playtest"><div className="panel-heading"><h2>Playtest</h2><button className="primary" onClick={playtest}>运行</button></div><p>{playtestResult}</p><div className="topology"><span>连通组 {connectedGroups(map).length}</span><span>邻接节点 {adjacencyOf(map).size}</span></div><small>编译验证 MapData 结构与拓扑；几何和开发板图层不会进入 PrefabDef。</small></section>
      </aside>
    </div>
  </div>;
}

function NodeInspector({ node, setFloor, update }: { node: MapNode; setFloor: (floor: number) => void; update: (patch: Partial<MapNode>) => void }): JSX.Element {
  return <div className="field-grid"><label>名称<input value={node.name ?? ''} onChange={(event) => update({ name: event.target.value })} /></label><label>尺度<select value={node.scale} onChange={(event) => update({ scale: event.target.value as SceneScale })}>{nodeScales.map((scale) => <option key={scale}>{scale}</option>)}</select></label><label>X<input type="number" min="0" max="1" step="0.01" value={node.at.x} onChange={(event) => update({ at: { ...node.at, x: Number(event.target.value) } })} /></label><label>Y<input type="number" min="0" max="1" step="0.01" value={node.at.y} onChange={(event) => update({ at: { ...node.at, y: Number(event.target.value) } })} /></label><label>楼层<input type="number" value={node.floor} onChange={(event) => setFloor(Number(event.target.value))} /></label><label>Def<input value={node.def} onChange={(event) => update({ def: event.target.value })} /></label></div>;
}

function EdgeInspector({ edge, update }: { edge: MapEdge; update: (patch: Partial<MapEdge>) => void }): JSX.Element {
  return <div className="field-grid"><label>方向<select value={edge.directionality} onChange={(event) => update({ directionality: event.target.value as MapEdge['directionality'] })}>{directions.map((direction) => <option key={direction}>{direction}</option>)}</select></label><label>Def<input value={edge.def} onChange={(event) => update({ def: event.target.value })} /></label><label>语义锚点<select value={edge.semanticAnchor ?? 'neutral'} onChange={(event) => update({ semanticAnchor: event.target.value as 'high' | 'low' | 'neutral' })}><option value="high">高地</option><option value="low">洼地</option><option value="neutral">中性</option></select></label><label>过渡窗口<input type="checkbox" checked={Boolean(edge.transitionWindow)} onChange={(event) => update({ transitionWindow: event.target.checked ? { control: [edge.path[0] ?? { x: 0, y: 0 }] } : undefined })} /></label></div>;
}
