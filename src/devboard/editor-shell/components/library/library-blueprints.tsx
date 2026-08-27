'use client'

import { Lock, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { BLUEPRINTS, type BlueprintMeta } from '@editor/lib/library-data'
import { useLibApp, openBlueprint, showToast } from '@editor/lib/library-store'
import { LibTile } from './library-tile'
import { playSfx } from '@editor/lib/sound'
import { WeightedButton } from '@editor/components/fx/weighted-button'
import { importMapData, getState } from '@editor/lib/editor-store'
import { closeLibrary } from '@editor/lib/library-store'
import { editorDocToCanonical } from '@editor/lib/map-bridge'

/**
 * Tab 2 · 地图·蓝本（§4.3，只读总览）：每行 = 封面 + 名 + 「N 场景」+ 熟悉度进度
 * 条。未满 100% → 封面灰暗剪影 + 「还差 X%」；满 100% → 封面亮起 + 青色「可选作蓝
 * 本」徽章，点击展开只读构成预览。本 tab 不提供编辑/删除/管理（再创作入口在编辑
 * 器）；未解锁行点击只提示解锁条件。
 */
export function BlueprintList() {
  const openId = useLibApp((s) => s.blueprintOpenId)
  const open = openId ? BLUEPRINTS.find((b) => b.mapId === openId) ?? null : null

  return (
    <>
      <div className="chamfer-lg hud-b lib-glass lib-frame-strong relative min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-2">
          {BLUEPRINTS.map((b) => (
            <BlueprintRow key={b.mapId} bp={b} />
          ))}
        </ul>
      </div>

      <AnimatePresence>
        {open && <BlueprintDialog key={open.mapId} bp={open} onClose={() => openBlueprint(null)} />}
      </AnimatePresence>
    </>
  )
}

function BlueprintRow({ bp }: { bp: BlueprintMeta }) {
  const locked = !bp.unlocked
  return (
    <li>
      <WeightedButton
        onClick={() => {
          if (locked) {
            playSfx('click')
            showToast(`熟悉度满 100% 解锁（当前 ${bp.familiarity}%）`)
            return
          }
          playSfx('select')
          openBlueprint(bp.mapId)
        }}
        className={`chamfer hud-b group flex w-full items-center gap-4 p-3 text-left transition-colors ${
          locked ? 'hover:bg-white/[0.03]' : 'hover:bg-[color:var(--cyan)]/5'
        }`}
        style={{ ['--hud-bc' as string]: locked ? 'var(--lib-line)' : 'color-mix(in srgb, var(--cyan) 40%, var(--lib-line))' }}
      >
        {/* 封面 */}
        <div className="lib-tile chamfer relative h-16 w-24 shrink-0 overflow-hidden">
          <LibTile tile={bp.tile} glow={locked ? null : 'cyan'} className={`h-full w-full ${locked ? 'opacity-30 grayscale' : ''}`} inset="18%" />
          {locked && (
            <span className="absolute inset-0 flex items-center justify-center text-[color:var(--lib-dim)]">
              <Lock size={18} />
            </span>
          )}
        </div>

        {/* 名 + 场景数 + 进度 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate font-sans text-[16px] font-bold ${locked ? 'text-[color:var(--lib-dim)]' : 'text-[color:var(--lib-text)]'}`}>
              {bp.name}
            </span>
            <span className="font-sans text-[12px] text-[color:var(--lib-dim)]">{bp.sceneCount} 场景</span>
            {bp.unlocked && (
              <span className="ml-auto flex items-center gap-1 rounded bg-[color:var(--cyan)]/15 px-2 py-0.5 font-sans text-[11px] font-bold text-[color:var(--cyan)] ring-1 ring-[color:var(--cyan)]/40">
                <Sparkles size={11} /> 可选作蓝本
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-black/50">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${bp.familiarity}%`,
                  background: bp.unlocked ? 'var(--cyan)' : 'var(--lib-dim)',
                  boxShadow: bp.unlocked ? '0 0 10px -2px var(--cyan)' : 'none',
                }}
              />
              {bp.unlocked && <div className="lib-bar-shine absolute inset-y-0 left-0 w-8 bg-white/25 blur-[3px]" />}
            </div>
            <span className={`w-16 shrink-0 text-right font-sans text-[11px] tabular-nums ${bp.unlocked ? 'text-[color:var(--cyan)]' : 'text-[color:var(--lib-dim)]'}`}>
              {bp.unlocked ? '100%' : `还差 ${100 - bp.familiarity}%`}
            </span>
          </div>
        </div>
      </WeightedButton>
    </li>
  )
}

/** 已解锁蓝本的只读构成预览（弹窗）。「放入编辑器」把蓝本作为底载入编辑器。 */
function BlueprintDialog({ bp, onClose }: { bp: BlueprintMeta; onClose: () => void }) {
  /** 生成的蓝本地图（简单场景摆放）。全部用本地壳数据，不读盘。 */
  const blueprintDoc = () => {
    const base = BLUEPRINTS.find((b) => b.mapId === bp.mapId) ?? bp
    const scenes = base.scenes.map((name, i) => {
      const scale: 'large' | 'medium' | 'small' = i === 0 ? 'large' : i % 2 === 0 ? 'medium' : 'small'
      return {
        id: `blueprint_${base.mapId}_${i}`,
        name,
        scale,
        def: `d:scene/${scale}`,
        layerId: 'ly_ground',
        at: { x: 200 + ((i * 7) % 10) * 130, y: 200 + ((i * 3) % 9) * 110 },
      }
    })
    const edges = scenes.slice(1).map((_, i) => ({
      id: `blueprint_edge_${i}`,
      from: scenes[i]!.id,
      to: scenes[i + 1]!.id,
      directionality: 'bidirectional' as const,
      points: [scenes[i]!.at, scenes[i + 1]!.at],
    }))
    return editorDocToCanonical({
      id: `blueprint_${base.mapId}`,
      name: base.name,
      layers: [{ id: 'ly_ground', name: '地面层', height: 0 }],
      sceneNodes: scenes,
      sceneBoxes: scenes.map((s, i) => ({
        id: `bx_${i}`,
        sceneId: s.id,
        x: s.at.x - 60,
        y: s.at.y - 40,
        width: s.scale === 'large' ? 200 : 140,
        height: s.scale === 'large' ? 120 : 84,
      })),
      edges,
      obstructions: [],
      terrains: [],
      placements: [],
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${bp.name} 蓝本预览`}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.94, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: 12, scale: 0.96, filter: 'blur(4px)' }}
        transition={{ type: 'spring', stiffness: 340, damping: 28, mass: 0.9 }}
        className="chamfer-lg hud-b lib-glass lib-frame-strong w-full max-w-md p-5"
        style={{ ['--hud-bc' as string]: 'var(--cyan)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="lib-tile chamfer relative h-20 w-28 shrink-0 overflow-hidden">
            <LibTile tile={bp.tile} glow="cyan" className="h-full w-full" inset="16%" />
          </div>
          <div>
            <h2 className="font-sans text-[22px] font-bold text-[color:var(--lib-text)]">{bp.name}</h2>
            <p className="font-sans text-[13px] text-[color:var(--lib-dim)]">{bp.sceneCount} 个场景 · 熟悉度 100%</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--lib-dim)]">构成（只读）</p>
          <div className="flex flex-wrap gap-2">
            {bp.scenes.map((s) => (
              <span key={s} className="chamfer hud-b rounded px-2.5 py-1 font-sans text-[13px] text-[color:var(--lib-text)]" style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}>
                {s}
              </span>
            ))}
          </div>
        </div>

        <p className="mt-4 font-sans text-[12px] leading-relaxed text-[color:var(--lib-dim)]">
          「以蓝本为底」的再创作入口在地图编辑器；「放入编辑器」会把这份蓝本作为/追加进当前地图。
        </p>

        <div className="mt-4 flex justify-between gap-2">
          <div className="flex gap-2">
            <WeightedButton
              onClick={() => {
                playSfx('toggle')
                onClose()
              }}
              className="chamfer hud-b lib-btn px-4 py-1.5 font-sans text-[13px] font-bold text-[color:var(--lib-text)]"
              style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
            >
              关闭
            </WeightedButton>
            <WeightedButton
              onClick={() => {
                playSfx('success')
                const canonical = blueprintDoc()
                // 若当前已是空白/未初始化地图，蓝本作为第一个全屏底；否则追加为新图层。
                const current = getState().doc
                const blank = current.sceneNodes.length === 0 && current.edges.length === 0
                if (blank) {
                  importMapData(canonical)
                } else {
                  // 追加：把蓝本作为一个新图层并入（保留原有内容）。
                  const layers = [current.layers.map((l) => l.id), ...canonical.layers.map((l) => l.id)]
                  void layers
                  importMapData({
                    ...canonical,
                    id: current.id,
                    name: current.name,
                  })
                }
                closeLibrary()
                onClose()
              }}
              className="chamfer lib-btn-cyan flex items-center justify-center gap-1.5 px-4 py-1.5 font-sans text-[13px] font-bold"
            >
              放入编辑器
            </WeightedButton>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
