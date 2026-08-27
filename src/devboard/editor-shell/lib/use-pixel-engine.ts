'use client'

/* =========================================================================
   usePixelEngine —— 128×128 像素位图的命令式引擎。

   像素级绘制走 requestAnimationFrame 量级的高频更新，不适合把每个像素塞进
   React state（会疯狂重渲染）。这里用一个 Uint8ClampedArray 位图 + 撤销栈
   （整幅快照，上限 50 步，§十一技术建议）做命令式源，只在「笔触结束 /
   撤销重做 / 载入底图」这些离散时刻才 setState 一次去刷新依赖它的按钮
   （撤销/重做可用态、脏标记）。
   ========================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CANVAS_SIZE, HISTORY_LIMIT, type TextureData } from './painter-types'

function blankBuffer(): Uint8ClampedArray {
  return new Uint8ClampedArray(CANVAS_SIZE * CANVAS_SIZE * 4)
}

function loadTextureIntoBuffer(dataUrl: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const off = document.createElement('canvas')
      off.width = CANVAS_SIZE
      off.height = CANVAS_SIZE
      const ctx = off.getContext('2d')
      if (!ctx) {
        reject(new Error('no-2d-context'))
        return
      }
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
      ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
      resolve(new Uint8ClampedArray(ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data))
    }
    img.onerror = () => reject(new Error('image-load-failed'))
    img.src = dataUrl
  })
}

export function usePixelEngine(isOpen: boolean, initialTexture: TextureData | null | undefined) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bufferRef = useRef<Uint8ClampedArray>(blankBuffer())
  const historyRef = useRef<Uint8ClampedArray[]>([])
  const redoRef = useRef<Uint8ClampedArray[]>([])

  const [dirty, setDirty] = useState(false)
  const [rev, setRev] = useState(0) // 撤销栈变化时递增，驱动撤销/重做按钮可用态刷新

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(bufferRef.current), CANVAS_SIZE, CANVAS_SIZE), 0, 0)
  }, [])

  const reset = useCallback(
    (texture: TextureData | null | undefined) => {
      historyRef.current = []
      redoRef.current = []
      setDirty(false)
      setRev((r) => r + 1)
      if (texture?.dataUrl) {
        loadTextureIntoBuffer(texture.dataUrl)
          .then((buf) => {
            bufferRef.current = buf
            draw()
          })
          .catch(() => {
            bufferRef.current = blankBuffer()
            draw()
          })
      } else {
        bufferRef.current = blankBuffer()
        draw()
      }
    },
    [draw],
  )

  // 每次打开都重新铺底：有底图铺底图，没有就空画布（§4.5，不清洗、不判定）
  useEffect(() => {
    if (isOpen) reset(initialTexture)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 壳层按 V0 原样；根配置未装 react-hooks 插件（规则已置 off 占位，此注释仅为 V0 原文保留）
  }, [isOpen])

  const setPixel = useCallback(
    (x: number, y: number, rgba: [number, number, number, number]) => {
      if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return
      const i = (y * CANVAS_SIZE + x) * 4
      bufferRef.current[i] = rgba[0]
      bufferRef.current[i + 1] = rgba[1]
      bufferRef.current[i + 2] = rgba[2]
      bufferRef.current[i + 3] = rgba[3]
      draw()
      setDirty(true)
    },
    [draw],
  )

  const getPixel = useCallback((x: number, y: number): [number, number, number, number] | null => {
    if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return null
    const i = (y * CANVAS_SIZE + x) * 4
    const b = bufferRef.current
    const r = b[i]
    const g = b[i + 1]
    const blue = b[i + 2]
    const alpha = b[i + 3]
    if (r === undefined || g === undefined || blue === undefined || alpha === undefined) return null
    return [r, g, blue, alpha]
  }, [])

  /** 每次落笔/擦除开始前调用一次，把「笔触前」的整幅快照入栈（撤销单位=一次笔触）。 */
  const beginStroke = useCallback(() => {
    historyRef.current.push(new Uint8ClampedArray(bufferRef.current))
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift()
    redoRef.current = []
    setRev((r) => r + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = historyRef.current.pop()
    if (!prev) return
    redoRef.current.push(new Uint8ClampedArray(bufferRef.current))
    bufferRef.current = prev
    draw()
    setDirty(true)
    setRev((r) => r + 1)
  }, [draw])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    historyRef.current.push(new Uint8ClampedArray(bufferRef.current))
    bufferRef.current = next
    draw()
    setDirty(true)
    setRev((r) => r + 1)
  }, [draw])

  const exportDataUrl = useCallback((): string => {
    const off = document.createElement('canvas')
    off.width = CANVAS_SIZE
    off.height = CANVAS_SIZE
    const ctx = off.getContext('2d')
    if (!ctx) return ''
    ctx.putImageData(new ImageData(new Uint8ClampedArray(bufferRef.current), CANVAS_SIZE, CANVAS_SIZE), 0, 0)
    return off.toDataURL('image/png')
  }, [])

  return {
    canvasRef,
    size: CANVAS_SIZE,
    dirty,
    setPixel,
    getPixel,
    beginStroke,
    undo,
    redo,
    canUndo: historyRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    exportDataUrl,
    draw,
    rev,
  }
}

export type PixelEngine = ReturnType<typeof usePixelEngine>
