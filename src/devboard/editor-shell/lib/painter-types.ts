/* =========================================================================
   像素绘制器 —— 共享类型 + 纯色彩工具函数（对齐《像素绘制器 V0.dev 投喂 Spec》§七）

   这里只放类型与不依赖 DOM/React 的纯函数，供组件树与接线层共同引用。
   TextureData / PixelPainterSaveResult 是硬性接口（§7.1），字段不可再改。
   ========================================================================= */

/** 画布固定 128×128，PNG dataURL（RGBA，透明保留）——硬性接口，不可改尺寸。 */
export interface TextureData {
  width: 128
  height: 128
  dataUrl: string
}

/** onSave 回调载荷（硬性接口） */
export interface PixelPainterSaveResult {
  materialId: string
  texture: TextureData
}

export type PainterTool = 'brush' | 'eraser' | 'eyedropper'

export const CANVAS_SIZE = 128
export const ZOOM_MIN = 2
export const ZOOM_MAX = 16
export const ZOOM_DEFAULT = 8
export const GRID_MIN_ZOOM = 4
export const HISTORY_LIMIT = 50
export const CUSTOM_SLOTS = 8

/** 两排固定常用色（§2.2）：语义色 12 格 */
export const SEMANTIC_COLORS: string[] = [
  '#e53e3e',
  '#3182ce',
  '#d69e2e',
  '#dd6b20',
  '#38a169',
  '#805ad5',
  '#f56565',
  '#06b6d4',
  '#627383',
  '#a8b2bd',
  '#0d1824',
  '#ffffff',
]

/** 中间常用色（§2.2）：8 格 */
export const MIDTONE_COLORS: string[] = [
  '#f2c6a0',
  '#8a5a2b',
  '#9aa5b1',
  '#6ab04c',
  '#7ac8e7',
  '#f78fb3',
  '#5c3a21',
  '#111111',
]

/* --------------------------------------------------------------- 颜色转换 ---- */

export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16) || 0
  const g = Number.parseInt(h.slice(2, 4), 16) || 0
  const b = Number.parseInt(h.slice(4, 6), 16) || 0
  return [r, g, b, alpha]
}

export function rgbaToHex(rgba: [number, number, number, number]): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`.toLowerCase()
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r0, g0, b0] = hexToRgba(hex)
  const r = r0 / 255
  const g = g0 / 255
  const b = b0 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100
  const lN = l / 100
  const c = (1 - Math.abs(2 * lN - 1)) * sN
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lN - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
