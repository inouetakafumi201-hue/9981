'use client'

import { tileStyle } from '@/lib/materials'

/**
 * 素材贴图 —— 在编辑器 8×8 像素图集之上，按 glow 叠一层青色/暖色径向辉光
 * (lib-glow-*)，用同一套像素资源还原「像素前景 + 全息能量道具」的观感。
 * 只接收 tile + glow 两个最小字段，素材卡片与蓝本封面均可复用。外框由调用方决定。
 *
 * `textureUrl`：像素绘制器保存后的自定义贴图（PNG dataURL）覆盖优先于图集
 * tile——玩家改绘合成物贴图后，素材库卡片/详情预览随之更新（Spec §八验收）。
 */
export function LibTile({
  tile,
  glow = null,
  className = '',
  inset = '14%',
  textureUrl,
}: {
  tile: number
  glow?: 'cyan' | 'warm' | null
  className?: string
  inset?: string
  textureUrl?: string | null
}) {
  const glowClass = glow === 'cyan' ? 'lib-glow-cyan' : glow === 'warm' ? 'lib-glow-warm' : ''
  return (
    <div className={`relative ${glowClass} ${className}`}>
      {textureUrl ? (
        <div
          className="absolute [image-rendering:pixelated]"
          style={{
            inset,
            backgroundImage: `url(${textureUrl})`,
            backgroundSize: '100% 100%',
          }}
        />
      ) : (
        <div className="absolute" style={{ inset, ...tileStyle(tile) }} />
      )}
    </div>
  )
}
