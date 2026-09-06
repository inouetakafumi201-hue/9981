'use client'
/* =========================================================================
   底图/图层文件上传工具 — 支持 SVG 与 PNG 格式。
   把浏览器文件读成本地 dataURL，供全屏底图/局部贴纸图层使用。
   无后端：图片只在浏览器内存中，随地图 JSON 一起导出。
   ========================================================================= */

export type UploadCategory = '全屏' | '局部'
export type ImageFormat = 'svg' | 'png'

/** 读取文件 → dataURL（`data:image/...;base64,...` 或 `data:image/svg+xml;utf8,...`）。 */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('文件读取结果不是字符串'))
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 校验文件是否为 SVG。 */
export function isSvg(file: File): boolean {
  if (file.type === 'image/svg+xml') return true
  return file.name.toLowerCase().endsWith('.svg')
}

/** 校验文件是否为 PNG。MIME 或魔数都能接受。 */
export function isPng(file: File): boolean {
  if (file.size < 8) return false
  if (file.type === 'image/png') return true
  return isPngBuffer(file)
}

/** 读前 8 字节魔数判断 PNG。IE/迟到浏览器不填 type 时的兜底。 */
export function isPngBuffer(file: File): boolean {
  return file.size >= 8 && file.name.toLowerCase().endsWith('.png')
}

/** 校验是否为支持的底图格式（SVG 或 PNG）。 */
export function isSupportedImage(file: File): boolean {
  return isSvg(file) || isPng(file)
}

/** 解析 SVG 字符串中的尺寸属性（viewBox / width / height）。 */
export function parseSvgDimensions(svgText: string): { width: number; height: number } | null {
  if (!svgText || typeof svgText !== 'string') return null

  // 1. 优先使用正则提取 viewBox (兼顾 Node/JSDOM/浏览器环境)
  const viewBoxMatch = svgText.match(/<svg[^>]*\sviewBox=["']([^"']+)["']/i)
  if (viewBoxMatch?.[1]) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! }
    }
  }

  // 2. 其次使用正则提取 width 和 height
  const widthMatch = svgText.match(/<svg[^>]*\swidth=["']([^"']+)["']/i)
  const heightMatch = svgText.match(/<svg[^>]*\sheight=["']([^"']+)["']/i)
  if (widthMatch?.[1] && heightMatch?.[1]) {
    const w = parseFloat(widthMatch[1])
    const h = parseFloat(heightMatch[1])
    if (w > 0 && h > 0) {
      return { width: w, height: h }
    }
  }

  // 3. 兜底尝试 DOMParser (如果在浏览器/支持 DOM 的环境中)
  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgText, 'image/svg+xml')
      const svg = doc.querySelector('svg')
      if (svg) {
        const viewBox = svg.getAttribute('viewBox')
        if (viewBox) {
          const parts = viewBox.trim().split(/[\s,]+/).map(Number)
          if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
            return { width: parts[2]!, height: parts[3]! }
          }
        }
      }
    }
  } catch {
    // 忽略
  }

  return null
}

/** 从 dataURL 或 Image 读图像的像素尺寸。 */
export function readImageSize(dataUrl: string, file?: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    // 如果是 SVG 文件，先尝试直接读取文本解析精度更高的 viewBox
    if (file && isSvg(file)) {
      const textReader = new FileReader()
      textReader.onload = () => {
        if (typeof textReader.result === 'string') {
          const dims = parseSvgDimensions(textReader.result)
          if (dims) {
            resolve(dims)
            return
          }
        }
        // 降级使用 Image 对象解码
        decodeViaImage(dataUrl, resolve, reject)
      }
      textReader.onerror = () => decodeViaImage(dataUrl, resolve, reject)
      textReader.readAsText(file)
      return
    }

    decodeViaImage(dataUrl, resolve, reject)
  })
}

function decodeViaImage(
  dataUrl: string,
  resolve: (val: { width: number; height: number }) => void,
  reject: (err: Error) => void,
) {
  const img = new Image()
  img.onload = () => {
    const width = img.naturalWidth || img.width || 1920
    const height = img.naturalHeight || img.height || 1080
    resolve({ width, height })
  }
  img.onerror = () => reject(new Error('无法解码图片（请确认 SVG / PNG 文件内容合法）'))
  img.src = dataUrl
}

/** 文件大小上限（字节）。默认 16MB，超出提示。 */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024
export function exceedsSizeLimit(file: File, limit = MAX_UPLOAD_BYTES): boolean {
  return file.size > limit
}

/**
 * 统一底图/图层上传：支持 SVG 与 PNG，把文件读成 dataURL + 尺寸 + 格式。
 */
export async function uploadImageFile(file: File): Promise<{
  dataUrl: string
  width: number
  height: number
  format: ImageFormat
}> {
  if (exceedsSizeLimit(file)) throw new Error('图片超过 16MB 上限')
  if (!isSupportedImage(file)) throw new Error('只支持 SVG 或 PNG 格式图片')

  const format: ImageFormat = isSvg(file) ? 'svg' : 'png'
  const dataUrl = await fileToDataURL(file)
  const { width, height } = await readImageSize(dataUrl, file)
  return { dataUrl, width, height, format }
}

/** 兼容旧版命名（uploadPngFile 转发至 uploadImageFile）。 */
export async function uploadPngFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const result = await uploadImageFile(file)
  return { dataUrl: result.dataUrl, width: result.width, height: result.height }
}
