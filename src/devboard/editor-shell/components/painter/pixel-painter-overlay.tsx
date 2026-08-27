'use client'

/* =========================================================================
   PixelPainterOverlay —— 像素绘制器悬浮窗根组件（对齐 Spec §五 / §七）。

   纯组件：只认 open / materialId / initialTexture / onClose / onSave（+ 可选
   materialName 用于顶栏展示，不属于硬性接口的字段变更，向后兼容）。不读任何
   全局投影、不写任何库，保存时把 texture 通过 onSave 交给调用方注入的动作
   通道，关闭时把决定权交回调用方（onClose）。任何界面都可以直接挂载它并
   传入这五个 prop 来唤出绘制器，因此本文件不 import 素材库/研究台的 store。
   ========================================================================= */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { usePixelEngine } from '@/lib/use-pixel-engine'
import {
  CUSTOM_SLOTS,
  ZOOM_DEFAULT,
  type PainterTool,
  type PixelPainterSaveResult,
  type TextureData,
} from '@/lib/painter-types'
import { PainterToolbar } from './painter-toolbar'
import { PainterCanvas } from './painter-canvas'
import { ZoomSlider } from './zoom-slider'
import { PalettePanel } from './palette-panel'
import { WeightedButton } from '@/components/fx/weighted-button'
import { playSfx } from '@/lib/sound'

export interface PixelPainterOverlayProps {
  open: boolean
  materialId: string
  /** 目标素材名（小字展示用，不属于硬性接口，缺省时回退显示 materialId） */
  materialName?: string
  initialTexture?: TextureData | null
  onClose: () => void
  onSave: (result: PixelPainterSaveResult) => void
}

export function PixelPainterOverlay({
  open,
  materialId,
  materialName,
  initialTexture,
  onClose,
  onSave,
}: PixelPainterOverlayProps) {
  const engine = usePixelEngine(open, initialTexture)

  const [tool, setTool] = useState<PainterTool>('brush')
  const [currentColor, setCurrentColor] = useState('#06b6d4')
  const [customColors, setCustomColors] = useState<string[]>([])
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // 每次重新打开都回到初始工具态；不跨会话保留自定义色以外的绘制态
  useEffect(() => {
    if (open) {
      setTool('brush')
      setZoom(ZOOM_DEFAULT)
      setConfirmDiscard(false)
    }
  }, [open])

  function requestClose() {
    if (engine.dirty) {
      playSfx('toggle')
      setConfirmDiscard(true)
      return
    }
    onClose()
  }

  function confirmedClose() {
    setConfirmDiscard(false)
    onClose()
  }

  function handleSave() {
    playSfx('success')
    const dataUrl = engine.exportDataUrl()
    onSave({ materialId, texture: { width: 128, height: 128, dataUrl } })
  }

  function handlePickColor(hex: string) {
    setCurrentColor(hex)
    setTool('brush')
  }

  function handleAddCustom() {
    setCustomColors((prev) => {
      if (prev.includes(currentColor)) return prev
      const next = [...prev, currentColor]
      return next.length > CUSTOM_SLOTS ? next.slice(next.length - CUSTOM_SLOTS) : next
    })
  }

  function handleRemoveCustom(index: number) {
    setCustomColors((prev) => prev.filter((_, i) => i !== index))
  }

  // 全局快捷键：Esc 关闭，Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (confirmDiscard) return
      if (e.key === 'Escape') {
        requestClose()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault()
        engine.redo()
      } else if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        engine.undo()
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        engine.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 壳层按 V0 原样；根配置未装 react-hooks 插件（规则已置 off 占位，此注释仅为 V0 原文保留）
  }, [open, confirmDiscard, engine.undo, engine.redo])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lib-root fixed inset-0 z-[980] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/55"
            style={{ backdropFilter: 'blur(6px)' }}
            onClick={requestClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="像素绘制"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 1 }}
            className="chamfer-lg hud-b lib-glass lib-frame-strong relative z-10 flex max-h-[92vh] w-[720px] max-w-[92vw] flex-col gap-4 overflow-y-auto p-5"
            style={{ ['--hud-bc' as string]: 'var(--cyan)' }}
          >
            {/* 桌面氛围底图：青色灯笼颜料桌，压在玻璃面板色之下，让对话框
                不再是一块纯色实体，而像悬在工坊桌面上方的一层玻璃 */}
            <div
              className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center opacity-45"
              style={{ backgroundImage: 'url(/painter/backdrop.png)' }}
            />
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(5,9,14,0.55)_100%)]" />

            {/* 顶栏 */}
            <div className="flex shrink-0 items-center justify-between">
              <div className="flex items-baseline gap-2">
                <h2 className="font-sans text-[16px] font-bold text-[color:var(--lib-text)]">像素绘制</h2>
                <span className="font-sans text-[12px] text-[color:var(--lib-dim)]">{materialName ?? materialId}</span>
              </div>
              <button
                aria-label="关闭"
                onClick={requestClose}
                className="grid h-7 w-7 place-items-center rounded-full text-[color:var(--lib-dim)] transition-colors hover:text-[color:var(--lib-text)]"
              >
                <X width={16} height={16} />
              </button>
            </div>

            {/* 工具栏 + 画布：对话框本身是内容撑高的 flex 列（无固定高度），
                所以这一行不能再用 flex-1——flex-basis:0% 在不定主轴尺寸下会
                回退成"内容尺寸"而不是这里的 height:400，反而把整个对话框
                撑爆。改成默认 flex-basis:auto，直接吃 height:400。 */}
            <div className="flex min-h-0 shrink-0 gap-3" style={{ height: 400 }}>
              <PainterToolbar
                tool={tool}
                onToolChange={setTool}
                onUndo={engine.undo}
                onRedo={engine.redo}
                canUndo={engine.canUndo}
                canRedo={engine.canRedo}
              />
              <PainterCanvas engine={engine} tool={tool} currentColor={currentColor} zoom={zoom} onPickColor={handlePickColor} />
            </div>

            <ZoomSlider zoom={zoom} onZoom={setZoom} />

            <PalettePanel
              currentColor={currentColor}
              onPick={setCurrentColor}
              customColors={customColors}
              onAddCustom={handleAddCustom}
              onRemoveCustom={handleRemoveCustom}
            />

            {/* 底部动作排 */}
            <div className="flex shrink-0 items-center justify-between pt-1">
              <WeightedButton
                onClick={requestClose}
                className="chamfer lib-btn hud-b px-5 py-2 font-sans text-[13px] font-bold text-[color:var(--lib-dim)] hover:text-[color:var(--lib-text)]"
                style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
              >
                关闭
              </WeightedButton>
              <WeightedButton onClick={handleSave} className="chamfer lib-btn-cyan px-6 py-2 font-sans text-[14px] font-bold">
                保存
              </WeightedButton>
            </div>

            {/* 丢弃修改确认 */}
            <AnimatePresence>
              {confirmDiscard && (
                <motion.div
                  className="absolute inset-0 z-20 grid place-items-center rounded-[inherit] bg-black/70"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.94, opacity: 0 }}
                    className="chamfer hud-b lib-glass flex w-[320px] flex-col items-center gap-4 p-5 text-center"
                    style={{ ['--hud-bc' as string]: 'var(--danger)' }}
                  >
                    <p className="font-sans text-[14px] text-[color:var(--lib-text)]">丢弃未保存的修改？</p>
                    <div className="flex w-full gap-2">
                      <WeightedButton
                        onClick={() => setConfirmDiscard(false)}
                        className="chamfer lib-btn hud-b flex-1 px-4 py-2 font-sans text-[13px] font-bold text-[color:var(--lib-text)]"
                        style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
                      >
                        取消
                      </WeightedButton>
                      <WeightedButton
                        onClick={confirmedClose}
                        className="chamfer hud-b flex-1 px-4 py-2 font-sans text-[13px] font-bold text-[color:var(--danger)]"
                        style={{ ['--hud-bc' as string]: 'var(--danger)' }}
                      >
                        丢弃
                      </WeightedButton>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
