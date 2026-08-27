'use client'

import { useEffect, useState, useRef } from 'react'
import { IconFolder, IconEye, IconEyeOff, IconPlus, IconChevronLeft, IconChevronRight, IconImage } from './icons'
import { HoloScan, HoloStatic } from './fx'
import { playSfx } from '@editor/lib/sound'
import {
  SCALE_LABEL,
  nodeAnchor,
  overlayOpacity,
  type SceneNode,
  type Layer,
  type BuildingGroup,
  type BuildingFloor,
} from '@editor/lib/map-types'
import {
  useEditor,
  getState,
  selectOne,
  flyTo,
  setCurrentLayer,
  addLayer,
  updateLayer,
  toast,
  addLayerFromImage,
  addBuildingFloor,
  setBuildingFloorImage,
  setBuildingFloorOrdinal,
  bindBuildingPortal,
  removeBuildingFloor,
} from '@editor/lib/editor-store'
import { uploadPngFile, type UploadCategory } from '@editor/lib/file-upload'

function SectionHeader({
  title,
  icon,
  extra,
}: {
  title: string
  icon?: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-4">
      <span className="h-3 w-[3px] shrink-0 bg-primary shadow-[0_0_8px_var(--primary)]" />
      {icon && <span className="text-primary">{icon}</span>}
      <h2 className="whitespace-nowrap text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
        {title}
      </h2>
      <span className="hud-head-line flex-1" />
      {extra}
    </div>
  )
}

const SCALE_DOT: Record<SceneNode['scale'], string> = {
  large: 'var(--primary)',
  medium: 'var(--warning)',
  small: 'var(--muted-foreground)',
}
const SCALE_TAG: Record<SceneNode['scale'], string> = {
  large: 'L',
  medium: 'M',
  small: 'S',
}

function SceneCard({
  scene,
  layerName,
  active,
}: {
  scene: SceneNode
  layerName: string
  active: boolean
}) {
  return (
    <button
      onClick={() => {
        playSfx('select')
        selectOne('scene', scene.id)
        const c = nodeAnchor(scene.id, getState().doc)
        flyTo({ x: c.x - 500, y: c.y - 380, w: 1000, h: 760 })
      }}
      onMouseEnter={() => playSfx('hover')}
      data-ctx="scene"
      data-scene-id={scene.id}
      style={
        {
          '--hud-bc': active ? 'var(--primary)' : 'var(--border)',
        } as React.CSSProperties
      }
      className={`hud-b chamfer group relative flex w-full items-center gap-3 p-2 text-left transition-all duration-200 ${
        active
          ? 'bg-primary/10 shadow-[0_0_22px_-8px_var(--primary)]'
          : 'bg-panel-inset hover:bg-card'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-9 w-[3px] -translate-y-1/2 bg-primary shadow-[0_0_10px_var(--primary)]" />
      )}
      <div className="chamfer-sm chamfer relative grid h-12 w-16 shrink-0 place-items-center overflow-hidden bg-black/40 ring-1 ring-inset ring-white/10">
        {active ? <HoloScan strong /> : <HoloStatic intensity={0.4} />}
        <span
          className="relative z-10 h-1.5 w-1.5 rounded-full"
          style={{
            background: SCALE_DOT[scene.scale],
            boxShadow: `0 0 6px ${SCALE_DOT[scene.scale]}`,
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-semibold ${active ? 'text-foreground' : 'text-foreground/85'}`}
        >
          {scene.name || '未命名'}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{SCALE_LABEL[scene.scale]}</span>
          <span className="opacity-40">·</span>
          <span>{layerName}</span>
        </div>
      </div>
      <span
        className={`chamfer-sm chamfer grid h-6 w-6 shrink-0 place-items-center font-mono text-[11px] font-bold ${
          active
            ? 'bg-primary text-primary-foreground'
            : 'bg-panel text-muted-foreground ring-1 ring-inset ring-border'
        }`}
      >
        {SCALE_TAG[scene.scale]}
      </span>
    </button>
  )
}

function LayerRow({
  layer,
  otherLayers,
  count,
  active,
}: {
  layer: Layer
  /** 除自己外的其它图层，用于高度冲突校验（B4：两个参与透视的图层不能填
   *  相同高度值——空值="独立层"不参与透视，天然不冲突）。 */
  otherLayers: Layer[]
  count: number
  active: boolean
}) {
  const [draft, setDraft] = useState<string>(layer.height != null ? String(layer.height) : '')
  const [err, setErr] = useState(false)

  useEffect(() => {
    setDraft(layer.height != null ? String(layer.height) : '')
    setErr(false)
  }, [layer.height])

  function commit() {
    if (draft.trim() === '') {
      setErr(false)
      updateLayer(layer.id, { height: undefined })
      return
    }
    const n = Number(draft)
    if (!Number.isFinite(n)) {
      setErr(true)
      playSfx('error')
      return
    }
    const conflict = otherLayers.some((l) => l.height === n)
    if (conflict) {
      setErr(true)
      playSfx('error')
      toast(`高度 ${n} 已被其它图层占用，透视图层高度必须唯一`, 'error')
      return
    }
    setErr(false)
    updateLayer(layer.id, { height: n })
  }

  return (
    <div
      style={
        {
          '--hud-bc': active ? 'var(--success)' : 'var(--border)',
        } as React.CSSProperties
      }
      className={`hud-b chamfer-sm chamfer flex w-full items-center gap-3 px-3 py-2.5 transition-colors ${
        active ? 'bg-success/8' : 'bg-panel-inset hover:bg-card'
      }`}
    >
      <button
        onClick={() => {
          playSfx('toggle')
          setCurrentLayer(layer.id)
        }}
        onMouseEnter={() => playSfx('hover')}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <span
          className={`h-2 w-2 shrink-0 rotate-45 ${active ? 'soft-blink bg-success shadow-[0_0_8px_var(--success)]' : 'bg-muted-foreground/50'}`}
        />
        <span
          className={`flex-1 truncate text-[13px] font-semibold ${active ? 'text-success' : 'text-foreground/80'}`}
        >
          {layer.name}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {count} 场景
        </span>
      </button>
      {/* 高度数字输入：留空 = 独立层，不参与跨层透视换算 */}
      <input
        type="number"
        value={draft}
        placeholder="独立层"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        onClick={(e) => e.stopPropagation()}
        title="高度（留空 = 独立层，不与其它图层叠加透视）"
        className={`hud-field chamfer-sm chamfer w-16 px-1.5 py-1 text-center text-[11px] focus:outline-none focus:ring-1 ${
          err ? 'ring-1 ring-error text-error' : 'focus:ring-primary'
        }`}
      />
      <button
        onClick={() => {
          playSfx('toggle')
          setCurrentLayer(layer.id)
        }}
        className={active ? 'text-success' : 'text-muted-foreground'}
      >
        {active ? <IconEye width={16} height={16} /> : <IconEyeOff width={16} height={16} />}
      </button>
    </div>
  )
}

const shortcuts = [
  { keys: ['V'], label: '选择工具' },
  { keys: ['N'], label: '放置场景' },
  { keys: ['E'], label: '拉边连接' },
  { keys: ['I'], label: '取样材质' },
  { keys: ['P'], label: '运行测试' },
  { keys: ['1-9'], label: '切换图层' },
  { keys: ['Space'], label: '按住平移' },
  { keys: ['Del'], label: '删除选中' },
  { keys: ['Ctrl', 'Z / Y'], label: '撤销 / 重做' },
]

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="chamfer-sm chamfer hud-btn inline-grid min-w-[26px] place-items-center px-1.5 py-1 font-mono text-[11px] font-semibold text-primary/90">
      {children}
    </kbd>
  )
}

/** PNG 上传为图层：全屏底图（铺满）或局部贴纸（等比缩放可移动）。 */
function LayerUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        onMouseEnter={() => playSfx('hover')}
        className="mt-1 flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-primary/80 transition-colors hover:text-primary"
      >
        <IconImage width={12} height={12} />
        上传底图（全屏 / 局部）
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".png,image/png"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          let loaded: ReturnType<typeof Object.assign>
          try {
            loaded = await uploadPngFile(file)
          } catch (err) {
            playSfx('error')
            toast(`上传失败：${err instanceof Error ? err.message : String(err)}`, 'error')
            return
          }
          // 选择类别：全屏（铺满整图）或局部（等比贴纸）
          const category: UploadCategory = window.confirm(
            '作为「全屏底图层」（铺满整张地图）？\n点「取消」则作为「局部贴纸图层」（等比缩放，可移动/缩放）。',
          )
            ? '全屏'
            : '局部'
          addLayerFromImage({
            dataUrl: loaded.dataUrl,
            pixelWidth: loaded.width,
            pixelHeight: loaded.height,
            name: file.name.replace(/\.png$/i, '') || '图层',
            category,
          })
          playSfx('success')
        }}
      />
    </>
  )
}

export function LeftPanel() {
  const scenes = useEditor((s) => s.doc.sceneNodes)
  const layers = useEditor((s) => s.doc.layers)
  const buildingGroups = useEditor((s) => s.doc.buildingGroups ?? [])
  const selection = useEditor((s) => s.selection)
  const currentLayerId = useEditor((s) => s.currentLayerId)
  const currentLayer = layers.find((l) => l.id === currentLayerId)
  const layerName = (id: string) => layers.find((l) => l.id === id)?.name ?? '未知图层'
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <aside className="hud-grain flex w-12 shrink-0 flex-col items-center border-r border-border-strong bg-panel py-4">
        <button
          onClick={() => {
            playSfx('click')
            setCollapsed(false)
          }}
          onMouseEnter={() => playSfx('hover')}
          className="chamfer-sm chamfer hud-btn grid h-9 w-9 place-items-center text-primary transition-colors hover:bg-primary/10"
          title="展开侧边栏"
        >
          <IconChevronRight width={18} height={18} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="hud-grain scroll-thin flex w-[336px] shrink-0 flex-col overflow-y-auto border-r border-border-strong bg-panel">
      {/* 收起按钮 */}
      <div className="flex items-center justify-end border-b border-border px-3 py-2">
        <button
          onClick={() => {
            playSfx('click')
            setCollapsed(true)
          }}
          onMouseEnter={() => playSfx('hover')}
          className="chamfer-sm chamfer hud-btn grid h-7 w-7 place-items-center text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          title="收起侧边栏"
        >
          <IconChevronLeft width={16} height={16} />
        </button>
      </div>
      {/* 梦境蓝图 */}
      <section className="rise-in border-b border-border" style={{ animationDelay: '40ms' }}>
        <SectionHeader
          title="梦境蓝图"
          icon={<IconFolder width={16} height={16} />}
          extra={
            <span className="font-mono text-[11px] text-muted-foreground">
              {scenes.length}
            </span>
          }
        />
        <div className="flex flex-col gap-2 px-3 pb-4">
          {scenes.length === 0 && (
            <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
              暂无场景。切换到「放置」工具，
              <br />
              在画布拖拽出一个场景区域。
            </p>
          )}
          {scenes.map((s) => (
            <SceneCard
              key={s.id}
              scene={s}
              layerName={layerName(s.layerId)}
              active={selection.some((x) => x.id === s.id)}
            />
          ))}
        </div>
      </section>

      {/* 建筑组分支 */}
      <section className="rise-in border-b border-border" style={{ animationDelay: '90ms' }}>
        <SectionHeader
          title="建筑组"
          extra={<span className="font-mono text-[11px] text-muted-foreground">{buildingGroups.length}</span>}
        />
        <div className="flex flex-col gap-2 px-3 pb-3">
          {buildingGroups.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">在画布框选区域以创建建筑组。</p>
          ) : buildingGroups.map((building) => (
            <BuildingGroupCard key={building.id} building={building} />
          ))}
        </div>
      </section>

      {/* 图层与高度 */}
      <section className="rise-in border-b border-border" style={{ animationDelay: '110ms' }}>
        <SectionHeader
          title="图层与高度"
          extra={
            <span className="font-mono text-[11px] text-muted-foreground">
              当前:{' '}
              <span className="font-semibold text-success">{currentLayer?.name ?? '—'}</span>
            </span>
          }
        />
        {/* 注记条（B4）：当前图层名 / 可见层数 / 与当前图层相邻透明度 */}
        {currentLayer && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 font-mono text-[10.5px] text-muted-foreground">
            <span>
              可见 <span className="text-foreground/80">{layers.length}</span>/{layers.length} 层
            </span>
            {layers
              .filter((l) => l.id !== currentLayer.id)
              .map((l) => (
                <span key={l.id}>
                  ↔{l.name} {Math.round(overlayOpacity(currentLayer, l) * 100)}%
                </span>
              ))}
          </div>
        )}
        <div className="flex flex-col gap-2 px-3 pb-4">
          {layers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              otherLayers={layers.filter((l) => l.id !== layer.id)}
              count={scenes.filter((s) => s.layerId === layer.id).length}
              active={layer.id === currentLayerId}
            />
          ))}
          <button
            onClick={() => {
              playSfx('click')
              addLayer(`图层 ${layers.length + 1}`)
            }}
            onMouseEnter={() => playSfx('hover')}
            className="flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <IconPlus width={12} height={12} />
            新建图层
          </button>
          <LayerUploadButton />
        </div>
      </section>

      {/* 快捷键 */}
      <section className="rise-in flex-1" style={{ animationDelay: '180ms' }}>
        <SectionHeader title="快捷键" />
        <div className="px-3 pb-4">
          <div className="grid grid-cols-[110px_1fr] items-center gap-x-4 px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span>按键</span>
            <span>功能</span>
          </div>
          <div className="flex flex-col">
            {shortcuts.map((s, i) => (
              <div
                key={s.label}
                className={`grid grid-cols-[110px_1fr] items-center gap-x-4 rounded-md px-2 py-1.5 ${i % 2 === 0 ? 'bg-panel-inset/60' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-1">
                  {s.keys.map((k, ki) => (
                    <span key={k} className="flex items-center gap-1">
                      {ki > 0 && (
                        <span className="text-[10px] text-muted-foreground">+</span>
                      )}
                      <Keycap>{k}</Keycap>
                    </span>
                  ))}
                </div>
                <span className="text-[12.5px] text-foreground/80">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </aside>
  )
}

function BuildingGroupCard({ building }: { building: BuildingGroup }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [portalInput, setPortalInput] = useState<{ from: string; to: string; def: string } | null>(null)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)

  const handleAddFloor = () => {
    playSfx('click')
    const nextOrdinal = (building.floors.at(-1)?.ordinal ?? 0) + 1
    const nextHeight = (building.floors.at(-1)?.height ?? 0) + 2
    addBuildingFloor(building.id, {
      ordinal: nextOrdinal,
      height: nextHeight,
      nodes: [],
      frame: { ...building.frame },
      image: undefined,
    })
    toast(`建筑 ${building.id} 新增楼层 F${nextOrdinal}`, 'ok')
  }

  const handleSelectFloor = (floor: BuildingFloor) => {
    playSfx('select')
    setSelectedFloorId(floor.id)
    selectOne('building', building.id)
  }

  const handlePickImage = (floorId: string) => () => {
    playSfx('click')
    fileRef.current?.click()
    // Bind current floor id by closure through dataset
    fileRef.current?.setAttribute('data-target-floor', floorId)
  }

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const targetFloorId = event.currentTarget.getAttribute('data-target-floor')
    if (!file || !targetFloorId) return
    const uploaded = await uploadPngFile(file)
    setBuildingFloorImage(building.id, targetFloorId, uploaded.dataUrl)
    toast(`已设置楼层图幅：${file.name}`, 'ok')
    event.currentTarget.value = ''
  }

  const handleBindPortal = (floorId: string) => () => {
    playSfx('click')
    if (portalInput && portalInput.from && portalInput.to) {
      bindBuildingPortal(building.id, {
        from: portalInput.from,
        to: portalInput.to,
        def: portalInput.def || 'portal:default',
      })
      setPortalInput(null)
    } else {
      setPortalInput({ from: floorId, to: '', def: 'portal:default' })
    }
  }

  return (
    <div
      data-ctx="building-group"
      data-building-id={building.id}
      className="rounded border border-border px-2 py-2"
    >
      <div className="flex items-center justify-between text-[11px] font-medium">
        <button
          onClick={() => {
            playSfx('select')
            selectOne('building', building.id)
          }}
          className="text-left"
        >
          {building.id}
        </button>
        <span className="font-mono text-muted-foreground">{building.floors.length} 层</span>
      </div>
      <div className="mt-1 flex flex-col gap-1 pl-2 text-[10px] text-muted-foreground">
        <span>外壳 · {building.shell}</span>
        {building.floors.map((floor) => (
          <div
            key={floor.id}
            data-ctx="building-floor"
            data-floor-id={floor.id}
            className={`flex flex-col gap-1 rounded px-1 py-1 ${selectedFloorId === floor.id ? 'bg-primary/10' : ''}`}
          >
            <button
              onClick={() => handleSelectFloor(floor)}
              className="flex justify-between text-left"
            >
              <span>↳ {floor.ordinal}F · h={floor.height}</span>
              {floor.image ? <span className="text-success">已绑定</span> : <span>无图幅</span>}
            </button>
            {selectedFloorId === floor.id ? (
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={handlePickImage(floor.id)}
                  className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-primary"
                >
                  设图幅
                </button>
                <button
                  onClick={() => {
                    playSfx('warning')
                    setBuildingFloorOrdinal(building.id, floor.id, Math.max(1, floor.ordinal - 1))
                  }}
                  className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-primary"
                >
                  上移层
                </button>
                <button
                  onClick={handleBindPortal(floor.id)}
                  className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-primary"
                >
                  绑入口
                </button>
                <button
                  onClick={() => {
                    playSfx('error')
                    removeBuildingFloor(building.id, floor.id)
                    setSelectedFloorId(null)
                  }}
                  className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-danger"
                >
                  移除
                </button>
                {portalInput?.from === floor.id ? (
                  <input
                    autoFocus
                    placeholder="to (floor id)"
                    value={portalInput.to}
                    onChange={(e) => setPortalInput({ ...portalInput, to: e.target.value })}
                    onBlur={() => portalInput.to && handleBindPortal(floor.id)()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && portalInput.to) handleBindPortal(floor.id)()
                    }}
                    className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-foreground"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <button
        onClick={handleAddFloor}
        data-ctx="add-building-floor"
        data-building-id={building.id}
        className="mt-2 flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
      >
        <IconPlus width={12} height={12} />
        新增楼层
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}
