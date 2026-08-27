'use client'

import type { BenchToken } from '@editor/lib/bench-data'
import { ACCENT_COLOR } from '@editor/lib/bench-data'

/**
 * 词条像素徽标（占位）：元素强调色底 + 首字，营造「印章/图腾」质感。真实版由
 * sprite-forge 产出词条贴图，这里保持同一尺寸接口以便无缝替换。
 * owned=false 时由外层套 .token-silhouette 压成剪影，这里只渲染本体。
 */
export function TokenEmblem({ token, className = '' }: { token: BenchToken; className?: string }) {
  const c = ACCENT_COLOR[token.accent]
  return (
    <span
      className={`lib-tile relative grid place-items-center overflow-hidden ${className}`}
      style={{ ['--glow' as string]: c }}
      aria-hidden
    >
      {/* 元素辉光底 */}
      <span
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at 50% 42%, color-mix(in srgb, ${c} 42%, transparent), transparent 68%)` }}
      />
      {/* 像素点阵微纹 */}
      <span
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 4px), repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 4px)',
        }}
      />
      <span
        className="relative font-mono text-[1.4em] font-black leading-none"
        style={{ color: c, textShadow: `0 0 10px ${c}` }}
      >
        {token.name.slice(0, 1)}
      </span>
    </span>
  )
}
