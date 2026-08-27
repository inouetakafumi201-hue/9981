'use client'

/* =========================================================================
   像素绘制器 —— 打开状态导航 slice。

   与 library-store / bench-store 同构（模块级可变 state + useSyncExternalStore），
   但**故意保持极简**：绘制器是独立、高度解耦的悬浮窗，不属于素材库或研究台任何
   一个界面，这里只记录「开不开 + 画哪个素材」，绝不掺入画笔/颜色/缩放等绘制态
   （那些是组件自持的纯局部状态，见 pixel-painter-overlay.tsx）。

   任何界面只需 `openPixelPainter(materialId)` 就能唤出悬浮窗，组件本身不关心
   调用方是谁——这正是 spec §一「解耦」的落点。
   ========================================================================= */

import { useSyncExternalStore } from 'react'

interface PainterNav {
  open: boolean
  materialId: string | null
}

let nav: PainterNav = { open: false, materialId: null }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** 唤出绘制器悬浮窗，目标素材 id 由调用方指定。 */
export function openPixelPainter(materialId: string) {
  nav = { open: true, materialId }
  emit()
}

/** 关闭悬浮窗（丢弃未保存修改的确认由组件内部处理，这里只负责真正的开关）。 */
export function closePixelPainter() {
  nav = { ...nav, open: false }
  emit()
}

export function usePainterNav<T>(selector: (s: PainterNav) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selector(nav),
    () => selector(nav),
  )
}
