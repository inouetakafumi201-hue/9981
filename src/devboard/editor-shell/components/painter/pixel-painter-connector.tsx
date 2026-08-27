'use client'

/* =========================================================================
   PixelPainter —— 唯一的真实接线层（对齐 Spec §七 端口映射表）。

   全局挂载一次（app/page.tsx）。本文件是**唯一**知道「素材库/研究台/元状态层」
   存在的地方：负责把 painter-store 的开关状态、library-store 的只读贴图投影
   /写动作通道，接到纯组件 PixelPainterOverlay 的五个 props 上。组件本体
   （pixel-painter-overlay.tsx）不 import 这里的任何东西。
   ========================================================================= */

import { usePainterNav, closePixelPainter } from '@editor/lib/painter-store'
import { useLibApp, materialTexture, materialSetTexture } from '@editor/lib/library-store'
import { materialMetaById } from '@editor/lib/library-data'
import { PixelPainterOverlay } from './pixel-painter-overlay'

export function PixelPainter() {
  const open = usePainterNav((s) => s.open)
  const materialId = usePainterNav((s) => s.materialId)
  // 订阅 textures 投影，保证素材被改绘后 initialTexture 跟着刷新
  useLibApp((s) => s.textures)

  const id = materialId ?? ''
  const meta = id ? materialMetaById(id) : null
  const initialTexture = id ? materialTexture(id) : null

  return (
    <PixelPainterOverlay
      open={open && !!materialId}
      materialId={id}
      materialName={meta?.name}
      initialTexture={initialTexture}
      onClose={closePixelPainter}
      onSave={({ materialId: mid, texture }) => {
        materialSetTexture(mid, texture)
        closePixelPainter()
      }}
    />
  )
}
