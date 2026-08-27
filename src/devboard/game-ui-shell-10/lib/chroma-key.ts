'use client'

// Canvas-based chroma-key: strips a solid key color (the magenta #ff00ff
// backing plate every current character sheet ships with) out of a raster
// image and returns a transparent PNG data URL. This is a client-only
// pixel operation — there is no way to get real per-pixel alpha out of a
// baked-in magenta background with CSS filters/blend-modes alone, so every
// sprite frame that still has a solid-color backing plate must pass through
// here once before it is ever displayed.
//
// B7-05 更新：
//  1) 解码产物现在存进共享的 LRU `bitmapCache`（lib/bitmap-cache.ts）而不是本文件里的
//     无界 Map——等价像素内存被钉在 256MB 上限内，回收最旧，杜绝会话内单调增长。
//  2) fetch/decode 三段分离：优先用 `createImageBitmap`（可离主线程解码），不可用时退回
//     `new Image()` + `img.decode()`（把解码从 drawImage 的同步路径里挪走，避免解码卡在
//     渲染关键帧内造成长帧与「从上往下刷」的渐进解码可见）。
//  3) 暴露同步的 `peekKeyedSprite`：命中缓存即可在首帧同步拿到 data URL，让预加载过的
//     sprite 挂载时零 pop-in（不再先渲染一个空占位再异步补上）。

import { bitmapCache } from '@/lib/bitmap-cache'

export type ChromaKeyOptions = {
  /** [r,g,b] of the color to remove. Defaults to pure magenta. */
  keyColor?: [number, number, number]
  /** Magenta-excess (see below) at/under which a pixel is left untouched. */
  minExcess?: number
  /** Magenta-excess at/over which a pixel is fully removed. Everything
   *  between minExcess and maxExcess ramps smoothly. */
  maxExcess?: number
  /** Unmix the key color out of partially-kept edge pixels instead of just
   *  fading their alpha, so no magenta tint survives the ramp. */
  despill?: boolean
}

const DEFAULTS: Required<ChromaKeyOptions> = {
  keyColor: [255, 0, 255],
  minExcess: 8,
  maxExcess: 195,
  despill: true,
}

/** 去重并发解码：同一 key 的解码只跑一次，后续调用共享同一个 Promise。 */
const inflight = new Map<string, Promise<string>>()

/** 缓存键：src + 全部选项。两个组件用相同选项请求同一帧 → 命中同一条缓存。 */
export function chromaKeyCacheKey(src: string, options?: ChromaKeyOptions): string {
  const opts = { ...DEFAULTS, ...options }
  return `${src}::${opts.keyColor.join(',')}::${opts.minExcess}::${opts.maxExcess}::${opts.despill}`
}

/**
 * 同步探测：解码产物是否已在 LRU 缓存里。命中返回 data URL，否则 undefined。
 * 预加载编排（B7-05 PreloadScheduler）在揭幕前把关键帧灌进缓存，消费组件用这个在
 * 首帧同步取到结果，避免「空占位 → 异步补图」的一帧 pop-in。
 */
export function peekKeyedSprite(src: string, options?: ChromaKeyOptions): string | undefined {
  return bitmapCache.peek(chromaKeyCacheKey(src, options))
}

/** 三段流水线的 fetch+decode 段：优先 createImageBitmap，退回 Image + decode()。 */
async function decodeSource(src: string): Promise<CanvasImageSource & { width: number; height: number }> {
  // createImageBitmap 可把解码放到浏览器内部线程，主线程只拿到已解码位图。
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    try {
      const res = await fetch(src, { cache: 'force-cache' })
      if (res.ok) {
        const blob = await res.blob()
        const bitmap = await createImageBitmap(blob)
        return bitmap
      }
    } catch {
      // 落到 Image 路径
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = async () => {
      // 显式 decode()：确保像素解码在 drawImage 之前完成，而不是卡在同步绘制里。
      try {
        if (typeof img.decode === 'function') await img.decode()
      } catch {
        // decode() 失败不致命，drawImage 仍可工作
      }
      resolve(img)
    }
    img.onerror = () => reject(new Error(`chroma-key: failed to load ${src}`))
    img.src = src
  })
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function clampByte(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

export function chromaKeySprite(src: string, options?: ChromaKeyOptions): Promise<string> {
  const opts = { ...DEFAULTS, ...options }
  const cacheKey = chromaKeyCacheKey(src, options)

  // 1) LRU 缓存命中：直接返回，零解码。
  const cached = bitmapCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)

  // 2) 正在解码：共享在途 Promise，避免同帧重复解码同一张图。
  const pending = inflight.get(cacheKey)
  if (pending) return pending

  const promise = (async () => {
    if (typeof document === 'undefined') return src
    const source = await decodeSource(src)
    const w = source.width
    const h = source.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return src
    ctx.drawImage(source, 0, 0)
    // createImageBitmap 产物用完即释放显存
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()

    const { data } = ctx.getImageData(0, 0, w, h)
    const [kr, kg, kb] = opts.keyColor
    const { minExcess, maxExcess, despill } = opts
    const range = Math.max(1, maxExcess - minExcess)

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      // "Magenta excess": how much a pixel's red/blue channels dominate its
      // green channel beyond what's plausible for real foreground art. Pure
      // key color scores 255. Crucially, anti-aliased blends between the
      // magenta plate and the sprite's dark outline (e.g. a near-black
      // silhouette edge) still score high here even though they land far
      // from pure magenta in plain RGB distance — mixing magenta with black
      // darkens a pixel without moving R/B below G. A Euclidean
      // distance-to-pure-magenta check misses exactly this halo; this metric
      // catches it.
      const excess = Math.min(r, b) - g
      if (excess <= minExcess) continue

      const alpha = 1 - clamp01((excess - minExcess) / range)
      data[i + 3] = Math.round((data[i + 3] / 255) * alpha * 255)

      if (despill && alpha > 0.004) {
        // Unmix the key color's contribution assuming the observed pixel is
        // C = alpha*foreground + (1-alpha)*key, so no magenta tint survives
        // on the semi-transparent edge ring.
        const inv = 1 - alpha
        data[i] = clampByte((r - inv * kr) / alpha)
        data[i + 1] = clampByte((g - inv * kg) / alpha)
        data[i + 2] = clampByte((b - inv * kb) / alpha)
      }
    }

    ctx.putImageData(new ImageData(data, w, h), 0, 0)
    const url = canvas.toDataURL('image/png')
    // 3) 写入 LRU：按等价像素内存记账（w*h*4），超上限回收最旧。
    bitmapCache.set(cacheKey, url, w * h * 4)
    return url
  })()
    .catch(() => src)
    .finally(() => {
      inflight.delete(cacheKey)
    })

  inflight.set(cacheKey, promise)
  return promise
}
