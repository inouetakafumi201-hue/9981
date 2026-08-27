'use client'

import { useCallback, useRef, useState } from 'react'
import { CANVAS_SIZE, GRID_MIN_ZOOM, hexToRgba, rgbaToHex, type PainterTool } from '@/lib/painter-types'
import type { PixelEngine } from '@/lib/use-pixel-engine'

/**
 * 128×128 画布视口（§4.3）：内部分辨率固定 128×128，显示层用 CSS 缩放 +
 * pixelated 渲染（禁止模糊插值）。透明像素露出棋盘格；缩放 ≥4x 显示网格线；
 * 超出视口可滚动。支持指针连续绘制与方向键 + Enter 的键盘绘制两条路径。
 */
export function PainterCanvas({
  engine,
  tool,
  currentColor,
  zoom,
  onPickColor,
}: {
  engine: PixelEngine
  tool: PainterTool
  currentColor: string
  zoom: number
  onPickColor: (hex: string) => void
}) {
  const displaySize = CANVAS_SIZE * zoom
  const paintingRef = useRef(false)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const colorRgba = useCallback((): [number, number, number, number] => {
    if (tool === 'eraser') return [0, 0, 0, 0]
    return hexToRgba(currentColor, 255)
  }, [tool, currentColor])

  const applyAt = useCallback(
    (x: number, y: number) => {
      if (tool === 'eyedropper') {
        const px = engine.getPixel(x, y)
        if (px && px[3] > 0) onPickColor(rgbaToHex(px))
        return
      }
      engine.setPixel(x, y, colorRgba())
    },
    [tool, engine, colorRgba, onPickColor],
  )

  function coordsFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = rect.width / CANVAS_SIZE
    const x = Math.floor((e.clientX - rect.left) / scale)
    const y = Math.floor((e.clientY - rect.top) / scale)
    return { x: Math.min(CANVAS_SIZE - 1, Math.max(0, x)), y: Math.min(CANVAS_SIZE - 1, Math.max(0, y)) }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = coordsFromEvent(e)
    setCursor({ x, y })
    if (tool === 'eyedropper') {
      applyAt(x, y)
      return
    }
    paintingRef.current = true
    engine.beginStroke()
    applyAt(x, y)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = coordsFromEvent(e)
    setCursor({ x, y })
    if (!paintingRef.current || tool === 'eyedropper') return
    applyAt(x, y)
  }

  function onPointerUp() {
    paintingRef.current = false
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let { x, y } = cursor
    let moved = false
    if (e.key === 'ArrowUp') {
      y = Math.max(0, y - 1)
      moved = true
    } else if (e.key === 'ArrowDown') {
      y = Math.min(CANVAS_SIZE - 1, y + 1)
      moved = true
    } else if (e.key === 'ArrowLeft') {
      x = Math.max(0, x - 1)
      moved = true
    } else if (e.key === 'ArrowRight') {
      x = Math.min(CANVAS_SIZE - 1, x + 1)
      moved = true
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (tool !== 'eyedropper') engine.beginStroke()
      applyAt(x, y)
      return
    }
    if (moved) {
      e.preventDefault()
      setCursor({ x, y })
    }
  }

  const showGrid = zoom >= GRID_MIN_ZOOM
  const cursorPx = { left: cursor.x * zoom, top: cursor.y * zoom, size: zoom }

  return (
    <div
      ref={wrapRef}
      className="scroll-thin chamfer hud-b relative min-h-0 flex-1 overflow-auto"
      style={{ ['--hud-bc' as string]: 'var(--lib-line)', background: 'var(--lib-inset)' }}
    >
      <div className="flex min-h-full min-w-full items-center justify-center p-4">
        <div
          role="application"
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="像素画布，128 乘 128，方向键移动光标，Enter 落笔"
          className="relative outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cyan)]"
          style={{ width: displaySize, height: displaySize }}
        >
          {/* 透明棋盘格底 */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'conic-gradient(#2a3540 90deg, #1c242c 90deg 180deg, #2a3540 180deg 270deg, #1c242c 270deg)',
              backgroundSize: `${Math.max(8, zoom * 2)}px ${Math.max(8, zoom * 2)}px`,
            }}
          />
          <canvas
            ref={engine.canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="absolute inset-0 [image-rendering:pixelated]"
            style={{ width: displaySize, height: displaySize, touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {/* 网格线：缩放 ≥4x 才显示，避免噪点 */}
          {showGrid && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent ' +
                  zoom +
                  'px), repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent ' +
                  zoom +
                  'px)',
              }}
            />
          )}
          {/* 键盘光标指示 */}
          <div
            className="pointer-events-none absolute border border-[color:var(--cyan)]"
            style={{
              left: cursorPx.left,
              top: cursorPx.top,
              width: cursorPx.size,
              height: cursorPx.size,
              boxShadow: '0 0 6px -1px var(--cyan)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
