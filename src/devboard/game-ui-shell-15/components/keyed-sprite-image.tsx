'use client'

// Static (non-animated, non-floating) chroma-keyed frame — for places that
// just need one clean transparent frame of a character sheet (e.g. the
// room's small player avatar) without the title screen's full float/state
// machine. Shares the same module-level cache as useKeyedSpriteFrames, so
// this never re-processes a frame the title screen already keyed.
import { useKeyedSpriteFrames } from '@/hooks/use-keyed-sprite-frames'

export function KeyedSpriteImage({
  src,
  alt = '',
  className = '',
  draggable = false,
}: {
  src: string
  alt?: string
  className?: string
  draggable?: boolean
}) {
  const { frames } = useKeyedSpriteFrames([src])
  const keyedSrc = frames[src]
  if (!keyedSrc) return <span className={className} aria-hidden="true" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={keyedSrc} alt={alt} className={className} draggable={draggable} />
}
