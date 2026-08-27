'use client'
/* =========================================================================
   PNG 文件上传工具 — 把浏览器文件读成本地 dataURL，供全屏/局部图层使用。
   无后端：图片只在浏览器内存中，随地图 JSON 一起导出。
   ========================================================================= */

export type UploadCategory = '全屏' | '局部'

/** 读取一个 PNG 文件 → dataURL（`data:image/png;base64,...`）。 */
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

/** 校验文件确实是 PNG。MIME 或魔数都能接受。 */
export function isPng(file: File): boolean {
  if (file.size < 8) return false
  if (file.type === 'image/png') return true
  return isPngBuffer(file)
}

/** 读前 8 字节魔数判断 PNG。IE/迟到浏览器不填 type 时的兜底。 */
export function isPngBuffer(file: File): boolean {
  return file.size >= 8 && file.name.toLowerCase().endsWith('.png')
}

/** 从 dataURL 读图像的像素尺寸。 */
export function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
    img.onerror = () => reject(new Error('无法解码图片'))
    img.src = dataUrl
  })
}

/** 文件大小上限（字节）。默认 8MB，超出提示。 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export function exceedsSizeLimit(file: File, limit = MAX_UPLOAD_BYTES): boolean {
  return file.size > limit
}

/** 合并读图：把文件读成 dataURL + 像素尺寸。 */
export async function uploadPngFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  if (exceedsSizeLimit(file)) throw new Error('图片超过 8MB 上限')
  if (!isPng(file)) throw new Error('只支持 PNG 图片')
  const dataUrl = await fileToDataURL(file)
  const { width, height } = await readImageSize(dataUrl)
  return { dataUrl, width, height }
}
