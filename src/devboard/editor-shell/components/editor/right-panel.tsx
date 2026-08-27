'use client'

import { useState, useRef } from 'react'
import {
  IconChevronDown,
  IconSearch,
  IconPlay,
  IconCheck,
  IconWarn,
  IconAnchor,
  IconTrash,
} from './icons'
import { playSfx } from '@editor/lib/sound'
import {
  MATERIALS,
  CATEGORIES,
  tileStyle,
  materialById,
  type MaterialCategory,
} from '@editor/lib/materials'
import {
  SCALE_LIMIT,
  DIRECTIONALITY_LABEL,
  boxesOfScene,
  type SceneNode,
  type SceneBox,
  type Edge,
  type EdgeDirectionality,
  type Obstruction,
  type Terrain,
  type Placement,
} from '@editor/lib/map-types'
import {
  useEditor,
  getState,
  updateSceneNode,
  updateSceneBox,
  updateEdge,
  updateObstruction,
  updateTerrain,
  deleteSelection,
  pulseElement,
  startMaterialDrag,
  moveMaterialDrag,
  endMaterialDrag,
  addPlacement,
} from '@editor/lib/editor-store'
import {
  screenToWorld,
  sceneIdAtPoint,
  isOverCanvas,
} from '@editor/lib/canvas-coords'
import { openLibrary } from '@editor/lib/library-store'

/* ------------------------------------------------------------------ */
/* shared UI                                                           */
/* ------------------------------------------------------------------ */

function SectionHeader({
  title,
  right,
}: {
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-4">
      <span className="h-3 w-[3px] shrink-0 bg-primary shadow-[0_0_8px_var(--primary)]" />
      <h2 className="whitespace-nowrap text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
        {title}
      </h2>
      <span className="hud-head-line flex-1" />
      {right}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  mono = true,
}: {
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`hud-field hud-field-hover chamfer-sm chamfer w-full px-3 py-1.5 text-[12.5px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary ${
        mono ? 'font-mono' : ''
      }`}
    />
  )
}

function NumberInput({
  value,
  onChange,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <input
      type="number"
      value={Math.round(value)}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="hud-field hud-field-hover chamfer-sm chamfer w-full px-3 py-1.5 font-mono text-[12.5px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="hud-b chamfer-sm flex gap-0.5 bg-panel-inset p-0.5" style={{ '--hud-bc': 'var(--border)' } as React.CSSProperties}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => {
              playSfx('toggle')
              onChange(o.value)
            }}
            onMouseEnter={() => playSfx('hover')}
            className={`flex-1 px-2 py-1 text-[11.5px] font-semibold transition-colors ${
              active
                ? 'bg-primary text-primary-foreground shadow-[0_0_10px_-3px_var(--primary)]'
                : 'text-foreground/65 hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function DeleteButton() {
  return (
    <button
      onClick={() => {
        playSfx('warning')
        deleteSelection()
      }}
      onMouseEnter={() => playSfx('hover')}
      className="hud-b chamfer-sm chamfer flex w-full items-center justify-center gap-2 bg-error/10 py-2 text-[12px] font-semibold uppercase tracking-wider text-error transition-colors hover:bg-error/20"
      style={{ '--hud-bc': 'color-mix(in srgb, var(--error) 40%, transparent)' } as React.CSSProperties}
    >
      <IconTrash width={14} height={14} />
      删除选中元素
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* inspectors per element type                                         */
/* ------------------------------------------------------------------ */

function SceneInspector({ scene }: { scene: SceneNode }) {
  const doc = getState().doc
  const degree = doc.edges.filter((e) => e.from === scene.id || e.to === scene.id).length
  const limit = SCALE_LIMIT[scene.scale]
  const over = degree > limit
  const boxes = boxesOfScene(scene.id, doc)
  const primaryBox: SceneBox | undefined = boxes[0]
  const layers = doc.layers

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      <Field label="名称">
        <TextInput
          mono={false}
          value={scene.name}
          onChange={(v) => updateSceneNode(scene.id, { name: v })}
        />
      </Field>
      <Field label="尺度">
        <Segmented
          value={scene.scale}
          onChange={(v) => updateSceneNode(scene.id, { scale: v })}
          options={[
            { value: 'large', label: '大' },
            { value: 'medium', label: '中' },
            { value: 'small', label: '小' },
          ]}
        />
      </Field>
      <Field label="图层">
        <select
          value={scene.layerId}
          onChange={(e) => updateSceneNode(scene.id, { layerId: e.target.value })}
          className="hud-field hud-field-hover chamfer-sm chamfer w-full px-3 py-1.5 text-[12.5px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      {/* geometry edits act on the primary member box; scenes aggregated from
          multiple overlapping boxes still show/edit that one box's rect here
          — moving/resizing it may re-trigger aggregation on release */}
      {primaryBox && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="X">
              <NumberInput
                value={primaryBox.x}
                onChange={(v) => updateSceneBox(primaryBox.id, { x: v })}
              />
            </Field>
            <Field label="Y">
              <NumberInput
                value={primaryBox.y}
                onChange={(v) => updateSceneBox(primaryBox.id, { y: v })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="宽">
              <NumberInput
                value={primaryBox.width}
                onChange={(v) => updateSceneBox(primaryBox.id, { width: Math.max(60, v) })}
              />
            </Field>
            <Field label="高">
              <NumberInput
                value={primaryBox.height}
                onChange={(v) => updateSceneBox(primaryBox.id, { height: Math.max(50, v) })}
              />
            </Field>
          </div>
        </>
      )}
      {boxes.length > 1 && (
        <div className="hud-field chamfer-sm chamfer px-3 py-1.5 text-[11px] text-muted-foreground">
          该场景由 {boxes.length} 个重叠矩形聚合而成，以上为第一个矩形的几何
        </div>
      )}
      {/* connection budget */}
      <div
        className={`hud-b chamfer-sm chamfer mt-1 flex items-center justify-between px-3 py-2 ${over ? 'bg-error/10' : 'bg-panel-inset'}`}
        style={{ '--hud-bc': over ? 'var(--error)' : 'var(--border)' } as React.CSSProperties}
      >
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          连接数 / 上限
        </span>
        <span className={`font-mono text-[13px] font-bold ${over ? 'text-error' : 'text-primary'}`}>
          {degree} / {limit}
        </span>
      </div>
      <DeleteButton />
    </div>
  )
}

function EdgeInspector({ edge }: { edge: Edge }) {
  const doc = getState().doc
  const from = doc.sceneNodes.find((s) => s.id === edge.from)
  const to = doc.sceneNodes.find((s) => s.id === edge.to)
  const arrow =
    edge.directionality === 'bidirectional'
      ? '↔'
      : edge.directionality === 'one-way-down'
        ? '↓'
        : edge.directionality === 'one-way-up'
          ? '↑'
          : '→'
  const visiblePoints = edge.points.filter((p) => !p.hidden)
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      <Field label="连接">
        <div className="hud-field chamfer-sm chamfer truncate px-3 py-1.5 text-[12.5px] text-foreground">
          {from?.name ?? '?'} {arrow} {to?.name ?? '?'}
        </div>
      </Field>
      <Field label="方向">
        <Segmented
          value={edge.directionality}
          onChange={(v: EdgeDirectionality) => updateEdge(edge.id, { directionality: v })}
          options={(
            ['bidirectional', 'unidirectional', 'one-way-up', 'one-way-down'] as EdgeDirectionality[]
          ).map((d) => ({ value: d, label: DIRECTIONALITY_LABEL[d] }))}
        />
      </Field>
      <Field label="锚点">
        <Segmented
          value={edge.semanticAnchor ?? 'neutral'}
          onChange={(v) => updateEdge(edge.id, { semanticAnchor: v })}
          options={[
            { value: 'highland', label: '高' },
            { value: 'neutral', label: '中' },
            { value: 'lowland', label: '低' },
          ]}
        />
      </Field>
      <div className="hud-field chamfer-sm chamfer flex items-center gap-2 px-3 py-1.5">
        <IconAnchor width={13} height={13} className="text-primary" />
        <span className="font-mono text-[11.5px] text-muted-foreground">
          折点 {Math.max(0, visiblePoints.length - 2)} 个 · 双击线段可拍直
        </span>
      </div>
      <Field label="过渡窗">
        <Segmented
          value={edge.transitionWindow ? 'on' : 'off'}
          onChange={(v) => {
            if (v === 'on') {
              const mid = edge.points[Math.floor(edge.points.length / 2)]
              if (!mid) return
              updateEdge(edge.id, { transitionWindow: { x: mid.x, y: mid.y } })
            } else {
              updateEdge(edge.id, { transitionWindow: undefined })
            }
          }}
          options={[
            { value: 'off', label: '无' },
            { value: 'on', label: '启用' },
          ]}
        />
      </Field>
      <DeleteButton />
    </div>
  )
}

function ObstructionInspector({ ob }: { ob: Obstruction }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      <Field label="类型">
        <Segmented
          value={ob.type}
          onChange={(v) => updateObstruction(ob.id, { type: v })}
          options={[
            { value: 'visual', label: '视觉遮挡' },
            { value: 'physical', label: '物理遮挡' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="宽">
          <NumberInput value={ob.width} onChange={(v) => updateObstruction(ob.id, { width: Math.max(20, v) })} />
        </Field>
        <Field label="高">
          <NumberInput value={ob.height} onChange={(v) => updateObstruction(ob.id, { height: Math.max(20, v) })} />
        </Field>
      </div>
      <Field label="旋转">
        <NumberInput value={ob.rotation} step={5} onChange={(v) => updateObstruction(ob.id, { rotation: v })} />
      </Field>
      <div
        className="hud-b chamfer-sm chamfer flex items-center justify-between px-3 py-2"
        style={{ '--hud-bc': 'var(--border)' } as React.CSSProperties}
      >
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          覆盖连线
        </span>
        <span className="font-mono text-[13px] font-bold text-primary">
          {ob.affectsEdges.length}
        </span>
      </div>
      <DeleteButton />
    </div>
  )
}

function TerrainInspector({ tr }: { tr: Terrain }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      <Field label="地形">
        <Segmented
          value={tr.type}
          onChange={(v) => updateTerrain(tr.id, { type: v })}
          options={[
            { value: 'highland', label: '高地' },
            { value: 'lowland', label: '低地' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="宽">
          <NumberInput value={tr.width} onChange={(v) => updateTerrain(tr.id, { width: Math.max(40, v) })} />
        </Field>
        <Field label="高">
          <NumberInput value={tr.height} onChange={(v) => updateTerrain(tr.id, { height: Math.max(40, v) })} />
        </Field>
      </div>
      <Field label="旋转">
        <NumberInput value={tr.rotation} step={5} onChange={(v) => updateTerrain(tr.id, { rotation: v })} />
      </Field>
      <DeleteButton />
    </div>
  )
}

function PlacementInspector({ pl }: { pl: Placement }) {
  const mat = materialById(pl.materialId)
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      <div className="flex items-center gap-3">
        <span
          className="chamfer-sm h-12 w-12 shrink-0 ring-1 ring-inset ring-border"
          style={mat ? tileStyle(mat.tile) : undefined}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {mat?.name ?? '未知素材'}
          </div>
          <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {mat?.category}
          </div>
        </div>
      </div>
      <DeleteButton />
    </div>
  )
}

function EmptyInspector() {
  return (
    <div className="px-4 pb-6 pt-1">
      <div
        className="hud-b chamfer-sm chamfer flex flex-col items-center gap-2 bg-panel-inset px-4 py-8 text-center"
        style={{ '--hud-bc': 'var(--border)' } as React.CSSProperties}
      >
        <span className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-inset ring-border">
          <IconAnchor width={16} height={16} className="text-muted-foreground" />
        </span>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          未选中任何元素。
          <br />
          在画布中点选场景、连线或遮挡框以编辑属性。
        </p>
      </div>
    </div>
  )
}

function Inspector() {
  const selection = useEditor((s) => s.selection)
  const doc = useEditor((s) => s.doc)
  const sel = selection[0]

  let title = '属性检查器'
  let body: React.ReactNode = <EmptyInspector />

  if (sel) {
    if (sel.type === 'scene') {
      const scene = doc.sceneNodes.find((s) => s.id === sel.id)
      if (scene) {
        title = '场景检查器'
        body = <SceneInspector scene={scene} />
      }
    } else if (sel.type === 'edge') {
      const edge = doc.edges.find((e) => e.id === sel.id)
      if (edge) {
        title = '连接边检查器'
        body = <EdgeInspector edge={edge} />
      }
    } else if (sel.type === 'obstruction') {
      const ob = doc.obstructions.find((o) => o.id === sel.id)
      if (ob) {
        title = '遮挡框检查器'
        body = <ObstructionInspector ob={ob} />
      }
    } else if (sel.type === 'terrain') {
      const tr = doc.terrains.find((t) => t.id === sel.id)
      if (tr) {
        title = '地形检查器'
        body = <TerrainInspector tr={tr} />
      }
    } else if (sel.type === 'placement') {
      const pl = doc.placements.find((p) => p.id === sel.id)
      if (pl) {
        title = '素材检查器'
        body = <PlacementInspector pl={pl} />
      }
    }
  }

  return (
    <section className="rise-in border-b border-border" style={{ animationDelay: '60ms' }}>
      <SectionHeader title={title} />
      {body}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* entry into the full-screen dream asset library                      */
/* ------------------------------------------------------------------ */

/**
 * 「快速素材库」头部的入口按钮：点击时以按钮中心为原点（视口归一化坐标）触发
 * 暖色传送门过场并打开整屏梦境素材库。按钮自身附一次能量吸入反馈
 * (lib-entry-charge)。这是需求里「快捷素材库上的按钮 + 特殊动态效果跳转」的
 * 落点；返回由素材库内的「回编辑器」处理，不重播开机动画。
 */
function LibraryEntryButton() {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      onMouseEnter={() => playSfx('hover')}
      onClick={() => {
        playSfx('success')
        const el = ref.current
        if (el) {
          el.classList.remove('lib-entry-charge')
          void el.offsetWidth // 重启动画
          el.classList.add('lib-entry-charge')
          const r = el.getBoundingClientRect()
          openLibrary({
            x: (r.left + r.width / 2) / window.innerWidth,
            y: (r.top + r.height / 2) / window.innerHeight,
          })
        } else {
          openLibrary()
        }
        window.setTimeout(() => {
          window.location.assign(`/asset-library?${new URLSearchParams({ entryTool: 'map-editor', returnTo: window.location.pathname, ...(new URLSearchParams(window.location.search).get('entryId') ? { entryId: new URLSearchParams(window.location.search).get('entryId')! } : {}) }).toString()}`)
        }, 360)
      }}
      style={{ ['--hud-bc' as string]: 'var(--primary)' }}
      className="chamfer hud-b group flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:text-primary-foreground hover:bg-primary/90"
      title="打开梦境素材库"
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M17.5 14v7M14 17.5h7" />
      </svg>
      素材库
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* material palette with drag-to-canvas                                */
/* ------------------------------------------------------------------ */

function MaterialPalette() {
  const [cat, setCat] = useState<MaterialCategory | '全部'>('全部')
  const [query, setQuery] = useState('')
  const dragging = useRef(false)

  const list = MATERIALS.filter((m) => {
    if (cat !== '全部' && m.category !== cat) return false
    if (query && !m.name.includes(query)) return false
    return true
  })

  function beginDrag(e: React.PointerEvent, materialId: string) {
    e.preventDefault()
    playSfx('click')
    dragging.current = true
    startMaterialDrag(materialId, e.clientX, e.clientY)

    const move = (ev: PointerEvent) => {
      const w = screenToWorld(ev.clientX, ev.clientY)
      const overId = w && isOverCanvas(ev.clientX, ev.clientY) ? sceneIdAtPoint(w) : null
      moveMaterialDrag(ev.clientX, ev.clientY, overId)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
      const drag = getState().dragMaterial
      const w = screenToWorld(ev.clientX, ev.clientY)
      if (drag?.overScene && w) {
        addPlacement(drag.materialId, drag.overScene, w)
        playSfx('success')
      }
      endMaterialDrag()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <section className="rise-in border-b border-border" style={{ animationDelay: '140ms' }}>
      <SectionHeader
        title="快速素材库"
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">{list.length}</span>
            <LibraryEntryButton />
          </div>
        }
      />

      {/* category chips */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {(['全部', ...CATEGORIES] as const).map((c) => {
          const active = c === cat
          return (
            <button
              key={c}
              onClick={() => {
                playSfx('toggle')
                setCat(c)
              }}
              onMouseEnter={() => playSfx('hover')}
              style={
                { '--hud-bc': active ? 'var(--primary)' : 'var(--border)' } as React.CSSProperties
              }
              className={`hud-b chamfer-sm chamfer px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                active ? 'bg-primary/12 text-primary' : 'bg-panel-inset text-foreground/70 hover:bg-card'
              }`}
            >
              {c}
            </button>
          )
        })}
      </div>

      {/* search */}
      <div className="px-4 pb-3">
        <div className="hud-field chamfer-sm chamfer flex items-center gap-2 px-2.5 py-1.5">
          <IconSearch width={13} height={13} className="text-primary/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索预制体…"
            className="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
      </div>

      {/* tile grid */}
      <div className="scroll-thin max-h-[260px] overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-5 gap-1.5">
          {list.map((m) => (
            <button
              key={m.id}
              onPointerDown={(e) => beginDrag(e, m.id)}
              onMouseEnter={() => playSfx('hover')}
              title={`${m.name} · 拖入场景放置`}
              className="chamfer-sm chamfer group relative aspect-square touch-none overflow-hidden ring-1 ring-inset ring-border transition-all duration-150 hover:ring-primary active:scale-95"
              style={tileStyle(m.tile)}
              aria-label={`${m.name}，拖入画布放置`}
            >
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-center text-[8px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                {m.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* live test runner (validation)                                       */
/* ------------------------------------------------------------------ */

function TestRunner() {
  const diagnostics = useEditor((s) => s.diagnostics)
  const doc = useEditor((s) => s.doc)
  const [ran, setRan] = useState(false)

  const errors = diagnostics.filter((d) => d.level === 'error')
  const warns = diagnostics.filter((d) => d.level === 'warning')

  const summary = [
    {
      label: '连通性',
      ok: !diagnostics.some((d) => d.id.startsWith('reach') || d.id.startsWith('iso')),
    },
    { label: '连接上限', ok: !diagnostics.some((d) => d.id.startsWith('deg')) },
    { label: '场景命名', ok: !diagnostics.some((d) => d.id.startsWith('name')) },
    { label: '遮挡覆盖', ok: !diagnostics.some((d) => d.id.startsWith('ob')) },
  ]

  return (
    <section className="rise-in" style={{ animationDelay: '220ms' }}>
      <SectionHeader title="运行测试" />
      <div className="px-4 pb-3">
        <button
          onClick={() => {
            playSfx('click')
            setRan(true)
            const hasErr = errors.length > 0
            const hasWarn = warns.length > 0
            window.setTimeout(
              () => playSfx(hasErr ? 'error' : hasWarn ? 'warning' : 'success'),
              260,
            )
          }}
          onMouseEnter={() => playSfx('hover')}
          className="hud-btn-primary chamfer group relative flex w-full items-center justify-center gap-2 overflow-hidden py-3 text-[14px] font-bold uppercase tracking-wider text-primary-foreground"
        >
          <span className="absolute inset-0 -translate-x-full bg-white/25 transition-transform duration-500 group-hover:translate-x-full" />
          <IconPlay width={16} height={16} />
          运行测试 (P)
        </button>
      </div>

      {/* summary badges */}
      <ul className="flex flex-col gap-2 px-4 pb-3">
        {summary.map((r) => (
          <li
            key={r.label}
            style={
              {
                '--hud-bc': r.ok
                  ? 'color-mix(in srgb, var(--success) 35%, transparent)'
                  : 'color-mix(in srgb, var(--warning) 40%, transparent)',
              } as React.CSSProperties
            }
            className={`hud-b chamfer-sm chamfer flex items-center gap-2.5 px-3 py-2.5 ${
              r.ok ? 'bg-success/8' : 'bg-warning/8'
            }`}
          >
            {r.ok ? (
              <IconCheck width={16} height={16} className="text-success" />
            ) : (
              <IconWarn width={16} height={16} className="text-warning" />
            )}
            <span className={`flex-1 text-[13px] font-medium ${r.ok ? 'text-success' : 'text-warning'}`}>
              {r.label}
            </span>
            <span className={`font-mono text-[10px] uppercase tracking-wider ${r.ok ? 'text-success/60' : 'text-warning/70'}`}>
              {r.ok ? 'PASS' : 'WARN'}
            </span>
          </li>
        ))}
      </ul>

      {/* detailed diagnostics, click to focus */}
      {diagnostics.length > 0 && (
        <>
          <SectionHeader title={`诊断明细 · ${errors.length}错 ${warns.length}警`} />
          <ul className="flex flex-col gap-1.5 px-4 pb-5">
            {diagnostics.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => {
                    playSfx('select')
                    if (d.target) pulseElement(d.target.id)
                  }}
                  onMouseEnter={() => playSfx('hover')}
                  className="hud-b chamfer-sm chamfer flex w-full items-start gap-2 bg-panel-inset px-3 py-2 text-left transition-colors hover:bg-card"
                  style={
                    {
                      '--hud-bc':
                        d.level === 'error' ? 'color-mix(in srgb, var(--error) 40%, transparent)' : 'var(--border)',
                    } as React.CSSProperties
                  }
                >
                  <span
                    className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${d.level === 'error' ? 'bg-error' : 'bg-warning'}`}
                  />
                  <span className="text-[12px] leading-snug text-foreground/85">{d.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {diagnostics.length === 0 && ran && (
        <p className="px-4 pb-6 text-center text-[12px] text-success">
          全部校验通过，可安全导出。
        </p>
      )}
    </section>
  )
}

export function RightPanel() {
  return (
    <aside className="hud-grain scroll-thin flex w-[356px] shrink-0 flex-col overflow-y-auto border-l border-border-strong bg-panel">
      <Inspector />
      <MaterialPalette />
      <TestRunner />
    </aside>
  )
}
