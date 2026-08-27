'use client'

import { useState } from 'react'
import { IconCheck, IconWarn, IconChevronDown } from './icons'
import { playSfx } from '@/lib/sound'
import { WORLD, nodeAnchor } from '@/lib/map-types'
import {
  useEditor,
  flyTo,
  selectOne,
  pulseElement,
} from '@/lib/editor-store'
import { catmullRomPath } from '@/lib/geometry'

function Metric({
  label,
  value,
  tone = 'ok',
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'error'
}) {
  const dot =
    tone === 'ok'
      ? 'bg-success shadow-[0_0_7px_var(--success)]'
      : tone === 'warn'
        ? 'soft-blink bg-warning shadow-[0_0_7px_var(--warning)]'
        : 'soft-blink bg-error shadow-[0_0_7px_var(--error)]'
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rotate-45 ${dot}`} />
      <div className="leading-tight">
        <div className="text-[12.5px] font-semibold text-foreground/85">{label}</div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{value}</div>
      </div>
    </div>
  )
}

function MiniMap() {
  const doc = useEditor((s) => s.doc)
  const camera = useEditor((s) => s.camera)
  const W = 150
  const H = 78
  const sx = W / WORLD.w
  const sy = H / WORLD.h

  return (
    <div className="hud-field chamfer relative h-[92px] w-[160px] shrink-0 p-2">
      <span className="absolute left-2 top-1.5 z-10 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        缩略图
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
        {/* edges */}
        <g stroke="var(--success)" strokeWidth={1} opacity={0.6} fill="none">
          {doc.edges.map((e) => (
            <path
              key={e.id}
              d={catmullRomPath(e.points.map((p) => ({ x: p.x * sx, y: p.y * sy })))}
            />
          ))}
        </g>
        {/* scene boxes (display geometry) */}
        {doc.sceneBoxes.map((b) => {
          const c = nodeAnchor(b.sceneId, doc)
          return (
            <rect
              key={b.id}
              x={b.x * sx}
              y={b.y * sy}
              width={b.width * sx}
              height={b.height * sy}
              rx={1.5}
              fill="var(--panel)"
              stroke="var(--primary)"
              strokeWidth={1}
              className="cursor-pointer"
              onClick={() => {
                playSfx('select')
                selectOne('scene', b.sceneId)
                flyTo({ x: c.x - 500, y: c.y - 380, w: 1000, h: 760 })
              }}
            />
          )
        })}
        {/* camera viewport */}
        <rect
          x={camera.x * sx}
          y={camera.y * sy}
          width={camera.w * sx}
          height={camera.h * sy}
          fill="none"
          stroke="var(--warning)"
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.8}
        />
      </svg>
    </div>
  )
}

export function DiagnosticsBar() {
  const doc = useEditor((s) => s.doc)
  const diagnostics = useEditor((s) => s.diagnostics)
  const [collapsed, setCollapsed] = useState(false)

  const errors = diagnostics.filter((d) => d.level === 'error')
  const warns = diagnostics.filter((d) => d.level === 'warning')
  const pass = errors.length === 0

  const reachIssue = diagnostics.some(
    (d) => d.id.startsWith('reach') || d.id.startsWith('iso'),
  )
  const degIssue = diagnostics.some((d) => d.id.startsWith('deg'))
  const obIssue = diagnostics.some((d) => d.id.startsWith('ob'))
  const transitionCount = doc.edges.filter((e) => e.transitionWindow).length
  const complexity =
    doc.sceneNodes.length + doc.edges.length > 18
      ? '高'
      : doc.sceneNodes.length + doc.edges.length > 9
        ? '中'
        : '低'

  const firstIssue = errors[0] ?? warns[0]

  if (collapsed) {
    return (
      <div className="hud-grain rise-in flex shrink-0 items-center justify-between border-t border-border-strong bg-panel px-5 py-2">
        <button
          onClick={() => {
            if (firstIssue?.target) {
              playSfx('select')
              selectOne(firstIssue.target.type, firstIssue.target.id)
              pulseElement(firstIssue.target.id)
            }
          }}
          onMouseEnter={() => firstIssue && playSfx('hover')}
          className="flex items-center gap-2 text-sm"
        >
          <span className={pass ? 'text-success' : 'text-error'}>
            {pass ? <IconCheck width={18} height={18} /> : <IconWarn width={18} height={18} />}
          </span>
          <span className={`font-semibold ${pass ? 'text-success' : 'text-error'}`}>
            {pass ? '结构校验通过' : `${errors.length} 处错误`}
          </span>
        </button>
        <button
          onClick={() => {
            playSfx('click')
            setCollapsed(false)
          }}
          onMouseEnter={() => playSfx('hover')}
          className="chamfer-sm chamfer hud-btn grid h-7 w-7 place-items-center text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          title="展开诊断面板"
        >
          <IconChevronDown width={16} height={16} className="rotate-180" />
        </button>
      </div>
    )
  }

  return (
    <div className="hud-grain rise-in flex shrink-0 flex-col border-t border-border-strong bg-panel">
      {/* 收起按钮行 */}
      <div className="flex items-center justify-end px-5 py-2">
        <button
          onClick={() => {
            playSfx('click')
            setCollapsed(true)
          }}
          onMouseEnter={() => playSfx('hover')}
          className="chamfer-sm chamfer hud-btn grid h-7 w-7 place-items-center text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          title="收起诊断面板"
        >
          <IconChevronDown width={16} height={16} />
        </button>
      </div>
      <div className="flex items-stretch gap-5 px-5 pb-3.5">
      {/* status card */}
      <button
        onClick={() => {
          if (firstIssue?.target) {
            playSfx('select')
            selectOne(firstIssue.target.type, firstIssue.target.id)
            pulseElement(firstIssue.target.id)
          }
        }}
        onMouseEnter={() => firstIssue && playSfx('hover')}
        className={`hud-b chamfer flex min-w-[280px] items-center gap-3 px-4 py-2 text-left transition-colors ${
          pass ? 'bg-success/8' : 'bg-error/8 hover:bg-error/12'
        }`}
        style={
          {
            '--hud-bc': pass
              ? 'color-mix(in srgb, var(--success) 35%, transparent)'
              : 'color-mix(in srgb, var(--error) 40%, transparent)',
          } as React.CSSProperties
        }
      >
        <span
          className={`chamfer-sm chamfer grid h-11 w-11 shrink-0 place-items-center ${
            pass
              ? 'bg-success/15 text-success shadow-[0_0_18px_-4px_var(--success)]'
              : 'bg-error/15 text-error shadow-[0_0_18px_-4px_var(--error)]'
          }`}
        >
          {pass ? <IconCheck width={26} height={26} /> : <IconWarn width={24} height={24} />}
        </span>
        <div className="leading-tight">
          <div className={`text-[15px] font-bold ${pass ? 'text-success' : 'text-error'}`}>
            {pass ? '结构校验通过' : `发现 ${errors.length} 处错误`}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {pass
              ? warns.length
                ? `${warns.length} 处警告，可导出`
                : '当前梦境结构完整，可导出'
              : firstIssue?.message ?? '点击定位问题'}
          </div>
        </div>
      </button>

      {/* metric columns */}
      <div className="flex flex-1 items-center gap-x-10 gap-y-3">
        <div className="flex flex-col gap-3">
          <Metric
            label="连通性"
            value={reachIssue ? '存在不可达场景' : '所有场景可达'}
            tone={reachIssue ? 'warn' : 'ok'}
          />
          <Metric
            label="连接上限"
            value={degIssue ? '超出尺度上限' : `${doc.edges.length} 条连线合法`}
            tone={degIssue ? 'error' : 'ok'}
          />
        </div>
        <div className="flex flex-col gap-3">
          <Metric label="过渡窗口" value={`${transitionCount} 个已配置`} />
          <Metric
            label="遮挡框"
            value={
              obIssue
                ? `${doc.obstructions.length} 处，含未覆盖`
                : `${doc.obstructions.length} 处正常`
            }
            tone={obIssue ? 'warn' : 'ok'}
          />
        </div>
        <div className="flex flex-col gap-3">
          <Metric label="素材放置" value={`${doc.placements.length} 个实例`} />
          <Metric
            label="性能预估"
            value={`节点 ${doc.sceneNodes.length} / 边 ${doc.edges.length} / 复杂度 ${complexity}`}
          />
        </div>
      </div>

      <MiniMap />
    </div>
    </div>
  )
}
