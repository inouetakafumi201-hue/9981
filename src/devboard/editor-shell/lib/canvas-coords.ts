'use client'

/* =========================================================================
   画布坐标转换 — 屏幕像素 <-> 世界单位
   通过注册 SVG 元素，跨组件（画布/右栏素材拖拽）共享坐标换算与命中检测。
   ========================================================================= */

import type { Vec } from './map-types'
import { pointInRect } from './geometry'
import { getState } from './editor-store'

let svgEl: SVGSVGElement | null = null

export function registerCanvas(el: SVGSVGElement | null) {
  svgEl = el
}

export function screenToWorld(clientX: number, clientY: number): Vec | null {
  if (!svgEl) return null
  const pt = svgEl.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svgEl.getScreenCTM()
  if (!ctm) return null
  const w = pt.matrixTransform(ctm.inverse())
  return { x: w.x, y: w.y }
}

/** 命中光标下的任一场景显示矩形，返回其所属的 sceneId（逻辑节点 id，
 *  不是矩形 id）——一个场景可能有多个成员框，命中任意一个都等价于命中
 *  整个场景节点。 */
export function sceneIdAtPoint(world: Vec): string | null {
  const { doc } = getState()
  // top-most first
  for (let i = doc.sceneBoxes.length - 1; i >= 0; i--) {
    const box = doc.sceneBoxes[i]
    if (box && pointInRect(world, box)) return box.sceneId
  }
  return null
}

export function isOverCanvas(clientX: number, clientY: number): boolean {
  if (!svgEl) return false
  const r = svgEl.getBoundingClientRect()
  return (
    clientX >= r.left &&
    clientX <= r.right &&
    clientY >= r.top &&
    clientY <= r.bottom
  )
}

/** 世界单位 / 屏幕像素 的换算比例。用于让命中半径、手柄尺寸等在任意缩放
 *  级别下保持恒定的屏幕像素大小——viewBox 缩放时世界单位对应的像素数会
 *  变化，命中判定若固定用世界单位阈值，缩小时会变得极难点中（这正是折点
 *  拖拽"敏感度低"的根因）。用法：`radiusPx * worldPerPixel()` 得到应在
 *  当前缩放下使用的世界单位半径。 */
export function worldPerPixel(): number {
  if (!svgEl) return 1
  const r = svgEl.getBoundingClientRect()
  if (r.width <= 0) return 1
  return getState().camera.w / r.width
}
