'use client'

import { useEffect, useRef, useState } from 'react'
import { chromaKeySprite, peekKeyedSprite, type ChromaKeyOptions } from '@/lib/chroma-key'

// 首帧同步种子：任何已被 B7-05 预加载编排灌进 LRU 缓存的帧，挂载时直接命中，state 从
// 第一帧就带着 data URL——不再先渲染空占位再异步补上，消除预加载过的 sprite 的一帧 pop-in。
function seedFromCache(frameSrcs: string[], options?: ChromaKeyOptions): Record<string, string> {
  const seed: Record<string, string> = {}
  for (const src of frameSrcs) {
    const cached = peekKeyedSprite(src, options)
    if (cached) seed[src] = cached
  }
  return seed
}

/**
 * Runs every frame of a character sheet through the magenta chroma-key pass
 * once, up front, and hands back a lookup table of the resulting transparent
 * data URLs. Every consumer (title-screen sprite, room avatar, future
 * characters) shares the same module-level cache in lib/chroma-key.ts, so
 * this only ever costs real work on the very first mount of a given sheet.
 *
 * `ready` stays false until every frame has resolved so callers can hold a
 * silhouette/placeholder instead of flashing a raw magenta frame while the
 * canvas pass runs.
 */
export function useKeyedSpriteFrames(frameSrcs: string[], options?: ChromaKeyOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  // 惰性初始化直接读缓存：预加载过的帧首帧即就绪，未预加载的走下方异步补齐。
  const [frames, setFrames] = useState<Record<string, string>>(() => seedFromCache(frameSrcs, options))

  useEffect(() => {
    let alive = true
    // 命中缓存的帧先同步合并进来，避免 effect 首次运行前的空窗
    setFrames((prev) => ({ ...seedFromCache(frameSrcs, optionsRef.current), ...prev }))
    Promise.all(frameSrcs.map((src) => chromaKeySprite(src, optionsRef.current).then((url) => [src, url] as const))).then(
      (pairs) => {
        if (!alive) return
        setFrames((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
      },
    )
    return () => {
      alive = false
    }
    // frameSrcs is expected to be a stable/derived array per caller (built
    // from constant frame-id lists), so join() is a cheap, correct dep key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSrcs.join('|')])

  const ready = frameSrcs.length > 0 && frameSrcs.every((src) => src in frames)
  return { frames, ready }
}
