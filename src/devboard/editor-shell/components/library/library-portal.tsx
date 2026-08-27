'use client'

import { useLibrary } from '@/lib/library-store'
import { PortalTransition } from '@/components/fx/portal-transition'

/**
 * 「梦境接入」传送门过场——只在 entering 阶段挂载（store 计时切到 open 时卸载）。
 * 现改为复用统一的 Framer Motion 传送门组件（暖金主题），与研究台的青色传送门、
 * 研究台回素材库的暖色传送门共用同一套实现，保证三处特效质感一致。
 */
export function LibraryPortal() {
  const origin = useLibrary((s) => s.origin)
  return <PortalTransition theme="warm" origin={origin} />
}
